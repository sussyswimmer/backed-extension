// Network helpers: every call has a timeout and is cancellable via the job's AbortSignal.

export const DEFAULT_TIMEOUT_MS = 12_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || (e as { code?: unknown }).code === 20);
}

/** Combine the job signal with a per-request timeout. */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new TimeoutError());
  }, timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export interface FetchOpts extends Omit<RequestInit, 'signal'> {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * fetch() with a timeout. Throws TimeoutError on timeout, AbortError when the job is stopped.
 * Does NOT throw on HTTP error statuses; callers decide.
 */
export async function fetchWithTimeout(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, ...init } = opts;
  const t = withTimeout(signal, timeoutMs);
  try {
    const f = fetchImpl ?? fetch;
    return await f(url, { ...init, signal: t.signal });
  } catch (e) {
    if (t.timedOut()) throw new TimeoutError(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    t.clear();
  }
}

/** fetch + JSON with status check. Throws HttpError on non-2xx. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, retryAfter(res));
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, retryAfter(res));
  return res.text();
}

export function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.min(30_000, n * 1000);
  return undefined;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Run tasks with a concurrency limit, preserving input order in the output. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Simple serial queue (used for Semantic Scholar, whose unauthenticated limit is tight). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
