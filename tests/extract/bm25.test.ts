import { describe, expect, it } from 'vitest';
import { Bm25, selectChunks, stem, termsOf, tokenize } from '../../src/background/extract/bm25';
import { buildDoc, makeChunks } from '../../src/background/extract/chunk';
import type { Plan } from '../../src/shared/types';

const plan: Plan = {
  normalizedClaim: "Raising the minimum wage doesn't significantly reduce employment.",
  claimType: 'causal',
  coreProposition: 'Minimum wage increases have small or no effects on employment.',
  paraphrases: ['Minimum wage increases had no detectable disemployment effect.', 'Employment elasticity close to zero.', 'No job losses after minimum wage rises.'],
  keyTerms: ['minimum wage', 'employment', 'disemployment effect'],
  excludeTerms: [],
  constraints: { side: 'support', strength: 'any' },
  queries: { academic: ['minimum wage employment'], semantic: ['x'], news: [], policy: [] },
  counterQuery: 'minimum wage increases reduce employment of teenagers',
};

describe('tokenize/stem', () => {
  it('drops stopwords and folds simple suffixes', () => {
    expect(tokenize('The wages were reduced, reducing employment')).toEqual(['wage', 'reduc', 'reduc', 'employment']);
    expect(stem('studies')).toBe('study');
    expect(termsOf('minimum wage effects')).toContain('minimum_wage');
  });
});

describe('Bm25', () => {
  it('ranks the document that matches the query best first', () => {
    const docs = [
      'The weather in Paris was mild this spring.',
      'Minimum wage increases had no effect on employment in New Jersey.',
      'Employment rose in manufacturing.',
    ].map(termsOf);
    const scores = new Bm25(docs).score(termsOf('minimum wage employment effect'));
    const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(2);
    expect(scores[0]).toBe(0);
  });
});

describe('selectChunks', () => {
  const mk = (id: string, sentences: string[]) =>
    buildDoc({ docId: id, candidateId: `c_${id}`, text: sentences.join(' '), textSource: 'html', finalUrl: 'u', fetchedAt: 't' });
  const relevant = mk('d1', [
    'Intro about the economy.',
    'We study minimum wage increases.',
    'The minimum wage had no disemployment effect.',
    'Employment did not fall.',
    'Weather was nice.',
    'Unrelated sentence about sports.',
    'Another unrelated sentence.',
    'Employment of teenagers was stable after the minimum wage rose.',
  ]);
  const irrelevant = mk('d2', ['Cats are mammals.', 'Dogs bark at night.', 'The moon orbits the earth.']);

  it('keeps top chunks per doc, skips zero-score docs, respects the total cap', () => {
    const chunksByDoc = new Map([
      ['d1', makeChunks(relevant)],
      ['d2', makeChunks(irrelevant)],
    ]);
    const out = selectChunks({ docs: [relevant, irrelevant], chunksByDoc, plan, counterDocIds: new Set(), perDoc: 3, total: 25 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.chunk.docId === 'd1')).toBe(true);
    // No overlapping chunks from the same doc.
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!.chunk;
        const b = out[j]!.chunk;
        expect(a.sentenceStart <= b.sentenceEnd && b.sentenceStart <= a.sentenceEnd).toBe(false);
      }
    const capped = selectChunks({ docs: [relevant], chunksByDoc, plan, counterDocIds: new Set(), perDoc: 3, total: 1 });
    expect(capped).toHaveLength(1);
  });
});
