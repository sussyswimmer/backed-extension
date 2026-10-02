// Source adapters registry + orchestration: run adapters in parallel, per-adapter timeout,
// isolate failures, dedupe. Public API used by the pipeline.

import type { AdapterErrorKind, Candidate, Plan, SourceAdapter, SourceId } from '../../shared/types';
import { TimeoutError, abortError, isAbortError, type FetchLike } from '../net';
import { createArxivAdapter } from './arxiv';
import { AdapterError, toAdapterError } from './errors';
import { createExaAdapter } from './exa';
import { createOpenAlexAdapter } from './openalex';
import { counterQueryOf, regionsOf, stableSignature, withRegionKeywords, withRegionSentence, yearBounds } from './query';
import { createSemanticScholarAdapter } from './semanticScholar';
import { dedupeCandidates } from './dedupe';
import { adapterLabel } from './labels';

export { AdapterError } from './errors';
export { adapterLabel } from './labels';
export { dedupeCandidates, mergeCandidates } from './dedupe';
export { preRank, selectForExtraction, shouldRunArxiv } from './rank';
export { tierForUrl, EXA_EXCLUDE_DOMAINS, POLICY_INCLUDE_DOMAINS, TIER_WEIGHT } from './tiers';
export { isEnglish } from './lang';
export { canonicalUrl, candidateIdFor, normalizeDoi } from './url';

export interface AdapterConfig {
  exaKey?: string;
  openalexKey?: string;
  contactEmail?: string;
  exaResultsPerAdapter: number;
  fetchImpl?: FetchLike;
}

/** All seven adapters, in display order. Exa adapters without a key throw AdapterError('auth') when searched. */
export function createAdapters(cfg: AdapterConfig): SourceAdapter[] {
  const fetchImpl = cfg.fetchImpl;
  const exaCfg = { exaKey: cfg.exaKey, exaResultsPerAdapter: cfg.exaResultsPerAdapter, fetchImpl };
  return [
    createOpenAlexAdapter({ openalexKey: cfg.openalexKey, contactEmail: cfg.contactEmail, fetchImpl }),
    createSemanticScholarAdapter({ fetchImpl }),
    createArxivAdapter({ fetchImpl }),
    createExaAdapter('exa_web', exaCfg),
    createExaAdapter('exa_news', exaCfg),
    createExaAdapter('exa_policy', exaCfg),
    createExaAdapter('exa_papers', exaCfg),
  ];
}

/**
 * Signature of the counter-query request an adapter would send (counterQuery + regions + years).
 * Lets the pipeline skip re-running the counter search when only other parts of the plan changed.
 */
export function counterSignature(adapter: SourceAdapter, plan: Plan): string {
  const q = counterQueryOf(plan);
  const regions = regionsOf(plan);
  const y = yearBounds(plan);
  const query = !q ? '' : adapter.needsExaKey ? withRegionSentence(q, regions) : withRegionKeywords(q, regions);
  return stableSignature(`${adapter.id}#counter`, { q: query, from: y.from ?? null, to: y.to ?? null });
}

export interface SearchRunOptions {
  adapters: SourceAdapter[];
  plan: Plan;
  signal: AbortSignal;
  limitPerAdapter: number;
  /** Also run plan.counterQuery through these adapters (limit counterLimit, default 3), marking results forCounter: true. */
  counterAdapters?: SourceAdapter[];
  counterLimit?: number;
  round: number;
  /** Per adapter call, default 10_000. */
  timeoutMs?: number;
  onProgress?: (e: { sourceId: SourceId; count: number; counter?: boolean }) => void;
  onAdapterError?: (sourceId: SourceId, kind: AdapterErrorKind, message: string) => void;
  onCost?: (usd: number) => void;
}

export const DEFAULT_ADAPTER_TIMEOUT_MS = 10_000;

interface Task {
  adapter: SourceAdapter;
  counter: boolean;
  limit: number;
}

/**
 * Run one adapter with its own timeout. The adapter gets a signal that aborts on job Stop or timeout;
 * the race guarantees we stop waiting even if an adapter ignores its signal.
 */
async function runTask(task: Task, opts: SearchRunOptions, timeoutMs: number): Promise<Candidate[]> {
  const { adapter } = task;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onJobAbort: (() => void) | undefined;
  let timedOut = false;
  const timeoutError = () => new AdapterError(adapter.id, 'timeout', `${adapterLabel(adapter.id)}: timed out after ${Math.round(timeoutMs / 1000)}s`);

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError());
      ctrl.abort(new TimeoutError());
    }, timeoutMs);
  });
  const jobAborted = new Promise<never>((_, reject) => {
    onJobAbort = () => {
      ctrl.abort(opts.signal.reason);
      reject(abortError());
    };
    if (opts.signal.aborted) onJobAbort();
    else opts.signal.addEventListener('abort', onJobAbort, { once: true });
  });
  // The losers of the race must not surface as unhandled rejections.
  timeout.catch(() => undefined);
  jobAborted.catch(() => undefined);

  const work = Promise.resolve().then(() =>
    adapter.search(opts.plan, { limit: task.limit, signal: ctrl.signal, counter: task.counter, onCost: opts.onCost }),
  );
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout, jobAborted]);
  } catch (e) {
    // Whatever the adapter threw after our timer fired (usually an abort) is a timeout.
    if (timedOut && !opts.signal.aborted) throw timeoutError();
    throw e;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onJobAbort) opts.signal.removeEventListener('abort', onJobAbort);
  }
}

/**
 * Run the chosen adapters (and counter searches) in parallel. One adapter failing never rejects:
 * failures go to onAdapterError and the others' results are returned, deduped, stamped with `round`.
 * Rejects only with an AbortError when the job signal is aborted (user pressed Stop).
 */
export async function runSearch(opts: SearchRunOptions): Promise<Candidate[]> {
  if (opts.signal.aborted) throw abortError();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const tasks: Task[] = opts.adapters.map((adapter) => ({ adapter, counter: false, limit: opts.limitPerAdapter }));
  if (counterQueryOf(opts.plan)) {
    for (const adapter of opts.counterAdapters ?? []) tasks.push({ adapter, counter: true, limit: opts.counterLimit ?? 3 });
  }

  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      try {
        const found = await runTask(task, opts, timeoutMs);
        const stamped = found.map((c) => {
          const out: Candidate = { ...c, round: opts.round, sourceIds: c.sourceIds?.length ? c.sourceIds : [c.sourceId] };
          if (task.counter) out.forCounter = true;
          return out;
        });
        opts.onProgress?.({ sourceId: task.adapter.id, count: stamped.length, ...(task.counter ? { counter: true } : {}) });
        return stamped;
      } catch (e) {
        if (isAbortError(e) && opts.signal.aborted) throw e;
        const err = toAdapterError(task.adapter.id, adapterLabel(task.adapter.id), e);
        if (err instanceof AdapterError) opts.onAdapterError?.(err.sourceId, err.kind, err.message);
        else opts.onAdapterError?.(task.adapter.id, 'network', `${adapterLabel(task.adapter.id)}: request aborted`);
        return [] as Candidate[];
      }
    }),
  );

  if (opts.signal.aborted) throw abortError();
  const all: Candidate[] = [];
  for (const s of settled) if (s.status === 'fulfilled') all.push(...s.value);
  return dedupeCandidates(all);
}
