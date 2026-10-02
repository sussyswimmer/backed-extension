import type { Progress } from '../../shared/types';
import { IconStop } from '../../shared/ui/Icons';
import { btn } from './ui';

export function ProgressBar({ progress, round, onStop }: { progress: Progress; round: number; onStop: () => void }) {
  const pct = Math.max(2, Math.min(100, Math.round(progress.percent || 0)));
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2">
        {round > 1 ? (
          <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent">Round {round} of search</span>
        ) : null}
        <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={progress.message}>
          {progress.message || 'Working…'}
        </p>
        <button type="button" onClick={onStop} className={btn('secondary', 'xs')} title="Stop (Esc)" aria-keyshortcuts="Escape">
          <IconStop className="h-3 w-3" />
          Stop
        </button>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunk"
        role="progressbar"
        aria-label="Search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="bk-bar h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Shown between pressing "Find sources" and the first snapshot of the new job. */
export function StartingBar() {
  return (
    <div className="px-3 pb-2">
      <p role="status" className="text-[12px] text-ink-2">
        Starting…
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunk">
        <div className="bk-pulse h-full w-[4%] rounded-full bg-accent" />
      </div>
    </div>
  );
}
