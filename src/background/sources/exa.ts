// Exa search: one client, four adapters (web, news, think tanks + gov/IGO, papers).
// Each adapter makes ONE call per search (cost: ~$0.005/search + ~$0.001/page of text).

import type { AdapterSearchOptions, Candidate, Plan, SourceAdapter, SourceTier } from '../../shared/types';
import { normalizeWs } from '../../shared/text';
import { fetchWithTimeout, type FetchLike } from '../net';
import { AdapterError, kindForStatus, toAdapterError } from './errors';
import { adapterLabel } from './labels';
import { isEnglish } from './lang';
import { counterQueryOf, firstQuery, regionsOf, stableSignature, withRegionSentence, yearBounds, type YearBounds } from './query';
import { EXA_EXCLUDE_DOMAINS, POLICY_INCLUDE_DOMAINS, isPreprintDoi, tierForUrl } from './tiers';
import { candidateIdFor, doiFromUrl, findDoiInText, isHttpUrl } from './url';

export const EXA_ENDPOINT = 'https://api.exa.ai/search';
export const EXA_TEXT_MAX_CHARS = 20_000;
/** Fallback cost estimate when the response has no costDollars. */
export const EXA_SEARCH_COST_USD = 0.005;
export const EXA_TEXT_COST_USD = 0.001;

export type ExaAdapterId = 'exa_web' | 'exa_news' | 'exa_policy' | 'exa_papers';

export interface ExaConfig {
  exaKey?: string;
  exaResultsPerAdapter: number;
  fetchImpl?: FetchLike;
}

export interface ExaRequest {
  query: string;
  type: 'auto';
  numResults: number;
  category?: 'news' | 'publication';
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  contents: { text: { maxCharacters: number } };
}

export interface ExaResult {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  author?: string | null;
  id?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  score?: number | null;
}

interface Preset {
  /** Plan query lists to try in order; the first non-empty query is used. */
  lists: Array<keyof Plan['queries']>;
  category?: ExaRequest['category'];
  includeDomains?: readonly string[];
  excludeDomains?: readonly string[];
}

const PRESETS: Record<ExaAdapterId, Preset> = {
  exa_web: { lists: ['semantic'], excludeDomains: EXA_EXCLUDE_DOMAINS },
  exa_news: { lists: ['news', 'semantic'], category: 'news' },
  exa_policy: { lists: ['policy', 'semantic'], includeDomains: POLICY_INCLUDE_DOMAINS },
  exa_papers: { lists: ['semantic'], category: 'publication' },
};

export function exaQueryFor(id: ExaAdapterId, plan: Plan, counter: boolean): string {
  const q = counter ? counterQueryOf(plan) : firstQuery(plan, PRESETS[id].lists);
  return q ? withRegionSentence(q, regionsOf(plan)) : '';
}

function dateBounds(y: YearBounds): { start?: string; end?: string } {
  const out: { start?: string; end?: string } = {};
  if (y.from !== undefined) out.start = `${y.from}-01-01T00:00:00.000Z`;
  if (y.to !== undefined) out.end = `${y.to}-12-31T23:59:59.999Z`;
  return out;
}

export function buildExaRequest(id: ExaAdapterId, plan: Plan, counter: boolean, numResults: number): ExaRequest {
  const p = PRESETS[id];
  const body: ExaRequest = {
    query: exaQueryFor(id, plan, counter),
    type: 'auto',
    numResults: Math.max(1, Math.min(100, Math.round(numResults))),
    contents: { text: { maxCharacters: EXA_TEXT_MAX_CHARS } },
  };
  if (p.category) body.category = p.category;
  if (p.includeDomains) body.includeDomains = [...p.includeDomains];
  if (p.excludeDomains) body.excludeDomains = [...p.excludeDomains];
  const d = dateBounds(yearBounds(plan));
  if (d.start) body.startPublishedDate = d.start;
  if (d.end) body.endPublishedDate = d.end;
  return body;
}

/** "By Jane Doe, John Roe and Ann Lee" / "A; B" -> ["Jane Doe", "John Roe", "Ann Lee"]. */
export function splitAuthors(author: string | null | undefined): string[] {
  if (!author) return [];
  const s = normalizeWs(author).replace(/^by\s+/i, '');
  const parts = s.includes(';') ? s.split(';') : s.split(/,|\s+and\s+|\s*&\s*/i);
  const out: string[] = [];
  for (const raw of parts) {
    const name = normalizeWs(raw.replace(/^(?:and|by)\s+/i, ''));
    if (name && name.length <= 120 && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Plain-text excerpt (markdown links/headings removed), cut at a word boundary. */
export function excerpt(text: string, max = 400): string {
  const plain = normalizeWs(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/[*_`>|]+/g, ' '),
  );
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\d?\./, '');
  } catch {
    return '';
  }
}

function isPdfUrl(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const NEWS_KEEP: readonly SourceTier[] = ['major_news', 'gov_igo', 'think_tank'];

export function mapExaResult(id: ExaAdapterId, r: ExaResult, rank: number, counter: boolean): Candidate | null {
  if (!isHttpUrl(r.url)) return null;
  const url = r.url.trim();
  const host = hostOf(url);
  const title = normalizeWs(r.title ?? '') || host;
  const text = typeof r.text === 'string' && r.text.trim() ? r.text : undefined;
  const highlights = (r.highlights ?? []).filter((h): h is string => typeof h === 'string' && h.trim().length > 0);
  const snippet = highlights.length ? normalizeWs(highlights.join(' … ')) : text ? excerpt(text) : title;

  const langSample = text && text.length >= 200 ? text : `${title}. ${snippet}${text && text !== snippet ? ' ' + text : ''}`;
  if (!isEnglish(langSample)) return null;

  const info = tierForUrl(url);
  let doi = doiFromUrl(url);
  let tier: SourceTier = info.tier;
  if (id === 'exa_news') {
    tier = NEWS_KEEP.includes(info.tier) ? info.tier : 'web';
  } else if (id === 'exa_papers') {
    if (!doi && text) doi = findDoiInText(text.slice(0, 3000));
    if (info.lowQuality || info.isWikipedia) tier = 'web';
    else if (info.tier === 'peer_reviewed' || info.tier === 'preprint' || info.tier === 'gov_igo' || info.tier === 'think_tank') tier = info.tier;
    else tier = doi && !isPreprintDoi(doi) ? 'peer_reviewed' : 'preprint';
  }

  const c: Candidate = {
    id: candidateIdFor({ doi, url }),
    sourceId: id,
    sourceIds: [id],
    tier,
    title,
    url,
    authors: splitAuthors(r.author),
    publisher: info.publisherName ?? host,
    snippet,
    searchRank: rank,
  };
  const published = typeof r.publishedDate === 'string' ? /^\d{4}(-\d{2}-\d{2})?/.exec(r.publishedDate.trim())?.[0] : undefined;
  if (published) c.published = published;
  if (doi) c.doi = doi;
  if (isPdfUrl(url)) c.pdfUrl = url;
  if (text) c.text = text;
  if (typeof r.score === 'number' && Number.isFinite(r.score)) c.searchScore = r.score;
  if (info.lowQuality) c.lowQuality = true;
  if (info.isWikipedia) c.isWikipedia = true;
  if (counter) c.forCounter = true;
  return c;
}

const STATUS_MESSAGE: Record<string, string> = {
  auth: 'Exa rejected the API key — check it in Options',
  out_of_credits: 'Exa is out of credits or over its budget',
  rate_limited: 'Exa rate limit reached',
};

export interface ExaSearchResult {
  results: ExaResult[];
  costUsd: number;
}

/** POST /search. Maps HTTP failures to AdapterError kinds; never puts the key in a message. */
export async function exaSearch(cfg: ExaConfig, id: ExaAdapterId, body: ExaRequest, signal: AbortSignal): Promise<ExaSearchResult> {
  const label = adapterLabel(id);
  if (!cfg.exaKey) throw new AdapterError(id, 'auth', 'Exa key missing');
  let raw: string;
  try {
    const res = await fetchWithTimeout(EXA_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': cfg.exaKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
      fetchImpl: cfg.fetchImpl,
    });
    raw = await res.text();
    if (!res.ok) {
      const kind = kindForStatus(res.status);
      throw new AdapterError(id, kind, `${label}: ${STATUS_MESSAGE[kind] ?? 'request failed'} (HTTP ${res.status})`);
    }
  } catch (e) {
    throw toAdapterError(id, label, e);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AdapterError(id, 'bad_response', `${label}: response was not valid JSON`);
  }
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new AdapterError(id, 'bad_response', `${label}: unexpected response shape`);
  const list = results.filter((r): r is ExaResult => !!r && typeof r === 'object');
  const total = (json as { costDollars?: { total?: unknown } }).costDollars?.total;
  const costUsd =
    typeof total === 'number' && Number.isFinite(total)
      ? total
      : EXA_SEARCH_COST_USD + EXA_TEXT_COST_USD * list.filter((r) => typeof r.text === 'string' && r.text.length > 0).length;
  return { results: list, costUsd };
}

export function createExaAdapter(id: ExaAdapterId, cfg: ExaConfig): SourceAdapter {
  return {
    id,
    needsExaKey: true,
    signature(plan: Plan): string {
      const y = yearBounds(plan);
      return stableSignature(id, { q: exaQueryFor(id, plan, false), from: y.from ?? null, to: y.to ?? null });
    },
    async search(plan: Plan, opts: AdapterSearchOptions): Promise<Candidate[]> {
      if (!cfg.exaKey) throw new AdapterError(id, 'auth', 'Exa key missing');
      const counter = !!opts.counter;
      const numResults = Math.min(opts.limit, cfg.exaResultsPerAdapter);
      if (numResults <= 0) return [];
      const body = buildExaRequest(id, plan, counter, numResults);
      if (!body.query) return [];
      const { results, costUsd } = await exaSearch(cfg, id, body, opts.signal);
      opts.onCost?.(costUsd);
      const out: Candidate[] = [];
      results.forEach((r, i) => {
        const c = mapExaResult(id, r, i, counter);
        if (c) out.push(c);
      });
      return out;
    },
  };
}

export const EXA_ADAPTER_IDS: readonly ExaAdapterId[] = ['exa_web', 'exa_news', 'exa_policy', 'exa_papers'];
