import type { JobState, OutputMode } from '../../shared/types';
import { truncate } from '../../shared/text';
import { displayClaim, languageName } from '../lib/view';
import { ModeSwitch } from './ModeSwitch';
import { Chip } from './ui';

export function ClaimHeader({
  state,
  mode,
  onMode,
  onEdit,
}: {
  state: JobState;
  mode: OutputMode;
  onMode: (m: OutputMode) => void;
  onEdit: () => void;
}) {
  const claim = displayClaim(state);
  const lang = state.plan?.inputLanguage?.trim();
  const showChips = state.constraintChips.length > 0 || state.valuesClaim;
  return (
    <section aria-label="Claim" className="px-3 pt-3 pb-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="bk-label">Claim</span>
        <button type="button" onClick={onEdit} className="text-[12px] font-medium text-accent underline-offset-2 hover:underline">
          Edit claim
        </button>
      </div>
      <h1 className="mt-1 font-serif text-[16.5px] leading-snug font-semibold tracking-[-0.005em] text-ink">{claim}</h1>
      {lang ? (
        <p className="mt-1 text-[12px] text-ink-3">
          Translated from {languageName(lang)}.{' '}
          <span title={state.rawClaim}>You typed: “{truncate(state.rawClaim.replace(/\s+/g, ' '), 90)}”</span>
        </p>
      ) : null}
      {showChips ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Search limits">
          {state.constraintChips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
          {state.valuesClaim ? (
            <Chip tone="warn" title="This is a values claim: expect arguments (op-eds, think tanks, philosophy), not measurements.">
              Values claim
            </Chip>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2.5">
        <ModeSwitch value={mode} onChange={onMode} />
      </div>
    </section>
  );
}
