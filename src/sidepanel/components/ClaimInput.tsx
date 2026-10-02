import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { OutputMode } from '../../shared/types';
import { IconSearch, IconWarn } from '../../shared/ui/Icons';
import { isSubmitKey } from '../lib/keyboard';
import { ModeSwitch } from './ModeSwitch';
import { btn, openOptions } from './ui';

export function ClaimInput({
  draft,
  onDraft,
  mode,
  onMode,
  onSubmit,
  onCancel,
  needsKey,
}: {
  draft: string;
  onDraft: (s: string) => void;
  mode: OutputMode;
  onMode: (m: OutputMode) => void;
  /** Called synchronously inside the click / Enter handler (needed for the permission prompt). */
  onSubmit: (claim: string) => void;
  /** Back to the current results, when there are any. */
  onCancel?: () => void;
  needsKey: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const submit = () => {
    if (draft.trim()) onSubmit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSubmitKey({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };
  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onFormSubmit} className="bk-enter px-3 pt-5 pb-4">
      <label htmlFor="claim" className="block font-serif text-[19px] leading-tight font-semibold tracking-tight">
        What claim do you want to back up?
      </label>
      <p className="mt-1 text-[12.5px] text-ink-3">Type it, paste it, or highlight it on a page. We find real sources and the exact words.</p>
      <div className="mt-3 rounded-xl border border-rule-strong bg-card shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        <textarea
          id="claim"
          ref={ref}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={4}
          maxLength={4000}
          placeholder="e.g. Raising the minimum wage doesn’t significantly reduce employment."
          className="block w-full resize-y rounded-xl bg-transparent px-3 py-2.5 font-serif text-[15px] leading-snug text-ink placeholder:text-ink-3 focus:outline-none"
          aria-describedby="claim-help"
        />
        <div className="flex items-center justify-between gap-2 border-t border-rule px-3 py-1.5">
          <span id="claim-help" className="text-[11px] text-ink-3">
            <kbd className="font-sans font-semibold">Enter</kbd> to search · <kbd className="font-sans font-semibold">Shift+Enter</kbd> new line
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ModeSwitch value={mode} onChange={onMode} />
        <button type="submit" className={btn('primary', 'md')} disabled={!draft.trim()}>
          <IconSearch className="h-4 w-4" />
          Find sources
        </button>
      </div>

      {onCancel ? (
        <button type="button" className={btn('quiet', 'bare', 'mt-2')} onClick={onCancel}>
          Back to results
        </button>
      ) : null}

      {needsKey ? (
        <div role="note" className="mt-4 flex gap-2 rounded-lg border border-warn-rule bg-warn px-3 py-2 text-[12.5px] text-warn-ink">
          <IconWarn className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Add your DeepSeek key first.{' '}
            <button type="button" onClick={openOptions} className="font-semibold underline underline-offset-2">
              Open options
            </button>
          </p>
        </div>
      ) : null}

      <div className="mt-6 space-y-1.5 border-t border-rule pt-3 text-[12px] text-ink-3">
        <p>
          <span className="font-semibold text-ink-2">Paper</span> ranks peer-reviewed and gov sources first.{' '}
          <span className="font-semibold text-ink-2">Essay</span> keeps it accessible.{' '}
          <span className="font-semibold text-ink-2">Debate</span> builds cards and shows pushback.
        </p>
        <p>
          Tip: highlight a sentence on any page or in Google Docs and press <kbd className="font-semibold text-ink-2">Alt+Shift+E</kbd>.
        </p>
      </div>
    </form>
  );
}
