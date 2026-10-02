import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../src/shared/types';
import { preRank, selectForExtraction, shouldRunArxiv } from '../../src/background/sources';
import { cand, makePlan } from './helpers';

const plan = makePlan();
const relevantTitle = 'Minimum wage increases and employment: small disemployment effect on low-wage jobs';
const relevantSnippet = 'We find minimum wage increases had no significant effect on employment and did not reduce the number of low-wage jobs.';

function scoreOf(ranked: Array<{ candidate: Candidate; score: number }>, id: string): number {
  return ranked.find((r) => r.candidate.id === id)!.score;
}

describe('preRank', () => {
  it('orders by tier + keyword overlap and sorts descending', () => {
    const ranked = preRank(
      [
        cand({ id: 'web-rel', url: 'https://w.com/1', tier: 'web', title: relevantTitle, snippet: relevantSnippet }),
        cand({ id: 'pr-rel', url: 'https://j.com/1', tier: 'peer_reviewed', title: relevantTitle, snippet: relevantSnippet }),
        cand({ id: 'pr-off', url: 'https://j.com/2', tier: 'peer_reviewed', title: 'Soil bacteria in alpine meadows', snippet: 'Microbial diversity.' }),
        cand({ id: 'news-rel', url: 'https://n.com/1', tier: 'major_news', title: relevantTitle, snippet: relevantSnippet }),
      ],
      plan,
    );
    // Relevance can beat tier: an on-topic web page outranks an off-topic journal article.
    expect(ranked.map((r) => r.candidate.id)).toEqual(['pr-rel', 'news-rel', 'web-rel', 'pr-off']);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    expect(scoreOf(ranked, 'pr-rel') - scoreOf(ranked, 'pr-off')).toBeGreaterThan(0.5);
  });

  it('penalizes low-quality (−1.0) and Wikipedia (−0.3)', () => {
    const base = { title: relevantTitle, snippet: relevantSnippet, tier: 'web' as const };
    const ranked = preRank(
      [
        cand({ id: 'lq', url: 'https://q.com/1', ...base, lowQuality: true }),
        cand({ id: 'wiki', url: 'https://w.org/1', ...base, isWikipedia: true }),
        cand({ id: 'plain', url: 'https://p.com/1', ...base }),
      ],
      plan,
    );
    expect(ranked.map((r) => r.candidate.id)).toEqual(['plain', 'wiki', 'lq']);
    expect(scoreOf(ranked, 'plain') - scoreOf(ranked, 'wiki')).toBeCloseTo(0.3, 5);
    expect(scoreOf(ranked, 'plain') - scoreOf(ranked, 'lq')).toBeCloseTo(1.0, 5);
  });

  it('applies recency only with year constraints (+0.2 inside, −0.3 outside)', () => {
    const cands = [
      cand({ id: 'old', url: 'https://a.com/1', tier: 'peer_reviewed', title: relevantTitle, published: '1995-01-01' }),
      cand({ id: 'new', url: 'https://a.com/2', tier: 'peer_reviewed', title: relevantTitle, published: '2015' }),
    ];
    const none = preRank(cands, plan);
    expect(scoreOf(none, 'old')).toBeCloseTo(scoreOf(none, 'new'), 5);
    const constrained = preRank(cands, makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2020 } }));
    expect(scoreOf(constrained, 'new') - scoreOf(constrained, 'old')).toBeCloseTo(0.5, 5);
  });

  it('adds 0.1·log10(citedBy+1) and the Exa score (normalized, ≤ 0.3)', () => {
    const ranked = preRank(
      [
        cand({ id: 'cited', url: 'https://a.com/1', tier: 'preprint', title: 'x', citedByCount: 999 }),
        cand({ id: 'uncited', url: 'https://a.com/2', tier: 'preprint', title: 'x' }),
        cand({ id: 'exa-top', url: 'https://a.com/3', tier: 'web', title: 'x', searchScore: 0.5 }),
        cand({ id: 'exa-low', url: 'https://a.com/4', tier: 'web', title: 'x', searchScore: 0.25 }),
      ],
      plan,
    );
    expect(scoreOf(ranked, 'cited') - scoreOf(ranked, 'uncited')).toBeCloseTo(0.3, 5);
    expect(scoreOf(ranked, 'exa-top') - scoreOf(ranked, 'exa-low')).toBeCloseTo(0.15, 5);
    expect(scoreOf(ranked, 'exa-top')).toBeLessThanOrEqual(0.4 + 1 + 0.3);
  });

  it('gives a small bonus to earlier search ranks when there is no score', () => {
    const ranked = preRank(
      [
        cand({ id: 'r5', url: 'https://a.com/2', tier: 'preprint', title: 'x', searchRank: 5 }),
        cand({ id: 'r0', url: 'https://a.com/1', tier: 'preprint', title: 'x', searchRank: 0 }),
      ],
      plan,
    );
    expect(ranked[0]!.candidate.id).toBe('r0');
    expect(scoreOf(ranked, 'r0') - scoreOf(ranked, 'r5')).toBeCloseTo(0.05, 5);
  });
});

describe('selectForExtraction', () => {
  const support = Array.from({ length: 10 }, (_, i) => ({ candidate: cand({ id: `s${i}`, url: `https://s.com/${i}` }), score: 3 - i * 0.1 }));
  const counter = Array.from({ length: 4 }, (_, i) => ({ candidate: cand({ id: `k${i}`, url: `https://k.com/${i}`, forCounter: true }), score: 1 - i * 0.1 }));
  const ranked = [...support, ...counter];

  it('reserves up to 3 slots for counter candidates by default', () => {
    const out = selectForExtraction(ranked, 5);
    expect(out.map((c) => c.id)).toEqual(['s0', 's1', 'k0', 'k1', 'k2']);
  });

  it('respects reserveCounter and exclude', () => {
    expect(selectForExtraction(ranked, 5, { reserveCounter: 0 }).map((c) => c.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(selectForExtraction(ranked, 5, { reserveCounter: 1, exclude: new Set(['s0', 'k0']) }).map((c) => c.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      'k1',
    ]);
  });

  it('counts counter candidates that rank high anyway, and fills when there are few', () => {
    const highCounter = [{ candidate: cand({ id: 'kHigh', url: 'https://k.com/h', forCounter: true }), score: 9 }, ...support];
    expect(selectForExtraction(highCounter, 3).map((c) => c.id)).toEqual(['kHigh', 's0', 's1']);
    expect(selectForExtraction(support.slice(0, 2), 15)).toHaveLength(2);
    expect(selectForExtraction(ranked, 0)).toEqual([]);
  });
});

describe('shouldRunArxiv', () => {
  it('runs for technical domain hints', () => {
    expect(shouldRunArxiv(makePlan({ domains: ['computer science'] }))).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['physics'] }))).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['Statistics'] }))).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['AI'] }))).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['quantitative biology'] }))).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['electrical engineering'] }))).toBe(true);
  });

  it('skips for non-technical claims', () => {
    expect(shouldRunArxiv(makePlan())).toBe(false); // economics, minimum wage
    expect(shouldRunArxiv(makePlan({ domains: [], keyTerms: ['capital controls', 'IMF austerity', 'Malaysia'] }))).toBe(false);
    expect(shouldRunArxiv(makePlan({ domains: ['history'], keyTerms: ['software'] }))).toBe(false);
  });

  it('falls back to key terms', () => {
    const p = makePlan({
      domains: undefined,
      keyTerms: ['large language models', 'scaling laws'],
      queries: { academic: ['language model scaling'], semantic: [], news: [], policy: [] },
    });
    expect(shouldRunArxiv(p)).toBe(true);
    expect(shouldRunArxiv(makePlan({ domains: ['economics'], keyTerms: ['machine learning', 'neural networks', 'labor markets'] }))).toBe(true);
  });
});
