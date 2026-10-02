// Semantic Scholar paper search. The unauthenticated limit is tight and shared, so every call goes
// through one module-level queue, backs off once on 429, then gives up with 'rate_limited'.

import type { AdapterSearchOptions, Candidate, Plan, SourceAdapter, SourceTier } from '../../shared/types';
import { normalizeWs } from '../../shared/text';
import { HttpError, SerialQueue, fetchWithTimeout, retryAfter, sleep as netSleep, throwIfAborted, type FetchLike } from '../net';
import { adapterLabel } from './labels';
import { AdapterError, toAdapterError } from './errors';
import { isEnglish } from './lang';
import { academicQueries, regionsOf, stableSignature, withRegionKeywords, yearBounds, type YearBounds } from './query';
import { isPreprintDoi } from './tiers';
import { candidateIdFor, isHttpUrl, normalizeDoi, toHttps } from './url';

export const S2_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';
const LABEL = adapterLabel('semantic_scholar');
const FIELDS = 'title,abstract,year,publicationDate,authors,venue,journal,url,openAccessPdf,externalIds,citationCount,publicationTypes';
/** Longest we wait before the single retry after a 429. */
export const S2_MAX_BACKOFF_MS = 2000;
const S2_DEFAULT_BACKOFF_MS = 1200;

/** One queue for the whole service worker: S2 calls never overlap, across jobs too. */
const s2Queue = new SerialQueue();

export interface S2Config {
  fetchImpl?: FetchLike;
}

export interface S2Deps {
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface S2Paper {
  paperId?: string | null;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  authors?: Array<{ name?: string | null } | null> | null;
  venue?: string | null;
  journal?: { name?: string | null } | null;
  url?: string | null;
  openAccessPdf?: { url?: string | null } | null;
  externalIds?: Record<string, string | number | null | undefined> | null;
  citationCount?: number | null;
  publicationTypes?: string[] | null;
}

/** S2 `year` param: "2010-2020", "2010-", "-2020". */
export function s2YearParam(y: YearBounds): string | undefined {
  if (y.from === undefined && y.to === undefined) return undefined;
  return `${y.from ?? ''}-${y.to ?? ''}`;
}

export function buildS2Url(query: string, years: YearBounds, limit: number): string {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('fields', FIELDS);
  params.set('limit', String(Math.max(1, Math.min(100, Math.round(limit)))));
  const yp = s2YearParam(years);
  if (yp) params.set('year', yp);
  return `${S2_BASE}?${params.toString()}`;
}

const PREPRINT_VENUE = /arxiv|biorxiv|medrxiv|ssrn|research square|preprint|\bosf\b|working paper|\bnber\b/i;

function s2Tier(p: S2Paper, doi: string | undefined): SourceTier {
  const venue = normalizeWs(p.journal?.name || p.venue || '');
  if (!venue || PREPRINT_VENUE.test(venue)) return 'preprint';
  if (doi && isPreprintDoi(doi)) return 'preprint';
  const types = p.publicationTypes ?? [];
  if (types.some((t) => t === 'JournalArticle' || t === 'Review' || t === 'Conference')) return 'peer_reviewed';
  return doi ? 'peer_reviewed' : 'preprint';
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

export function mapS2Paper(p: S2Paper, rank: number): Candidate | null {
  const title = normalizeWs(p.title ?? '');
  if (!title) return null;
  const abstract = normalizeWs(p.abstract ?? '');
  if (!isEnglish(abstract ? `${title}. ${abstract}` : title)) return null;
  const ext = p.externalIds ?? {};
  const rawDoi = str(ext.DOI);
  const arxivId = str(ext.ArXiv);
  const doi = rawDoi ? normalizeDoi(rawDoi) : arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : undefined;
  const url = rawDoi
    ? `https://doi.org/${normalizeDoi(rawDoi)}`
    : arxivId
      ? `https://arxiv.org/abs/${arxivId}`
      : isHttpUrl(p.url)
        ? toHttps(p.url)
        : p.paperId
          ? `https://www.semanticscholar.org/paper/${p.paperId}`
          : undefined;
  if (!url) return null;
  const authors = (p.authors ?? []).map((a) => normalizeWs(a?.name ?? '')).filter((n) => n.length > 0);
  const publisher = normalizeWs(p.journal?.name || p.venue || '') || undefined;
  const published = p.publicationDate || (p.year ? String(p.year) : undefined);
  const pdf = p.openAccessPdf?.url;
  const c: Candidate = {
    id: candidateIdFor({ doi, url }),
    sourceId: 'semantic_scholar',
    sourceIds: ['semantic_scholar'],
    tier: s2Tier(p, doi),
    title,
    url,
    authors,
    searchRank: rank,
  };
  if (isHttpUrl(pdf)) c.pdfUrl = toHttps(pdf);
  if (doi) c.doi = doi;
  if (publisher) c.publisher = publisher;
  if (published) c.published = published;
  if (abstract) c.snippet = abstract;
  if (typeof p.citationCount === 'number') c.citedByCount = p.citationCount;
  return c;
}

export function parseS2Response(json: unknown): Candidate[] {
  if (!json || typeof json !== 'object') throw new AdapterError('semantic_scholar', 'bad_response', `${LABEL}: unexpected response shape`);
  const data = (json as { data?: unknown }).data;
  if (data === undefined) return []; // no matches: S2 omits `data`
  if (!Array.isArray(data)) throw new AdapterError('semantic_scholar', 'bad_response', `${LABEL}: unexpected response shape`);
  const out: Candidate[] = [];
  data.forEach((p: unknown, i) => {
    if (!p || typeof p !== 'object') return;
    const c = mapS2Paper(p as S2Paper, i);
    if (c) out.push(c);
  });
  return out;
}

export function createSemanticScholarAdapter(cfg: S2Config, deps: S2Deps = {}): SourceAdapter {
  const doSleep = deps.sleep ?? netSleep;
  const queryFor = (plan: Plan, counter: boolean): string | undefined => {
    const q = counter ? normalizeWs(plan.counterQuery ?? '') : academicQueries(plan, 1)[0];
    return q ? withRegionKeywords(q, regionsOf(plan)) : undefined;
  };

  async function request(url: string, signal: AbortSignal): Promise<unknown> {
    const get = () => fetchWithTimeout(url, { signal, fetchImpl: cfg.fetchImpl, headers: { Accept: 'application/json' } });
    let res = await get();
    if (res.status === 429) {
      const wait = Math.min(S2_MAX_BACKOFF_MS, retryAfter(res) ?? S2_DEFAULT_BACKOFF_MS);
      await doSleep(wait, signal);
      res = await get();
      if (res.status === 429) throw new AdapterError('semantic_scholar', 'rate_limited', `${LABEL}: rate limited, skipped for now`);
    }
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, retryAfter(res));
    const body = await res.text();
    return JSON.parse(body) as unknown;
  }

  return {
    id: 'semantic_scholar',
    needsExaKey: false,
    signature(plan: Plan): string {
      const y = yearBounds(plan);
      return stableSignature('semantic_scholar', { q: queryFor(plan, false) ?? null, year: s2YearParam(y) ?? null });
    },
    async search(plan: Plan, opts: AdapterSearchOptions): Promise<Candidate[]> {
      const q = queryFor(plan, !!opts.counter);
      if (!q || opts.limit <= 0) return [];
      const url = buildS2Url(q, yearBounds(plan), opts.limit);
      try {
        const json = await s2Queue.run(async () => {
          throwIfAborted(opts.signal);
          return request(url, opts.signal);
        });
        const out = parseS2Response(json).slice(0, opts.limit);
        return opts.counter ? out.map((c) => ({ ...c, forCounter: true })) : out;
      } catch (e) {
        throw toAdapterError('semantic_scholar', LABEL, e);
      }
    },
  };
}
