// Runs a job: plan -> search -> extract -> match -> verify -> rank -> (summaries + refine) -> loop.
// Everything network-bound takes the run's AbortSignal so Stop cancels within a second.
import type {
  Candidate,
  CandidateMeta,
  Chunk,
  DebugInfo,
  DocText,
  JobError,
  JobState,
  JobStatus,
  JobWarning,
  OutputMode,
  Plan,
  RefineAnswer,
  Settings,
  SourceAdapter,
  SourceId,
  VerifiedMatch,
} from '../shared/types';
import { EXA_SOURCE_IDS, KEEP_AS_IS } from '../shared/types';
import { redactSecrets } from '../shared/settings';
import { hash32 } from '../shared/text';
import { estimateCostUsd, LlmError, type LlmClient, type LlmUsage } from './llm/deepseek';
import { isAbortError, mapLimit, sleep, type FetchLike } from './net';
import { constraintChips, fallbackPlan, isValuesClaim, makePlan, makeRefineCard, replan } from './plan';
import { acquireText, type Extractor } from './extract/getText';
import { makeChunks } from './extract/chunk';
import { selectChunks } from './extract/bm25';
import { BATCH_SIZE, matchBatch, sourceLabel, toBatches, type DocInfo } from './match/score';
import { localScopeNote, rankResults, type PoolEntry } from './match/rank';
import { summarizeResults } from './match/summarize';
import { adapterLabel, mergeCandidates, preRank, runSearch, selectForExtraction, shouldRunArxiv } from './sources';

export const MAX_ROUNDS = 3;
export const MAX_CHUNKS_PER_ROUND = 25;
const READ_CONCURRENCY = 8;
const MATCH_CONCURRENCY = 3;
const ADAPTER_LIMIT = 8;
/** Money kept back from matching so summaries and refine questions still fit under the cap. */
const RESERVE_USD = 0.004;
const EXA_SEARCH_EST_USD = 0.005;
const EXA_PAGE_EST_USD = 0.001;

export interface PipelineDeps {
  settings: Settings;
  /** Build the job's LLM client; every API response's usage must be reported through onUsage. */
  makeLlm: (onUsage: (u: LlmUsage, label: string) => void) => LlmClient;
  adapters: SourceAdapter[];
  extractor: Extractor;
  fetchImpl?: FetchLike;
  /** Whether we may fetch arbitrary pages (optional <all_urls> host permission granted). */
  canFetchPages: boolean;
  emit: (state: JobState) => void;
  now?: () => number;
  /** How long to wait for slow page/PDF reads before matching what we already have. */
  waveDeadlineMs?: number;
  /** Ask refine questions early if this much time passed and ≥ 3 results are verified. */
  refineEarlyMs?: number;
  /** Chunks per LLM match call (default 8). */
  matchBatchSize?: number;
}

export function emptyDebug(): DebugInfo {
  return {
    fabricatedIdsDropped: 0,
    unverifiedDropped: 0,
    injectionSentencesBlocked: 0,
    batchesSkipped: 0,
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    llmCostUsd: 0,
    exaCostUsd: 0,
    candidatesFound: 0,
    docsRead: 0,
    chunksMatched: 0,
    adapterCounts: {},
    timingsMs: {},
  };
}

export function newJobState(claim: string, mode: OutputMode, now: number): JobState {
  return {
    jobId: `job_${now.toString(36)}_${hash32(claim + now)}`,
    rawClaim: claim,
    mode,
    createdAt: now,
    updatedAt: now,
    status: 'planning',
    round: 1,
    maxRounds: MAX_ROUNDS,
    constraintChips: [],
    support: [],
    pushback: [],
    refineDismissed: false,
    answers: [],
    progress: { stage: 'planning', message: 'Planning the search…', percent: 3 },
    warnings: [],
    notRelevant: [],
    picked: [],
    academicOnly: false,
    valuesClaim: false,
    debug: emptyDebug(),
  };
}

function splitByline(byline: string): string[] {
  return byline
    .replace(/^by\s+/i, '')
    .split(/\s*(?:;|,\s*and\s+|\s+and\s+|,)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 80 && !/^\d/.test(s));
}

export class Job {
  readonly state: JobState;
  private readonly deps: PipelineDeps;
  private readonly llm: LlmClient;
  private runCtrl = new AbortController();
  private running = false;
  private candidates: Candidate[] = [];
  private readonly candidateById = new Map<string, Candidate>();
  private readonly attempted = new Set<string>();
  private readonly docs = new Map<string, DocInfo>();
  private readonly docByCandidate = new Map<string, string>();
  private readonly chunksByDoc = new Map<string, Chunk[]>();
  private readonly matchedChunks = new Set<string>();
  private readonly pool = new Map<string, PoolEntry>();
  private readonly signatures = new Map<SourceId, string>();
  private lastCounterSig = '';
  private readonly skipped = new Set<SourceId>();
  private exaOff: boolean;
  private nextDoc = 1;
  private costStopped = false;
  private refineStarted = false;
  private refinePromise: Promise<void> | null = null;
  private roundStartedAt = 0;
  /** Money spent before the current round started; the cost cap applies per search round. */
  private roundSpendStart = 0;
  private inFlightUsd = 0;
  private readonly startedAt: number;

  constructor(claim: string, mode: OutputMode, deps: PipelineDeps) {
    this.deps = deps;
    const now = this.now();
    this.startedAt = now;
    this.state = newJobState(claim, mode, now);
    this.llm = deps.makeLlm((u) => this.recordUsage(u));
    this.exaOff = !deps.settings.exaKey;
    const exaEnabled = EXA_SOURCE_IDS.some((id) => deps.settings.enabledSources[id]);
    if (!deps.settings.exaKey && exaEnabled) {
      this.state.academicOnly = true;
      this.warn('exa_missing', 'Web, news, think tank and government sources are off. Add an Exa key in options to turn them on.');
    }
    if (!deps.canFetchPages) {
      this.warn('no_host_permission', 'Backed can’t open web pages itself, so some sources show their abstract only.');
    }
  }

  /* ------------------------------ public API ------------------------------ */

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    await this.guard(async (signal) => {
      const t0 = this.now();
      this.setStatus('planning', 'Planning the search…', 5);
      let plan: Plan;
      try {
        plan = await makePlan(this.llm, this.state.rawClaim, this.state.mode, signal);
      } catch (e) {
        if (e instanceof LlmError && e.kind === 'malformed') {
          plan = fallbackPlan(this.state.rawClaim);
          this.warn('llm_batch_skipped', 'The planner’s answer was unusable, so a simple keyword search was used.');
        } else {
          throw e;
        }
      }
      this.state.debug.timingsMs.plan = this.now() - t0;
      this.setPlan(plan);
      await this.runRound(1, true, signal);
    });
  }

  stop(): void {
    if (!this.running) return;
    this.runCtrl.abort();
    this.running = false;
    this.state.status = 'stopped';
    this.state.refining = undefined;
    this.state.progress = { stage: 'stopped', message: 'Stopped. Results so far are kept.', percent: this.state.progress.percent };
    this.emit();
  }

  async answerRefine(answers: RefineAnswer[]): Promise<void> {
    if (this.running || !this.state.plan) return;
    const card = this.state.refine;
    const recorded = answers
      .filter((a) => a.answer.trim())
      .map((a) => ({ ...a, answer: a.answer.trim(), question: card?.questions.find((q) => q.id === a.questionId)?.text ?? a.questionId }));
    const effective = recorded.filter((a) => a.answer.toLowerCase() !== KEEP_AS_IS.toLowerCase());
    if (recorded.length) this.state.answers.push({ round: card?.round ?? this.state.round, answers: recorded });
    if (!effective.length) {
      this.state.refineDismissed = true;
      this.emit();
      return;
    }
    await this.refineRound(effective, undefined);
  }

  async searchAgain(freeText: string): Promise<void> {
    const text = freeText.trim();
    if (this.running || !this.state.plan || !text) return;
    this.state.answers.push({ round: this.state.round, answers: [], freeText: text });
    await this.refineRound([], text);
  }

  dismissRefine(): void {
    this.state.refineDismissed = true;
    this.emit();
  }

  markNotRelevant(candidateId: string): void {
    if (!this.state.notRelevant.includes(candidateId)) this.state.notRelevant.push(candidateId);
    this.state.picked = this.state.picked.filter((id) => id !== candidateId);
    this.rerank();
    this.emit();
  }

  togglePick(candidateId: string): void {
    const i = this.state.picked.indexOf(candidateId);
    if (i >= 0) this.state.picked.splice(i, 1);
    else if (this.pool.has(candidateId)) this.state.picked.push(candidateId);
    this.emit();
  }

  setMode(mode: OutputMode): void {
    this.state.mode = mode;
    this.rerank();
    this.emit();
  }

  /** Text we used for a candidate (for live re-verification in the debug panel). */
  docFor(candidateId: string): DocText | undefined {
    const id = this.docByCandidate.get(candidateId);
    return id ? this.docs.get(id)?.doc : undefined;
  }

  /* ------------------------------ rounds ------------------------------ */

  private async refineRound(answers: Array<{ questionId: string; answer: string }>, freeText: string | undefined): Promise<void> {
    if (this.state.round >= this.state.maxRounds) {
      this.warn('max_rounds', `That’s the maximum of ${this.state.maxRounds} search rounds. Pick from what’s here, or start a new search.`);
      this.state.refine = undefined;
      this.emit();
      return;
    }
    await this.guard(async (signal) => {
      const label = [...answers.map((a) => a.answer), ...(freeText ? [freeText] : [])].join(', ');
      this.state.refining = `Refining: ${label.length > 80 ? label.slice(0, 79) + '…' : label}`;
      this.setStatus('planning', 'Updating the search plan…', 5);
      const t0 = this.now();
      const plan = await replan({
        llm: this.llm,
        plan: this.state.plan as Plan,
        card: this.state.refine,
        answers,
        ...(freeText ? { freeText } : {}),
        notRelevantTitles: this.notRelevantTitles(),
        mode: this.state.mode,
        signal,
      });
      this.state.debug.timingsMs[`replan${this.state.round + 1}`] = this.now() - t0;
      this.setPlan(plan);
      this.state.round += 1;
      this.state.refine = undefined;
      this.state.refineDismissed = false;
      this.costStopped = false;
      await this.runRound(this.state.round, false, signal);
    });
  }

  private async runRound(round: number, first: boolean, signal: AbortSignal): Promise<void> {
    const plan = this.state.plan as Plan;
    this.roundStartedAt = this.now();
    this.refineStarted = false;
    this.refinePromise = null;

    /* ---- search ---- */
    this.setStatus('searching', round === 1 ? 'Searching sources…' : `Round ${round}: searching again…`, 12);
    this.roundSpendStart = this.spent();
    const usable = this.deps.adapters.filter((a) => this.adapterUsable(a, plan));
    let toRun = usable.filter((a) => first || this.signatures.get(a.id) !== a.signature(plan));
    const counterSig = `${plan.counterQuery}|${plan.constraints.side}|${plan.constraints.yearFrom ?? ''}|${plan.constraints.yearTo ?? ''}`;
    const runCounter = first || counterSig !== this.lastCounterSig;
    // The counter view always goes through OpenAlex; through Exa only when it matters most
    // (Debate mode or the user asked for the other side) — each Exa call costs real money.
    const exaCounter = this.state.mode === 'debate' || plan.constraints.side !== 'support';
    let counterAdapters = runCounter ? usable.filter((a) => a.id === 'openalex' || (a.id === 'exa_web' && exaCounter)) : [];
    const counterLimit = plan.constraints.side === 'attack' ? 5 : 3;

    // Cost cap (per search round): drop the least important Exa calls if they alone would exceed it.
    const exaCost = (n: number) => EXA_SEARCH_EST_USD + EXA_PAGE_EST_USD * n;
    const perCall = exaCost(this.deps.settings.exaResultsPerAdapter);
    const budget = this.deps.settings.costCapUsdPerSearch - 2 * RESERVE_USD;
    let exaEst = toRun.filter((a) => a.needsExaKey).length * perCall + counterAdapters.filter((a) => a.needsExaKey).length * exaCost(counterLimit);
    if (exaEst > budget) {
      counterAdapters = counterAdapters.filter((a) => !a.needsExaKey);
      for (const drop of ['exa_papers', 'exa_news', 'exa_policy', 'exa_web'] as SourceId[]) {
        exaEst = toRun.filter((a) => a.needsExaKey).length * perCall;
        if (exaEst <= budget) break;
        toRun = toRun.filter((a) => a.id !== drop);
      }
      this.warn('cost_cap', 'Some web searches were skipped to stay under your cost cap per search.');
    }
    for (const a of toRun) this.signatures.set(a.id, a.signature(plan));
    if (runCounter) this.lastCounterSig = counterSig;

    const t0 = this.now();
    const found = toRun.length || counterAdapters.length
      ? await runSearch({
          adapters: toRun,
          plan,
          signal,
          limitPerAdapter: ADAPTER_LIMIT,
          counterAdapters,
          counterLimit,
          round,
          onProgress: (e) => {
            const prev = this.state.debug.adapterCounts[e.sourceId] ?? 0;
            this.state.debug.adapterCounts[e.sourceId] = prev + e.count;
            this.setStatus('searching', `${adapterLabel(e.sourceId)}: ${e.count} result${e.count === 1 ? '' : 's'}${e.counter ? ' (counter view)' : ''}`, Math.min(30, this.state.progress.percent + 3));
          },
          onAdapterError: (id, kind, message) => this.onAdapterError(id, kind, message),
          onCost: (usd) => {
            this.state.debug.exaCostUsd += usd;
          },
        })
      : [];
    this.state.debug.timingsMs[`search${round}`] = this.now() - t0;
    this.candidates = mergeCandidates(this.candidates, found);
    for (const c of this.candidates) this.candidateById.set(c.id, c);
    this.state.debug.candidatesFound = this.candidates.length;

    /* ---- choose what to read ---- */
    const notRelevant = new Set(this.state.notRelevant);
    const ranked = preRank(this.candidates.filter((c) => !notRelevant.has(c.id)), plan);
    const toRead = selectForExtraction(ranked, this.deps.settings.maxCandidates, {
      reserveCounter: counterLimit,
      exclude: new Set(this.attempted),
    });

    if (toRead.length) await this.readAndMatch(toRead, plan, round, signal);
    this.rerank();
    this.emit();

    /* ---- summaries + refine questions (in parallel) ---- */
    this.setStatus('refining', 'Summarizing and checking for gaps…', 92);
    const t1 = this.now();
    if (!this.refineStarted) this.startRefine(signal);
    await Promise.all([this.runSummaries(signal), this.refinePromise]);
    this.state.debug.timingsMs[`finish${round}`] = this.now() - t1;
    this.state.debug.timingsMs.total = this.now() - this.startedAt;

    this.state.refining = undefined;
    this.setStatus('ready', this.state.support.length || this.state.pushback.length ? 'Done. Pick the sources that fit your argument.' : 'Nothing solid found.', 100);
  }

  private async readAndMatch(toRead: Candidate[], plan: Plan, round: number, signal: AbortSignal): Promise<void> {
    this.setStatus('reading', `Reading ${toRead.length} source${toRead.length === 1 ? '' : 's'}…`, 32);
    const ready: DocInfo[] = [];
    let done = 0;
    for (const c of toRead) this.attempted.add(c.id);
    const t0 = this.now();
    const readAll = mapLimit(toRead, READ_CONCURRENCY, async (c) => {
      const docId = `d${this.nextDoc++}`;
      try {
        const doc = await acquireText(c, docId, {
          extractor: this.deps.extractor,
          signal,
          keyTerms: plan.keyTerms,
          canFetchPages: this.deps.canFetchPages,
          ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
        });
        if (doc) ready.push(this.registerDoc(c, doc));
      } catch (e) {
        if (isAbortError(e) || signal.aborted) throw e;
        // An unreadable source is skipped; it never breaks the job.
      } finally {
        done++;
        if (!signal.aborted) this.setStatus('reading', `Read ${done} of ${toRead.length} sources`, 32 + Math.round((done / toRead.length) * 20));
      }
    });
    const readDone = readAll.then(
      () => true,
      () => true,
    );

    // Wave 1: whatever is ready at the deadline (Exa text and abstracts are instant).
    await Promise.race([readDone, sleep(this.deps.waveDeadlineMs ?? 6000, signal).then(() => false)]);
    if (signal.aborted) throw abortErr();
    const total = toRead.length;
    let budget = MAX_CHUNKS_PER_ROUND;
    const wave1 = ready.splice(0);
    let readFinished = false;
    void readDone.then(() => {
      readFinished = true;
    });
    if (wave1.length) {
      const share = readFinished ? budget : Math.max(Math.min(wave1.length, budget), Math.round((budget * wave1.length) / total));
      budget -= await this.matchWave(wave1, plan, round, share, signal);
    }
    await readAll; // rethrows abort
    this.state.debug.timingsMs[`read${round}`] = this.now() - t0;
    const wave2 = ready.splice(0);
    if (wave2.length && !this.costStopped) {
      await this.matchWave(wave2, plan, round, Math.max(budget, Math.min(wave2.length, 10)), signal);
    }
  }

  /** Returns how many chunks were sent. */
  private async matchWave(infos: DocInfo[], plan: Plan, round: number, budget: number, signal: AbortSignal): Promise<number> {
    if (!infos.length || budget <= 0) return 0;
    const docs = infos.map((i) => i.doc);
    for (const d of docs) if (!this.chunksByDoc.has(d.docId)) this.chunksByDoc.set(d.docId, makeChunks(d));
    const counterDocIds = new Set(infos.filter((i) => i.forCounter).map((i) => i.doc.docId));
    const chosen = selectChunks({ docs, chunksByDoc: this.chunksByDoc, plan, counterDocIds, perDoc: 3, total: budget })
      .map((s) => s.chunk)
      .filter((c) => !this.matchedChunks.has(c.id));
    if (!chosen.length) return 0;
    this.setStatus('matching', `Checking ${chosen.length} passages…`, 55);
    const batches = toBatches(chosen, this.deps.matchBatchSize ?? BATCH_SIZE);
    let sent = 0;
    let finished = 0;
    const t0 = this.now();
    await mapLimit(batches, MATCH_CONCURRENCY, async (batch, i) => {
      if (signal.aborted || this.costStopped) return;
      const chars = 6000 + batch.reduce((n, c) => n + this.chunkChars(c), 0);
      const est = estimateCostUsd(chars, 160 * batch.length + 200, this.deps.settings.prices);
      // Count batches already in flight so concurrent batches can't all slip under the cap.
      if (this.roundSpent() + this.inFlightUsd + est > this.deps.settings.costCapUsdPerSearch - RESERVE_USD) {
        this.costStopped = true;
        this.warn('cost_cap', `Stopped checking passages at your $${this.deps.settings.costCapUsdPerSearch.toFixed(2)} cost cap. Showing what’s verified so far.`);
        return;
      }
      for (const c of batch) this.matchedChunks.add(c.id);
      sent += batch.length;
      this.inFlightUsd += est;
      let out;
      try {
        out = await matchBatch({ llm: this.llm, plan, chunks: batch, docs: this.docs, signal, label: `match r${round}#${i + 1}` });
      } finally {
        this.inFlightUsd -= est;
      }
      const d = this.state.debug;
      d.chunksMatched += batch.length;
      d.fabricatedIdsDropped += out.stats.fabricatedIds;
      d.unverifiedDropped += out.stats.unverified;
      d.injectionSentencesBlocked += out.stats.injection;
      if (out.skipped) {
        d.batchesSkipped++;
        this.warn('llm_batch_skipped', 'Some passages couldn’t be checked (the AI’s answer was unusable) and were skipped.');
      }
      for (const m of out.verified) this.addMatch(m, round);
      finished++;
      this.rerank();
      if ((this.state.support.length || this.state.pushback.length) && d.firstResultMs === undefined) d.firstResultMs = this.now() - this.startedAt;
      this.setStatus('matching', `Checked ${finished} of ${batches.length} batches · ${this.state.support.length + this.state.pushback.length} verified`, 55 + Math.round((finished / batches.length) * 35));
      // Ask refine questions early if matching drags on.
      const verifiedCount = this.state.support.length + this.state.pushback.length;
      if (!this.refineStarted && verifiedCount >= 3 && this.now() - this.startedAt >= (this.deps.refineEarlyMs ?? 20_000)) this.startRefine(signal);
    });
    this.state.debug.timingsMs[`match${round}`] = (this.state.debug.timingsMs[`match${round}`] ?? 0) + (this.now() - t0);
    return sent;
  }

  /* ------------------------------ helpers ------------------------------ */

  private startRefine(signal: AbortSignal): void {
    this.refineStarted = true;
    const round = this.state.round;
    if (round >= this.state.maxRounds || this.costStopped || !(this.state.support.length + this.state.pushback.length)) {
      this.state.refine = undefined;
      this.refinePromise = Promise.resolve();
      return;
    }
    const t0 = this.now();
    this.refinePromise = makeRefineCard({
      llm: this.llm,
      plan: this.state.plan as Plan,
      results: [...this.state.support, ...this.state.pushback],
      notRelevantTitles: this.notRelevantTitles(),
      previousAnswers: this.state.answers,
      round,
      signal,
    }).then(
      (card) => {
        this.state.debug.timingsMs[`refine${round}`] = this.now() - t0;
        this.state.refine = card;
        this.state.refineDismissed = false;
        this.emit();
      },
      (e: unknown) => this.softLlmFailure(e, 'Couldn’t prepare follow-up questions this time.'),
    );
  }

  private async runSummaries(signal: AbortSignal): Promise<void> {
    const visible = [...this.state.support, ...this.state.pushback].filter((r) => !r.summary);
    const targets = visible
      .map((r) => ({ result: r, doc: this.docFor(r.candidateId) }))
      .filter((t): t is { result: (typeof visible)[number]; doc: DocText } => !!t.doc);
    if (!targets.length) return;
    const est = estimateCostUsd(3000 + targets.length * 2000, 260 * targets.length, this.deps.settings.prices);
    if (this.roundSpent() + est > this.deps.settings.costCapUsdPerSearch * 1.1) {
      this.warn('cost_cap', 'Skipped AI summaries to stay under your cost cap. The verified quotations are shown.');
      return;
    }
    const t0 = this.now();
    try {
      const summaries = await summarizeResults({ llm: this.llm, claim: (this.state.plan as Plan).normalizedClaim, targets, signal });
      for (const [candidateId, s] of summaries) {
        const entry = this.pool.get(candidateId);
        if (entry) entry.summary = s;
      }
      this.rerank();
      this.emit();
    } catch (e) {
      this.softLlmFailure(e, 'Couldn’t write summaries this time. The verified quotations are shown.');
    }
    this.state.debug.timingsMs[`summaries${this.state.round}`] = this.now() - t0;
  }

  /** Summary/refine failures don't end the job, except a bad key or empty balance. */
  private softLlmFailure(e: unknown, message: string): void {
    if (isAbortError(e)) return;
    if (e instanceof LlmError && (e.kind === 'auth' || e.kind === 'balance')) {
      this.fail(e);
      return;
    }
    this.warn('summary_failed', message);
  }

  private registerDoc(c: Candidate, doc: DocText): DocInfo {
    const info: DocInfo = { doc, candidateId: c.id, label: sourceLabel(c.title || doc.title || c.url, c.publisher, c.published ?? doc.published), forCounter: !!c.forCounter };
    this.docs.set(doc.docId, info);
    this.docByCandidate.set(c.id, doc.docId);
    this.state.debug.docsRead++;
    return info;
  }

  private chunkChars(c: Chunk): number {
    const doc = this.docs.get(c.docId)?.doc;
    if (!doc) return 0;
    return doc.sentences.slice(c.sentenceStart, c.sentenceEnd + 1).reduce((n, s) => n + s.text.length + 12, 0);
  }

  private addMatch(m: VerifiedMatch, round: number): void {
    let entry = this.pool.get(m.candidateId);
    if (!entry) {
      const c = this.candidateById.get(m.candidateId);
      const info = this.docs.get(m.docId);
      if (!c || !info) return;
      entry = {
        candidateId: c.id,
        meta: this.metaFor(c, info.doc),
        textSource: info.doc.textSource,
        finalUrl: info.doc.finalUrl,
        round: c.round ?? round,
        matches: [],
      };
      // A source first shown in this round is "new" in this round.
      entry.round = round;
      this.pool.set(c.id, entry);
    }
    if (!entry.matches.some((x) => x.chunkId === m.chunkId && x.sentenceIds.join() === m.sentenceIds.join())) entry.matches.push(m);
  }

  private metaFor(c: Candidate, doc: DocText): CandidateMeta {
    const meta: CandidateMeta = {
      id: c.id,
      sourceId: c.sourceId,
      tier: c.tier,
      title: c.title || doc.title || c.url,
      url: c.url,
      authors: c.authors.length ? c.authors : doc.byline ? splitByline(doc.byline) : [],
    };
    if (c.pdfUrl) meta.pdfUrl = c.pdfUrl;
    if (c.doi) meta.doi = c.doi;
    if (c.publisher) meta.publisher = c.publisher;
    const published = c.published ?? doc.published;
    if (published) meta.published = published;
    if (c.citedByCount !== undefined) meta.citedByCount = c.citedByCount;
    if (c.lowQuality) meta.lowQuality = true;
    if (c.isWikipedia) meta.isWikipedia = true;
    return meta;
  }

  private rerank(): void {
    const plan = this.state.plan;
    for (const entry of this.pool.values()) {
      const note = plan ? localScopeNote(entry.meta.published, plan.constraints.yearFrom, plan.constraints.yearTo) : undefined;
      if (note) entry.localScopeNote = note;
      else delete entry.localScopeNote;
    }
    const { support, pushback } = rankResults([...this.pool.values()], {
      mode: this.state.mode,
      notRelevant: new Set(this.state.notRelevant),
      nowYear: new Date(this.now()).getUTCFullYear(),
      side: plan?.constraints.side ?? 'support',
    });
    this.state.support = support;
    this.state.pushback = pushback;
    const visible = new Set([...support, ...pushback].map((r) => r.candidateId));
    this.state.picked = this.state.picked.filter((id) => visible.has(id) || this.pool.has(id));
  }

  private adapterUsable(a: SourceAdapter, plan: Plan): boolean {
    if (!this.deps.settings.enabledSources[a.id]) return false;
    if (this.skipped.has(a.id)) return false;
    if (a.needsExaKey && (this.exaOff || !this.deps.settings.exaKey)) return false;
    if (a.id === 'arxiv' && !shouldRunArxiv(plan)) return false;
    return true;
  }

  private onAdapterError(id: SourceId, kind: string, message: string): void {
    const isExa = EXA_SOURCE_IDS.includes(id);
    if (isExa && kind === 'auth') {
      if (!this.exaOff) {
        this.exaOff = true;
        this.state.academicOnly = true;
        this.warn('exa_invalid', 'Exa rejected your key, so this search uses academic sources only. Check your Exa key in options.');
      }
      return;
    }
    if (isExa && (kind === 'rate_limited' || kind === 'out_of_credits')) {
      if (!this.exaOff) {
        this.exaOff = true;
        this.warn(
          'exa_limited',
          kind === 'out_of_credits'
            ? 'Exa is out of credits, so web, news and think tank results were skipped. Academic results are still shown.'
            : 'Exa is rate-limiting requests, so web, news and think tank results were skipped for this search.',
        );
      }
      return;
    }
    if (id === 'semantic_scholar' && kind === 'rate_limited') {
      this.skipped.add(id);
      this.warn('s2_limited', 'Semantic Scholar is busy, so it was skipped for this search.');
      return;
    }
    this.warn('adapter_failed', `${adapterLabel(id)} didn’t answer (${kind.replace('_', ' ')}). Other sources are still shown.`);
    void message;
  }

  private notRelevantTitles(): string[] {
    return this.state.notRelevant.map((id) => this.pool.get(id)?.meta.title ?? this.candidateById.get(id)?.title ?? '').filter(Boolean);
  }

  private setPlan(plan: Plan): void {
    this.state.plan = plan;
    this.state.constraintChips = constraintChips(plan);
    this.state.valuesClaim = isValuesClaim(plan);
    this.emit();
  }

  private spent(): number {
    return this.state.debug.llmCostUsd + this.state.debug.exaCostUsd;
  }

  private roundSpent(): number {
    return this.spent() - this.roundSpendStart;
  }

  private recordUsage(u: LlmUsage): void {
    const d = this.state.debug;
    d.llmCalls++;
    d.tokensIn += u.promptTokens;
    d.tokensOut += u.completionTokens;
    d.llmCostUsd += u.costUsd;
  }

  private warn(code: JobWarning['code'], message: string): void {
    if (this.state.warnings.some((w) => w.code === code && w.message === message)) return;
    this.state.warnings.push({ code, message });
    this.emit();
  }

  private setStatus(status: JobStatus, message: string, percent: number): void {
    if (this.runCtrl.signal.aborted && status !== 'stopped') return;
    this.state.status = status;
    this.state.progress = { stage: status, message, percent: Math.max(0, Math.min(100, percent)) };
    this.emit();
  }

  private fail(e: unknown): void {
    let error: JobError;
    if (e instanceof LlmError) {
      if (e.kind === 'auth') error = { code: 'deepseek_key', message: 'Check your DeepSeek key.', showOptionsLink: true };
      else if (e.kind === 'balance') error = { code: 'deepseek_balance', message: 'Your DeepSeek balance is empty. Top up, then try again.', showOptionsLink: true };
      else if (e.kind === 'unavailable') error = { code: 'deepseek_unavailable', message: `${e.message} Results so far are kept.` };
      else error = { code: 'internal', message: e.message, showOptionsLink: e.kind === 'bad_request' };
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      error = { code: 'internal', message: `Something went wrong: ${msg}` };
    }
    error.message = redactSecrets(error.message, [this.deps.settings.deepseekKey, this.deps.settings.exaKey, this.deps.settings.openalexKey]);
    this.state.error = error;
    this.state.status = 'error';
    this.state.refining = undefined;
    this.running = false;
    this.runCtrl.abort();
    this.state.progress = { stage: 'error', message: error.message, percent: this.state.progress.percent };
    this.emit();
  }

  /** Run one operation with a fresh AbortController; map errors to state. */
  private async guard(fn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.runCtrl = new AbortController();
    const signal = this.runCtrl.signal;
    this.running = true;
    this.state.error = undefined;
    try {
      await fn(signal);
    } catch (e) {
      if (signal.aborted || isAbortError(e)) {
        if (this.state.status !== 'error') this.state.status = 'stopped';
      } else {
        this.fail(e);
      }
    } finally {
      if (this.runCtrl.signal === signal) this.running = false;
      this.emit();
    }
  }

  private emit(): void {
    this.state.updatedAt = this.now();
    this.deps.emit(this.state);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function abortErr(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}
