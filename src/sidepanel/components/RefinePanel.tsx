import { useId, useState, type FormEvent, type Ref } from 'react';
import type { JobState, RefineAnswer, RefineCard, RefineQuestion } from '../../shared/types';
import { IconInfo, Spinner } from '../../shared/ui/Icons';
import { atMaxRounds, choiceOptions, collectAnswers, hasChanges, refiningLabel, showQuestions, type Selections } from '../lib/refine';
import { btn } from './ui';

interface RefinePanelProps {
  state: JobState;
  running: boolean;
  pickedCount: number;
  hasResults: boolean;
  focusRef: Ref<HTMLElement>;
  onAnswer: (answers: RefineAnswer[]) => void;
  onDismiss: () => void;
  onSearchAgain: (freeText: string) => void;
  onMakeOutput: () => void;
}

/**
 * The refine card (pinned above results) plus the pick prompt that is always shown once results
 * exist: "Which of these fits your argument best?", the picked counter and "None of these fit".
 */
export function RefinePanel(props: RefinePanelProps) {
  const { state, running, hasResults } = props;
  const card = state.refine;
  const questionsOn = showQuestions(state);
  const coverageOnly = !!card && !state.refineDismissed && !state.refining && !questionsOn && card.coverageNote.trim();
  if (!state.refining && !questionsOn && !hasResults) return null;

  const cardKey = card ? `${card.round}:${card.questions.map((q) => q.id).join('|')}` : 'none';
  return (
    <section
      ref={props.focusRef}
      tabIndex={-1}
      aria-label="Refine and pick"
      className="bk-enter mx-3 mb-3 overflow-hidden rounded-xl border border-rule-strong bg-card shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {state.refining ? (
        <div className="flex items-center gap-2 bg-accent-soft px-3 py-2.5 text-[13px] text-accent" role="status">
          <Spinner className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium" title={state.refining}>
            {refiningLabel(state.refining)}
          </span>
        </div>
      ) : null}

      {questionsOn && card ? (
        <Questions key={cardKey} card={card} running={running} onAnswer={props.onAnswer} onDismiss={props.onDismiss} />
      ) : null}

      {coverageOnly ? <p className="px-3 pt-3 text-[12.5px] text-ink-2">{card?.coverageNote}</p> : null}

      {hasResults ? (
        <PickPrompt
          withRule={!!state.refining || questionsOn}
          pickedCount={props.pickedCount}
          maxed={atMaxRounds(state)}
          running={running}
          onMakeOutput={props.onMakeOutput}
          onSearchAgain={props.onSearchAgain}
        />
      ) : null}
    </section>
  );
}

function Questions({
  card,
  running,
  onAnswer,
  onDismiss,
}: {
  card: RefineCard;
  running: boolean;
  onAnswer: (answers: RefineAnswer[]) => void;
  onDismiss: () => void;
}) {
  const [sel, setSel] = useState<Selections>({});
  const answers = collectAnswers(card, sel);
  const changed = hasChanges(answers);
  const set = (id: string, value: string) => setSel((s) => ({ ...s, [id]: value }));

  return (
    <div className="px-3 pt-3 pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="bk-label">Sharpen the search</h2>
        <span className="text-[11px] text-ink-3">Optional</span>
      </div>
      {card.coverageNote.trim() ? <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{card.coverageNote}</p> : null}

      {card.questions.length > 0 ? (
        <div className="mt-2.5 space-y-3">
          {card.questions.map((q) => (
            <Question key={q.id} q={q} value={sel[q.id] ?? ''} onChange={(v) => set(q.id, v)} />
          ))}
        </div>
      ) : null}

      {card.questions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={btn('primary', 'sm')}
            disabled={!changed || running}
            onClick={() => onAnswer(answers)}
            title={running ? 'Available when this round finishes' : changed ? undefined : 'Choose an answer first'}
          >
            Search again with these
          </button>
          <button type="button" className={btn('secondary', 'sm')} onClick={onDismiss}>
            Looks good
          </button>
          {running ? <span className="text-[11px] text-ink-3">Finishing this round…</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function Question({ q, value, onChange }: { q: RefineQuestion; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const whyId = `${id}-why`;
  const textQuestion = q.kind === 'text' || !(q.options && q.options.length);
  return (
    <fieldset title={q.why} aria-describedby={q.why ? whyId : undefined}>
      <legend className="flex items-start gap-1 text-[13.5px] leading-snug font-medium text-ink">
        <span>{q.text}</span>
        {q.why ? (
          <span title={q.why} className="mt-[2px] shrink-0 text-ink-3">
            <IconInfo className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </legend>
      {q.why ? (
        <span id={whyId} className="sr-only">
          Why we ask: {q.why}
        </span>
      ) : null}
      {textQuestion ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          placeholder="Type here, or leave blank"
          aria-label={q.text}
          className="mt-1.5 h-8 w-full rounded-md border border-rule-strong bg-paper px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {choiceOptions(q).map((o) => (
            <label key={o} className="relative">
              <input
                type="radio"
                name={id}
                value={o}
                checked={value === o}
                onChange={() => onChange(o)}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span
                className={
                  'pointer-events-none block rounded-full border border-rule-strong bg-paper px-2.5 py-1 text-[12.5px] leading-tight text-ink-2 transition-colors ' +
                  'peer-hover:border-accent peer-hover:text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink ' +
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent'
                }
              >
                {o}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function PickPrompt({
  withRule,
  pickedCount,
  maxed,
  running,
  onMakeOutput,
  onSearchAgain,
}: {
  withRule: boolean;
  pickedCount: number;
  maxed: boolean;
  running: boolean;
  onMakeOutput: () => void;
  onSearchAgain: (text: string) => void;
}) {
  const [missingOpen, setMissingOpen] = useState(false);
  const [missing, setMissing] = useState('');
  const inputId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = missing.trim();
    if (!text || running) return;
    onSearchAgain(text);
    setMissing('');
    setMissingOpen(false);
  };
  return (
    <div className={`px-3 py-3 ${withRule ? 'border-t border-rule' : ''}`}>
      <h2 className="font-serif text-[15px] leading-snug font-semibold text-ink">Which of these fits your argument best?</h2>
      <p className="mt-0.5 text-[12px] text-ink-3">Tap “Use this” on the cards below (or press 1–9). Pick as many as you like.</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" className={btn('primary', 'sm')} disabled={pickedCount === 0} onClick={onMakeOutput}>
          {pickedCount} picked → Make output
        </button>
        {!maxed ? (
          <button
            type="button"
            className="text-[12.5px] font-medium text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink"
            aria-expanded={missingOpen}
            onClick={() => setMissingOpen((o) => !o)}
          >
            None of these fit
          </button>
        ) : null}
      </div>
      {maxed ? <p className="mt-2 text-[12px] text-ink-3">That was the last search round for this claim. Edit the claim to start fresh.</p> : null}
      {missingOpen && !maxed ? (
        <form onSubmit={submit} className="mt-2.5">
          <label htmlFor={inputId} className="text-[12.5px] font-medium text-ink">
            What’s missing?
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              id={inputId}
              type="text"
              autoFocus
              value={missing}
              onChange={(e) => setMissing(e.target.value)}
              maxLength={300}
              placeholder="e.g. studies from Southeast Asia"
              className="h-8 min-w-0 flex-1 rounded-md border border-rule-strong bg-paper px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            <button type="submit" className={btn('primary', 'sm')} disabled={!missing.trim() || running}>
              Search again
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
