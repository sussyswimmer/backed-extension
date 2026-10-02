// Reference-list entries and in-text citations: APA 7, Chicago author-date (17th), MLA 9.

import type { CandidateMeta, CitationStyles, OutputMode } from '../types';
import {
  apaAuthorList,
  chicagoAuthorList,
  inTextAuthors,
  mlaAuthorList,
} from './names';
import { apaPages, mlaPageRange, pageRange, validPages, type PageRef } from './pages';
import { HANGING_INDENT, italic, plain, renderParas, urlSeg, type Formatted, type Seg } from './rich';
import {
  apaDate,
  buildWork,
  dateOf,
  endsWithTerminal,
  isValidDate,
  longDate,
  mlaDate,
  shortTitle,
  terminate,
  type Work,
} from './work';

export type CiteStyle = 'apa' | 'chicago' | 'mla';

export interface CitationOptions {
  /**
   * Pages of the quoted passage. Reference-list entries cite the whole work in all three styles,
   * so the quoted page belongs in the in-text citation; accepted here for API symmetry.
   */
  pages?: PageRef;
  /** Access date, added by MLA and Chicago for undated web pages. */
  accessed?: Date;
}

/** Paper → its configured style, Essay → its configured style, Debate → 'apa' (debate uses formatDebateCite). */
export function styleForMode(mode: OutputMode, styles: CitationStyles): CiteStyle {
  if (mode === 'paper') return styles.paper;
  if (mode === 'essay') return styles.essay;
  return 'apa';
}

// ---------- Segment helpers ----------

type Unit = Seg[];

/** Join non-empty units with single spaces. */
function sentence(...units: Array<Unit | undefined>): Seg[] {
  const out: Seg[] = [];
  for (const u of units) {
    if (!u || u.length === 0) continue;
    if (out.length > 0) out.push(plain(' '));
    out.push(...u);
  }
  return out;
}

/** Join non-empty units with ", " and end with a period: MLA's container chain. */
function commaChain(...units: Array<Unit | undefined>): Unit | undefined {
  const parts = units.filter((u): u is Unit => Boolean(u && u.length > 0));
  if (parts.length === 0) return undefined;
  const out: Seg[] = [];
  parts.forEach((u, i) => {
    if (i > 0) out.push(plain(', '));
    out.push(...u);
  });
  return withPeriod(out);
}

function lastText(segs: Seg[]): string {
  return segs.length > 0 ? (segs[segs.length - 1]?.text ?? '') : '';
}

/** End a unit with a period unless it already ends with . ? or ! */
function withPeriod(segs: Seg[]): Seg[] {
  return endsWithTerminal(lastText(segs)) ? segs : [...segs, plain('.')];
}

const textUnit = (s: string): Unit => [plain(terminate(s))];
const italicUnit = (s: string): Unit => withPeriod([italic(s)]);
/** "Title." in quotes; a title ending in ? or ! keeps its own mark: "Why?" */
const quotedUnit = (title: string, punct = '.'): Unit => [
  plain(`"${title}${endsWithTerminal(title) ? '' : punct}"`),
];
const locatorUnit = (work: Work, period: boolean): Unit | undefined => {
  if (!work.locator) return undefined;
  const seg = urlSeg(work.locator);
  return period ? withPeriod([seg]) : [seg];
};

// ---------- APA 7 ----------

function apaCitation(work: Work): Seg[] {
  const fullDate = work.type === 'news' || work.type === 'web';
  const date = (fullDate ? apaDate(work.date) : work.date.year ? String(work.date.year) : undefined) ?? 'n.d.';
  const dateUnit: Unit = [plain(`(${date}).`)];
  const titleItalic = work.type === 'report' || work.type === 'web';
  const titleUnit = titleItalic ? italicUnit(work.title) : textUnit(work.title);
  const containerItalic = work.type === 'journal' || work.type === 'news';
  const containerUnit = work.container
    ? containerItalic
      ? italicUnit(work.container)
      : textUnit(work.container)
    : undefined;
  const locator = locatorUnit(work, false);

  if (work.authors.length === 0) return sentence(titleUnit, dateUnit, containerUnit, locator);
  return sentence(textUnit(apaAuthorList(work.authors)), dateUnit, titleUnit, containerUnit, locator);
}

function apaInText(work: Work, pages?: PageRef): string {
  const who = work.authors.length > 0 ? inTextAuthors(work.authors, 'apa') : shortTitle(work.title);
  const year = work.date.year ? String(work.date.year) : 'n.d.';
  return `(${[who, year, pages ? apaPages(pages) : undefined].filter(Boolean).join(', ')})`;
}

// ---------- Chicago author-date ----------

function chicagoCitation(work: Work, accessed?: Date): Seg[] {
  const dateUnit = textUnit(work.date.year ? String(work.date.year) : 'n.d.');
  const titleUnit = work.type === 'report' ? italicUnit(work.title) : quotedUnit(work.title);
  const fullDate = work.date.month ? longDate(work.date) : undefined;

  let containerUnit: Unit | undefined;
  let webDate: Unit | undefined;
  if (work.type === 'journal') {
    containerUnit = work.container ? italicUnit(work.container) : undefined;
  } else if (work.type === 'news') {
    const parts: Seg[] = work.container ? [italic(work.container)] : [];
    if (fullDate) parts.push(plain(parts.length > 0 ? `, ${fullDate}` : fullDate));
    containerUnit = parts.length > 0 ? withPeriod(parts) : undefined;
  } else {
    containerUnit = work.container ? textUnit(work.container) : undefined;
    if (work.type === 'web' && fullDate) webDate = textUnit(fullDate);
  }
  const accessUnit =
    work.type === 'web' && !work.date.year && isValidDate(accessed)
      ? textUnit(`Accessed ${longDate(dateOf(accessed)) ?? ''}`)
      : undefined;
  const locator = locatorUnit(work, true);

  if (work.authors.length === 0) {
    return sentence(titleUnit, dateUnit, containerUnit, webDate, accessUnit, locator);
  }
  return sentence(textUnit(chicagoAuthorList(work.authors)), dateUnit, titleUnit, containerUnit, webDate, accessUnit, locator);
}

function chicagoInText(work: Work, pages?: PageRef): string {
  const who = work.authors.length > 0 ? inTextAuthors(work.authors, 'chicago') : `"${shortTitle(work.title)}"`;
  const year = work.date.year ? String(work.date.year) : 'n.d.';
  return `(${who} ${year}${pages ? `, ${pageRange(pages)}` : ''})`;
}

// ---------- MLA 9 ----------

function mlaCitation(work: Work, accessed?: Date): Seg[] {
  const titleUnit = work.type === 'report' ? italicUnit(work.title) : quotedUnit(work.title);
  const container: Unit | undefined = work.container
    ? [work.type === 'report' ? plain(work.container) : italic(work.container)]
    : undefined;
  // Journals and reports: the year (publication dates for papers are often placeholders like 01-01).
  const fullDate = work.type === 'news' || work.type === 'web';
  const date = fullDate ? mlaDate(work.date) : work.date.year ? String(work.date.year) : undefined;
  const chain = commaChain(container, date ? [plain(date)] : undefined, locatorUnit(work, false));
  const accessUnit =
    work.type === 'web' && !work.date.year && isValidDate(accessed)
      ? textUnit(`Accessed ${mlaDate(dateOf(accessed)) ?? ''}`)
      : undefined;
  const authors = work.authors.length > 0 ? textUnit(mlaAuthorList(work.authors)) : undefined;
  return sentence(authors, titleUnit, chain, accessUnit);
}

function mlaInText(work: Work, pages?: PageRef): string {
  const who = work.authors.length > 0 ? inTextAuthors(work.authors, 'mla') : `"${shortTitle(work.title)}"`;
  return `(${[who, pages ? mlaPageRange(pages) : undefined].filter(Boolean).join(' ')})`;
}

// ---------- Public API ----------

/** Segments of a reference-list entry (shared by the HTML/text and Markdown renderers). */
export function citationSegs(meta: CandidateMeta, style: CiteStyle, opts: CitationOptions = {}): Seg[] {
  const work = buildWork(meta);
  switch (style) {
    case 'apa':
      return apaCitation(work);
    case 'chicago':
      return chicagoCitation(work, opts.accessed);
    case 'mla':
      return mlaCitation(work, opts.accessed);
  }
}

/** Full reference-list entry. HTML is one paragraph with a hanging indent. */
export function formatCitation(meta: CandidateMeta, style: CiteStyle, opts: CitationOptions = {}): Formatted {
  return renderParas([{ segs: citationSegs(meta, style, opts), style: HANGING_INDENT }]);
}

/** In-text citation: "(Card & Krueger, 1994, p. 790)", "(Card and Krueger 1994, 790)", "(Card and Krueger 790)". */
export function formatInText(meta: CandidateMeta, style: CiteStyle, opts: { pages?: PageRef } = {}): string {
  const work = buildWork(meta);
  const pages = validPages(opts.pages);
  switch (style) {
    case 'apa':
      return apaInText(work, pages);
    case 'chicago':
      return chicagoInText(work, pages);
    case 'mla':
      return mlaInText(work, pages);
  }
}
