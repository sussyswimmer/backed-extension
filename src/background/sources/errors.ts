// Adapter errors: one typed error so the orchestrator can decide what to skip for the rest of the job.

import type { AdapterErrorKind, SourceId } from '../../shared/types';
import { HttpError, TimeoutError, isAbortError } from '../net';

export class AdapterError extends Error {
  sourceId: SourceId;
  kind: AdapterErrorKind;
  constructor(sourceId: SourceId, kind: AdapterErrorKind, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.sourceId = sourceId;
    this.kind = kind;
  }
}

/** Map an HTTP status to an error kind (shared by all adapters). */
export function kindForStatus(status: number): AdapterErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'out_of_credits';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'network';
  return 'bad_response';
}

/**
 * Convert anything thrown inside an adapter into an AdapterError.
 * Abort errors (user pressed Stop) are returned unchanged so they propagate as aborts.
 * Messages never include URLs, so keys passed as query params can't leak.
 */
export function toAdapterError(sourceId: SourceId, label: string, e: unknown): Error {
  if (e instanceof AdapterError) return e;
  if (e instanceof TimeoutError) return new AdapterError(sourceId, 'timeout', `${label}: ${e.message}`);
  if (isAbortError(e)) return e as Error;
  if (e instanceof HttpError) return new AdapterError(sourceId, kindForStatus(e.status), `${label}: HTTP ${e.status}`);
  if (e instanceof SyntaxError) return new AdapterError(sourceId, 'bad_response', `${label}: response was not valid JSON`);
  return new AdapterError(sourceId, 'network', `${label}: network error`);
}
