import { describe, expect, it } from 'vitest';
import { formatDebateCard, formatQuote, honestyLine, relationLabel } from '../../src/shared/cite';
import { ACCESSED, frag, fragParts, match, result, words } from './helpers';

describe('honestyLine', () => {
  it('matches the brief for every relation', () => {
    expect(honestyLine('direct')).toBeUndefined();
    expect(honestyLine('paraphrase')).toBe('Paraphrase match: the source supports this idea in different words.');
    expect(honestyLine('partial')).toBe('Partial: supports a weaker version.');
    expect(honestyLine('contradicts')).toBe('Contradicts: the source argues against this claim.');
  });

  it('relation labels', () => {
    expect(relationLabel('direct')).toBe('Direct');
    expect(relationLabel('paraphrase')).toBe('Paraphrase');
    expect(relationLabel('partial')).toBe('Partial');
    expect(relationLabel('contradicts')).toBe('Contradicts');
  });
});

describe('formatQuote — Paper', () => {
  it('inline quote under 40 words', () => {
    const passage = `${words(38)} end.`; // 39 words
    const q = formatQuote(result({ best: match({ fragments: [frag(passage)] }) }), 'paper');
    expect(q.text).toBe(`"${passage}"`);
    expect(q.html).toBe(`&quot;${passage}&quot;`);
  });

  it('block quote at 40 words: no quotation marks, indented paragraph', () => {
    const passage = `${words(39)} end.`; // 40 words
    const q = formatQuote(result({ best: match({ fragments: [frag(passage)] }) }), 'paper');
    expect(q.text).toBe(passage);
    expect(q.html).toBe(`<p style="margin-left:0.5in">${passage}</p>`);
  });

  it('keeps the passage verbatim apart from whitespace', () => {
    const passage = 'Employment\nrose by 2.3 percent  (p < 0.05) — "not" fell.';
    const q = formatQuote(result({ best: match({ fragments: [frag(passage)] }) }), 'paper');
    expect(q.text).toBe('"Employment rose by 2.3 percent (p < 0.05) — "not" fell."');
  });
});

describe('formatQuote — Essay', () => {
  it('uses only the matching fragments, joined with " […] ", without context', () => {
    const best = match({
      fragments: [frag('Wages rose.'), frag('Jobs did not\nfall.')],
      contextBefore: 'In 1992 New Jersey acted.',
      contextAfter: 'Prices rose slightly.',
    });
    const q = formatQuote(result({ best }), 'essay');
    expect(q.text).toBe('"Wages rose. […] Jobs did not fall."');
    expect(q.text).not.toContain('New Jersey');
    expect(q.text).not.toContain('Prices');
  });

  it('is inline even when long', () => {
    const passage = `${words(60)}.`;
    const q = formatQuote(result({ best: match({ fragments: [frag(passage)] }) }), 'essay');
    expect(q.text).toBe(`"${passage}"`);
    expect(q.html).not.toContain('<p');
  });
});

describe('formatQuote — Debate', () => {
  it('is the passage part of the debate card', () => {
    const best = match({
      fragments: [fragParts([{ text: 'Jobs did not fall.', match: true }, { text: ' A gap.', match: false }, { text: ' Wages rose.', match: true }])],
      contextBefore: 'Before.',
      contextAfter: 'After.',
      relation: 'paraphrase',
    });
    const r = result({ best });
    const q = formatQuote(r, 'debate');
    const card = formatDebateCard(r, { accessed: ACCESSED, honestyLine: true });
    expect(card.html.endsWith(q.html)).toBe(true);
    expect(card.text.endsWith(q.text)).toBe(true);
    expect(q.text).toBe('Before. Jobs did not fall. A gap. Wages rose. After.');
  });
});
