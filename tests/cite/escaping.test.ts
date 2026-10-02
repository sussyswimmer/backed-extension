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
  type Formatted,
} from '../../src/shared/cite';
import { ACCESSED, frag, fragParts, htmlToText, match, meta, result, summary } from './helpers';

const EVIL_TITLE = '<script>alert("x")</script> Jobs & Wages';
const EVIL_PASSAGE = 'Wages rose <script>steal()</script> & jobs held "steady".';
const evilMeta = meta({
  tier: 'think_tank',
  title: EVIL_TITLE,
  authors: ['<b>Jane</b> Doe', 'O\'Brien, Pat'],
  publisher: 'Center for <img src=x onerror=alert(1)>',
  published: '2020',
  url: 'https://example.org/a"onmouseover="alert(1)',
});
const evilResult = result({
  meta: evilMeta,
  best: match({
    relation: 'paraphrase',
    fragments: [fragParts([{ text: EVIL_PASSAGE, match: true }, { text: ' <i>gap</i> & more.', match: false }])],
    contextBefore: '<iframe src=//evil>',
    contextAfter: 'After & <b>bold</b>',
  }),
  summary: summary({ summary: 'Says <script>x</script> & more.', tag: '<u>tag</u> & co', limits: '<img>' }),
});

function allHtml(): string[] {
  const out: Formatted[] = [
    formatCitation(evilMeta, 'apa'),
    formatCitation(evilMeta, 'chicago', { accessed: ACCESSED }),
    formatCitation(evilMeta, 'mla', { accessed: ACCESSED }),
    formatDebateCite(evilMeta, ACCESSED),
    formatDebateCard(evilResult, { accessed: ACCESSED, honestyLine: true }),
    formatLinkSummaryQuote(evilResult, { honestyLine: true }),
    formatAll([evilResult, evilResult], { honestyLine: true }),
    formatQuote(evilResult, 'paper'),
    formatQuote(evilResult, 'essay'),
    formatQuote(evilResult, 'debate'),
  ];
  for (const mode of ['paper', 'essay', 'debate'] as const) {
    const f = formatForMode(evilResult, mode, { styles: { paper: 'apa', essay: 'mla' }, accessed: ACCESSED, honestyLine: true });
    out.push(f.citation, f.quote, f.linkSummaryQuote);
    if (f.card) out.push(f.card);
  }
  return out.map((f) => f.html);
}

const ALLOWED_TAGS = new Set(['p', 'b', 'i', 'u', 'a', 'span', 'br']);

describe('HTML escaping', () => {
  it('escapes every piece of source-derived text', () => {
    for (const html of allHtml()) {
      // Attribute-looking text is harmless once its '<' is escaped; what matters is no live tag or quote break-out.
      expect(html).not.toMatch(/<script|<img|<iframe|onmouseover="/i);
      for (const tag of html.match(/<\/?([a-z]+)/gi) ?? []) {
        expect(ALLOWED_TAGS.has(tag.replace(/[</]/g, '').toLowerCase()), `${tag} in ${html}`).toBe(true);
      }
    }
  });

  it('title and passage with <script> and & are escaped in HTML but intact in text', () => {
    const c = formatCitation(evilMeta, 'apa');
    expect(c.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Jobs &amp; Wages');
    expect(c.text).toContain(EVIL_TITLE);
    const q = formatQuote(evilResult, 'paper');
    expect(q.html).toContain('Wages rose &lt;script&gt;steal()&lt;/script&gt; &amp; jobs held &quot;steady&quot;.');
    expect(htmlToText(q.html)).toBe(q.text);
    expect(q.text).toContain(EVIL_PASSAGE);
  });

  it('the visible text of every HTML output equals its plain text (modulo line breaks)', () => {
    const card = formatDebateCard(evilResult, { accessed: ACCESSED, honestyLine: true });
    expect(htmlToText(card.html.replace(/<\/p><p>/g, '\n'))).toBe(card.text);
    const lsq = formatLinkSummaryQuote(evilResult, { honestyLine: true });
    expect(htmlToText(lsq.html.replace(/<\/p><p>/g, '\n'))).toBe(lsq.text);
  });

  it('only http(s) URLs become links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://x.org/a', 'vbscript:x', ' javascript:alert(1)']) {
      const m = meta({ url, title: 'T', authors: ['Jane Doe'], published: '2020' });
      const r = result({ meta: m, finalUrl: url });
      for (const html of [
        formatCitation(m, 'apa').html,
        formatCitation(m, 'mla').html,
        formatDebateCite(m, ACCESSED).html,
        formatLinkSummaryQuote(r, { honestyLine: true }).html,
      ]) {
        expect(html).not.toContain('<a ');
        expect(html).not.toMatch(/<script/i);
      }
    }
  });

  it('a quote character in a URL cannot break out of the href attribute', () => {
    const html = formatCitation(evilMeta, 'apa').html;
    expect(html).toContain('href="https://example.org/a&quot;onmouseover=&quot;alert(1)"');
  });

  it('Markdown export neutralizes raw HTML in quotations and escapes it elsewhere', () => {
    const md = exportMarkdown({
      claim: '<script>x</script>',
      mode: 'debate',
      results: [evilResult],
      styles: { paper: 'apa', essay: 'mla' },
      accessed: ACCESSED,
      honestyLine: true,
    });
    expect(md).not.toMatch(/(^|[^\\])<(script|img|iframe|b|i|u)\b/i);
  });

  it('plain-text card has the passage verbatim', () => {
    const plain = formatDebateCard(result({ best: match({ fragments: [frag(EVIL_PASSAGE)] }) }), { accessed: ACCESSED, honestyLine: false });
    expect(plain.text).toContain(EVIL_PASSAGE);
  });
});
