// Normalizes a CandidateMeta into the structured fields every style formats from.

import type { CandidateMeta, SourceTier } from '../types';
import { hostOf, normalizeWs } from '../text';
import { httpUrl } from './rich';
import { nameText, normalizeAuthors, type ParsedName } from './names';

export type ItemType = 'journal' | 'news' | 'report' | 'web';

export interface PartialDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface Work {
  type: ItemType;
  /** Person or organization authors; for reports with no authors, the publisher as organization. */
  authors: ParsedName[];
  /** Never empty. No trailing period (may end with "?" or "!"). */
  title: string;
  /** Journal / outlet / site name / report publisher. Omitted when it repeats the (single) author. */
  container?: string;
  date: PartialDate;
  /** https://doi.org/… when a DOI is known, else the URL. */
  locator?: string;
}

/** Treat missing, blank and stringified-nothing values ("undefined", "null") as absent. */
export function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = normalizeWs(v);
  if (!t || /^(undefined|null|nan|n\/a|none)$/i.test(t)) return undefined;
  return t;
}

/** Strip stray trailing punctuation but keep periods that end an abbreviation ("Inc.", "U.S."). */
export function stripTrailingPunct(s: string): string {
  let t = s.replace(/[\s,;:]+$/, '');
  if (t.endsWith('.') && !/(^|[\s.])(\p{L}|inc|ltd|co|corp|jr|sr|st|bros|plc|llc)\.$/iu.test(t)) {
    t = t.replace(/\.+$/, '');
  }
  return t.replace(/[\s,;:]+$/, '');
}

/** Compare two entity names loosely ("The World Bank" ≈ "World Bank"). */
export function sameEntity(a: string, b: string): boolean {
  const key = (s: string): string =>
    s
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const ka = key(a);
  return ka.length > 0 && ka === key(b);
}

/** Bare DOI ("10.1257/aer.84.4.772") from any common spelling, or undefined. */
export function normalizeDoi(doi: unknown): string | undefined {
  const d = clean(doi)
    ?.replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();
  return d && /^10\.\d{2,}\/\S+$/.test(d) ? d : undefined;
}

export function doiUrl(doi: unknown): string | undefined {
  const d = normalizeDoi(doi);
  return d ? `https://doi.org/${d}` : undefined;
}

export function parseDate(published: unknown): PartialDate {
  const s = clean(published);
  if (!s) return {};
  const validYear = (y: number): boolean => Number.isInteger(y) && y > 1000 && y < 2200;
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?!\d)/.exec(s);
  if (m) {
    const year = Number(m[1]);
    if (!validYear(year)) return {};
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!(month >= 1 && month <= 12)) return { year };
    if (!(day >= 1 && day <= 31)) return { year, month };
    return { year, month, day };
  }
  const y = /\b(\d{4})\b/.exec(s);
  const year = y ? Number(y[1]) : NaN;
  return validYear(year) ? { year } : {};
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export function dateOf(d: Date): PartialDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

const monthName = (m?: number): string | undefined => (m ? MONTHS[m - 1] : undefined);

/** "March 5, 2020" / "March 2020" / "2020" (Chicago, debate). */
export function longDate(d: PartialDate): string | undefined {
  if (!d.year) return undefined;
  const month = monthName(d.month);
  if (!month) return String(d.year);
  return d.day ? `${month} ${d.day}, ${d.year}` : `${month} ${d.year}`;
}

/** "2020, March 5" / "2020, March" / "2020" (APA). */
export function apaDate(d: PartialDate): string | undefined {
  if (!d.year) return undefined;
  const month = monthName(d.month);
  if (!month) return String(d.year);
  return d.day ? `${d.year}, ${month} ${d.day}` : `${d.year}, ${month}`;
}

/** "5 Mar. 2020" / "Mar. 2020" / "2020" (MLA). */
export function mlaDate(d: PartialDate): string | undefined {
  if (!d.year) return undefined;
  const month = d.month ? MLA_MONTHS[d.month - 1] : undefined;
  if (!month) return String(d.year);
  return d.day ? `${d.day} ${month} ${d.year}` : `${month} ${d.year}`;
}

function itemType(tier: SourceTier | undefined, hasPublisher: boolean): ItemType {
  switch (tier) {
    case 'peer_reviewed':
    case 'preprint':
      return hasPublisher ? 'journal' : 'report';
    case 'major_news':
      return 'news';
    case 'gov_igo':
    case 'think_tank':
      return 'report';
    default:
      return 'web';
  }
}

/** Title without wrapping quotes, a " | Outlet" suffix that repeats the publisher, or a trailing period. */
export function cleanTitle(raw: unknown, publisher?: string): string | undefined {
  let t = clean(raw);
  if (!t) return undefined;
  t = t.replace(/^["“”']+(.*?)["“”']+$/, '$1');
  if (publisher) {
    const m = /^(.*\S)\s+[|–—-]\s+([^|–—]+)$/.exec(t);
    if (m && m[1] && m[2] && sameEntity(m[2], publisher)) t = m[1];
  }
  t = stripTrailingPunct(t);
  return /[\p{L}\p{N}]/u.test(t) ? t : undefined;
}

/** Up to four words of the main title, for in-text citations of authorless works. */
export function shortTitle(title: string): string {
  const main = title.split(/:\s|\s[|–—]\s|\s-\s/)[0] ?? title;
  const words = main.split(/\s+/).filter(Boolean);
  const short = words.length > 4 ? words.slice(0, 4).join(' ') : main;
  return stripTrailingPunct(short) || title;
}

export function endsWithTerminal(s: string): boolean {
  return /[.?!]$/.test(s.trim());
}

/** Append a period unless the text already ends a sentence. */
export function terminate(s: string): string {
  return endsWithTerminal(s) ? s : `${s}.`;
}

export function buildWork(meta: CandidateMeta): Work {
  const publisher = (() => {
    const p = clean(meta.publisher);
    return p ? stripTrailingPunct(p) || undefined : undefined;
  })();
  const type = itemType(meta.tier, Boolean(publisher));
  let authors = normalizeAuthors(meta.authors);
  let container = publisher;
  if (authors.length === 0 && type === 'report' && publisher) {
    authors = [{ kind: 'org', name: publisher }];
    container = undefined;
  }
  const soleAuthor = authors.length === 1 ? authors[0] : undefined;
  if (container && soleAuthor && sameEntity(nameText(soleAuthor), container)) container = undefined;

  const url = clean(meta.url);
  const title = cleanTitle(meta.title, publisher) ?? (url ? hostOf(url) : '') ?? '';
  const work: Work = {
    type,
    authors,
    title: title || 'Untitled',
    date: parseDate(meta.published),
  };
  if (container) work.container = container;
  const locator = doiUrl(meta.doi) ?? (url ? (httpUrl(url) ?? url) : undefined);
  if (locator) work.locator = locator;
  return work;
}
