// arXiv API (Atom). Only run for technical/scientific claims (see shouldRunArxiv in rank.ts).

import type { AdapterSearchOptions, Candidate, Plan, SourceAdapter } from '../../shared/types';
import { normalizeWs, yearOf } from '../../shared/text';
import { fetchWithTimeout, HttpError, retryAfter, type FetchLike } from '../net';
import { adapterLabel } from './labels';
import { AdapterError, toAdapterError } from './errors';
import { parseAtomFeed, type AtomEntry } from './atom';
import { isEnglish } from './lang';
import { academicQueries, regionsOf, stableSignature, withRegionKeywords, yearBounds, type YearBounds } from './query';
import { candidateIdFor, isHttpUrl, normalizeDoi, toHttps } from './url';

export const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const LABEL = adapterLabel('arxiv');

export interface ArxivConfig {
  fetchImpl?: FetchLike;
}

/** Lucene-safe terms: letters, digits, spaces, hyphens. */
function sanitize(q: string): string {
  return normalizeWs(q.replace(/[^\p{L}\p{N}\s-]+/gu, ' '));
}

const ARXIV_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'than', 'are', 'was', 'were', 'into', 'over', 'under', 'between', 'versus', 'vs']);

/**
 * arXiv's query language needs a field prefix on every term and explicit boolean operators:
 * "all:minimum wage" would only apply `all:` to the first word. Build
 * `all:a AND all:b AND …` (strict) or `all:a OR all:b …` (loose fallback) from up to 5 terms.
 */
export function arxivQuery(query: string, op: 'AND' | 'OR' = 'AND'): string {
  const terms = sanitize(query)
    .split(' ')
    .filter((t) => t.length > 2 && !ARXIV_STOP.has(t.toLowerCase()))
    .slice(0, op === 'AND' ? 5 : 4);
  if (!terms.length) return `all:${sanitize(query)}`;
  return terms.map((t) => `all:${t}`).join(` ${op} `);
}

export function buildArxivUrl(query: string, maxResults: number, op: 'AND' | 'OR' = 'AND'): string {
  const params = new URLSearchParams();
  params.set('search_query', arxivQuery(query, op));
  params.set('start', '0');
  params.set('max_results', String(Math.max(1, Math.min(50, Math.round(maxResults)))));
  params.set('sortBy', 'relevance');
  params.set('sortOrder', 'descending');
  return `${ARXIV_BASE}?${params.toString()}`;
}

/** "http://arxiv.org/abs/2001.08361v2" -> { base: "2001.08361", versioned: "2001.08361v2" } */
export function arxivIdOf(entryId: string): { base: string; versioned: string } | undefined {
  const m = /arxiv\.org\/abs\/(.+?)\/?$/i.exec(entryId.trim());
  if (!m?.[1]) return undefined;
  const versioned = m[1];
  return { versioned, base: versioned.replace(/v\d+$/i, '') };
}

function inYears(published: string | undefined, y: YearBounds): boolean {
  if (y.from === undefined && y.to === undefined) return true;
  const year = yearOf(published);
  if (year === undefined) return false;
  if (y.from !== undefined && year < y.from) return false;
  if (y.to !== undefined && year > y.to) return false;
  return true;
}

export function mapArxivEntry(e: AtomEntry, rank: number): Candidate | null {
  if (/\/api\/errors/i.test(e.id) || (e.title === 'Error' && !e.authors.length)) return null;
  const ids = arxivIdOf(e.id);
  const title = normalizeWs(e.title);
  if (!ids || !title) return null;
  const summary = normalizeWs(e.summary);
  const url = `https://arxiv.org/abs/${ids.base}`;
  const pdfLink = e.links.find((l) => l.title === 'pdf' || l.type === 'application/pdf')?.href;
  const pdfUrl = isHttpUrl(pdfLink) ? toHttps(pdfLink) : `https://arxiv.org/pdf/${ids.versioned}`;
  const doi = e.doi ? normalizeDoi(e.doi) : `10.48550/arxiv.${ids.base.toLowerCase()}`;
  const c: Candidate = {
    id: candidateIdFor({ doi, url }),
    sourceId: 'arxiv',
    sourceIds: ['arxiv'],
    tier: 'preprint',
    title,
    url,
    pdfUrl,
    doi,
    authors: e.authors.map((a) => normalizeWs(a)).filter((a) => a.length > 0),
    publisher: 'arXiv',
    searchRank: rank,
  };
  if (e.published) c.published = e.published.slice(0, 10);
  if (summary) c.snippet = summary;
  return c;
}

export function parseArxivFeed(xml: string, years: YearBounds = {}): Candidate[] {
  if (!/<feed[\s>]/.test(xml)) throw new AdapterError('arxiv', 'bad_response', `${LABEL}: response was not an Atom feed`);
  const out: Candidate[] = [];
  parseAtomFeed(xml).forEach((e, i) => {
    const c = mapArxivEntry(e, i);
    if (!c) return;
    if (!isEnglish(c.snippet ? `${c.title}. ${c.snippet}` : c.title)) return;
    if (!inYears(c.published, years)) return;
    out.push(c);
  });
  return out;
}

export function createArxivAdapter(cfg: ArxivConfig): SourceAdapter {
  const queryFor = (plan: Plan, counter: boolean): string | undefined => {
    const q = counter ? normalizeWs(plan.counterQuery ?? '') : academicQueries(plan, 1)[0];
    const withRegions = q ? sanitize(withRegionKeywords(q, regionsOf(plan))) : '';
    return withRegions || undefined;
  };

  return {
    id: 'arxiv',
    needsExaKey: false,
    signature(plan: Plan): string {
      const y = yearBounds(plan);
      return stableSignature('arxiv', { q: queryFor(plan, false) ?? null, from: y.from ?? null, to: y.to ?? null });
    },
    async search(plan: Plan, opts: AdapterSearchOptions): Promise<Candidate[]> {
      const q = queryFor(plan, !!opts.counter);
      if (!q || opts.limit <= 0) return [];
      const years = yearBounds(plan);
      // Year filtering happens client-side, so over-fetch when it applies.
      const max = years.from !== undefined || years.to !== undefined ? opts.limit * 3 : opts.limit;
      try {
        const fetchFeed = async (op: 'AND' | 'OR') => {
          const res = await fetchWithTimeout(buildArxivUrl(q, max, op), { signal: opts.signal, fetchImpl: cfg.fetchImpl });
          if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, retryAfter(res));
          return parseArxivFeed(await res.text(), years);
        };
        let found = await fetchFeed('AND');
        // All terms together can be too strict for a 5-keyword query; loosen once.
        if (!found.length && q.split(' ').length > 2) found = await fetchFeed('OR');
        const out = found.slice(0, opts.limit);
        return opts.counter ? out.map((c) => ({ ...c, forCounter: true })) : out;
      } catch (e) {
        throw toAdapterError('arxiv', LABEL, e);
      }
    },
  };
}
