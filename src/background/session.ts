// Job state survives a service-worker restart via chrome.storage.session.
import type { JobState } from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';

/**
 * A job restored after the worker was killed can't continue its in-flight network work.
 * If it was mid-run, keep everything verified so far and mark it interrupted so the panel
 * shows "Search interrupted" with a Retry button. Finished/stopped jobs come back unchanged.
 */
export function restoreJobState(saved: unknown): JobState | null {
  if (!saved || typeof saved !== 'object') return null;
  const s = saved as JobState;
  if (typeof s.jobId !== 'string' || !Array.isArray(s.support) || !Array.isArray(s.pushback)) return null;
  if (!ACTIVE_STATUSES.includes(s.status)) return s;
  return {
    ...s,
    status: 'interrupted',
    refining: undefined,
    progress: { stage: 'interrupted', message: 'Search interrupted. Press Retry to run it again.', percent: s.progress?.percent ?? 0 },
  };
}
