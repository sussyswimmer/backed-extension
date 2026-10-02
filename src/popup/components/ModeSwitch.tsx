import { useId } from 'react';
import type { OutputMode } from '../../shared/types';
import { MODE_LABELS, MODES } from '../lib/view';

/** Paper / Essay / Debate segmented control (native radios, so arrow keys work). */
export function ModeSwitch({
  value,
  onChange,
  label = 'Format',
  showLabel = true,
}: {
  value: OutputMode;
  onChange: (mode: OutputMode) => void;
  label?: string;
  showLabel?: boolean;
}) {
  const name = useId();
  const labelId = `${name}-label`;
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className={showLabel ? 'bk-label' : 'sr-only'}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-lg border border-rule bg-sunk p-0.5">
        {MODES.map((m) => (
          <label key={m} className="relative">
            <input
              type="radio"
              name={name}
              value={m}
              checked={value === m}
              onChange={() => onChange(m)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span
              className={
                'pointer-events-none block rounded-md px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors ' +
                'peer-checked:bg-card peer-checked:text-ink peer-checked:shadow-sm peer-hover:text-ink ' +
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent'
              }
            >
              {MODE_LABELS[m]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
