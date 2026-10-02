// Whole pipeline on fixtures with mocked network and a scripted DeepSeek.
import { describe, expect, it } from 'vitest';
import { Job } from '../../src/background/pipeline';
import { isVerbatimIn } from '../../src/background/match/verify';
import { looksLikeInjection } from '../../src/background/llm/prompts';
import { openAtPassageUrl } from '../../src/shared/cite';
import type { JobState, SourceResult } from '../../src/shared/types';
import { makeDeps, makeWorld } from './world';

const CLAIM = "Raising the minimum wage doesn't significantly reduce employment.";

function shown(s: JobState): SourceResult[] {
  return [...s.support, ...s.pushback];
}

/** The core guarantee: every passage on screen is a verbatim substring of the text we used. */
function assertAllVerified(job: Job): void {
  for (const r of shown(job.state)) {
    const doc = job.docFor(r.candidateId);
    expect(doc, r.meta.title).toBeDefined();
    for (const m of [r.best, ...r.more]) {
      expect(m.verification.verbatim).toBe(true);
      for (const f of m.fragments) {
        expect(doc!.text.slice(f.charStart, f.charEnd)).toBe(f.text);
        expect(isVerbatimIn(doc!.text, f.text)).toBe(true);
        expect(f.parts.map((p) => p.text).join('')).toBe(f.text);
      }
      for (const id of m.sentenceIds) expect(doc!.sentences.some((s) => s.id === id)).toBe(true);
      expect(looksLikeInjection(m.passage)).toBe(false);
    }
  }
}

describe('pipeline: first round', () => {
  it('plans, searches, reads, matches, verifies, ranks, summarizes and asks grounded questions', async () => {
    const world = makeWorld();
    const deps = makeDeps(world);
    const job = new Job(CLAIM, 'paper', deps);
    await job.start();
    const s = job.state;

    expect(s.status).toBe('ready');
    expect(s.plan?.normalizedClaim).toBe(CLAIM);
    expect(s.support.length).toBeGreaterThanOrEqual(3);
    expect(s.pushback.map((r) => r.meta.title)).toContain('Minimum Wage Increases, Wages, and Low-Wage Employment: Evidence from Seattle');
    assertAllVerified(job);

    // Same paper from OpenAlex + Exa collapsed to one card, keeping Exa's text.
    const cengiz = shown(s).filter((r) => /Effect of Minimum Wages on Low-Wage Jobs/.test(r.meta.title));
    expect(cengiz).toHaveLength(1);
    // The news article came from exa_web and exa_news (with utm params): one card.
    expect(shown(s).filter((r) => r.meta.title.startsWith('Study finds minimum wage'))).toHaveLength(1);

    // Card & Krueger came from the open-access PDF; the match is on page 70 of 80 (huge-PDF path).
    const ck = shown(s).find((r) => r.meta.title.startsWith('Minimum Wages and Employment'));
    expect(ck?.textSource).toBe('pdf');
    expect(ck?.best.verification.page).toBe(70);
    expect(openAtPassageUrl(ck!)).toMatch(/ck1994\.pdf#page=70$/);
    expect(job.docFor(ck!.candidateId)?.text).not.toContain('AMERICAN ECONOMIC REVIEW'); // running header stripped

    // Paywalled page fell back to its snippet and is never presented as full text.
    const paywalled = job.docFor(shown(s).find((r) => r.meta.url.includes('paywalled'))?.candidateId ?? '');
    if (paywalled) expect(paywalled.textSource).toBe('abstract_only');

    // Prompt injection page: never shown with the injected sentence.
    for (const r of shown(s)) expect(r.best.passage).not.toMatch(/ignore previous instructions/i);
    expect(s.debug.injectionSentencesBlocked).toBeGreaterThanOrEqual(1);

    // Fabricated sentence IDs and the ghost chunk were dropped and counted.
    expect(s.debug.fabricatedIdsDropped).toBeGreaterThanOrEqual(2);

    // Non-English Exa result filtered out.
    expect(shown(s).some((r) => r.meta.url.includes('elpais'))).toBe(false);

    // Summaries: labelled data, invented number sentence dropped.
    const withSummary = shown(s).filter((r) => r.summary);
    expect(withSummary.length).toBeGreaterThan(0);
    for (const r of withSummary) {
      expect(r.summary!.summary).not.toContain('987654');
      expect(r.summary!.droppedSentences).toBe(1);
    }

    // Semantic Scholar was rate limited: skipped with a small warning, job unaffected.
    expect(s.warnings.map((w) => w.code)).toContain('s2_limited');
    // arXiv doesn't run for an economics claim.
    expect(world.calls.adapters.some((c) => c.source === 'arxiv')).toBe(false);

    // Refine card grounded in the results (all US) and asked after matching.
    expect(s.refine?.questions[0]).toMatchObject({ affects: 'regions' });
    expect(s.refine?.questions[0]?.options).toContain('Keep as is');
    expect(s.debug.firstResultMs).toBeDefined();
    const firstResultState = deps.states.find((x) => x.support.length + x.pushback.length > 0);
    expect(firstResultState?.refine).toBeUndefined(); // first verified result streamed before any question

    // Cost tracked for DeepSeek and Exa, well under the cap.
    expect(s.debug.llmCostUsd).toBeGreaterThan(0);
    expect(s.debug.exaCostUsd).toBeGreaterThan(0);
    expect(s.debug.llmCostUsd + s.debug.exaCostUsd).toBeLessThan(0.05);
  });
});

describe('pipeline: refine rounds', () => {
  it('region answer → re-plan → only adapters whose requests changed re-run → results merge with New badges', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    const before = shown(job.state).map((r) => r.candidateId);
    expect(before.length).toBeGreaterThan(0);
    const counterRound1 = world.calls.adapters.filter((c) => /reduce employment and hours/.test(c.query)).length;

    world.round = 2;
    await job.answerRefine([{ questionId: 'region', answer: 'Vietnam' }]);
    const s = job.state;
    expect(s.status).toBe('ready');
    expect(s.round).toBe(2);
    expect(s.constraintChips).toContain('Vietnam');
    expect(s.answers[0]?.answers[0]).toMatchObject({ questionId: 'region', answer: 'Vietnam' });

    // Nothing the user saw was wiped.
    for (const id of before) expect(shown(s).map((r) => r.candidateId).concat(s.notRelevant)).toContain(id);
    // The new Vietnam study arrived in round 2 → "New".
    const vn = shown(s).find((r) => r.meta.title.includes('Vietnam'));
    expect(vn?.round).toBe(2);
    expect(shown(s).filter((r) => r.round === 1).length).toBeGreaterThan(0);

    // Round 2 only re-ran adapters whose request changed; the counter search (unchanged) did not re-run; S2 stays skipped.
    const r2 = world.calls.adapters.filter((c) => c.round === 2);
    expect(r2.some((c) => c.source === 'openalex')).toBe(true);
    expect(r2.some((c) => c.source === 'semantic_scholar')).toBe(false);
    expect(world.calls.adapters.filter((c) => /reduce employment and hours/.test(c.query)).length).toBe(counterRound1);
    assertAllVerified(job);
  });

  it('source-mix answer that only changes policy queries re-runs only the policy adapter', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    world.round = 2;
    await job.answerRefine([{ questionId: 'region', answer: 'More government and think tank sources' }]);
    const r2 = world.calls.adapters.filter((c) => c.round === 2).map((c) => c.source);
    expect(r2).toEqual(['exa_policy']);
    expect(job.state.round).toBe(2);
  });

  it('an answer sent while the first round is still finishing is queued, not lost', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    const run = job.start();
    // Answer as soon as the refine card shows up (summaries may still be running).
    while (!job.state.refine) await new Promise((r) => setTimeout(r, 5));
    world.round = 2;
    const answered = job.answerRefine([{ questionId: 'region', answer: 'Vietnam' }]);
    await run;
    await answered;
    expect(job.state.round).toBe(2);
    expect(job.state.constraintChips).toContain('Vietnam');
  });

  it('"Keep as is" changes nothing and just dismisses the card', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    const calls = world.calls.deepseek.length;
    await job.answerRefine([{ questionId: 'region', answer: 'Keep as is' }]);
    expect(job.state.refineDismissed).toBe(true);
    expect(job.state.round).toBe(1);
    expect(world.calls.deepseek.length).toBe(calls);
  });

  it('stops after 3 rounds and then only shows the pick prompt', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    await job.searchAgain('More government and think tank sources');
    expect(job.state.round).toBe(2);
    await job.searchAgain('Vietnam please');
    expect(job.state.round).toBe(3);
    expect(job.state.refine).toBeUndefined();
    await job.searchAgain('anything else');
    expect(job.state.round).toBe(3);
    expect(job.state.warnings.map((w) => w.code)).toContain('max_rounds');
  });

  it('Not relevant removes the card and feeds the next refine/re-plan', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    const victim = job.state.support[0]!;
    job.togglePick(victim.candidateId);
    job.markNotRelevant(victim.candidateId);
    expect(shown(job.state).map((r) => r.candidateId)).not.toContain(victim.candidateId);
    expect(job.state.picked).not.toContain(victim.candidateId);
  });

  it('mode switch re-ranks without any new network call', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    const n = world.calls.deepseek.length + world.calls.adapters.length;
    job.setMode('debate');
    job.setMode('paper');
    expect(world.calls.deepseek.length + world.calls.adapters.length).toBe(n);
    expect(job.state.mode).toBe('paper');
  });
});

describe('pipeline: failure modes', () => {
  it('DeepSeek 401 → stops with "Check your DeepSeek key" and an options link', async () => {
    const job = new Job(CLAIM, 'essay', makeDeps(makeWorld({ statusForCall: { 1: 401 } })));
    await job.start();
    expect(job.state.status).toBe('error');
    expect(job.state.error).toMatchObject({ code: 'deepseek_key', showOptionsLink: true });
    expect(job.state.error?.message).toMatch(/Check your DeepSeek key/);
    expect(JSON.stringify(job.state)).not.toContain('sk-test-deepseek-key');
  });

  it('DeepSeek 5xx on later batches → retried twice, then a clear error with partial results kept', async () => {
    const world = makeWorld({ matchFailFrom: { call: 2, status: 503 } });
    const job = new Job(CLAIM, 'essay', makeDeps(world, {}, { matchBatchSize: 2 }));
    await job.start();
    expect(job.state.error?.code).toBe('deepseek_unavailable');
    expect(job.state.error?.message).toMatch(/kept/);
    expect(shown(job.state).length).toBeGreaterThan(0);
    assertAllVerified(job);
  });

  it('malformed match JSON → one repair retry, then the batch is skipped and noted', async () => {
    const world = makeWorld({ malformedMatchCalls: new Set([1, 2]) });
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    expect(job.state.status).toBe('ready');
    expect(job.state.debug.batchesSkipped).toBe(1);
    expect(job.state.warnings.map((w) => w.code)).toContain('llm_batch_skipped');
    assertAllVerified(job);
  });

  it('no Exa key → academic-only mode with a banner, no Exa calls', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world, { exaKey: '' }));
    await job.start();
    expect(job.state.academicOnly).toBe(true);
    expect(job.state.warnings.map((w) => w.code)).toContain('exa_missing');
    expect(world.calls.adapters.some((c) => c.source.startsWith('exa'))).toBe(false);
    expect(shown(job.state).length).toBeGreaterThan(0);
  });

  it('Exa key invalid (401) → academic-only for this job, banner explains', async () => {
    const world = makeWorld({}, { exaStatus: 401 });
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    expect(job.state.academicOnly).toBe(true);
    expect(job.state.warnings.map((w) => w.code)).toContain('exa_invalid');
    expect(shown(job.state).length).toBeGreaterThan(0);
  });

  it.each([429, 402])('Exa %s → Exa skipped for this job, warning names it, academic results still shown', async (status) => {
    const world = makeWorld({}, { exaStatus: status });
    const job = new Job(CLAIM, 'essay', makeDeps(world));
    await job.start();
    const w = job.state.warnings.find((x) => x.code === 'exa_limited');
    expect(w?.message).toMatch(/Exa/);
    expect(shown(job.state).length).toBeGreaterThan(0);
    // Not retried in a later round.
    const before = world.calls.adapters.filter((c) => c.source.startsWith('exa')).length;
    world.round = 2;
    await job.answerRefine([{ questionId: 'region', answer: 'Vietnam' }]);
    expect(world.calls.adapters.filter((c) => c.source.startsWith('exa')).length).toBe(before);
  });

  it('cost cap hit → stops matching, keeps what is verified, adds a note', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world, { costCapUsdPerSearch: 0.0075, exaKey: '' }, { matchBatchSize: 1 }));
    await job.start();
    expect(job.state.warnings.map((w) => w.code)).toContain('cost_cap');
    const matchCalls = world.calls.deepseek.filter((c) => c.startsWith('match')).length;
    expect(matchCalls).toBeGreaterThan(0);
    expect(matchCalls).toBeLessThan(job.state.debug.docsRead * 3);
    expect(shown(job.state).length).toBeGreaterThan(0); // what was verified before the cap is shown
    expect(job.state.debug.llmCostUsd).toBeLessThan(0.0075 * 1.25);
    assertAllVerified(job);
  });

  it('Stop aborts in-flight work within 1s and keeps partial results', async () => {
    const world = makeWorld({ delayMs: 30 }, { pageDelayMs: 10_000 });
    const job = new Job(CLAIM, 'essay', makeDeps(world, {}, { waveDeadlineMs: 50 }));
    const run = job.start();
    // Let planning + search + the instant Exa-text wave finish while PDF/page fetches hang.
    for (let i = 0; i < 100 && job.state.support.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    const partial = shown(job.state).length;
    const t0 = Date.now();
    job.stop();
    await run;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(job.state.status).toBe('stopped');
    expect(shown(job.state).length).toBe(partial);
    expect(partial).toBeGreaterThan(0);
  });

  it('pages unreachable (no host permission) → abstract/Exa text only, with a note', async () => {
    const world = makeWorld();
    const job = new Job(CLAIM, 'essay', makeDeps(world, {}, { canFetchPages: false }));
    await job.start();
    expect(job.state.warnings.map((w) => w.code)).toContain('no_host_permission');
    for (const r of shown(job.state)) expect(['exa', 'abstract_only']).toContain(r.textSource);
    assertAllVerified(job);
  });
});
