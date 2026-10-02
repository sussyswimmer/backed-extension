import { describe, expect, it } from 'vitest';
import { localScopeNote, rankResults, scoreMatch, type PoolEntry } from '../../src/background/match/rank';
import { guardNumbers, summarizeResults } from '../../src/background/match/summarize';
import type { LlmClient } from '../../src/background/llm/deepseek';
import type { CandidateMeta, DocText, Relation, SourceResult, SourceTier, VerifiedMatch } from '../../src/shared/types';

function match(candidateId: string, relation: Relation, confidence = 0.9, opts: Partial<VerifiedMatch> = {}): VerifiedMatch {
  return {
    candidateId,
    docId: 'd1',
    chunkId: `${candidateId}.c0`,
    relation,
    confidence,
    reason: 'r',
    sentenceIds: [`${candidateId}.s1`],
    fragments: [],
    passage: 'Our estimates show the minimum wage had no significant effect on employment in this sample.',
    verification: { verbatim: true, charStart: 0, charEnd: 10 },
    ...opts,
  } as unknown as VerifiedMatch;
}

function meta(id: string, tier: SourceTier, published = '2015', extra: Partial<CandidateMeta> = {}): CandidateMeta {
  return { id, sourceId: 'openalex', tier, title: `T ${id}`, url: `https://x.org/${id}`, authors: [], published, ...extra };
}

function entry(id: string, tier: SourceTier, matches: VerifiedMatch[], extra: Partial<PoolEntry> = {}): PoolEntry {
  return { candidateId: id, meta: meta(id, tier), textSource: 'html', finalUrl: '', round: 1, matches, ...extra };
}

describe('scoreMatch', () => {
  it('relation × confidence × tier, minus penalties', () => {
    expect(scoreMatch(match('a', 'direct', 1), entry('a', 'peer_reviewed', []), 'essay', 2026)).toBe(1);
    expect(scoreMatch(match('a', 'paraphrase', 1), entry('a', 'peer_reviewed', []), 'essay', 2026)).toBe(0.85);
    expect(scoreMatch(match('a', 'partial', 1), entry('a', 'web', []), 'essay', 2026)).toBe(0.2);
    expect(scoreMatch(match('a', 'direct', 1, { scopeMismatch: 'US only' }), entry('a', 'peer_reviewed', []), 'essay', 2026)).toBe(0.85);
    expect(scoreMatch(match('a', 'direct', 1), entry('a', 'peer_reviewed', [], { textSource: 'abstract_only' }), 'essay', 2026)).toBe(0.95);
  });

  it('mode boosts: Paper favours peer-reviewed/gov, Debate favours recent quotable passages', () => {
    const m = match('a', 'direct', 1);
    expect(scoreMatch(m, entry('a', 'gov_igo', []), 'paper', 2026)).toBeCloseTo(0.95 * 1.15, 3);
    expect(scoreMatch(m, entry('a', 'major_news', []), 'paper', 2026)).toBe(0.75);
    const recent = { ...entry('a', 'major_news', []), meta: meta('a', 'major_news', '2024') };
    expect(scoreMatch(m, recent, 'debate', 2026)).toBeCloseTo(0.75 * 1.1 * 1.1, 3);
  });
});

describe('rankResults', () => {
  it('one result per source (best passage), Support top 7, Pushback top 3, not-relevant removed', () => {
    const pool: PoolEntry[] = [];
    for (let i = 0; i < 9; i++) pool.push(entry(`s${i}`, 'peer_reviewed', [match(`s${i}`, 'direct', 0.5 + i / 20)]));
    for (let i = 0; i < 4; i++) pool.push(entry(`p${i}`, 'think_tank', [match(`p${i}`, 'contradicts', 0.6 + i / 20)]));
    pool.push(
      entry('multi', 'peer_reviewed', [
        match('multi', 'partial', 0.9),
        match('multi', 'direct', 0.95, { sentenceIds: ['multi.s5'], chunkId: 'multi.c1' }),
        match('multi', 'contradicts', 0.99, { sentenceIds: ['multi.s9'], chunkId: 'multi.c2' }),
      ]),
    );
    const out = rankResults(pool, { mode: 'essay', notRelevant: new Set(['s8']), nowYear: 2026 });
    expect(out.support).toHaveLength(7);
    expect(out.pushback).toHaveLength(3);
    expect(out.support.map((r) => r.candidateId)).not.toContain('s8');
    const multi = out.all.find((r) => r.candidateId === 'multi') as SourceResult;
    expect(multi.best.relation).toBe('direct');
    expect(multi.more.map((m) => m.relation)).toEqual(['partial']);
    const scores = out.support.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('local scope note for results outside a newly chosen year range', () => {
    expect(localScopeNote('2009-05-01', 2015, 2025)).toBe('Published 2009, outside 2015–2025');
    expect(localScopeNote('2019', 2015)).toBeUndefined();
    expect(localScopeNote(undefined, 2015)).toBeUndefined();
  });
});

describe('summary number guard', () => {
  const source = 'Employment fell by 1.5 percent among 2,345 teens between 2010 and 2016. The minimum wage was $7.25.';

  it('drops only sentences with numbers absent from the source text', () => {
    const out = guardNumbers('The study covers 2010 to 2016. Employment fell by 1.5 percent. It finds a 12 percent drop in hours. No numbers here.', source);
    expect(out.text).toBe('The study covers 2010 to 2016. Employment fell by 1.5 percent. No numbers here.');
    expect(out.dropped).toBe(1);
  });

  it('treats 2345 and 2,345 as the same number, but not rounded values', () => {
    expect(guardNumbers('It studies 2345 teens.', source).dropped).toBe(0);
    expect(guardNumbers('Employment fell by 2 percent.', source).dropped).toBe(1);
    expect(guardNumbers('Wages were $7.25.', source).dropped).toBe(0);
  });

  it('summarizeResults applies the guard, labels abstract-only, and keeps tag/limits only if clean', async () => {
    const doc: DocText = { docId: 'd4', candidateId: 'c4', text: source, sentences: [], textSource: 'abstract_only', finalUrl: 'u', fetchedAt: 't' };
    const result = { candidateId: 'c4', meta: meta('c4', 'peer_reviewed'), best: match('c4', 'direct'), more: [], score: 1, textSource: 'abstract_only', finalUrl: 'u', round: 1 } as SourceResult;
    const llm: LlmClient = {
      async json<T>() {
        return {
          data: {
            sources: [
              {
                docId: 'd4',
                summary: 'Teens lost jobs. The fall was 9 percent.',
                howItRelates: 'Finds a 9 percent fall.',
                limits: 'Covers 2010 to 2016 only.',
                tag: 'Minimum wage hikes cost 40% of teen jobs',
              },
            ],
          } as T,
          usage: { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, costUsd: 0 },
          repaired: false,
        };
      },
    };
    const out = await summarizeResults({ llm, claim: 'c', targets: [{ result, doc }], signal: new AbortController().signal });
    const s = out.get('c4');
    expect(s?.summary).toBe('Based on the abstract only. Teens lost jobs.');
    expect(s?.droppedSentences).toBe(1);
    expect(s?.howItRelates).toBe('r'); // fell back to the matcher's reason
    expect(s?.limits).toBe('Covers 2010 to 2016 only.');
    expect(s?.tag).toBeUndefined();
    expect(s?.abstractOnly).toBe(true);
  });
});
