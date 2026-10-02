import { describe, expect, it } from 'vitest';
import { candidateIdFor, canonicalUrl, normalizeDoi } from '../../src/background/sources';
import { doiFromUrl, findDoiInText } from '../../src/background/sources/url';
import { hash32 } from '../../src/shared/text';

describe('canonicalUrl', () => {
  it.each([
    ['http://www.Example.com/Path/', 'https://example.com/Path'],
    ['https://example.com/a/b#section-2', 'https://example.com/a/b'],
    ['https://example.com/article?utm_source=x&utm_medium=y&fbclid=abc', 'https://example.com/article'],
    ['https://example.com/article?page=2&sort=asc', 'https://example.com/article'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['https://example.com/?p=123&utm_campaign=z', 'https://example.com/?p=123'],
    ['https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3456789&download=yes', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3456789&download=yes'],
    ['https://site.org/view.php?b=2&a=1&gclid=q', 'https://site.org/view.php?a=1&b=2'],
    ['https://site.org/page.aspx?id=7', 'https://site.org/page.aspx?id=7'],
    ['https://www.youtube.com/watch?v=abc&t=10', 'https://youtube.com/watch?v=abc'],
    ['https://example.com:443/x', 'https://example.com/x'],
    ['http://example.com:8080/x/', 'https://example.com:8080/x'],
    ['  https://www2.example.com/x  ', 'https://example.com/x'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected);
  });

  it('returns unparsable input trimmed', () => {
    expect(canonicalUrl(' not a url ')).toBe('not a url');
  });

  it('same page with/without www, tracking, trailing slash and http collapses to one key', () => {
    const variants = [
      'http://www.brookings.edu/articles/mw/',
      'https://brookings.edu/articles/mw',
      'https://www.brookings.edu/articles/mw/?utm_source=twitter#top',
    ];
    expect(new Set(variants.map(canonicalUrl)).size).toBe(1);
  });
});

describe('DOIs', () => {
  it('normalizes prefixes, case and trailing punctuation', () => {
    expect(normalizeDoi('https://doi.org/10.1093/QJE/QJZ014')).toBe('10.1093/qje/qjz014');
    expect(normalizeDoi('http://dx.doi.org/10.1162/REST_a_00039')).toBe('10.1162/rest_a_00039');
    expect(normalizeDoi('doi: 10.1257/aer.20131183.')).toBe('10.1257/aer.20131183');
    expect(normalizeDoi('10.1016/S0140-6736(20)30183-5')).toBe('10.1016/s0140-6736(20)30183-5');
    expect(normalizeDoi('https://doi.org/10.1000%2Fxyz')).toBe('10.1000/xyz');
  });

  it('finds DOIs in URLs', () => {
    expect(doiFromUrl('https://doi.org/10.1093/qje/qjz014')).toBe('10.1093/qje/qjz014');
    expect(doiFromUrl('https://onlinelibrary.wiley.com/doi/abs/10.1111/joes.12345')).toBe('10.1111/joes.12345');
    expect(doiFromUrl('https://www.tandfonline.com/doi/full/10.1080/00036846.2019.1234567')).toBe('10.1080/00036846.2019.1234567');
    expect(doiFromUrl('https://journals.sagepub.com/doi/10.1177/0019793919870000')).toBe('10.1177/0019793919870000');
    expect(doiFromUrl('https://example.com/papers/123')).toBeUndefined();
  });

  it('finds DOIs in text, including inside parentheses and markdown links', () => {
    expect(findDoiInText('Published (doi:10.1016/j.jpubeco.2017.01.002).')).toBe('10.1016/j.jpubeco.2017.01.002');
    expect(findDoiInText('See [10.1093/qje/qjz014](https://doi.org/10.1093/qje/qjz014)')).toBe('10.1093/qje/qjz014');
    expect(findDoiInText('The Lancet, https://doi.org/10.1016/S0140-6736(20)30183-5 and more')).toBe('10.1016/s0140-6736(20)30183-5');
    expect(findDoiInText('no identifiers here 10.12 or 10/1234')).toBeUndefined();
  });
});

describe('candidateIdFor', () => {
  it('hashes the normalized DOI when present, else the canonical URL', () => {
    expect(candidateIdFor({ doi: 'https://doi.org/10.1093/QJE/qjz014', url: 'https://a.com/x' })).toBe('c_' + hash32('10.1093/qje/qjz014'));
    expect(candidateIdFor({ url: 'http://www.a.com/x/?utm_source=1' })).toBe('c_' + hash32('https://a.com/x'));
    expect(candidateIdFor({ doi: '10.1093/qje/qjz014', url: 'https://one.com' })).toBe(candidateIdFor({ doi: '10.1093/QJE/QJZ014', url: 'https://two.com' }));
  });
});
