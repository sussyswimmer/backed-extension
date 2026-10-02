import { describe, expect, it } from 'vitest';
import type { AdapterErrorKind, Candidate, SourceAdapter, SourceId } from '../../src/shared/types';
import { adapterLabel, createAdapters, runSearch } from '../../src/background/sources';
import { bodyOf, cand, fixtureJson, fixtureText, hangingFetch, jsonResponse, makePlan, mockFetch, textResponse } from './helpers';

const plan = makePlan({ domains: ['computer science'] });

const counterWork = {
  results: [
    {
      id: 'https://openalex.org/W9',
      doi: 'https://doi.org/10.9999/counter.1',
      display_name: 'Minimum Wages Reduce Teen Employment: New Evidence of Job Losses',
      publication_year: 2017,
      publication_date: '2017-03-01',
      language: 'en',
      type: 'article',
      cited_by_count: 50,
      authorships: [],
      primary_location: { landing_page_url: 'https://journal.example.org/9', source: { display_name: 'Labor Journal', type: 'journal' } },
      best_oa_location: null,
      abstract_inverted_index: { Job: [0], losses: [1] },
    },
  ],
};

const counterExa = {
  results: [
    {
      title: 'Minimum wage hikes cost jobs, study finds',
      url: 'https://www.wsj.com/articles/minimum-wage-hikes-cost-jobs-123',
      publishedDate: '2019-01-01T00:00:00.000Z',
      score: 0.3,
      text: 'A new study finds that minimum wage increases led to job losses among low-skilled workers in several states, contradicting earlier research.',
    },
  ],
};

/** Routes each adapter's request to a different behaviour. */
function routedFetch() {
  return mockFetch(async (url, init) => {
    const counterQ = plan.counterQuery;
    if (url.startsWith('https://api.openalex.org/')) {
      const q = new URL(url).searchParams.get('search');
      return jsonResponse(q === counterQ ? counterWork : fixtureJson('openalex-works.json'));
    }
    if (url.startsWith('https://api.semanticscholar.org/')) return hangingFetch()(url, init); // times out
    if (url.startsWith('https://export.arxiv.org/')) return textResponse(fixtureText('arxiv-429.real.txt'), 429, 'text/plain');
    if (url === 'https://api.exa.ai/search') {
      const body = bodyOf<{ query: string; category?: string; includeDomains?: string[] }>(init);
      if (body.query === counterQ) return jsonResponse(counterExa);
      if (body.category === 'news') return new Response('{"results": [ {"title": "trunc', { status: 200 }); // bad JSON
      if (body.includeDomains) return jsonResponse(fixtureJson('exa-402.json'), 402);
      if (body.category === 'publication') return jsonResponse(fixtureJson('exa-papers.json'));
      return jsonResponse(fixtureJson('exa-web.json'));
    }
    return jsonResponse({}, 404);
  });
}

describe('runSearch', () => {
  it('isolates failures (timeout, 429, bad JSON, 402), returns the rest deduped, reports errors/progress/cost', async () => {
    const { fetch } = routedFetch();
    const adapters = createAdapters({ exaKey: 'EXA-SECRET-KEY', exaResultsPerAdapter: 10, fetchImpl: fetch });
    const byId = (id: SourceId) => adapters.find((a) => a.id === id)!;
    const errors: Array<[SourceId, AdapterErrorKind, string]> = [];
    const progress: Array<{ sourceId: SourceId; count: number; counter?: boolean }> = [];
    const costs: number[] = [];

    const out = await runSearch({
      adapters,
      plan,
      signal: new AbortController().signal,
      limitPerAdapter: 10,
      counterAdapters: [byId('openalex'), byId('exa_web')],
      round: 2,
      timeoutMs: 150,
      onProgress: (e) => progress.push(e),
      onAdapterError: (id, kind, msg) => errors.push([id, kind, msg]),
      onCost: (usd) => costs.push(usd),
    });

    expect(errors.map(([id, kind]) => `${id}:${kind}`).sort()).toEqual([
      'arxiv:rate_limited',
      'exa_news:bad_response',
      'exa_policy:out_of_credits',
      'semantic_scholar:timeout',
    ]);
    for (const [, , msg] of errors) expect(msg).not.toContain('EXA-SECRET-KEY');

    expect(progress.filter((p) => !p.counter).map((p) => p.sourceId).sort()).toEqual(['exa_papers', 'exa_web', 'openalex']);
    expect(progress.filter((p) => p.counter).map((p) => p.sourceId).sort()).toEqual(['exa_web', 'openalex']);
    expect(progress.find((p) => p.sourceId === 'openalex' && !p.counter)!.count).toBe(4);

    // exa_web 0.009 + exa_papers 0.011 (costDollars) + counter exa_web estimate 0.005 + 0.001 × 1 page.
    expect(costs).toHaveLength(3);
    expect(costs).toContain(0.009);
    expect(costs).toContain(0.011);
    expect(costs.some((c) => Math.abs(c - 0.006) < 1e-9)).toBe(true);

    // Results from the healthy adapters, all stamped with the round.
    expect(out.length).toBeGreaterThan(5);
    expect(out.every((c) => c.round === 2)).toBe(true);
    const sources = new Set(out.flatMap((c) => c.sourceIds ?? []));
    expect([...sources].sort()).toEqual(['exa_papers', 'exa_web', 'openalex']);

    // The QJE paper from OpenAlex + Exa papers collapsed into one.
    const qje = out.filter((c) => c.doi === '10.1093/qje/qjz014');
    expect(qje).toHaveLength(1);
    expect(qje[0]!.text).toBeTruthy();
    expect(qje[0]!.pdfUrl).toBeTruthy();

    // Counter results are marked.
    const counter = out.filter((c) => c.forCounter);
    expect(counter.map((c) => c.title).sort()).toEqual([
      'Minimum Wages Reduce Teen Employment: New Evidence of Job Losses',
      'Minimum wage hikes cost jobs, study finds',
    ]);
    expect(out.filter((c) => !c.forCounter).length).toBeGreaterThan(3);
  });

  it('times out an adapter that ignores its signal', async () => {
    const stuck: SourceAdapter = { id: 'arxiv', needsExaKey: false, signature: () => 's', search: () => new Promise<Candidate[]>(() => undefined) };
    const ok: SourceAdapter = {
      id: 'openalex',
      needsExaKey: false,
      signature: () => 's',
      search: async () => [cand({ url: 'https://ok.org/1', sourceId: 'openalex', title: 'ok' })],
    };
    const errors: string[] = [];
    const t0 = Date.now();
    const out = await runSearch({
      adapters: [stuck, ok],
      plan,
      signal: new AbortController().signal,
      limitPerAdapter: 5,
      round: 1,
      timeoutMs: 50,
      onAdapterError: (id, kind) => errors.push(`${id}:${kind}`),
    });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(errors).toEqual(['arxiv:timeout']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ round: 1, sourceIds: ['openalex'] });
  });

  it('maps unexpected adapter exceptions to network errors and never rejects', async () => {
    const broken: SourceAdapter = {
      id: 'exa_web',
      needsExaKey: true,
      signature: () => 's',
      search: () => {
        throw new Error('kaboom');
      },
    };
    const errors: string[] = [];
    const out = await runSearch({
      adapters: [broken],
      plan,
      signal: new AbortController().signal,
      limitPerAdapter: 5,
      round: 1,
      onAdapterError: (id, kind) => errors.push(`${id}:${kind}`),
    });
    expect(out).toEqual([]);
    expect(errors).toEqual(['exa_web:network']);
  });

  it('skips the counter search when the plan has no counterQuery and uses counterLimit', async () => {
    const seen: Array<{ counter?: boolean; limit: number }> = [];
    const spy: SourceAdapter = {
      id: 'openalex',
      needsExaKey: false,
      signature: () => 's',
      search: async (_p, o) => {
        seen.push({ counter: o.counter, limit: o.limit });
        return [];
      },
    };
    await runSearch({ adapters: [], counterAdapters: [spy], plan: makePlan({ counterQuery: '' }), signal: new AbortController().signal, limitPerAdapter: 5, round: 1 });
    expect(seen).toEqual([]);
    await runSearch({ adapters: [spy], counterAdapters: [spy], counterLimit: 2, plan, signal: new AbortController().signal, limitPerAdapter: 5, round: 1 });
    expect(seen).toEqual([
      { counter: false, limit: 5 },
      { counter: true, limit: 2 },
    ]);
  });

  it('rejects with AbortError when the job is stopped, without reporting adapter errors', async () => {
    const ctrl = new AbortController();
    const slow: SourceAdapter = {
      id: 'openalex',
      needsExaKey: false,
      signature: () => 's',
      search: (_p, o) =>
        new Promise<Candidate[]>((_, reject) =>
          o.signal.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          }),
        ),
    };
    const errors: string[] = [];
    const p = runSearch({ adapters: [slow], plan, signal: ctrl.signal, limitPerAdapter: 5, round: 1, onAdapterError: (id) => errors.push(id) });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(errors).toEqual([]);
  });

  it('Exa adapters without a key report auth', async () => {
    const adapters = createAdapters({ exaResultsPerAdapter: 3, fetchImpl: mockFetch(() => jsonResponse({ results: [] })).fetch });
    const errors: string[] = [];
    await runSearch({
      adapters: adapters.filter((a) => a.needsExaKey),
      plan,
      signal: new AbortController().signal,
      limitPerAdapter: 3,
      round: 1,
      onAdapterError: (id, kind, msg) => errors.push(`${id}:${kind}:${msg}`),
    });
    expect(errors.sort()).toEqual([
      'exa_news:auth:Exa key missing',
      'exa_papers:auth:Exa key missing',
      'exa_policy:auth:Exa key missing',
      'exa_web:auth:Exa key missing',
    ]);
  });
});

describe('createAdapters / adapterLabel', () => {
  it('creates all seven adapters with the right flags and labels', () => {
    const adapters = createAdapters({ exaResultsPerAdapter: 4 });
    expect(adapters.map((a) => a.id)).toEqual(['openalex', 'semantic_scholar', 'arxiv', 'exa_web', 'exa_news', 'exa_policy', 'exa_papers']);
    expect(adapters.filter((a) => a.needsExaKey).map((a) => a.id)).toEqual(['exa_web', 'exa_news', 'exa_policy', 'exa_papers']);
    expect(adapters.map((a) => adapterLabel(a.id))).toEqual([
      'OpenAlex',
      'Semantic Scholar',
      'arXiv',
      'Exa web',
      'Exa news',
      'Exa think tanks & gov',
      'Exa papers',
    ]);
  });
});
