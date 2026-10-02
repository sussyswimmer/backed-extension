import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../src/shared/types';
import { candidateIdFor, dedupeCandidates, mergeCandidates } from '../../src/background/sources';
import { createOpenAlexAdapter } from '../../src/background/sources/openalex';
import { createSemanticScholarAdapter } from '../../src/background/sources/semanticScholar';
import { createExaAdapter } from '../../src/background/sources/exa';
import { cand, fixtureJson, jsonResponse, makePlan, mockFetch, signal } from './helpers';

async function realCandidates(): Promise<{ oa: Candidate[]; s2: Candidate[]; exa: Candidate[] }> {
  const plan = makePlan({ queries: { academic: ['minimum wage'], semantic: ['x'], news: [], policy: [] } });
  const oa = await createOpenAlexAdapter({ fetchImpl: mockFetch(() => jsonResponse(fixtureJson('openalex-works.json'))).fetch }).search(plan, {
    limit: 10,
    signal: signal(),
  });
  const s2 = await createSemanticScholarAdapter(
    { fetchImpl: mockFetch(() => jsonResponse(fixtureJson('s2-search.json'))).fetch },
    { sleep: async () => undefined },
  ).search(plan, { limit: 10, signal: signal() });
  const exa = await createExaAdapter('exa_papers', {
    exaKey: 'k',
    exaResultsPerAdapter: 10,
    fetchImpl: mockFetch(() => jsonResponse(fixtureJson('exa-papers.json'))).fetch,
  }).search(plan, { limit: 10, signal: signal() });
  return { oa, s2, exa };
}

describe('dedupeCandidates', () => {
  it('collapses the same paper from OpenAlex + S2 + an Exa hit into ONE candidate, keeping Exa text and the PDF', async () => {
    const { oa, s2, exa } = await realCandidates();
    const isCengiz = (c: Candidate) => c.title === 'The Effect of Minimum Wages on Low-Wage Jobs';
    expect([...oa, ...s2, ...exa].filter(isCengiz)).toHaveLength(3);

    const out = dedupeCandidates([...s2, ...exa, ...oa]);
    const matches = out.filter(isCengiz);
    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    expect(m.doi).toBe('10.1093/qje/qjz014');
    expect(m.id).toBe(candidateIdFor({ doi: '10.1093/qje/qjz014', url: 'x' }));
    expect(m.text).toContain('The Quarterly Journal of Economics, Volume 134'); // from Exa
    expect(m.pdfUrl).toBe('https://www.nber.org/papers/w25434.pdf'); // from OpenAlex
    expect(m.sourceId).toBe('openalex'); // richest record (has pdfUrl) is the base
    expect([...(m.sourceIds ?? [])].sort()).toEqual(['exa_papers', 'openalex', 'semantic_scholar']);
    expect(m.citedByCount).toBe(812);
    expect(m.tier).toBe('peer_reviewed');
    expect(m.authors.length).toBe(4);
    expect(m.snippet!.length).toBeGreaterThan(100);
  });

  it('dedupes by canonical URL (tracking params, www, http, trailing slash)', () => {
    const out = dedupeCandidates([
      cand({ url: 'http://www.brookings.edu/articles/mw/?utm_source=x', title: 'A', snippet: 'short', sourceId: 'exa_web' }),
      cand({ url: 'https://brookings.edu/articles/mw', title: 'A', snippet: 'a longer snippet here', sourceId: 'exa_policy', text: 'full text' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('full text');
    expect(out[0]!.sourceIds).toEqual(['exa_policy', 'exa_web']);
  });

  it('matches an Exa hit on a PDF URL to the candidate whose pdfUrl it is', () => {
    const out = dedupeCandidates([
      cand({ url: 'https://www.nber.org/papers/w1', pdfUrl: 'https://www.nber.org/papers/w1.pdf', title: 'Paper One About Wages', sourceId: 'openalex' }),
      cand({ url: 'https://www.nber.org/papers/w1.pdf', title: 'w1.pdf', sourceId: 'exa_papers', text: 'pdf text' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('pdf text');
  });

  it('dedupes near-identical titles of ≥ 4 words, but not short generic titles', () => {
    const long = dedupeCandidates([
      cand({ url: 'https://a.com/1', title: 'The Effect of Minimum Wages on Low-Wage Jobs' }),
      cand({ url: 'https://b.com/2', title: 'the effect of minimum wages on low wage jobs.' }),
    ]);
    expect(long).toHaveLength(1);
    const short = dedupeCandidates([cand({ url: 'https://a.com/1', title: 'Minimum Wages' }), cand({ url: 'https://b.com/2', title: 'Minimum Wages' })]);
    expect(short).toHaveLength(2);
  });

  it('merges transitively (DOI links A–B, URL links B–C)', () => {
    const out = dedupeCandidates([
      cand({ url: 'https://x.org/a', doi: '10.1/abc', title: 'A1' }),
      cand({ url: 'https://y.org/b', doi: '10.1/ABC', title: 'B1' }),
      cand({ url: 'https://y.org/b/', title: 'C1' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps the better tier, the lowest round, the max citations; forCounter only if all were counter', () => {
    const [m] = dedupeCandidates([
      cand({ url: 'https://arxiv.org/abs/1', doi: '10.9/x', tier: 'preprint', round: 2, citedByCount: 3, forCounter: true }),
      cand({ url: 'https://journal.org/1', doi: '10.9/x', tier: 'peer_reviewed', round: 1, citedByCount: 40 }),
    ]);
    expect(m).toMatchObject({ tier: 'peer_reviewed', round: 1, citedByCount: 40 });
    expect(m!.forCounter).toBeUndefined();
    const [c] = dedupeCandidates([
      cand({ url: 'https://a.org/1', forCounter: true }),
      cand({ url: 'https://a.org/1/', forCounter: true }),
    ]);
    expect(c!.forCounter).toBe(true);
  });

  it('fills a bare year with a full date for the same year', () => {
    const [m] = dedupeCandidates([
      cand({ url: 'https://a.org/1', published: '2019', snippet: 'longer snippet wins base' }),
      cand({ url: 'https://a.org/1/', published: '2019-05-06' }),
    ]);
    expect(m!.published).toBe('2019-05-06');
  });

  it('leaves unique candidates untouched (but with sourceIds)', () => {
    const out = dedupeCandidates([cand({ url: 'https://a.org/1', id: 'c_keep', sourceId: 'arxiv' })]);
    expect(out[0]).toMatchObject({ id: 'c_keep', sourceIds: ['arxiv'] });
  });
});

describe('mergeCandidates', () => {
  const existing: Candidate[] = [
    cand({ id: 'c_a', url: 'https://site.org/a', title: 'Alpha study on wages', round: 1, sourceId: 'openalex', tier: 'preprint' }),
    cand({ id: 'c_b', url: 'https://site.org/b', title: 'Beta', round: 1, forCounter: true }),
  ];

  it('never drops existing candidates and keeps their id, round and order', () => {
    const incoming = [
      cand({ id: 'new1', url: 'https://site.org/a/', title: 'Alpha study on wages', doi: '10.5/alpha', text: 'TEXT', round: 2, sourceId: 'exa_web', tier: 'peer_reviewed' }),
      cand({ id: 'new2', url: 'https://site.org/c', title: 'Gamma', round: 2 }),
    ];
    const out = mergeCandidates(existing, incoming);
    expect(out.map((c) => c.id)).toEqual(['c_a', 'c_b', 'new2']);
    expect(out[0]).toMatchObject({ id: 'c_a', round: 1, text: 'TEXT', doi: '10.5/alpha', tier: 'peer_reviewed' });
    expect(out[0]!.sourceIds).toEqual(['openalex', 'exa_web']);
    expect(out[2]!.round).toBe(2);
  });

  it('returns all existing candidates even when nothing new arrives or everything matches', () => {
    expect(mergeCandidates(existing, [])).toHaveLength(2);
    const out = mergeCandidates(existing, [cand({ url: 'https://site.org/b' }), cand({ url: 'https://site.org/a' })]);
    expect(out.map((c) => c.id)).toEqual(['c_a', 'c_b']);
  });

  it('clears forCounter when a support search finds the same item', () => {
    const out = mergeCandidates(existing, [cand({ url: 'https://site.org/b', round: 2 })]);
    expect(out[1]!.forCounter).toBeUndefined();
    expect(out[1]!.round).toBe(1);
  });

  it('dedupes the incoming batch itself', () => {
    const out = mergeCandidates([], [cand({ url: 'https://n.org/1' }), cand({ url: 'http://www.n.org/1/' })]);
    expect(out).toHaveLength(1);
  });

  it('does not mutate its inputs', () => {
    const before = JSON.stringify(existing);
    mergeCandidates(existing, [cand({ url: 'https://site.org/a', text: 'zzz' })]);
    expect(JSON.stringify(existing)).toBe(before);
  });
});
