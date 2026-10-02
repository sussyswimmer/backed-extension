import { describe, expect, it } from 'vitest';
import { formatDebateCard, formatDebateCite } from '../../src/shared/cite';
import {
  ACCESSED,
  CARD_DOI_URL,
  CARD_KRUEGER,
  CARD_TITLE,
  REUTERS,
  REUTERS_URL,
  WDR_DOI_URL,
  WDR_TITLE,
  WORLD_BANK,
  fragParts,
  frag,
  match,
  meta,
  result,
  summary,
} from './helpers';

describe('formatDebateCite', () => {
  it('Author, Year, "Title," Publication, URL, accessed DATE', () => {
    const f = formatDebateCite(CARD_KRUEGER, ACCESSED);
    expect(f.text).toBe(
      `David Card and Alan B. Krueger, 1994, "${CARD_TITLE}," American Economic Review, ${CARD_DOI_URL}, accessed October 2, 2026`,
    );
    expect(f.html).toBe(
      `<p><b>David Card and Alan B. Krueger</b>, <b>1994</b>, &quot;${CARD_TITLE},&quot; American Economic Review, <a href="${CARD_DOI_URL}">${CARD_DOI_URL}</a>, accessed October 2, 2026</p>`,
    );
  });

  it('news with a single author', () => {
    expect(formatDebateCite(REUTERS, ACCESSED).text).toBe(
      `Jane Doe, 2020, "Minimum wage hikes did not cut jobs, study finds," Reuters, ${REUTERS_URL}, accessed October 2, 2026`,
    );
  });

  it('organization author is not repeated as the publication', () => {
    expect(formatDebateCite(WORLD_BANK, ACCESSED).text).toBe(
      `World Bank, 2019, "${WDR_TITLE}," ${WDR_DOI_URL}, accessed October 2, 2026`,
    );
  });

  it('3+ authors: et al.', () => {
    const m = meta({ ...CARD_KRUEGER, authors: ['David Card', 'Alan B. Krueger', 'Lawrence F. Katz'] });
    expect(formatDebateCite(m, ACCESSED).text.startsWith('David Card et al., 1994, ')).toBe(true);
  });

  it('missing parts leave no empty commas', () => {
    const bare = meta({ title: 'Bare Page', url: 'https://x.org/p', authors: [], tier: 'web' });
    expect(formatDebateCite(bare, ACCESSED).text).toBe('"Bare Page," https://x.org/p, accessed October 2, 2026');
    const noUrl = meta({ title: 'Bare Page', url: '', authors: [], tier: 'web' });
    expect(formatDebateCite(noUrl, ACCESSED).text).toBe('"Bare Page," accessed October 2, 2026');
    expect(formatDebateCite(noUrl, new Date(Number.NaN)).text).toBe('"Bare Page"');
  });

  it('a title ending in "?" takes no comma', () => {
    const m = meta({ ...REUTERS, title: 'Do minimum wages kill jobs?' });
    expect(formatDebateCite(m, ACCESSED).text).toContain('"Do minimum wages kill jobs?" Reuters, ');
  });
});

describe('formatDebateCard', () => {
  const best = match({
    relation: 'paraphrase',
    contextBefore: 'New Jersey raised its minimum wage in 1992.',
    contextAfter: 'Prices rose slightly.',
    fragments: [
      fragParts([
        { text: 'Employment did not fall.', match: true },
        { text: ' Stores kept hours.', match: false },
        { text: ' Full-time jobs rose.', match: true },
      ]),
      frag('Teen employment was unchanged.'),
    ],
  });
  const r = result({ best, summary: summary({ tag: 'Minimum wage hikes don’t cost jobs' }) });

  it('HTML: tag bold, cite, honesty italic, passage with <b><u> matches and 8pt context', () => {
    const { html } = formatDebateCard(r, { accessed: ACCESSED, honestyLine: true });
    const paras = html.match(/<p>.*?<\/p>/g) ?? [];
    expect(paras).toHaveLength(4);
    expect(paras[0]).toBe('<p><b>Minimum wage hikes don’t cost jobs</b></p>');
    expect(paras[1]).toContain('<b>David Card and Alan B. Krueger</b>');
    expect(paras[2]).toBe('<p><i>Paraphrase match: the source supports this idea in different words.</i></p>');
    expect(paras[3]).toBe(
      '<p><span style="font-size:8pt">New Jersey raised its minimum wage in 1992.</span> ' +
        '<b><u>Employment did not fall.</u></b> Stores kept hours. <b><u>Full-time jobs rose.</u></b>' +
        ' […] <b><u>Teen employment was unchanged.</u></b> ' +
        '<span style="font-size:8pt">Prices rose slightly.</span></p>',
    );
    expect(html).not.toMatch(/class=|<style|<link|<div/);
  });

  it('gap sentences are normal weight and normal size', () => {
    const { html } = formatDebateCard(r, { accessed: ACCESSED, honestyLine: true });
    expect(html).toContain('</u></b> Stores kept hours. <b><u>');
    expect(html).not.toContain('8pt">Stores');
  });

  it('plain text: no markup, one line per part, passage verbatim', () => {
    const { text } = formatDebateCard(r, { accessed: ACCESSED, honestyLine: true });
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Minimum wage hikes don’t cost jobs');
    expect(lines[1]).toMatch(/^David Card and Alan B\. Krueger, 1994, "/);
    expect(lines[2]).toBe('Paraphrase match: the source supports this idea in different words.');
    expect(lines[3]).toBe(
      'New Jersey raised its minimum wage in 1992. Employment did not fall. Stores kept hours. Full-time jobs rose. […] Teen employment was unchanged. Prices rose slightly.',
    );
    expect(text).not.toMatch(/<|\*\*|__/);
  });

  it('honesty line off, or direct relation → no honesty line', () => {
    expect(formatDebateCard(r, { accessed: ACCESSED, honestyLine: false }).text).not.toContain('Paraphrase match');
    const direct = result({ best: match({ relation: 'direct' }), summary: summary({ tag: 'Tag' }) });
    const f = formatDebateCard(direct, { accessed: ACCESSED, honestyLine: true });
    expect(f.text.split('\n')).toHaveLength(3);
    expect(f.html).not.toContain('<i>');
  });

  it('contradicting sources get the contradicts line', () => {
    const c = result({ best: match({ relation: 'contradicts' }), summary: summary({ tag: 'Tag' }) });
    expect(formatDebateCard(c, { accessed: ACCESSED, honestyLine: true }).text).toContain(
      'Contradicts: the source argues against this claim.',
    );
  });

  it('tag falls back to howItRelates; no summary → no tag line', () => {
    const noTag = result({ best: match(), summary: summary({ tag: undefined, howItRelates: 'Finds no job losses' }) });
    expect(formatDebateCard(noTag, { accessed: ACCESSED, honestyLine: true }).text.split('\n')[0]).toBe('Finds no job losses');
    const none = result({ best: match() });
    const f = formatDebateCard(none, { accessed: ACCESSED, honestyLine: true });
    expect(f.text.split('\n')).toHaveLength(2);
    expect(f.text.split('\n')[0]).toMatch(/^David Card/);
  });

  it('fragments without parts are fully bold + underlined', () => {
    const plainFrag = result({ best: match({ fragments: [frag('Only sentence.')] }) });
    expect(formatDebateCard(plainFrag, { accessed: ACCESSED, honestyLine: false }).html).toContain('<b><u>Only sentence.</u></b>');
  });
});
