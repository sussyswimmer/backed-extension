import { describe, expect, it } from 'vitest';
import { FRAGMENT_GAP, quoteSegments, quoteText } from '../../src/popup/lib/quote';
import { fragment } from './fixtures';

describe('quoteSegments', () => {
  it('highlights matching parts and dims one sentence of context on each side', () => {
    const segs = quoteSegments({
      contextBefore: 'Before sentence.',
      contextAfter: 'After sentence.',
      passage: 'Match one. Gap two.',
      fragments: [fragment([{ text: 'Match one. ', match: true }, { text: 'Gap two.', match: false }])],
    });
    expect(segs).toEqual([
      { text: 'Before sentence.', kind: 'context' },
      { text: ' ', kind: 'text' },
      { text: 'Match one.', kind: 'match' },
      { text: ' Gap two. ', kind: 'text' },
      { text: 'After sentence.', kind: 'context' },
    ]);
  });

  it('joins fragments with " […] " and keeps the quotation text verbatim (whitespace collapsed)', () => {
    const m = {
      passage: 'First  match.\nSecond match.',
      fragments: [fragment([{ text: 'First  match.', match: true }]), fragment([{ text: '\nSecond match.', match: true }])],
    };
    const segs = quoteSegments(m);
    expect(segs.map((s) => s.kind)).toEqual(['match', 'gap', 'match']);
    expect(segs[1]?.text).toBe(FRAGMENT_GAP);
    expect(quoteText(m)).toBe('First match. […] Second match.');
  });

  it('never puts the highlight on edge spaces', () => {
    const segs = quoteSegments({ passage: '', fragments: [fragment([{ text: 'Lead. ', match: false }, { text: ' Hit here. ', match: true }, { text: 'Tail.', match: false }])] });
    for (const s of segs.filter((x) => x.kind === 'match')) {
      expect(s.text).toBe(s.text.trim());
    }
    expect(segs.map((s) => s.text).join('')).toBe('Lead. Hit here. Tail.');
  });

  it('falls back to the passage when fragments are missing', () => {
    expect(quoteSegments({ passage: '  Only the passage.  ', fragments: [] })).toEqual([{ text: 'Only the passage.', kind: 'match' }]);
  });

  it('can leave the context out', () => {
    const segs = quoteSegments({ contextBefore: 'Ctx.', passage: 'P.', fragments: [fragment([{ text: 'P.', match: true }])] }, { context: false });
    expect(segs).toEqual([{ text: 'P.', kind: 'match' }]);
  });

  it('treats markup in source text as plain text (no parsing)', () => {
    const evil = '<img src=x onerror=alert(1)> says so.';
    const segs = quoteSegments({ passage: evil, fragments: [fragment([{ text: evil, match: true }])] });
    expect(segs).toEqual([{ text: evil, kind: 'match' }]);
  });
});
