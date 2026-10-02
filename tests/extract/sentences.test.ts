import { describe, expect, it } from 'vitest';
import { segmentSentences, pageFor } from '../../src/background/extract/sentences';
import { buildDoc, makeChunks } from '../../src/background/extract/chunk';
import { normalizeDocText } from '../../src/shared/text';

describe('segmentSentences', () => {
  const text =
    'Minimum wages in the U.S. rose in 1992. Card et al. found no effect, e.g. in New Jersey.\nHeading Without Period\nWe estimate an elasticity of 0.1. This is small (p. 790). Dr. Smith agreed.\n\n1. First item here. Second.';

  it('keeps exact offsets for every sentence', () => {
    const out = segmentSentences(text, 'd1');
    expect(out.length).toBeGreaterThan(5);
    for (const s of out) expect(text.slice(s.start, s.end)).toBe(s.text);
    expect(out.map((s) => s.id)).toEqual(out.map((_, i) => `d1.s${i}`));
  });

  it('does not split on common abbreviations and decimals', () => {
    const texts = segmentSentences(text, 'd1').map((s) => s.text);
    expect(texts).toContain('Minimum wages in the U.S. rose in 1992.');
    expect(texts).toContain('Card et al. found no effect, e.g. in New Jersey.');
    expect(texts).toContain('We estimate an elasticity of 0.1.');
    expect(texts).toContain('This is small (p. 790).');
    expect(texts).toContain('Dr. Smith agreed.');
  });

  it('treats line breaks as sentence boundaries (headings stand alone)', () => {
    const texts = segmentSentences(text, 'd1').map((s) => s.text);
    expect(texts).toContain('Heading Without Period');
  });

  it('splits very long run-on text into exact pieces', () => {
    const long = Array.from({ length: 200 }, (_, i) => `cell${i}`).join(' ');
    const out = segmentSentences(long, 'd2');
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) {
      expect(long.slice(s.start, s.end)).toBe(s.text);
      expect(s.text.length).toBeLessThanOrEqual(600);
    }
  });

  it('assigns pages from page starts', () => {
    const t = 'Page one text. More one.\n\nPage two starts here. End.';
    const starts = [
      { page: 1, start: 0 },
      { page: 2, start: t.indexOf('Page two') },
    ];
    const out = segmentSentences(t, 'd3', starts);
    expect(out[0]?.page).toBe(1);
    expect(out.find((s) => s.text.startsWith('Page two'))?.page).toBe(2);
    expect(pageFor(0, starts)).toBe(1);
  });
});

describe('buildDoc + makeChunks', () => {
  it('normalizes text and builds 4-sentence windows with 1 overlap', () => {
    const raw = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} is here.`).join('    ');
    const doc = buildDoc({ docId: 'd9', candidateId: 'c', text: raw, textSource: 'html', finalUrl: 'https://x', fetchedAt: 'now' });
    expect(doc.text).toBe(normalizeDocText(raw));
    expect(doc.sentences).toHaveLength(10);
    const chunks = makeChunks(doc);
    expect(chunks.map((c) => [c.sentenceStart, c.sentenceEnd])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
    ]);
    expect(chunks[0]?.id).toBe('d9.c0');
  });
});
