// OpenAlex works search. Free; optional api_key raises the daily budget; mailto joins the polite pool.

import type { AdapterSearchOptions, Candidate, Plan, SourceAdapter, SourceTier } from '../../shared/types';
import { normalizeWs } from '../../shared/text';
import { HttpError, fetchJson, type FetchLike } from '../net';
import { adapterLabel } from './labels';
import { AdapterError, toAdapterError } from './errors';
import { academicQueries, counterQueryOf, regionsOf, stableSignature, withRegionKeywords, yearBounds, type YearBounds } from './query';
import { candidateIdFor, isHttpUrl, normalizeDoi, toHttps } from './url';

export const OPENALEX_BASE = 'https://api.openalex.org/works';
const LABEL = adapterLabel('openalex');
const SELECT = [
  'id',
  'doi',
  'display_name',
  'publication_date',
  'publication_year',
  'language',
  'type',
  'cited_by_count',
  'authorships',
  'primary_location',
  'best_oa_location',
  'abstract_inverted_index',
].join(',');

export interface OpenAlexConfig {
  openalexKey?: string;
  contactEmail?: string;
  fetchImpl?: FetchLike;
}

interface OASource {
  display_name?: string | null;
  type?: string | null;
  host_organization_name?: string | null;
}

interface OALocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  is_oa?: boolean | null;
  source?: OASource | null;
}

export interface OAWork {
  id?: string | null;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_date?: string | null;
  publication_year?: number | null;
  language?: string | null;
  type?: string | null;
  cited_by_count?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null; raw_author_name?: string | null }> | null;
  primary_location?: OALocation | null;
  best_oa_location?: OALocation | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

interface OAResponse {
  results?: unknown;
}

/** Rebuild an abstract from OpenAlex's inverted index ({ word: [positions] }). */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index || typeof index !== 'object') return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (Number.isInteger(p) && p >= 0 && p < 50_000) words[p] = word;
  }
  return normalizeWs(words.filter((w) => typeof w === 'string').join(' '));
}

export function buildOpenAlexUrl(query: string, years: YearBounds, perPage: number, cfg: OpenAlexConfig): string {
  const params = new URLSearchParams();
  params.set('search', query);
  const filters: string[] = [];
  if (years.from !== undefined) filters.push(`from_publication_date:${years.from}-01-01`);
  if (years.to !== undefined) filters.push(`to_publication_date:${years.to}-12-31`);
  filters.push('language:en');
  params.set('filter', filters.join(','));
  params.set('per-page', String(Math.max(1, Math.min(50, Math.round(perPage)))));
  params.set('select', SELECT);
  if (cfg.openalexKey) params.set('api_key', cfg.openalexKey);
  if (cfg.contactEmail) params.set('mailto', cfg.contactEmail);
  return `${OPENALEX_BASE}?${params.toString()}`;
}

function tierOf(w: OAWork): SourceTier {
  const type = (w.type ?? '').toLowerCase();
  const sourceType = (w.primary_location?.source?.type ?? '').toLowerCase();
  return (type === 'article' || type === 'review') && sourceType === 'journal' ? 'peer_reviewed' : 'preprint';
}

export function mapOpenAlexWork(w: OAWork, rank: number, forCounter: boolean): Candidate | null {
  const title = normalizeWs(w.display_name ?? w.title ?? '');
  if (!title) return null;
  if (w.language && w.language !== 'en') return null;
  const doi = w.doi ? normalizeDoi(w.doi) : undefined;
  const landing = [w.best_oa_location?.landing_page_url, w.primary_location?.landing_page_url].find(isHttpUrl);
  const url = landing ? toHttps(landing) : doi ? `https://doi.org/${doi}` : isHttpUrl(w.id) ? w.id : undefined;
  if (!url) return null;
  const pdf = [w.best_oa_location?.pdf_url, w.primary_location?.pdf_url].find(isHttpUrl);
  const authors = (w.authorships ?? [])
    .map((a) => normalizeWs(a?.author?.display_name ?? a?.raw_author_name ?? ''))
    .filter((n) => n.length > 0);
  const publisher = normalizeWs(w.primary_location?.source?.display_name ?? '') || undefined;
  const published = w.publication_date || (w.publication_year ? String(w.publication_year) : undefined);
  const abstract = rebuildAbstract(w.abstract_inverted_index);
  const c: Candidate = {
    id: candidateIdFor({ doi, url }),
    sourceId: 'openalex',
    sourceIds: ['openalex'],
    tier: tierOf(w),
    title,
    url,
    authors,
    searchRank: rank,
  };
  if (pdf) c.pdfUrl = toHttps(pdf);
  if (doi) c.doi = doi;
  if (publisher) c.publisher = publisher;
  if (published) c.published = published;
  if (abstract) c.snippet = abstract;
  if (typeof w.cited_by_count === 'number') c.citedByCount = w.cited_by_count;
  if (forCounter) c.forCounter = true;
  return c;
}

export function parseOpenAlexResponse(json: unknown, forCounter: boolean): Candidate[] {
  const results = (json as OAResponse | null)?.results;
  if (!Array.isArray(results)) throw new AdapterError('openalex', 'bad_response', `${LABEL}: unexpected response shape`);
  const out: Candidate[] = [];
  results.forEach((w: unknown, i) => {
    if (!w || typeof w !== 'object') return;
    const c = mapOpenAlexWork(w as OAWork, i, forCounter);
    if (c) out.push(c);
  });
  return out;
}

/** Interleave several ranked lists, dropping repeats, re-numbering searchRank. */
function interleave(lists: Candidate[][], limit: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const l of lists) {
      const c = l[i];
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ ...c, searchRank: out.length });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function createOpenAlexAdapter(cfg: OpenAlexConfig): SourceAdapter {
  const queriesFor = (plan: Plan, counter: boolean): string[] => {
    const regions = regionsOf(plan);
    if (counter) {
      const q = counterQueryOf(plan);
      return q ? [withRegionKeywords(q, regions)] : [];
    }
    return academicQueries(plan, 2).map((q) => withRegionKeywords(q, regions));
  };

  return {
    id: 'openalex',
    needsExaKey: false,
    signature(plan: Plan): string {
      const y = yearBounds(plan);
      return stableSignature('openalex', { q: queriesFor(plan, false), from: y.from ?? null, to: y.to ?? null });
    },
    async search(plan: Plan, opts: AdapterSearchOptions): Promise<Candidate[]> {
      const counter = !!opts.counter;
      const queries = queriesFor(plan, counter);
      if (queries.length === 0 || opts.limit <= 0) return [];
      const years = yearBounds(plan);
      const settled = await Promise.allSettled(
        queries.map(async (q) => {
          const url = buildOpenAlexUrl(q, years, opts.limit, cfg);
          const json = await fetchJson<unknown>(url, { signal: opts.signal, fetchImpl: cfg.fetchImpl, headers: { Accept: 'application/json' } });
          return parseOpenAlexResponse(json, counter);
        }),
      );
      const ok = settled.filter((s): s is PromiseFulfilledResult<Candidate[]> => s.status === 'fulfilled').map((s) => s.value);
      if (ok.length === 0) {
        const first = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
        throw openAlexError(first?.reason, !!cfg.openalexKey);
      }
      return interleave(ok, opts.limit);
    },
  };
}

function openAlexError(e: unknown, hasKey: boolean): Error {
  if (e instanceof HttpError && e.status === 429) {
    return new AdapterError(
      'openalex',
      'rate_limited',
      hasKey ? `${LABEL}: rate limit or daily budget reached` : `${LABEL}: shared daily budget used up — add a free OpenAlex API key in Options`,
    );
  }
  return toAdapterError('openalex', LABEL, e);
}
