import { useId, useState } from 'react';
import { openAtPassageUrl } from '../../shared/cite';
import type { SourceResult, SourceSummary, VerifiedMatch } from '../../shared/types';
import { IconCheck, IconChevron, IconExternal, IconPlus, IconWarn, Spinner } from '../../shared/ui/Icons';
import { openExternal, safeHttpUrl } from '../../shared/ui/safeUrl';
import { isNew, metaLine, scopeNotes } from '../lib/view';
import { Quotation } from './Quotation';
import { btn, ExternalLink, NewBadge, RelationBadge, TierBadge } from './ui';

export interface ReverifyState {
  pending: boolean;
  ok?: boolean;
  message?: string;
}

export interface ResultCardProps {
  result: SourceResult;
  /** 0-based position among the visible cards (keys 1–9 address the first nine). */
  keyIndex?: number;
  picked: boolean;
  /** Summaries are still being written for this round. */
  summaryPending: boolean;
  showDebug: boolean;
  reverify?: ReverifyState;
  onTogglePick: (candidateId: string) => void;
  onNotRelevant: (candidateId: string) => void;
  onReverify: (candidateId: string) => void;
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return (m?.[1] ?? text).trim();
}

export function SummaryBlock({ summary, pending, defaultOpen = false }: { summary?: SourceSummary; pending: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  if (!summary) {
    return pending ? (
      <p className="text-[12px] text-ink-3">
        <span className="bk-label">Summary (AI)</span> <span className="bk-pulse">writing…</span>
      </p>
    ) : null;
  }
  const lead = summary.howItRelates?.trim() || firstSentence(summary.summary ?? '');
  const label = summary.abstractOnly ? 'Summary (AI) · from abstract' : 'Summary (AI)';
  const hasMore = !!(summary.summary?.trim() || summary.limits?.trim());
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={!hasMore}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-start gap-2 rounded-md text-left disabled:cursor-default"
      >
        <span className="min-w-0 flex-1">
          <span className="bk-label block leading-tight">{label}</span>
          <span className="mt-1 block text-[13.5px] leading-snug font-semibold text-ink">{lead}</span>
        </span>
        {hasMore ? (
          <IconChevron className={`mt-3.5 h-4 w-4 shrink-0 text-ink-3 transition-transform group-hover:text-ink ${open ? 'rotate-180' : ''}`} />
        ) : null}
      </button>
      {open && hasMore ? (
        <div id={id} className="mt-1 space-y-1 text-[13px] leading-snug text-ink-2">
          {summary.summary?.trim() ? <p>{summary.summary}</p> : null}
          {summary.limits?.trim() ? (
            <p>
              <span className="font-semibold text-ink">Limits:</span> {summary.limits}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ScopeRows({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1">
      {notes.map((n) => (
        <li key={n} className="flex items-start gap-1.5 rounded-md border border-warn-rule bg-warn px-2 py-1 text-[12px] leading-snug text-warn-ink">
          <IconWarn className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function MorePassage({ match }: { match: VerifiedMatch }) {
  return (
    <li className="space-y-1.5 border-t border-dashed border-rule pt-2.5">
      <RelationBadge relation={match.relation} />
      <Quotation match={match} compact />
      {match.reason ? <p className="text-[12px] text-ink-3">{match.reason}</p> : null}
      {match.scopeMismatch ? <ScopeRows notes={[match.scopeMismatch]} /> : null}
    </li>
  );
}

export function ResultCard(props: ResultCardProps) {
  const { result, keyIndex, picked, summaryPending, showDebug, reverify } = props;
  const [showMore, setShowMore] = useState(false);
  const moreId = useId();
  const { meta, best } = result;
  const notes = scopeNotes(result);
  const passageUrl = safeHttpUrl(openAtPassageUrl(result));
  const keyNumber = keyIndex !== undefined && keyIndex < 9 ? keyIndex + 1 : undefined;
  const line = metaLine(meta);

  return (
    <article
      aria-label={meta.title}
      className={`bk-enter relative rounded-xl border bg-card p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-colors ${
        picked ? 'border-accent ring-1 ring-accent' : 'border-rule'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1 pr-6">
        <TierBadge tier={meta.tier} />
        <RelationBadge relation={best.relation} />
        {isNew(result) ? <NewBadge round={result.round} /> : null}
        {meta.isWikipedia ? (
          <span className="inline-flex h-5 items-center rounded-full border border-warn-rule bg-warn px-2 text-[11px] font-medium text-warn-ink">
            Wikipedia · Use to find the real source
          </span>
        ) : null}
      </div>
      {keyNumber ? (
        <kbd
          aria-hidden="true"
          title={`Press ${keyNumber} to toggle “Use this”`}
          className="absolute top-2.5 right-2.5 grid h-5 w-5 place-items-center rounded border border-rule bg-paper font-sans text-[10.5px] font-semibold text-ink-3"
        >
          {keyNumber}
        </kbd>
      ) : null}

      <h3 className="mt-2 font-serif text-[15.5px] leading-snug font-semibold text-ink">
        <ExternalLink href={meta.url} className="decoration-rule-strong underline-offset-[3px] hover:underline">
          {meta.title}
        </ExternalLink>
      </h3>
      {line ? <p className="mt-0.5 text-[12px] text-ink-3">{line}</p> : null}

      <div className="mt-2.5">
        <SummaryBlock summary={result.summary} pending={summaryPending} />
      </div>

      <div className="mt-2.5">
        <span className="bk-label">Quotation</span>
        <div className="mt-1">
          <Quotation match={best} />
        </div>
      </div>

      {best.reason ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          <span className="font-semibold">Why: </span>
          {best.reason}
        </p>
      ) : null}

      {notes.length ? (
        <div className="mt-2">
          <ScopeRows notes={notes} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={picked}
          aria-keyshortcuts={keyNumber ? String(keyNumber) : undefined}
          onClick={() => props.onTogglePick(result.candidateId)}
          className={picked ? btn('primary', 'sm') : btn('accentOutline', 'sm')}
        >
          {picked ? <IconCheck className="h-3.5 w-3.5" /> : <IconPlus className="h-3.5 w-3.5" />}
          {picked ? 'Picked' : 'Use this'}
        </button>
        {passageUrl ? (
          <button type="button" className={btn('ghost', 'sm')} onClick={() => openExternal(passageUrl)}>
            <IconExternal className="h-3.5 w-3.5" />
            Open at passage
          </button>
        ) : null}
        {result.more.length > 0 ? (
          <button type="button" className={btn('ghost', 'sm')} aria-expanded={showMore} aria-controls={moreId} onClick={() => setShowMore((s) => !s)}>
            {showMore ? 'Hide passages' : `More passages (${result.more.length})`}
          </button>
        ) : null}
        <button type="button" className={btn('quiet', 'bare', 'ml-auto')} onClick={() => props.onNotRelevant(result.candidateId)}>
          Not relevant
        </button>
      </div>

      {showMore && result.more.length > 0 ? (
        <ul id={moreId} className="mt-2.5 space-y-2.5">
          {result.more.map((m) => (
            <MorePassage key={`${m.chunkId}:${m.sentenceIds.join(',')}`} match={m} />
          ))}
        </ul>
      ) : null}

      {showDebug ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-2 font-mono text-[11px] text-ink-3">
          <button type="button" className={btn('secondary', 'xs')} disabled={reverify?.pending} onClick={() => props.onReverify(result.candidateId)}>
            {reverify?.pending ? <Spinner className="h-3 w-3" /> : null}
            Re-verify on live page
          </button>
          <span>
            {result.textSource} · score {result.score.toFixed(2)} · conf {best.confidence.toFixed(2)} · r{result.round}
          </span>
          {reverify && !reverify.pending && reverify.message ? (
            <p role="status" className={`w-full font-sans text-[12px] ${reverify.ok ? 'text-ok-ink' : 'text-err-ink'}`}>
              {reverify.ok ? '✓ ' : '✗ '}
              {reverify.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
