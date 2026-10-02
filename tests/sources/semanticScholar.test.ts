import { describe, expect, it } from 'vitest';
import { createSemanticScholarAdapter, s2YearParam, S2_MAX_BACKOFF_MS } from '../../src/background/sources/semanticScholar';
import { AdapterError } from '../../src/background/sources';
import { fixtureJson, fixtureText, jsonResponse, makePlan, mockFetch, signal } from './helpers';

const search = fixtureJson('s2-search.json');
const real429 = fixtureText('s2-429.real.json');

function noSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe('Semantic Scholar adapter', () => {
  it('builds the request with fields, limit, year range and region keywords', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(search));
    const adapter = createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep());
    await adapter.search(makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2020, regions: ['Mexico'] } }), {
      limit: 7,
      signal: signal(),
    });
    expect(calls).toHaveLength(1); // first academic query only
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.semanticscholar.org/graph/v1/paper/search');
    expect(u.searchParams.get('query')).toBe('minimum wage employment effects Mexico');
    expect(u.searchParams.get('limit')).toBe('7');
    expect(u.searchParams.get('year')).toBe('2010-2020');
    const fields = u.searchParams.get('fields')!.split(',');
    for (const f of ['title', 'abstract', 'year', 'authors', 'venue', 'url', 'openAccessPdf', 'externalIds', 'citationCount']) expect(fields).toContain(f);
  });

  it('formats open-ended year ranges', () => {
    expect(s2YearParam({ from: 2010 })).toBe('2010-');
    expect(s2YearParam({ to: 2020 })).toBe('-2020');
    expect(s2YearParam({})).toBeUndefined();
  });

  it('maps papers, drops non-English, handles empty openAccessPdf url', async () => {
    const { fetch } = mockFetch(() => jsonResponse(search));
    const out = await createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep()).search(makePlan(), { limit: 10, signal: signal() });
    expect(out.map((c) => c.title)).toEqual([
      'The Effect of Minimum Wages on Low-Wage Jobs',
      'Machine Learning Estimates of Minimum Wage Employment Effects',
      'Minimum Wages',
    ]);
    const [qje, arxivOnly, book] = out;
    expect(qje).toMatchObject({
      sourceId: 'semantic_scholar',
      tier: 'peer_reviewed',
      doi: '10.1093/qje/qjz014',
      url: 'https://doi.org/10.1093/qje/qjz014',
      publisher: 'The Quarterly Journal of Economics',
      published: '2019-05-06',
      citedByCount: 798,
      authors: ['Doruk Cengiz', 'Arindrajit Dube', 'Attila S. Lindner', 'Ben Zipperer'],
    });
    expect(qje!.pdfUrl).toBeUndefined(); // openAccessPdf.url === ""
    // arXiv-hosted paper that S2 labels JournalArticle is still a preprint.
    expect(arxivOnly).toMatchObject({
      tier: 'preprint',
      url: 'https://arxiv.org/abs/2107.06469',
      pdfUrl: 'https://arxiv.org/pdf/2107.06469',
      doi: '10.48550/arxiv.2107.06469',
    });
    // No abstract, no venue: title-only English check passes, preprint tier, S2 landing page.
    expect(book).toMatchObject({ tier: 'preprint', published: '2008', url: expect.stringContaining('semanticscholar.org/paper/') as string });
    expect(book!.snippet).toBeUndefined();
  });

  it('returns [] when S2 has no matches (no `data` field)', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ total: 0, offset: 0 }));
    expect(await createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep()).search(makePlan(), { limit: 5, signal: signal() })).toEqual([]);
  });

  it('on 429 backs off once (respecting retry-after, capped) and retries', async () => {
    let n = 0;
    const { fetch, calls } = mockFetch(() => (n++ === 0 ? jsonResponse(real429, 429, { 'retry-after': '1' }) : jsonResponse(search)));
    const s = noSleep();
    const out = await createSemanticScholarAdapter({ fetchImpl: fetch }, s).search(makePlan(), { limit: 5, signal: signal() });
    expect(calls).toHaveLength(2);
    expect(s.waits).toEqual([1000]);
    expect(out.length).toBe(3);
  });

  it('caps the backoff at ~2s and gives up with rate_limited after the second 429', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(real429, 429, { 'retry-after': '30' }));
    const s = noSleep();
    const err = await createSemanticScholarAdapter({ fetchImpl: fetch }, s)
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect(s.waits).toEqual([S2_MAX_BACKOFF_MS]);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('rate_limited');
    expect((err as AdapterError).sourceId).toBe('semantic_scholar');
  });

  it('uses a default backoff when there is no retry-after header (real S2 429s have none)', async () => {
    const { fetch } = mockFetch(() => jsonResponse(real429, 429));
    const s = noSleep();
    await createSemanticScholarAdapter({ fetchImpl: fetch }, s)
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch(() => undefined);
    expect(s.waits).toHaveLength(1);
    expect(s.waits[0]).toBeGreaterThan(0);
    expect(s.waits[0]).toBeLessThanOrEqual(S2_MAX_BACKOFF_MS);
  });

  it('serializes concurrent calls through one queue', async () => {
    let active = 0;
    let maxActive = 0;
    const { fetch } = mockFetch(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return jsonResponse(search);
    });
    const a = createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep());
    const b = createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep());
    await Promise.all([a.search(makePlan(), { limit: 3, signal: signal() }), b.search(makePlan(), { limit: 3, signal: signal() })]);
    expect(maxActive).toBe(1);
  });

  it('maps bad JSON to bad_response and 500 to network', async () => {
    const { fetch } = mockFetch(() => new Response('not json', { status: 200 }));
    const e1 = await createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep())
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect((e1 as AdapterError).kind).toBe('bad_response');
    const { fetch: f2 } = mockFetch(() => jsonResponse({ message: 'Internal' }, 500));
    const e2 = await createSemanticScholarAdapter({ fetchImpl: f2 }, noSleep())
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect((e2 as AdapterError).kind).toBe('network');
  });

  it('counter search uses the counterQuery', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(search));
    const out = await createSemanticScholarAdapter({ fetchImpl: fetch }, noSleep()).search(makePlan(), {
      limit: 2,
      signal: signal(),
      counter: true,
    });
    expect(new URL(calls[0]!.url).searchParams.get('query')).toBe('minimum wage increases cause job losses for low-skilled workers');
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.forCounter)).toBe(true);
  });
});
