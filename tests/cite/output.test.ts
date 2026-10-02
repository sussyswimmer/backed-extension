import { describe, expect, it } from 'vitest';
import {
  exportMarkdown,
  formatAll,
  formatCitation,
  formatDebateCard,
  formatDebateCite,
  formatForMode,
  formatLinkSummaryQuote,
  formatQuote,
} from '../../src/shared/cite';
import { ACCESSED, CARD_KRUEGER, REUTERS, WEB_NO_DATE, frag, match, result, summary } from './helpers';

const PASSAGE = 'We find no indication that the rise in the minimum wage reduced employment.';
const pdfBest = (relation: 'direct' | 'paraphrase' = 'paraphrase') =>
  match({ relation, fragments: [frag(PASSAGE, { page: 790 })], page: 790 });
const pdfResult = (relation: 'direct' | 'paraphrase' = 'paraphrase') =>
  result({
    best: pdfBest(relation),
    textSource: 'pdf',
    finalUrl: 'https://a.org/ck.pdf',
    summary: summary({ limits: 'Two US states only.', tag: 'Minimum wage hikes don’t cost jobs' }),
  });
const OPTS = { styles: { paper: 'apa', essay: 'mla' } as const, accessed: ACCESSED, honestyLine: true };

describe('formatLinkSummaryQuote', () => {
  it('title, URL, open-at link, labelled summary, limits, relation label + quote, honesty line', () => {
    const { text } = formatLinkSummaryQuote(pdfResult(), { honestyLine: true });
    expect(text.split('\n')).toEqual([
      CARD_KRUEGER.title,
      CARD_KRUEGER.url,
      'Open at quotation: https://a.org/ck.pdf#page=790',
      'Summary (AI): Finds no job losses after a minimum wage rise. The study compares fast-food employment in two states. It finds no job losses.',
      'Limits: Two US states only.',
      `Quotation (Paraphrase): "${PASSAGE}"`,
      'Paraphrase match: the source supports this idea in different words.',
    ]);
  });

  it('HTML links the title and the open-at URL, italicizes the honesty line', () => {
    const { html } = formatLinkSummaryQuote(pdfResult(), { honestyLine: true });
    expect(html).toContain(`<a href="${CARD_KRUEGER.url}"><b>`);
    expect(html).toContain('<a href="https://a.org/ck.pdf#page=790">');
    expect(html).toContain('<b>Summary (AI):</b>');
    expect(html).toContain('<i>Paraphrase match: the source supports this idea in different words.</i>');
  });

  it('honesty line off; direct match has none; abstract-only summary is labelled; no summary → no summary line', () => {
    expect(formatLinkSummaryQuote(pdfResult(), { honestyLine: false }).text).not.toContain('Paraphrase match');
    expect(formatLinkSummaryQuote(pdfResult('direct'), { honestyLine: true }).text).toContain('Quotation (Direct): "');
    expect(formatLinkSummaryQuote(pdfResult('direct'), { honestyLine: true }).text).not.toContain('match:');
    const abs = result({ best: pdfBest(), summary: summary({ abstractOnly: true }) });
    expect(formatLinkSummaryQuote(abs, { honestyLine: true }).text).toContain('Summary (AI, abstract only): ');
    expect(formatLinkSummaryQuote(result(), { honestyLine: true }).text).not.toContain('Summary');
  });
});

describe('formatForMode', () => {
  it('Paper (APA): citation, in-text with PDF page, quote; no card', () => {
    const out = formatForMode(pdfResult(), 'paper', OPTS);
    expect(out.citation).toEqual(formatCitation(CARD_KRUEGER, 'apa', { accessed: ACCESSED }));
    expect(out.inText).toBe('(Card & Krueger, 1994, p. 790)');
    expect(out.quote).toEqual(formatQuote(pdfResult(), 'paper'));
    expect(out.card).toBeUndefined();
    expect(out.linkSummaryQuote).toEqual(formatLinkSummaryQuote(pdfResult(), { honestyLine: true }));
  });

  it('Paper (Chicago)', () => {
    const out = formatForMode(pdfResult(), 'paper', { ...OPTS, styles: { paper: 'chicago', essay: 'mla' } });
    expect(out.inText).toBe('(Card and Krueger 1994, 790)');
    expect(out.citation.text.startsWith('Card, David, and Alan B. Krueger. 1994. ')).toBe(true);
  });

  it('Essay (MLA default and APA)', () => {
    expect(formatForMode(pdfResult(), 'essay', OPTS).inText).toBe('(Card and Krueger 790)');
    expect(formatForMode(pdfResult(), 'essay', { ...OPTS, styles: { paper: 'apa', essay: 'apa' } }).inText).toBe(
      '(Card & Krueger, 1994, p. 790)',
    );
  });

  it('Debate: debate cite as citation, card, no in-text', () => {
    const out = formatForMode(pdfResult(), 'debate', OPTS);
    expect(out.citation).toEqual(formatDebateCite(CARD_KRUEGER, ACCESSED));
    expect(out.card).toEqual(formatDebateCard(pdfResult(), { accessed: ACCESSED, honestyLine: true }));
    expect(out.inText).toBeUndefined();
  });

  it('only uses page numbers when the passage came from a PDF', () => {
    const html = result({ best: pdfBest(), textSource: 'html' });
    expect(formatForMode(html, 'paper', OPTS).inText).toBe('(Card & Krueger, 1994)');
  });

  it('switching modes re-formats the same result', () => {
    const r = pdfResult();
    const modes = (['paper', 'essay', 'debate'] as const).map((m) => formatForMode(r, m, OPTS).citation.text);
    expect(new Set(modes).size).toBe(3);
  });
});

describe('formatAll', () => {
  it('every source as link + summary + quote, separated by a blank line', () => {
    const a = pdfResult();
    const b = result({ meta: REUTERS, best: match({ relation: 'direct' }) });
    const all = formatAll([a, b], { honestyLine: true });
    expect(all.text).toBe(
      `${formatLinkSummaryQuote(a, { honestyLine: true }).text}\n\n${formatLinkSummaryQuote(b, { honestyLine: true }).text}`,
    );
    expect(all.html).toBe(
      `${formatLinkSummaryQuote(a, { honestyLine: true }).html}<p><br></p>${formatLinkSummaryQuote(b, { honestyLine: true }).html}`,
    );
  });

  it('empty set → empty output', () => {
    expect(formatAll([], { honestyLine: true })).toEqual({ text: '', html: '' });
  });
});

describe('exportMarkdown', () => {
  const results = [pdfResult(), result({ meta: WEB_NO_DATE, best: match({ relation: 'direct' }), summary: summary() })];
  const md = exportMarkdown({ claim: 'Minimum wage hikes don’t cause big job losses', mode: 'paper', results, ...OPTS });

  it('claim heading, mode line, one section per source', () => {
    const lines = md.split('\n');
    expect(lines[0]).toBe('# Minimum wage hikes don’t cause big job losses');
    expect(lines[2]).toBe('Research paper · APA 7 · 2 sources · Accessed October 2, 2026');
    expect(md).toContain(`## 1. [${CARD_KRUEGER.title}](${CARD_KRUEGER.url})`);
    expect(md).toContain('## 2. [How to Read a Minimum Wage Study](https://example.org/guide)');
    expect(md).toContain('[Open at quotation](https://a.org/ck.pdf#page=790)');
  });

  it('summary (AI), quotation as a blockquote, honesty line, citation with *italics*, in-text', () => {
    expect(md).toContain('**Summary (AI):** Finds no job losses after a minimum wage rise. The study compares');
    expect(md).toContain('**Limits:** Two US states only.');
    expect(md).toContain(`**Quotation (Paraphrase):**\n\n> ${PASSAGE}\n\n*Paraphrase match: the source supports this idea in different words.*`);
    expect(md).toContain(
      `**Citation:** Card, D., & Krueger, A. B. (1994). ${CARD_KRUEGER.title}. *American Economic Review*. [https://doi.org/10.1257/aer.84.4.772](https://doi.org/10.1257/aer.84.4.772)`,
    );
    expect(md).toContain('**In-text:** (Card & Krueger, 1994, p. 790)');
    expect(md).toContain('**Citation:** Doe, J. (n.d.). *How to Read a Minimum Wage Study*. Example Blog.');
  });

  it('is well-formed: trailing newline, no triple blank lines, no HTML', () => {
    expect(md.endsWith('\n')).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
    expect(md).not.toMatch(/<\/?[a-z]/i);
  });

  it('Debate mode: cite + card (bold matches), no in-text', () => {
    const d = exportMarkdown({ claim: 'X', mode: 'debate', results: [pdfResult()], ...OPTS });
    expect(d).toContain('Debate · Debate cites · 1 source');
    expect(d).toContain('**Card:**\n\n**Minimum wage hikes don’t cost jobs**\n\n**David Card and Alan B. Krueger**, **1994**, "');
    expect(d.match(/\*\*David Card and Alan B\. Krueger\*\*/g)).toHaveLength(1);
    expect(d).toContain(`**${PASSAGE}**`);
    expect(d).not.toContain('**In-text:**');
  });

  it('Essay mode uses the essay style', () => {
    const e = exportMarkdown({ claim: 'X', mode: 'essay', results: [pdfResult()], ...OPTS });
    expect(e).toContain('School essay · MLA 9');
    expect(e).toContain('**In-text:** (Card and Krueger 790)');
    expect(e).toContain('*American Economic Review*, 1994,');
  });

  it('escapes Markdown in source-derived text but keeps quotations verbatim', () => {
    const tricky = result({
      meta: { ...WEB_NO_DATE, title: 'Wages *really* [matter]' },
      best: match({ fragments: [frag('Effects were small (p < 0.05) for *all* groups.')] }),
    });
    const t = exportMarkdown({ claim: '# not a *heading*', mode: 'paper', results: [tricky], ...OPTS });
    expect(t.split('\n')[0]).toBe('# # not a \\*heading\\*');
    expect(t).toContain('[Wages \\*really\\* \\[matter\\]](https://example.org/guide)');
    expect(t).toContain('> Effects were small (p < 0.05) for *all* groups.');
  });

  it('empty set', () => {
    const e = exportMarkdown({ claim: 'X', mode: 'paper', results: [], ...OPTS });
    expect(e).toContain('0 sources');
    expect(e).toContain('No sources picked.');
  });
});
