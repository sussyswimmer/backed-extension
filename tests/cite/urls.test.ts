import { describe, expect, it } from 'vitest';
import { openAtPassageUrl, pagesOf, pdfPageUrl, textFragmentUrl } from '../../src/shared/cite';
import { CARD_KRUEGER, frag, match, meta, result, words } from './helpers';

describe('textFragmentUrl', () => {
  it('uses the whole passage when it has 8 words or fewer', () => {
    expect(textFragmentUrl('https://a.org/p', 'Wages rose but jobs did not fall.')).toBe(
      'https://a.org/p#:~:text=Wages%20rose%20but%20jobs%20did%20not%20fall.',
    );
    expect(textFragmentUrl('https://a.org/p', words(8))).toBe(
      `https://a.org/p#:~:text=${words(8).replace(/ /g, '%20')}`,
    );
  });

  it('encodes dashes, commas and ampersands (directive syntax)', () => {
    const url = textFragmentUrl('https://a.org/p', 'Fast-food jobs, wages & hours');
    expect(url).toBe('https://a.org/p#:~:text=Fast%2Dfood%20jobs%2C%20wages%20%26%20hours');
    const fragment = url.split('#:~:text=')[1] ?? '';
    expect(fragment).not.toMatch(/[-&,]/);
  });

  it('uses start,end (first 5 / last 5 words) for longer passages', () => {
    const passage = 'one two three four five six seven eight nine ten eleven twelve';
    expect(textFragmentUrl('https://a.org/p', passage)).toBe(
      'https://a.org/p#:~:text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%20twelve',
    );
  });

  it('never lets start and end overlap (9–10 word passages)', () => {
    expect(textFragmentUrl('https://a.org/p', words(9))).toBe(
      'https://a.org/p#:~:text=word1%20word2%20word3%20word4%20word5,word6%20word7%20word8%20word9',
    );
    expect(textFragmentUrl('https://a.org/p', words(10))).toBe(
      'https://a.org/p#:~:text=word1%20word2%20word3%20word4%20word5,word6%20word7%20word8%20word9%20word10',
    );
  });

  it('strips an existing #fragment and keeps the query string', () => {
    expect(textFragmentUrl('https://a.org/p?x=1#section-2', 'Short passage')).toBe(
      'https://a.org/p?x=1#:~:text=Short%20passage',
    );
    expect(textFragmentUrl('https://a.org/p#:~:text=old', 'New')).toBe('https://a.org/p#:~:text=New');
  });

  it('uses only the first fragment of a " […] " passage', () => {
    expect(textFragmentUrl('https://a.org/p', 'First bit here. […] Second bit there.')).toBe(
      'https://a.org/p#:~:text=First%20bit%20here.',
    );
  });

  it('collapses whitespace (including newlines) in the passage', () => {
    expect(textFragmentUrl('https://a.org/p', '  Jobs\n did   not\tfall ')).toBe('https://a.org/p#:~:text=Jobs%20did%20not%20fall');
  });

  it('degrades gracefully on empty input', () => {
    expect(textFragmentUrl('https://a.org/p#x', '   ')).toBe('https://a.org/p');
    expect(textFragmentUrl('', 'words')).toBe('');
  });
});

describe('pdfPageUrl', () => {
  it('appends #page=N and strips an existing fragment', () => {
    expect(pdfPageUrl('https://a.org/paper.pdf', 7)).toBe('https://a.org/paper.pdf#page=7');
    expect(pdfPageUrl('https://a.org/paper.pdf#page=2', 7)).toBe('https://a.org/paper.pdf#page=7');
    expect(pdfPageUrl('https://a.org/paper.pdf#view=fit', 3)).toBe('https://a.org/paper.pdf#page=3');
  });

  it('returns the URL unchanged without a valid page', () => {
    expect(pdfPageUrl('https://a.org/paper.pdf#zoom=50')).toBe('https://a.org/paper.pdf#zoom=50');
    expect(pdfPageUrl('https://a.org/paper.pdf', 0)).toBe('https://a.org/paper.pdf');
    expect(pdfPageUrl('https://a.org/paper.pdf', 1.5)).toBe('https://a.org/paper.pdf');
    expect(pdfPageUrl('https://a.org/paper.pdf', Number.NaN)).toBe('https://a.org/paper.pdf');
  });
});

describe('pagesOf', () => {
  it('single page from verification or fragment', () => {
    expect(pagesOf(match({ page: 790 }))).toEqual({ from: 790 });
    expect(pagesOf(match({ fragments: [frag('A.', { page: 4 })] }))).toEqual({ from: 4 });
  });

  it('span across fragments, pageEnd and verification', () => {
    expect(pagesOf(match({ fragments: [frag('A.', { page: 12 }), frag('B.', { page: 13 })], page: 12 }))).toEqual({ from: 12, to: 13 });
    expect(pagesOf(match({ fragments: [frag('A.', { page: 12, pageEnd: 14 })] }))).toEqual({ from: 12, to: 14 });
  });

  it('undefined without (valid) pages', () => {
    expect(pagesOf(match())).toBeUndefined();
    expect(pagesOf(match({ fragments: [frag('A.', { page: 0 })], page: -1 }))).toBeUndefined();
  });
});

describe('openAtPassageUrl', () => {
  const pdfMatch = match({ fragments: [frag('We find no job losses.', { page: 9 })], page: 9 });

  it('PDF text → the PDF at the page (finalUrl preferred)', () => {
    const r = result({ best: pdfMatch, textSource: 'pdf', finalUrl: 'https://a.org/final.pdf#x' });
    expect(openAtPassageUrl(r)).toBe('https://a.org/final.pdf#page=9');
  });

  it('PDF text without finalUrl falls back to meta.pdfUrl', () => {
    const r = result({ meta: meta({ ...CARD_KRUEGER, pdfUrl: 'https://a.org/p.pdf' }), best: pdfMatch, textSource: 'pdf', finalUrl: '' });
    expect(openAtPassageUrl(r)).toBe('https://a.org/p.pdf#page=9');
  });

  it('HTML / Exa / abstract text → text fragment on finalUrl or meta.url', () => {
    const best = match({ fragments: [frag('Employment did not fall.')] });
    expect(openAtPassageUrl(result({ best, textSource: 'html', finalUrl: 'https://news.org/a' }))).toBe(
      'https://news.org/a#:~:text=Employment%20did%20not%20fall.',
    );
    expect(openAtPassageUrl(result({ best, textSource: 'exa', finalUrl: '' }))).toBe(
      'https://www.jstor.org/stable/2118030#:~:text=Employment%20did%20not%20fall.',
    );
  });
});
