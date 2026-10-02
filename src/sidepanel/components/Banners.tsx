import type { ReactNode } from 'react';
import type { JobState, JobWarning } from '../../shared/types';
import { IconInfo, IconRetry, IconWarn, IconX } from '../../shared/ui/Icons';
import { ACADEMIC_ONLY_NOTE, warningKey } from '../lib/view';
import { btn, openOptions } from './ui';

function Banner({
  tone,
  icon,
  children,
  onDismiss,
  role,
}: {
  tone: 'error' | 'warn' | 'info';
  icon: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  role?: 'alert' | 'status';
}) {
  const tones = {
    error: 'border-err-rule bg-err text-err-ink',
    warn: 'border-warn-rule bg-warn text-warn-ink',
    info: 'border-rule bg-sunk text-ink-2',
  } as const;
  return (
    <div role={role} className={`bk-enter flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] leading-snug ${tones[tone]}`}>
      <span className="mt-[1px] shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100">
          <IconX className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const ACADEMIC_KEY = 'academic_only';

export function Banners({
  state,
  warnings,
  dismissed,
  onDismiss,
  onRetry,
}: {
  state: JobState;
  /** Already filtered (dismissed / duplicates removed). */
  warnings: JobWarning[];
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
  onRetry: () => void;
}) {
  const error = state.error;
  const retryable = !!error && (error.code === 'deepseek_unavailable' || error.code === 'internal');
  const items: ReactNode[] = [];

  if (error) {
    items.push(
      <Banner key="error" tone="error" role="alert" icon={<IconWarn className="h-4 w-4" />}>
        <p className="font-medium">{error.message}</p>
        {error.showOptionsLink || retryable ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {error.showOptionsLink ? (
              <button type="button" className={btn('secondary', 'xs')} onClick={openOptions}>
                Open options
              </button>
            ) : null}
            {retryable ? (
              <button type="button" className={btn('secondary', 'xs')} onClick={onRetry}>
                <IconRetry className="h-3 w-3" /> Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </Banner>,
    );
  }

  if (state.status === 'interrupted') {
    items.push(
      <Banner key="interrupted" tone="warn" role="alert" icon={<IconWarn className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Search interrupted.</p>
          <button type="button" className={btn('primary', 'xs')} onClick={onRetry}>
            <IconRetry className="h-3 w-3" /> Retry
          </button>
        </div>
      </Banner>,
    );
  }

  if (state.status === 'stopped') {
    items.push(
      <Banner key="stopped" tone="info" role="status" icon={<IconInfo className="h-4 w-4" />}>
        <p>Stopped. Results so far are kept.</p>
      </Banner>,
    );
  }

  if (state.academicOnly && !dismissed.has(ACADEMIC_KEY)) {
    items.push(
      <Banner key="academic" tone="info" icon={<IconInfo className="h-4 w-4" />} onDismiss={() => onDismiss(ACADEMIC_KEY)}>
        <p>
          {ACADEMIC_ONLY_NOTE}.{' '}
          <button type="button" onClick={openOptions} className="font-semibold text-ink underline underline-offset-2">
            Open options
          </button>
        </p>
      </Banner>,
    );
  }

  for (const w of warnings) {
    const key = warningKey(w);
    items.push(
      <Banner key={key} tone="warn" icon={<IconWarn className="h-3.5 w-3.5" />} onDismiss={() => onDismiss(key)}>
        <p>{w.message}</p>
      </Banner>,
    );
  }

  if (items.length === 0) return null;
  return <div className="space-y-1.5 px-3 pb-2">{items}</div>;
}
