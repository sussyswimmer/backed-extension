import { useId } from 'react';
import type { JobState, OutputMode, SourceResult } from '../../shared/types';
import { IconChevron } from '../../shared/ui/Icons';
import { atMaxRounds, EMPTY_STATE_CHIPS } from '../lib/refine';
import type { DebateTab, DisplayLists } from '../lib/view';
import { ResultCard, type ReverifyState } from './ResultCard';

interface ResultsProps {
  state: JobState;
  mode: OutputMode;
  lists: DisplayLists;
  running: boolean;
  empty: boolean;
  debateTab: DebateTab;
  onDebateTab: (t: DebateTab) => void;
  pushbackOpen: boolean;
  onPushbackOpen: (open: boolean) => void;
  showDebug: boolean;
  reverify: Record<string, ReverifyState>;
  onTogglePick: (id: string) => void;
  onNotRelevant: (id: string) => void;
  onReverify: (id: string) => void;
  onSearchAgain: (freeText: string) => void;
}

export function Results(props: ResultsProps) {
  const { state, mode, lists, running, empty } = props;
  const tabsId = useId();

  if (empty) return <EmptyState disabled={running || atMaxRounds(state) || !state.plan} maxed={atMaxRounds(state)} onChip={props.onSearchAgain} />;

  const total = lists.support.length + lists.pushback.length;
  if (total === 0) return running ? <Skeleton /> : null;

  // Index of each visible card in display order, for the 1–9 key hints.
  const keyIndex = new Map(lists.ordered.map((r, i) => [r.candidateId, i] as const));
  const picked = new Set(state.picked);
  // Summaries are written at the end of each round (status "refining").
  const summaryPending = state.status === 'refining';
  const renderCards = (items: SourceResult[]) => (
    <div className="space-y-2.5">
      {items.map((r) => (
        <ResultCard
          key={r.candidateId}
          result={r}
          keyIndex={keyIndex.get(r.candidateId)}
          picked={picked.has(r.candidateId)}
          summaryPending={summaryPending}
          showDebug={props.showDebug}
          reverify={props.reverify[r.candidateId]}
          onTogglePick={props.onTogglePick}
          onNotRelevant={props.onNotRelevant}
          onReverify={props.onReverify}
        />
      ))}
    </div>
  );

  if (mode === 'debate') {
    const tab = props.debateTab;
    const tabBtn = (t: DebateTab, label: string, n: number) => (
      <button
        type="button"
        role="tab"
        id={`${tabsId}-${t}`}
        aria-selected={tab === t}
        aria-controls={`${tabsId}-panel`}
        onClick={() => props.onDebateTab(t)}
        className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors ${
          tab === t ? (t === 'pushback' ? 'bg-card text-rose-800 shadow-sm dark:text-rose-300' : 'bg-card text-ink shadow-sm') : 'text-ink-3 hover:text-ink'
        }`}
      >
        {label} <span className="font-normal tabular-nums">({n})</span>
      </button>
    );
    const items = tab === 'pushback' ? lists.pushback : lists.support;
    return (
      <div className="px-3">
        <div role="tablist" aria-label="Support and pushback" className="mb-2.5 flex gap-1 rounded-lg border border-rule bg-sunk p-0.5">
          {tabBtn('support', 'Support', lists.support.length)}
          {tabBtn('pushback', 'Pushback', lists.pushback.length)}
        </div>
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
          {items.length ? renderCards(items) : <p className="py-6 text-center text-[13px] text-ink-3">{tab === 'pushback' ? 'No strong pushback found.' : 'No supporting sources yet.'}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-3">
      <section aria-labelledby={`${tabsId}-support`}>
        <h2 id={`${tabsId}-support`} className="mb-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-ink">
          Support <span className="font-normal text-ink-3 tabular-nums">({lists.support.length})</span>
        </h2>
        {lists.support.length ? renderCards(lists.support) : <p className="text-[13px] text-ink-3">{running ? 'Still checking…' : 'No supporting sources found.'}</p>}
      </section>

      <section>
        <h2>
          <button
            type="button"
            aria-expanded={props.pushbackOpen}
            aria-controls={`${tabsId}-pushback`}
            onClick={() => props.onPushbackOpen(!props.pushbackOpen)}
            className="flex w-full items-center gap-1.5 border-t border-rule pt-3 text-left text-[13px] font-semibold text-ink"
          >
            <IconChevron className={`h-4 w-4 text-ink-3 transition-transform ${props.pushbackOpen ? '' : '-rotate-90'}`} />
            Pushback <span className="font-normal text-ink-3 tabular-nums">({lists.pushback.length})</span>
            <span className="ml-auto text-[11.5px] font-normal text-ink-3">Sources that disagree</span>
          </button>
        </h2>
        {props.pushbackOpen ? (
          <div id={`${tabsId}-pushback`} className="mt-2">
            {lists.pushback.length ? renderCards(lists.pushback) : <p className="text-[13px] text-ink-3">No strong pushback found.</p>}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function EmptyState({ disabled, maxed, onChip }: { disabled: boolean; maxed: boolean; onChip: (text: string) => void }) {
  return (
    <div className="bk-enter mx-3 rounded-xl border border-dashed border-rule-strong px-4 py-6 text-center">
      <p className="font-serif text-[17px] font-semibold text-ink">Nothing solid found</p>
      <p className="mx-auto mt-1 max-w-[30ch] text-[12.5px] text-ink-3">
        {maxed ? 'That was the last search round. Edit the claim to try a new angle.' : 'Loosen the search with one tap:'}
      </p>
      {!maxed ? (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {EMPTY_STATE_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={disabled}
              onClick={() => onChip(c.freeText)}
              title={c.freeText}
              className="rounded-full border border-rule-strong bg-card px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-45"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2.5 px-3" aria-hidden="true">
      <p className="text-[12px] text-ink-3">Verified sources appear here as they’re checked.</p>
      {[0, 1].map((i) => (
        <div key={i} className="bk-pulse rounded-xl border border-rule bg-card p-3" style={{ animationDelay: `${i * 0.2}s` }}>
          <div className="flex gap-1">
            <div className="h-5 w-24 rounded-full bg-sunk" />
            <div className="h-5 w-16 rounded-full bg-sunk" />
          </div>
          <div className="mt-2.5 h-4 w-11/12 rounded bg-sunk" />
          <div className="mt-1.5 h-3 w-1/2 rounded bg-sunk" />
          <div className="mt-3 space-y-1.5 border-l-[3px] border-rule pl-3">
            <div className="h-3 w-full rounded bg-sunk" />
            <div className="h-3 w-5/6 rounded bg-sunk" />
            <div className="h-3 w-2/3 rounded bg-sunk" />
          </div>
        </div>
      ))}
    </div>
  );
}
