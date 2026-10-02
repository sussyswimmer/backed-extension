// Combined outputs: link + summary + quote, the per-mode bundle, "Copy all" and the Markdown export.

import type { CitationStyles, OutputMode, SourceResult } from '../types';
import { normalizeWs } from '../text';
import { debateCiteSegs, debateTag, formatDebateCard, formatDebateCite } from './debate';
import { pagesOf, type PageRef } from './pages';
import { cardPassageSegs, formatQuote, honestyLine, passageText, relationLabel } from './quote';
import {
  bold,
  httpUrl,
  italic,
  mdEscape,
  mdEscapeVerbatim,
  mdLink,
  plain,
  renderMarkdown,
  renderParas,
  type Formatted,
  type Para,
} from './rich';
import { citationSegs, formatCitation, formatInText, styleForMode, type CiteStyle } from './styles';
import { openAtPassageUrl } from './urls';
import { buildWork, clean, dateOf, isValidDate, longDate, terminate } from './work';

/** The landing page the title links to (http(s) only; anything else is not a usable link). */
function landingUrl(result: SourceResult): string {
  return httpUrl(clean(result.meta.url)) ?? httpUrl(clean(result.finalUrl)) ?? '';
}

/** "Open at quotation" link, when it is a usable http(s) URL different from the landing page. */
function openAtUrl(result: SourceResult, landing: string): string | undefined {
  const url = httpUrl(openAtPassageUrl(result));
  return url && url !== landing ? url : undefined;
}

/** Pages are only meaningful when the passage text came from a PDF. */
function resultPages(result: SourceResult): PageRef | undefined {
  return result.textSource === 'pdf' ? pagesOf(result.best) : undefined;
}

function summaryLabel(result: SourceResult): string {
  return result.summary?.abstractOnly ? 'Summary (AI, abstract only):' : 'Summary (AI):';
}

/** howItRelates first (it is the claim-specific line), then the 2–3 sentence summary. */
function summaryBody(result: SourceResult): string | undefined {
  const how = clean(result.summary?.howItRelates);
  const body = clean(result.summary?.summary);
  const text = [how ? terminate(how) : undefined, body].filter(Boolean).join(' ');
  return text || undefined;
}

function linkSummaryQuoteParas(result: SourceResult, opts: { honestyLine: boolean }): Para[] {
  const work = buildWork(result.meta);
  const url = landingUrl(result);
  const openAt = openAtUrl(result, url);
  const paras: Para[] = [{ segs: [{ text: work.title, bold: true, href: url }] }];
  if (url) paras.push({ segs: [{ text: url, href: url }] });
  if (openAt) paras.push({ segs: [plain('Open at quotation: '), { text: openAt, href: openAt }] });
  const summary = summaryBody(result);
  if (summary) paras.push({ segs: [bold(summaryLabel(result)), plain(` ${summary}`)] });
  const limits = clean(result.summary?.limits);
  if (limits) paras.push({ segs: [bold('Limits:'), plain(` ${limits}`)] });
  paras.push({
    segs: [bold(`Quotation (${relationLabel(result.best.relation)}):`), plain(` "${passageText(result.best)}"`)],
  });
  const honesty = opts.honestyLine ? honestyLine(result.best.relation) : undefined;
  if (honesty) paras.push({ segs: [italic(honesty)] });
  return paras;
}

/** Title + URL (+ open-at-quotation link), "Summary (AI): …" (+ limits), relation label + quotation. */
export function formatLinkSummaryQuote(result: SourceResult, opts: { honestyLine: boolean }): Formatted {
  return renderParas(linkSummaryQuoteParas(result, opts));
}

export interface ModeOutputs {
  citation: Formatted;
  /** Paper and Essay only. */
  inText?: string;
  quote: Formatted;
  /** Debate only. */
  card?: Formatted;
  linkSummaryQuote: Formatted;
}

/**
 * Everything "Copy as…" offers for one result in one mode. Debate's citation is the debate cite.
 * `quote` is exactly formatQuote(result, mode); the honesty line is part of `card` and
 * `linkSummaryQuote` (use honestyLine() to show it next to a Paper/Essay quote).
 */
export function formatForMode(
  result: SourceResult,
  mode: OutputMode,
  opts: { styles: CitationStyles; accessed: Date; honestyLine: boolean },
): ModeOutputs {
  const linkSummaryQuote = formatLinkSummaryQuote(result, { honestyLine: opts.honestyLine });
  const quote = formatQuote(result, mode);
  if (mode === 'debate') {
    return {
      citation: formatDebateCite(result.meta, opts.accessed),
      quote,
      card: formatDebateCard(result, { accessed: opts.accessed, honestyLine: opts.honestyLine }),
      linkSummaryQuote,
    };
  }
  const style = styleForMode(mode, opts.styles);
  const pages = resultPages(result);
  return {
    citation: formatCitation(result.meta, style, { pages, accessed: opts.accessed }),
    inText: formatInText(result.meta, style, { pages }),
    quote,
    linkSummaryQuote,
  };
}

/** "Copy all": every source as link + summary + quote, separated by a blank line. */
export function formatAll(results: SourceResult[], opts: { honestyLine: boolean }): Formatted {
  const each = results.map((r) => formatLinkSummaryQuote(r, opts));
  return {
    text: each.map((f) => f.text).join('\n\n'),
    html: each.map((f) => f.html).join('<p><br></p>'),
  };
}

// ---------- Markdown export ----------

const STYLE_LABELS: Record<CiteStyle, string> = { apa: 'APA 7', chicago: 'Chicago author-date', mla: 'MLA 9' };
const MODE_LABELS: Record<OutputMode, string> = { paper: 'Research paper', essay: 'School essay', debate: 'Debate' };

/** "> " on every line of a verbatim passage. */
function mdBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${mdEscapeVerbatim(line)}`.trimEnd())
    .join('\n');
}

function mdSource(result: SourceResult, index: number, mode: OutputMode, args: ExportArgs): string[] {
  const work = buildWork(result.meta);
  const url = landingUrl(result);
  const openAt = openAtUrl(result, url);
  const out: string[] = [`## ${index + 1}. ${mdLink(work.title, url)}`, ''];
  if (openAt) out.push(mdLink('Open at quotation', openAt), '');

  const summary = summaryBody(result);
  if (summary) out.push(`**${summaryLabel(result)}** ${mdEscape(summary)}`, '');
  const limits = clean(result.summary?.limits);
  if (limits) out.push(`**Limits:** ${mdEscape(limits)}`, '');

  out.push(`**Quotation (${relationLabel(result.best.relation)}):**`, '', mdBlockquote(passageText(result.best)), '');
  const honesty = args.honestyLine ? honestyLine(result.best.relation) : undefined;
  if (honesty) out.push(`*${mdEscape(honesty)}*`, '');

  if (mode === 'debate') {
    // The card carries the debate cite, so it is not repeated on its own line.
    out.push('**Card:**', '');
    const tag = debateTag(result);
    if (tag) out.push(`**${mdEscape(tag)}**`, '');
    out.push(renderMarkdown(debateCiteSegs(result.meta, args.accessed)), '');
    if (honesty) out.push(`*${mdEscape(honesty)}*`, '');
    out.push(renderMarkdown(cardPassageSegs(result.best), mdEscapeVerbatim), '');
  } else {
    const style = styleForMode(mode, args.styles);
    const pages = resultPages(result);
    out.push(`**Citation:** ${renderMarkdown(citationSegs(result.meta, style, { pages, accessed: args.accessed }))}`, '');
    out.push(`**In-text:** ${mdEscape(formatInText(result.meta, style, { pages }))}`, '');
  }
  return out;
}

interface ExportArgs {
  claim: string;
  mode: OutputMode;
  results: SourceResult[];
  styles: CitationStyles;
  accessed: Date;
  honestyLine: boolean;
}

/**
 * The whole set as Markdown: claim heading; per source the link, AI summary, quotation as a
 * blockquote, then citation (italics as *…*) + in-text citation (Paper/Essay) or the card with
 * its debate cite (Debate).
 */
export function exportMarkdown(args: ExportArgs): string {
  const { mode, results } = args;
  const claim = normalizeWs(typeof args.claim === 'string' ? args.claim : '');
  const n = results.length;
  const styleNote = mode === 'debate' ? 'Debate cites' : STYLE_LABELS[styleForMode(mode, args.styles)];
  const accessed = isValidDate(args.accessed) ? longDate(dateOf(args.accessed)) : undefined;
  const meta = [MODE_LABELS[mode], styleNote, `${n} ${n === 1 ? 'source' : 'sources'}`, accessed ? `Accessed ${accessed}` : '']
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [`# ${claim ? mdEscape(claim) : 'Sources'}`, '', meta, ''];
  if (n === 0) lines.push('No sources picked.', '');
  results.forEach((r, i) => lines.push(...mdSource(r, i, mode, args)));
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
