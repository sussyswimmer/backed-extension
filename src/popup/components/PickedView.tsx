import { useId, useMemo, useState, type ReactNode } from 'react';
import { exportMarkdown, formatForMode, honestyLine, openAtPassageUrl } from '../../shared/cite';
import type { CitationStyles, OutputMode, RoundAnswers, Settings, SourceResult } from '../../shared/types';
import { saveSettings } from '../../shared/settings';
import { copyRich, downloadText } from '../../shared/ui/clipboard';
import { IconBack, IconCopy, IconDownload, IconExternal, IconX } from '../../shared/ui/Icons';
import { safeHttpUrl } from '../../shared/ui/safeUrl';
import { copyAll, copyItems, markdownFilename } from '../lib/format';
import { isKeepAsIs } from '../lib/refine';
import { countLabel, metaLine, RELATION_LABELS } from '../lib/view';
import { CopyMenu } from './CopyMenu';
import { ModeSwitch } from './ModeSwitch';
import { Quotation } from './Quotation';
import { btn, ExternalLink, RelationBadge, TierBadge, useNotify } from './ui';

export interface PickedViewProps {
  claim: string;
  results: SourceResult[];
  mode: OutputMode;
  onModeChange: (m: OutputMode) => void;
  settings: Settings;
  /** Access date used in citations (now for a live job, save time for history). */
  accessed: Date;
  onBack: () => void;
  backLabel: string;
  /** History: no removing picks. */
  readOnly?: boolean;
  onRemove?: (candidateId: string) => void;
  /** Extra line under the claim (e.g. "Saved Oct 2, 2026"). */
  subtitle?: ReactNode;
  answers?: RoundAnswers[];
}

const STYLE_LABEL = { apa: 'APA', chicago: 'Chicago', mla: 'MLA' } as const;

export function PickedView(props: PickedViewProps) {
  const { results, mode, settings, accessed } = props;
  const notify = useNotify();
  /** Cards whose honesty line the user removed. */
  const [noHonesty, setNoHonesty] = useState<ReadonlySet<string>>(() => new Set());
  const honestyFor = (r: SourceResult) => settings.honestyLine && !noHonesty.has(r.candidateId);
  const setHonesty = (id: string, on: boolean) =>
    setNoHonesty((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCopyAll = async () => {
    const ok = await copyRich(copyAll(results, honestyFor));
    notify(ok ? `Copied ${countLabel(results.length)}` : 'Couldn’t copy. Click inside the panel and try again.');
  };
  const onExport = () => {
    const md = exportMarkdown({ claim: props.claim, mode, results, styles: settings.citationStyles, accessed, honestyLine: settings.honestyLine });
    downloadText(markdownFilename(props.claim, Date.now()), md);
    notify('Exported .md');
  };

  const answered = (props.answers ?? []).filter((r) => r.freeText || r.answers.some((a) => !isKeepAsIs(a.answer)));

  return (
    <div className="bk-enter pb-6">
      <div className="px-3 pt-2.5">
        <button type="button" className={btn('ghost', 'sm', '-ml-2')} onClick={props.onBack}>
          <IconBack className="h-3.5 w-3.5" />
          {props.backLabel}
        </button>
      </div>

      <header className="border-b border-rule px-3 pt-1 pb-3">
        <span className="bk-label">Your sources for</span>
        <h1 className="mt-1 font-serif text-[17px] leading-snug font-semibold text-ink">{props.claim}</h1>
        {props.subtitle ? <p className="mt-0.5 text-[12px] text-ink-3">{props.subtitle}</p> : null}
        {answered.length ? (
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-3">
            {answered.map((r) => (
              <li key={r.round}>
                <span className="font-semibold text-ink-2">Round {r.round}:</span>{' '}
                {[...r.answers.filter((a) => !isKeepAsIs(a.answer)).map((a) => a.answer), ...(r.freeText ? [r.freeText] : [])].join(' · ')}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ModeSwitch value={mode} onChange={props.onModeChange} />
          <StyleToggle mode={mode} styles={settings.citationStyles} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-auto text-[12.5px] font-medium text-ink-2">{countLabel(results.length)}</span>
          <button type="button" className={btn('primary', 'sm')} disabled={!results.length} onClick={() => void onCopyAll()}>
            <IconCopy className="h-3.5 w-3.5" />
            Copy all
          </button>
          <button type="button" className={btn('secondary', 'sm')} disabled={!results.length} onClick={onExport}>
            <IconDownload className="h-3.5 w-3.5" />
            Export .md
          </button>
        </div>
      </header>

      {results.length === 0 ? (
        <p className="px-3 py-8 text-center text-[13px] text-ink-3">No sources picked yet. Go back and tap “Use this” on the ones that fit.</p>
      ) : (
        <ol className="divide-y divide-rule">
          {results.map((r, i) => (
            <PickedSource
              key={r.candidateId}
              result={r}
              index={i}
              mode={mode}
              styles={settings.citationStyles}
              accessed={accessed}
              honestyEnabled={settings.honestyLine}
              honesty={honestyFor(r)}
              onHonesty={(on) => setHonesty(r.candidateId, on)}
              onRemove={props.readOnly ? undefined : props.onRemove}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StyleToggle({ mode, styles }: { mode: OutputMode; styles: CitationStyles }) {
  const labelId = useId();
  if (mode === 'debate') return null;
  const options = mode === 'paper' ? (['apa', 'chicago'] as const) : (['mla', 'apa'] as const);
  const value = mode === 'paper' ? styles.paper : styles.essay;
  const choose = (v: (typeof options)[number]) => {
    const next: CitationStyles =
      mode === 'paper' ? { ...styles, paper: v === 'chicago' ? 'chicago' : 'apa' } : { ...styles, essay: v === 'apa' ? 'apa' : 'mla' };
    void saveSettings({ citationStyles: next }).catch(() => undefined);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="bk-label" id={labelId}>
        Style
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-lg border border-rule bg-sunk p-0.5">
        {options.map((o) => (
          <label key={o} className="relative">
            <input
              type="radio"
              name={`${labelId}-${mode}`}
              checked={value === o}
              onChange={() => choose(o)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="pointer-events-none block rounded-md px-2 py-1 text-xs font-medium text-ink-2 peer-checked:bg-card peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {STYLE_LABEL[o]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PickedSource({
  result,
  index,
  mode,
  styles,
  accessed,
  honestyEnabled,
  honesty,
  onHonesty,
  onRemove,
}: {
  result: SourceResult;
  index: number;
  mode: OutputMode;
  styles: CitationStyles;
  accessed: Date;
  honestyEnabled: boolean;
  honesty: boolean;
  onHonesty: (on: boolean) => void;
  onRemove?: (candidateId: string) => void;
}) {
  const outputs = useMemo(() => formatForMode(result, mode, { styles, accessed, honestyLine: honesty }), [result, mode, styles, accessed, honesty]);
  const items = useMemo(() => copyItems(outputs, mode), [outputs, mode]);
  const { meta, best, summary } = result;
  const passageUrl = safeHttpUrl(openAtPassageUrl(result));
  const honestyText = honestyLine(best.relation);
  const tag = summary?.tag?.trim() || summary?.howItRelates?.trim();
  const line = metaLine(meta);
  const styleName = mode === 'paper' ? STYLE_LABEL[styles.paper] : mode === 'essay' ? STYLE_LABEL[styles.essay] : '';

  return (
    <li className="px-3 py-4">
      {/* 1. Link */}
      <div className="flex items-start gap-2.5">
        <span className="mt-[1px] font-serif text-[20px] leading-none font-semibold text-accent tabular-nums" aria-hidden="true">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[15.5px] leading-snug font-semibold text-ink">
            <ExternalLink href={meta.url} className="underline decoration-rule-strong underline-offset-[3px] hover:decoration-accent">
              {meta.title}
            </ExternalLink>
          </h2>
          {line ? <p className="mt-0.5 text-[12px] text-ink-3">{line}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <TierBadge tier={meta.tier} />
            {passageUrl ? (
              <ExternalLink href={passageUrl} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                <IconExternal className="h-3 w-3" />
                Open at quotation
              </ExternalLink>
            ) : null}
          </div>
        </div>
      </div>

      {/* 2. Summary */}
      {summary ? (
        <div className="mt-3">
          <span className="bk-label">{summary.abstractOnly ? 'Summary (AI) · from abstract' : 'Summary (AI)'}</span>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
            {summary.howItRelates?.trim() ? <strong className="font-semibold text-ink">{summary.howItRelates.trim()}</strong> : null}
            {summary.howItRelates?.trim() && summary.summary?.trim() ? ' ' : null}
            {summary.summary}
          </p>
          {summary.limits?.trim() ? (
            <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
              <span className="font-semibold text-ink">Limits:</span> {summary.limits}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === 'debate' && tag ? (
        <div className="mt-3 rounded-lg border border-rule bg-sunk px-2.5 py-2">
          <span className="bk-label">Your tag (AI-drafted)</span>
          <p className="mt-0.5 text-[13.5px] leading-snug font-bold text-ink">{tag}</p>
        </div>
      ) : null}

      {/* 3. Quotation */}
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-1.5">
          <RelationBadge relation={best.relation} />
          <span className="bk-label">Quotation</span>
        </div>
        <Quotation match={best} />
        {honestyText && honestyEnabled ? (
          honesty ? (
            <p className="mt-1.5 flex items-start gap-1 text-[12px] leading-snug text-ink-2 italic">
              <span className="min-w-0 flex-1">{honestyText}</span>
              <button
                type="button"
                onClick={() => onHonesty(false)}
                aria-label="Remove the honesty line from this source"
                title="Remove this line"
                className="shrink-0 rounded p-0.5 text-ink-3 not-italic hover:bg-sunk hover:text-ink"
              >
                <IconX className="h-3 w-3" />
              </button>
            </p>
          ) : (
            <button type="button" onClick={() => onHonesty(true)} className="mt-1 text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Add the “{RELATION_LABELS[best.relation]}” note back
            </button>
          )
        ) : null}
      </div>

      {/* Citation preview: shows the current mode/style so switching re-formats visibly. */}
      <div className="mt-3 rounded-lg bg-sunk px-2.5 py-2 text-[12px] leading-snug text-ink-2">
        <span className="bk-label">{mode === 'debate' ? 'Cite' : `Citation (${styleName})`}</span>
        <p className="mt-0.5 [overflow-wrap:anywhere]">{outputs.citation.text}</p>
        {outputs.inText ? (
          <p className="mt-1">
            <span className="font-semibold text-ink">In-text:</span> {outputs.inText}
          </p>
        ) : null}
      </div>

      {/* 4. Copy as… */}
      <div className="mt-2.5 flex items-center gap-2">
        <CopyMenu items={items} />
        {onRemove ? (
          <button type="button" className={btn('quiet', 'bare', 'ml-auto')} onClick={() => onRemove(result.candidateId)}>
            Remove
          </button>
        ) : null}
      </div>
    </li>
  );
}
