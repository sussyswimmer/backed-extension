// Small display formatters (money, durations, dates, file names) and the per-card copy menu items.
import type { ModeOutputs } from '../../shared/cite';
import { escapeHtml, formatAll } from '../../shared/cite';
import type { DebugInfo, OutputMode, SourceId, SourceResult } from '../../shared/types';
import type { RichText } from '../../shared/ui/clipboard';

/** "$0.0123" — debug panel money always shows 4 decimals. */
export function usd4(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(4)}`;
}

/** "840 ms", "12.3 s". */
export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "Oct 2, 2026" in the user's locale. */
export function shortDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/** "backed-minimum-wage-hikes-dont-cause-2026-10-02.md" */
export function markdownFilename(claim: string, ts: number): string {
  const slug = claim
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  const d = new Date(ts);
  const date = Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${['backed', slug, date].filter(Boolean).join('-')}.md`;
}

const ADAPTER_NAMES: Record<SourceId, string> = {
  openalex: 'OpenAlex',
  semantic_scholar: 'Semantic Scholar',
  arxiv: 'arXiv',
  exa_web: 'Exa web',
  exa_news: 'Exa news',
  exa_policy: 'Exa policy',
  exa_papers: 'Exa papers',
};

export interface DebugRows {
  counters: Array<[string, string]>;
  money: Array<[string, string]>;
  timings: Array<[string, string]>;
  adapters: Array<[string, string]>;
}

/** Debug panel rows: counters, cost (4 decimals), timings and per-adapter candidate counts. */
export function debugRows(d: DebugInfo): DebugRows {
  const n = (v: number | undefined) => String(v ?? 0);
  const counters: Array<[string, string]> = [
    ['Fabricated IDs dropped', n(d.fabricatedIdsDropped)],
    ['Unverified dropped', n(d.unverifiedDropped)],
    ['Injection sentences blocked', n(d.injectionSentencesBlocked)],
    ['Batches skipped', n(d.batchesSkipped)],
    ['LLM calls', n(d.llmCalls)],
    ['Tokens in / out', `${d.tokensIn ?? 0} / ${d.tokensOut ?? 0}`],
    ['Candidates found', n(d.candidatesFound)],
    ['Docs read', n(d.docsRead)],
    ['Chunks matched', n(d.chunksMatched)],
  ];
  const money: Array<[string, string]> = [
    ['LLM $', usd4(d.llmCostUsd)],
    ['Exa $', usd4(d.exaCostUsd)],
    ['Total $', usd4((d.llmCostUsd ?? 0) + (d.exaCostUsd ?? 0))],
  ];
  const timings: Array<[string, string]> = [];
  if (typeof d.firstResultMs === 'number') timings.push(['First result', duration(d.firstResultMs)]);
  for (const [k, v] of Object.entries(d.timingsMs ?? {})) timings.push([k, duration(v)]);
  const adapters = (Object.entries(d.adapterCounts ?? {}) as Array<[SourceId, number | undefined]>)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]): [string, string] => [ADAPTER_NAMES[k] ?? k, String(v)]);
  return { counters, money, timings, adapters };
}

export type CopyItemId ='citation' | 'inText' | 'card' | 'quote' | 'linkSummaryQuote';

export interface CopyItem {
  id: CopyItemId;
  label: string;
  value: RichText;
}

/** The "Copy as…" menu for one source in one mode. */
export function copyItems(outputs: ModeOutputs, mode: OutputMode): CopyItem[] {
  const items: CopyItem[] = [{ id: 'citation', label: mode === 'debate' ? 'Citation (debate cite)' : 'Citation', value: outputs.citation }];
  if (mode !== 'debate' && outputs.inText) {
    items.push({ id: 'inText', label: 'In-text citation', value: { text: outputs.inText, html: escapeHtml(outputs.inText) } });
  }
  if (mode === 'debate' && outputs.card) items.push({ id: 'card', label: 'Debate card', value: outputs.card });
  items.push({ id: 'quote', label: 'Quotation', value: outputs.quote });
  items.push({ id: 'linkSummaryQuote', label: 'Link + summary + quote', value: outputs.linkSummaryQuote });
  return items;
}

/**
 * "Copy all" with the honesty line decided per card (it can be removed on a single card).
 * Built from formatAll so the output matches it exactly when every card has the same setting.
 */
export function copyAll(results: SourceResult[], honestyFor: (r: SourceResult) => boolean): RichText {
  if (results.length === 0) return { text: '', html: '' };
  const flags = results.map(honestyFor);
  if (flags.every((f) => f === flags[0])) return formatAll(results, { honestyLine: flags[0] ?? true });
  const each = results.map((r, i) => formatAll([r], { honestyLine: flags[i] ?? true }));
  return { text: each.map((f) => f.text).join('\n\n'), html: each.map((f) => f.html).join('<p><br></p>') };
}
