import { describe, expect, it } from 'vitest';
import { formatCitation, formatInText, pagesOf, styleForMode } from '../../src/shared/cite';
import {
  ACCESSED,
  CARD_DOI_URL,
  CARD_KRUEGER,
  CARD_TITLE,
  REUTERS,
  REUTERS_URL,
  WDR_DOI_URL,
  WDR_TITLE,
  WEB_NO_DATE,
  WORLD_BANK,
  frag,
  match,
  meta,
} from './helpers';

const PAGE = { from: 790 };
const pdfPages = (page: number, pageEnd?: number) =>
  pagesOf(match({ fragments: [frag('We find no reduction in employment.', { page, pageEnd })], page }));

const THREE = meta({
  ...CARD_KRUEGER,
  authors: ['David Card', 'Alan B. Krueger', 'Lawrence F. Katz'],
});
const FOUR = meta({ ...THREE, authors: [...THREE.authors, 'Jane Doe'] });

describe('APA 7', () => {
  it('journal article with DOI', () => {
    const f = formatCitation(CARD_KRUEGER, 'apa', { accessed: ACCESSED });
    expect(f.text).toBe(`Card, D., & Krueger, A. B. (1994). ${CARD_TITLE}. American Economic Review. ${CARD_DOI_URL}`);
    expect(f.html).toContain('<i>American Economic Review</i>');
    expect(f.html).not.toContain(`<i>${CARD_TITLE}`);
    expect(f.html).toContain(`<a href="${CARD_DOI_URL}">${CARD_DOI_URL}</a>`);
    expect(f.text).not.toContain('jstor'); // DOI over URL
  });

  it('news article: full date, single author, outlet italic, " | Reuters" suffix dropped', () => {
    const f = formatCitation(REUTERS, 'apa');
    expect(f.text).toBe(`Doe, J. (2020, March 5). Minimum wage hikes did not cut jobs, study finds. Reuters. ${REUTERS_URL}`);
    expect(f.html).toContain('<i>Reuters</i>');
  });

  it('government report with organization author (publisher not repeated)', () => {
    const f = formatCitation(WORLD_BANK, 'apa');
    expect(f.text).toBe(`World Bank. (2019). ${WDR_TITLE}. ${WDR_DOI_URL}`);
    expect(f.html).toContain(`<i>${WDR_TITLE}</i>`);
    expect(f.text.match(/World Bank/g)).toHaveLength(1);
  });

  it('report with person authors keeps the publisher', () => {
    const m = meta({ tier: 'think_tank', title: 'Wage Floors', authors: ['Jane Doe'], publisher: 'Brookings Institution', published: '2021', url: 'https://brookings.edu/x' });
    expect(formatCitation(m, 'apa').text).toBe('Doe, J. (2021). Wage Floors. Brookings Institution. https://brookings.edu/x');
  });

  it('does not repeat an organization author that equals the publisher', () => {
    const m = meta({ tier: 'gov_igo', title: 'Report', authors: ['World Bank'], publisher: 'The World Bank', published: '2019', url: 'https://wb.org/r' });
    expect(formatCitation(m, 'apa').text).toBe('World Bank. (2019). Report. https://wb.org/r');
  });

  it('web page with no date: n.d., title italic, site name, no access date', () => {
    const f = formatCitation(WEB_NO_DATE, 'apa', { accessed: ACCESSED });
    expect(f.text).toBe('Doe, J. (n.d.). How to Read a Minimum Wage Study. Example Blog. https://example.org/guide');
    expect(f.html).toContain('<i>How to Read a Minimum Wage Study</i>');
    expect(f.text).not.toContain('Retrieved');
  });

  it('web page with a full date uses it', () => {
    const m = meta({ ...WEB_NO_DATE, published: '2021-06-01' });
    expect(formatCitation(m, 'apa').text).toContain('(2021, June 1).');
  });

  it('in-text: 1, 2 and 3+ authors, organization, n.d.', () => {
    expect(formatInText(meta({ ...CARD_KRUEGER, authors: ['David Card'] }), 'apa')).toBe('(Card, 1994)');
    expect(formatInText(CARD_KRUEGER, 'apa')).toBe('(Card & Krueger, 1994)');
    expect(formatInText(THREE, 'apa')).toBe('(Card et al., 1994)');
    expect(formatInText(WORLD_BANK, 'apa')).toBe('(World Bank, 2019)');
    expect(formatInText(REUTERS, 'apa')).toBe('(Doe, 2020)');
    expect(formatInText(WEB_NO_DATE, 'apa')).toBe('(Doe, n.d.)');
  });

  it('in-text with PDF page number and page span', () => {
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: pdfPages(790) })).toBe('(Card & Krueger, 1994, p. 790)');
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: pdfPages(12, 13) })).toBe('(Card & Krueger, 1994, pp. 12–13)');
    expect(formatInText(WEB_NO_DATE, 'apa', { pages: PAGE })).toBe('(Doe, n.d., p. 790)');
  });

  it('3–20 authors are all listed with "&" before the last', () => {
    expect(formatCitation(THREE, 'apa').text).toMatch(/^Card, D\., Krueger, A\. B\., & Katz, L\. F\. \(1994\)\. /);
  });

  it('21+ authors: first 19, ellipsis, last', () => {
    const authors = Array.from({ length: 25 }, (_, i) => `Author${String.fromCharCode(65 + i)} Person${i + 1}`);
    const text = formatCitation(meta({ authors, published: '2020' }), 'apa').text;
    expect(text).toContain('Person19, A., … Person25, A. (2020).');
    expect(text).not.toContain('Person20');
    expect(text).not.toContain('. .');
  });

  it('no author: title moves to the author position; in-text uses the title', () => {
    const news = meta({ ...REUTERS, authors: [] });
    expect(formatCitation(news, 'apa').text).toBe(`Minimum wage hikes did not cut jobs, study finds. (2020, March 5). Reuters. ${REUTERS_URL}`);
    const web = meta({ tier: 'web', title: 'Sticky Wages', authors: [], url: 'https://x.org/s' });
    expect(formatCitation(web, 'apa').text).toBe('Sticky Wages. (n.d.). https://x.org/s');
    expect(formatCitation(web, 'apa').html).toContain('<i>Sticky Wages</i>');
    expect(formatInText(web, 'apa', { pages: PAGE })).toBe('(Sticky Wages, n.d., p. 790)');
    expect(formatInText(meta({ title: 'The Long and Winding Road to Full Employment', published: '2001' }), 'apa')).toBe('(The Long and Winding, 2001)');
  });

  it('title ending in "?" gets no extra period', () => {
    const m = meta({ ...CARD_KRUEGER, title: 'Do Minimum Wages Kill Jobs?' });
    expect(formatCitation(m, 'apa').text).toContain('(1994). Do Minimum Wages Kill Jobs? American Economic Review.');
  });

  it('preprint without a publisher is formatted as a standalone work', () => {
    const m = meta({ tier: 'preprint', title: 'A Preprint', authors: ['Jane Doe'], published: '2023', url: 'https://arxiv.org/abs/1' });
    const f = formatCitation(m, 'apa');
    expect(f.text).toBe('Doe, J. (2023). A Preprint. https://arxiv.org/abs/1');
    expect(f.html).toContain('<i>A Preprint</i>');
  });
});

describe('Chicago author-date', () => {
  it('journal article with DOI', () => {
    const f = formatCitation(CARD_KRUEGER, 'chicago');
    expect(f.text).toBe(`Card, David, and Alan B. Krueger. 1994. "${CARD_TITLE}." American Economic Review. ${CARD_DOI_URL}.`);
    expect(f.html).toContain('<i>American Economic Review</i>');
  });

  it('news article with full date', () => {
    const f = formatCitation(REUTERS, 'chicago');
    expect(f.text).toBe(`Doe, Jane. 2020. "Minimum wage hikes did not cut jobs, study finds." Reuters, March 5, 2020. ${REUTERS_URL}.`);
    expect(f.html).toContain('<i>Reuters</i>, March 5, 2020.');
  });

  it('government report with organization author', () => {
    const f = formatCitation(WORLD_BANK, 'chicago');
    expect(f.text).toBe(`World Bank. 2019. ${WDR_TITLE}. ${WDR_DOI_URL}.`);
    expect(f.html).toContain(`<i>${WDR_TITLE}</i>`);
  });

  it('web page with no date: n.d. and access date', () => {
    expect(formatCitation(WEB_NO_DATE, 'chicago', { accessed: ACCESSED }).text).toBe(
      'Doe, Jane. n.d. "How to Read a Minimum Wage Study." Example Blog. Accessed October 2, 2026. https://example.org/guide.',
    );
    expect(formatCitation(WEB_NO_DATE, 'chicago').text).toBe(
      'Doe, Jane. n.d. "How to Read a Minimum Wage Study." Example Blog. https://example.org/guide.',
    );
  });

  it('dated web page: no access date, publication date after the site', () => {
    const m = meta({ ...WEB_NO_DATE, published: '2021-06-01' });
    expect(formatCitation(m, 'chicago', { accessed: ACCESSED }).text).toBe(
      'Doe, Jane. 2021. "How to Read a Minimum Wage Study." Example Blog. June 1, 2021. https://example.org/guide.',
    );
  });

  it('three authors in the reference list', () => {
    expect(formatCitation(THREE, 'chicago').text).toMatch(/^Card, David, Alan B\. Krueger, and Lawrence F\. Katz\. 1994\. /);
  });

  it('in-text: 1–3 authors listed, 4+ et al., organization, n.d.', () => {
    expect(formatInText(CARD_KRUEGER, 'chicago')).toBe('(Card and Krueger 1994)');
    expect(formatInText(THREE, 'chicago')).toBe('(Card, Krueger, and Katz 1994)');
    expect(formatInText(FOUR, 'chicago')).toBe('(Card et al. 1994)');
    expect(formatInText(WORLD_BANK, 'chicago')).toBe('(World Bank 2019)');
    expect(formatInText(REUTERS, 'chicago')).toBe('(Doe 2020)');
    expect(formatInText(WEB_NO_DATE, 'chicago')).toBe('(Doe n.d.)');
  });

  it('in-text with PDF page number and page span', () => {
    expect(formatInText(CARD_KRUEGER, 'chicago', { pages: pdfPages(790) })).toBe('(Card and Krueger 1994, 790)');
    expect(formatInText(CARD_KRUEGER, 'chicago', { pages: pdfPages(12, 13) })).toBe('(Card and Krueger 1994, 12–13)');
  });

  it('no author: title first, quoted short title in-text', () => {
    const news = meta({ ...REUTERS, authors: [] });
    expect(formatCitation(news, 'chicago').text).toBe(
      `"Minimum wage hikes did not cut jobs, study finds." 2020. Reuters, March 5, 2020. ${REUTERS_URL}.`,
    );
    expect(formatInText(news, 'chicago', { pages: PAGE })).toBe('("Minimum wage hikes did" 2020, 790)');
  });
});

describe('MLA 9', () => {
  it('journal article with DOI', () => {
    const f = formatCitation(CARD_KRUEGER, 'mla');
    expect(f.text).toBe(`Card, David, and Alan B. Krueger. "${CARD_TITLE}." American Economic Review, 1994, ${CARD_DOI_URL}.`);
    expect(f.html).toContain('<i>American Economic Review</i>, 1994,');
  });

  it('news article with day-month-year date', () => {
    expect(formatCitation(REUTERS, 'mla').text).toBe(
      `Doe, Jane. "Minimum wage hikes did not cut jobs, study finds." Reuters, 5 Mar. 2020, ${REUTERS_URL}.`,
    );
  });

  it('government report with organization author', () => {
    const f = formatCitation(WORLD_BANK, 'mla');
    expect(f.text).toBe(`World Bank. ${WDR_TITLE}. 2019, ${WDR_DOI_URL}.`);
    expect(f.html).toContain(`<i>${WDR_TITLE}</i>`);
  });

  it('web page with no date: date omitted, access date at the end', () => {
    expect(formatCitation(WEB_NO_DATE, 'mla', { accessed: ACCESSED }).text).toBe(
      'Doe, Jane. "How to Read a Minimum Wage Study." Example Blog, https://example.org/guide. Accessed 2 Oct. 2026.',
    );
    expect(formatCitation(WEB_NO_DATE, 'mla', { accessed: ACCESSED }).html).toContain('<i>Example Blog</i>');
  });

  it('omits a missing date without "n.d."', () => {
    const news = meta({ ...REUTERS, published: undefined });
    const text = formatCitation(news, 'mla', { accessed: ACCESSED }).text;
    expect(text).toBe(`Doe, Jane. "Minimum wage hikes did not cut jobs, study finds." Reuters, ${REUTERS_URL}.`);
  });

  it('3+ authors: first author, et al.', () => {
    expect(formatCitation(THREE, 'mla').text).toMatch(/^Card, David, et al\. "/);
    expect(formatInText(THREE, 'mla', { pages: PAGE })).toBe('(Card et al. 790)');
  });

  it('in-text: author + page, no page, page span', () => {
    expect(formatInText(CARD_KRUEGER, 'mla', { pages: pdfPages(790) })).toBe('(Card and Krueger 790)');
    expect(formatInText(CARD_KRUEGER, 'mla', { pages: pdfPages(12, 13) })).toBe('(Card and Krueger 12–13)');
    expect(formatInText(CARD_KRUEGER, 'mla', { pages: { from: 790, to: 791 } })).toBe('(Card and Krueger 790–91)');
    expect(formatInText(CARD_KRUEGER, 'mla')).toBe('(Card and Krueger)');
    expect(formatInText(meta({ ...CARD_KRUEGER, authors: ['David Card'] }), 'mla')).toBe('(Card)');
    expect(formatInText(WORLD_BANK, 'mla', { pages: PAGE })).toBe('(World Bank 790)');
  });

  it('no author: starts with the title; in-text uses a quoted short title', () => {
    const web = meta({ tier: 'web', title: 'Sticky Wages', authors: [], url: 'https://x.org/s', publisher: 'Wage Blog' });
    expect(formatCitation(web, 'mla').text).toBe('"Sticky Wages." Wage Blog, https://x.org/s.');
    expect(formatInText(web, 'mla', { pages: PAGE })).toBe('("Sticky Wages" 790)');
    expect(formatInText(web, 'mla')).toBe('("Sticky Wages")');
  });
});

describe('shared rules', () => {
  it('normalizes every DOI spelling to https://doi.org/', () => {
    for (const doi of ['10.1257/x.1', 'doi:10.1257/x.1', 'DOI: 10.1257/x.1', 'https://doi.org/10.1257/x.1', 'http://dx.doi.org/10.1257/x.1']) {
      expect(formatCitation(meta({ doi }), 'apa').text).toContain('https://doi.org/10.1257/x.1');
      expect(formatCitation(meta({ doi }), 'apa').text).not.toContain('doi.org/doi');
    }
  });

  it('falls back to the URL when the DOI is not a DOI', () => {
    expect(formatCitation(meta({ doi: 'n/a' }), 'apa').text).toContain('https://example.org/page');
  });

  it('ignores invalid page refs', () => {
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: { from: 0 } })).toBe('(Card & Krueger, 1994)');
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: { from: Number.NaN } })).toBe('(Card & Krueger, 1994)');
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: { from: 5, to: 5 } })).toBe('(Card & Krueger, 1994, p. 5)');
    expect(formatInText(CARD_KRUEGER, 'apa', { pages: { from: 13, to: 12 } })).toBe('(Card & Krueger, 1994, pp. 12–13)');
  });

  it('citation HTML is a single paragraph with a hanging indent and no classes', () => {
    const { html } = formatCitation(CARD_KRUEGER, 'mla');
    expect(html.startsWith('<p style="margin-left:0.5in;text-indent:-0.5in">')).toBe(true);
    expect(html.endsWith('</p>')).toBe(true);
    expect(html).not.toMatch(/class=|<style|<link/);
  });

  it('styleForMode', () => {
    const styles = { paper: 'chicago', essay: 'apa' } as const;
    expect(styleForMode('paper', styles)).toBe('chicago');
    expect(styleForMode('essay', styles)).toBe('apa');
    expect(styleForMode('debate', styles)).toBe('apa');
    expect(styleForMode('paper', { paper: 'apa', essay: 'mla' })).toBe('apa');
    expect(styleForMode('essay', { paper: 'apa', essay: 'mla' })).toBe('mla');
  });
});
