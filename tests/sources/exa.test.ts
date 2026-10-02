import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../src/shared/types';
import {
  EXA_TEXT_MAX_CHARS,
  createExaAdapter,
  excerpt,
  splitAuthors,
  type ExaAdapterId,
  type ExaRequest,
} from '../../src/background/sources/exa';
import { AdapterError, EXA_EXCLUDE_DOMAINS, POLICY_INCLUDE_DOMAINS } from '../../src/background/sources';
import { TimeoutError } from '../../src/background/net';
import { bodyOf, fixtureJson, headerOf, jsonResponse, makePlan, mockFetch, signal } from './helpers';

const KEY = 'exa-test-key-9f8e7d';

async function run(id: ExaAdapterId, fixture: string, opts: { limit?: number; counter?: boolean; plan?: ReturnType<typeof makePlan>; perAdapter?: number } = {}) {
  const { fetch, calls } = mockFetch(() => jsonResponse(fixtureJson(fixture)));
  const costs: number[] = [];
  const adapter = createExaAdapter(id, { exaKey: KEY, exaResultsPerAdapter: opts.perAdapter ?? 10, fetchImpl: fetch });
  const out = await adapter.search(opts.plan ?? makePlan(), {
    limit: opts.limit ?? 10,
    signal: signal(),
    counter: opts.counter,
    onCost: (usd) => costs.push(usd),
  });
  return { out, calls, costs, body: bodyOf<ExaRequest>(calls[0]?.init) };
}

function byHost(out: Candidate[], host: string): Candidate | undefined {
  return out.find((c) => new URL(c.url).hostname.includes(host));
}

describe('Exa request building', () => {
  it('exa_web: POST with x-api-key, auto type, numResults, text contents, excludeDomains, date bounds, region text', async () => {
    const plan = makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2020, regions: ['Vietnam', 'Thailand'] } });
    const { calls, body } = await run('exa_web', 'exa-web.json', { plan, limit: 8, perAdapter: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.exa.ai/search');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(headerOf(calls[0]!.init, 'x-api-key')).toBe(KEY);
    expect(headerOf(calls[0]!.init, 'content-type')).toBe('application/json');
    expect(body).toMatchObject({
      query: 'Our estimates show minimum wage increases had no significant effect on employment in Vietnam or Thailand',
      type: 'auto',
      numResults: 4, // min(limit, exaResultsPerAdapter)
      contents: { text: { maxCharacters: EXA_TEXT_MAX_CHARS } },
      startPublishedDate: '2010-01-01T00:00:00.000Z',
      endPublishedDate: '2020-12-31T23:59:59.999Z',
    });
    expect(EXA_TEXT_MAX_CHARS).toBe(20000);
    expect(body.excludeDomains).toEqual([...EXA_EXCLUDE_DOMAINS]);
    expect(body.excludeDomains).toContain('reddit.com');
    expect(body.category).toBeUndefined();
    expect(body.includeDomains).toBeUndefined();
  });

  it('no date fields when the plan has no year constraints', async () => {
    const { body } = await run('exa_web', 'exa-web.json');
    expect(body.startPublishedDate).toBeUndefined();
    expect(body.endPublishedDate).toBeUndefined();
    expect(body.query).toBe('Our estimates show minimum wage increases had no significant effect on employment.');
  });

  it('exa_news: news query + category news; falls back to semantic', async () => {
    const { body } = await run('exa_news', 'exa-news.json');
    expect(body).toMatchObject({ query: 'minimum wage increase job losses study', category: 'news', type: 'auto' });
    const fallback = await run('exa_news', 'exa-news.json', { plan: makePlan({ queries: { academic: [], semantic: ['S1'], news: [], policy: [] } }) });
    expect(fallback.body.query).toBe('S1');
  });

  it('exa_policy: policy query + think-tank and gov/IGO includeDomains (within the 1200 cap)', async () => {
    const { body } = await run('exa_policy', 'exa-policy.json');
    expect(body.query).toBe('minimum wage employment evidence review');
    expect(body.category).toBeUndefined();
    expect(body.includeDomains).toEqual([...POLICY_INCLUDE_DOMAINS]);
    for (const d of ['brookings.edu', 'cfr.org', 'imf.org', 'worldbank.org', 'oecd.org', 'sbv.gov.vn', '*.un.org']) expect(body.includeDomains).toContain(d);
    expect(body.includeDomains!.length).toBeLessThanOrEqual(1200);
  });

  it('exa_papers: semantic query + category publication', async () => {
    const { body } = await run('exa_papers', 'exa-papers.json');
    expect(body).toMatchObject({ category: 'publication', query: 'Our estimates show minimum wage increases had no significant effect on employment.' });
  });

  it('counter search uses counterQuery', async () => {
    const { body, out } = await run('exa_web', 'exa-web.json', { counter: true, limit: 3 });
    expect(body.query).toBe('minimum wage increases cause job losses for low-skilled workers');
    expect(body.numResults).toBe(3);
    expect(out.every((c) => c.forCounter)).toBe(true);
  });
});

describe('Exa result mapping', () => {
  it('exa_web: with text, without text, Wikipedia, low quality; drops the Vietnamese result; reports costDollars', async () => {
    const { out, costs } = await run('exa_web', 'exa-web.json');
    expect(costs).toEqual([0.009]);
    expect(out).toHaveLength(4);
    expect(byHost(out, 'vnexpress')).toBeUndefined();

    const brookings = byHost(out, 'brookings.edu')!;
    expect(brookings).toMatchObject({
      sourceId: 'exa_web',
      sourceIds: ['exa_web'],
      tier: 'think_tank',
      publisher: 'Brookings Institution',
      published: '2023-03-14',
      authors: ['Jane Smith', 'John Doe', 'Ann Lee'],
      searchScore: 0.4123,
      searchRank: 0,
    });
    expect(brookings.text).toContain('# What does the research say');
    expect(brookings.snippet!.length).toBeLessThanOrEqual(401);
    expect(brookings.snippet).not.toContain('#');
    expect(brookings.id).toMatch(/^c_[0-9a-f]{8}$/);

    const wiki = byHost(out, 'wikipedia')!;
    expect(wiki).toMatchObject({ tier: 'web', isWikipedia: true, publisher: 'Wikipedia', authors: [] });
    expect(wiki.published).toBeUndefined();

    // No `text`: title is the snippet, English check runs on title + snippet.
    const noText = byHost(out, 'econ-explainers')!;
    expect(noText.text).toBeUndefined();
    expect(noText.snippet).toBe('The minimum wage debate, explained');
    expect(noText).toMatchObject({ tier: 'web', authors: ['Sam Writer'], publisher: 'econ-explainers.com' });

    const reddit = byHost(out, 'reddit')!;
    expect(reddit).toMatchObject({ tier: 'web', lowQuality: true });
  });

  it('exa_news: major outlets → major_news, others (even journal domains) → web; Spanish dropped; estimates cost', async () => {
    const { out, costs } = await run('exa_news', 'exa-news.json');
    // No costDollars: 0.005 + 0.001 × 5 results with text.
    expect(costs).toHaveLength(1);
    expect(costs[0]).toBeCloseTo(0.01, 6);
    expect(byHost(out, 'elpais')).toBeUndefined();
    expect(byHost(out, 'reuters')).toMatchObject({
      tier: 'major_news',
      publisher: 'Reuters',
      authors: ['Reuters Staff', 'Ann Saphir'],
      published: '2026-01-05',
    });
    expect(byHost(out, 'e.vnexpress.net')).toMatchObject({ tier: 'major_news', publisher: 'VnExpress International', authors: ['Nguyen Quy'] });
    expect(byHost(out, 'springfieldtimes')).toMatchObject({ tier: 'web', authors: [] });
    expect(byHost(out, 'nature.com')).toMatchObject({ tier: 'web' });
    expect(byHost(out, 'apnews')).toMatchObject({ tier: 'major_news', snippet: 'Teen employment and the minimum wage: what the numbers show' });
  });

  it('exa_policy: tier from domain, PDF urls become pdfUrl', async () => {
    const { out } = await run('exa_policy', 'exa-policy.json');
    expect(out).toHaveLength(4);
    const imf = byHost(out, 'imf.org')!;
    expect(imf).toMatchObject({ tier: 'gov_igo', publisher: 'International Monetary Fund' });
    expect(imf.pdfUrl).toBe(imf.url);
    expect(byHost(out, 'brookings')).toMatchObject({ tier: 'think_tank' });
    expect(byHost(out, 'sbv.gov.vn')).toMatchObject({ tier: 'gov_igo', publisher: 'State Bank of Vietnam' });
    expect(byHost(out, 'gov.uk')).toMatchObject({ tier: 'gov_igo', publisher: 'UK Government' });
  });

  it('exa_papers: journal domain or detectable DOI → peer_reviewed, else preprint; DOI set', async () => {
    const { out, costs } = await run('exa_papers', 'exa-papers.json');
    expect(costs).toEqual([0.011]);
    expect(byHost(out, 'academic.oup.com')).toMatchObject({
      tier: 'peer_reviewed',
      doi: '10.1093/qje/qjz014',
      publisher: 'Oxford Academic',
      authors: ['Doruk Cengiz', 'Arindrajit Dube', 'Attila Lindner', 'Ben Zipperer'],
    });
    const econstor = byHost(out, 'econstor')!;
    expect(econstor).toMatchObject({ tier: 'preprint' });
    expect(econstor.pdfUrl).toBe(econstor.url);
    expect(byHost(out, 'scholar.example-university.edu')).toMatchObject({
      tier: 'peer_reviewed',
      doi: '10.1016/j.jpubeco.2017.01.002',
      authors: ['J. Smith', 'A. Doe'],
    });
    const draft = byHost(out, 'faculty.example-university.edu')!;
    expect(draft.tier).toBe('preprint');
    expect(draft.doi).toBeUndefined();
    expect(draft.pdfUrl).toBe(draft.url);
    expect(byHost(out, 'ssrn')).toMatchObject({ tier: 'preprint', publisher: 'SSRN' });
    expect(byHost(out, 'doi.org')).toMatchObject({ tier: 'peer_reviewed', doi: '10.1257/jep.99.1.001' });
  });
});

describe('Exa errors', () => {
  const plan = makePlan();
  async function errFor(status: number, body: unknown) {
    const { fetch } = mockFetch(() => jsonResponse(body, status));
    const costs: number[] = [];
    const e = await createExaAdapter('exa_web', { exaKey: KEY, exaResultsPerAdapter: 4, fetchImpl: fetch })
      .search(plan, { limit: 4, signal: signal(), onCost: (u) => costs.push(u) })
      .catch((err: unknown) => err);
    return { e: e as AdapterError, costs };
  }

  it('401/403 → auth, 402 → out_of_credits, 429 → rate_limited; no cost reported; key never in message', async () => {
    const a = await errFor(401, fixtureJson('exa-401.json'));
    expect(a.e).toBeInstanceOf(AdapterError);
    expect(a.e.kind).toBe('auth');
    expect(a.e.sourceId).toBe('exa_web');
    expect(a.e.message).not.toContain(KEY);
    expect(a.costs).toEqual([]);
    expect((await errFor(403, fixtureJson('exa-401.json'))).e.kind).toBe('auth');
    expect((await errFor(402, fixtureJson('exa-402.json'))).e.kind).toBe('out_of_credits');
    expect((await errFor(429, fixtureJson('exa-429.json'))).e.kind).toBe('rate_limited');
    expect((await errFor(503, { error: 'busy' })).e.kind).toBe('network');
  });

  it('garbage or wrong shape → bad_response', async () => {
    expect((await errFor(200, '<!doctype html><p>gateway</p>')).e.kind).toBe('bad_response');
    expect((await errFor(200, { data: [] })).e.kind).toBe('bad_response');
  });

  it('missing key → auth without any request', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse({ results: [] }));
    const e = await createExaAdapter('exa_news', { exaResultsPerAdapter: 4, fetchImpl: fetch })
      .search(plan, { limit: 4, signal: signal() })
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AdapterError);
    expect((e as AdapterError).kind).toBe('auth');
    expect((e as AdapterError).message).toBe('Exa key missing');
    expect(calls).toHaveLength(0);
  });

  it('timeout → timeout', async () => {
    const fetchImpl = () => Promise.reject(new TimeoutError('Timed out after 12s'));
    const e = await createExaAdapter('exa_web', { exaKey: KEY, exaResultsPerAdapter: 4, fetchImpl })
      .search(plan, { limit: 4, signal: signal() })
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AdapterError);
    expect((e as AdapterError).kind).toBe('timeout');
  });

  it('network failure → network', async () => {
    const fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'));
    const e = await createExaAdapter('exa_web', { exaKey: KEY, exaResultsPerAdapter: 4, fetchImpl })
      .search(plan, { limit: 4, signal: signal() })
      .catch((err: unknown) => err);
    expect((e as AdapterError).kind).toBe('network');
  });
});

describe('Exa helpers', () => {
  it('splits author strings', () => {
    expect(splitAuthors('By Jane Smith, John Doe and Ann Lee')).toEqual(['Jane Smith', 'John Doe', 'Ann Lee']);
    expect(splitAuthors('J. Smith; A. Doe')).toEqual(['J. Smith', 'A. Doe']);
    expect(splitAuthors('Smith & Jones')).toEqual(['Smith', 'Jones']);
    expect(splitAuthors('')).toEqual([]);
    expect(splitAuthors(null)).toEqual([]);
    expect(splitAuthors(' , ,')).toEqual([]);
  });

  it('excerpts at a word boundary and strips markdown', () => {
    const text = '# Heading\n\n**Bold** words and a [link](https://x.y/z) ' + 'lorem ipsum '.repeat(60);
    const e = excerpt(text, 100);
    expect(e.length).toBeLessThanOrEqual(101);
    expect(e.endsWith('…')).toBe(true);
    expect(e.startsWith('Heading Bold words and a link lorem')).toBe(true);
  });
});
