import { describe, expect, it } from 'vitest';
import { createOpenAlexAdapter, rebuildAbstract } from '../../src/background/sources/openalex';
import { AdapterError } from '../../src/background/sources';
import { fixtureJson, fixtureText, jsonResponse, makePlan, mockFetch, signal } from './helpers';

const works = fixtureJson('openalex-works.json');
const abstracts = fixtureJson<Record<string, string>>('openalex-abstracts.json');

describe('rebuildAbstract', () => {
  it('rebuilds the text from an inverted index', () => {
    expect(rebuildAbstract({ world: [1], Hello: [0], again: [3], ',': [2] })).toBe('Hello world , again');
    expect(rebuildAbstract(null)).toBe('');
    expect(rebuildAbstract({})).toBe('');
  });

  it('matches the original abstract for fixture works', () => {
    const w = (works as { results: Array<{ abstract_inverted_index: Record<string, number[]> }> }).results[0]!;
    expect(rebuildAbstract(w.abstract_inverted_index)).toBe(abstracts['W2952349331']);
  });
});

describe('OpenAlex adapter', () => {
  it('builds the request: search, year + language filter, per-page, select, bearer key header and mailto', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(works));
    const adapter = createOpenAlexAdapter({ openalexKey: 'oa-key-123', contactEmail: 'me@example.com', fetchImpl: fetch });
    const plan = makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2020, regions: ['Vietnam'] } });
    await adapter.search(plan, { limit: 6, signal: signal() });

    expect(calls).toHaveLength(2); // two academic queries in parallel
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://api.openalex.org/works');
    expect(u.searchParams.get('search')).toBe('minimum wage employment effects Vietnam');
    expect(u.searchParams.get('filter')).toBe('from_publication_date:2010-01-01,to_publication_date:2020-12-31,language:en');
    expect(u.searchParams.get('per-page')).toBe('6');
    expect(u.searchParams.has('api_key')).toBe(false); // never in the URL
    expect(calls[0]!.url).not.toContain('oa-key-123');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer oa-key-123');
    expect(u.searchParams.get('mailto')).toBe('me@example.com');
    expect(u.searchParams.get('select')).toContain('abstract_inverted_index');
    expect(new URL(calls[1]!.url).searchParams.get('search')).toBe('minimum wage disemployment low-wage jobs Vietnam');
  });

  it('omits api_key, mailto and date filters when not configured', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(works));
    const adapter = createOpenAlexAdapter({ fetchImpl: fetch });
    await adapter.search(makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2015 } }), { limit: 5, signal: signal() });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.has('api_key')).toBe(false);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(u.searchParams.has('mailto')).toBe(false);
    expect(u.searchParams.get('filter')).toBe('from_publication_date:2015-01-01,language:en');
  });

  it('maps works to candidates', async () => {
    const { fetch } = mockFetch(() => jsonResponse(works));
    const adapter = createOpenAlexAdapter({ fetchImpl: fetch });
    const out = await adapter.search(makePlan({ queries: { academic: ['minimum wage'], semantic: [], news: [], policy: [] } }), {
      limit: 10,
      signal: signal(),
    });
    // The Spanish work (language: es) is dropped defensively.
    expect(out.map((c) => c.title)).toEqual([
      'The Effect of Minimum Wages on Low-Wage Jobs',
      'Minimum Wage Effects Across State Borders: Estimates Using Contiguous Counties',
      'Minimum Wages and Employment: A Review of Evidence from the New Minimum Wage Research',
      'The Minimum Wage and Labor Market Outcomes',
    ]);
    const [cengiz, dube, nber, chapter] = out;
    expect(cengiz).toMatchObject({
      sourceId: 'openalex',
      sourceIds: ['openalex'],
      tier: 'peer_reviewed',
      doi: '10.1093/qje/qjz014',
      url: 'https://www.nber.org/papers/w25434', // best OA landing, upgraded to https
      pdfUrl: 'https://www.nber.org/papers/w25434.pdf',
      authors: ['Doruk Cengiz', 'Arindrajit Dube', 'Attila Lindner', 'Ben Zipperer'],
      publisher: 'The Quarterly Journal of Economics',
      published: '2019-05-06',
      citedByCount: 812,
      snippet: abstracts['W2952349331'],
      searchRank: 0,
    });
    expect(cengiz!.id).toMatch(/^c_[0-9a-f]{8}$/);
    expect(dube).toMatchObject({ tier: 'peer_reviewed', doi: '10.1162/rest_a_00039', citedByCount: 1543 });
    expect(dube!.url).toContain('direct.mit.edu');
    expect(dube!.pdfUrl).toBeUndefined();
    // Working paper in a repository -> preprint; author with null `author` falls back to raw_author_name.
    expect(nber).toMatchObject({ tier: 'preprint', doi: '10.3386/w12663', authors: ['David Neumark', 'William Wascher'] });
    // Book chapter without abstract or DOI: preprint tier, year-only date, landing URL as id source.
    expect(chapter).toMatchObject({ tier: 'preprint', published: '2008', authors: [] });
    expect(chapter!.snippet).toBeUndefined();
    expect(chapter!.doi).toBeUndefined();
  });

  it('merges the two query result lists without duplicates and respects limit', async () => {
    const { fetch } = mockFetch(() => jsonResponse(works));
    const adapter = createOpenAlexAdapter({ fetchImpl: fetch });
    const out = await adapter.search(makePlan(), { limit: 3, signal: signal() });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
    expect(out.map((c) => c.searchRank)).toEqual([0, 1, 2]);
  });

  it('counter search uses counterQuery and marks results forCounter', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(works));
    const adapter = createOpenAlexAdapter({ fetchImpl: fetch });
    const out = await adapter.search(makePlan(), { limit: 3, signal: signal(), counter: true });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get('search')).toBe('minimum wage increases cause job losses for low-skilled workers');
    expect(new URL(calls[0]!.url).searchParams.get('per-page')).toBe('3');
    expect(out.every((c) => c.forCounter === true)).toBe(true);
  });

  it('still returns results when one of the two queries fails', async () => {
    let n = 0;
    const { fetch } = mockFetch(() => (n++ === 0 ? jsonResponse({ error: 'boom' }, 500) : jsonResponse(works)));
    const out = await createOpenAlexAdapter({ fetchImpl: fetch }).search(makePlan(), { limit: 5, signal: signal() });
    expect(out.length).toBeGreaterThan(0);
  });

  it('maps the real 429 (budget exhausted) response to rate_limited with a key hint', async () => {
    const { fetch } = mockFetch(() => jsonResponse(fixtureText('openalex-429.real.json'), 429));
    const err = await createOpenAlexAdapter({ fetchImpl: fetch })
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('rate_limited');
    expect((err as AdapterError).sourceId).toBe('openalex');
    expect((err as AdapterError).message).toMatch(/API key/);
  });

  it('maps garbage to bad_response', async () => {
    const { fetch } = mockFetch(() => new Response('<html>oops</html>', { status: 200 }));
    const err = await createOpenAlexAdapter({ fetchImpl: fetch })
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect((err as AdapterError).kind).toBe('bad_response');
    const { fetch: f2 } = mockFetch(() => jsonResponse({ meta: {} }));
    const err2 = await createOpenAlexAdapter({ fetchImpl: f2 })
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect((err2 as AdapterError).kind).toBe('bad_response');
  });

  it('never leaks the api key in error messages', async () => {
    const { fetch } = mockFetch(() => jsonResponse({}, 403));
    const err = await createOpenAlexAdapter({ openalexKey: 'SECRET-KEY', fetchImpl: fetch })
      .search(makePlan(), { limit: 5, signal: signal() })
      .catch((e: unknown) => e);
    expect((err as AdapterError).kind).toBe('auth');
    expect((err as Error).message).not.toContain('SECRET-KEY');
  });
});
