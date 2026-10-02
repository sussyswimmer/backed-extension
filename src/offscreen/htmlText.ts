// HTML -> readable main text. Runs in the offscreen document (real DOM) and in tests (jsdom).
// Fetched HTML is untrusted: we only ever read text out of it; nothing is rendered or executed.
import { Readability } from '@mozilla/readability';
import type { ExtractedHtml } from '../shared/messages';

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL', 'CAPTION', 'TBODY', 'THEAD', 'TFOOT',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'NAV']);
const REFERENCE_HEADING = /^(?:\d+\.?\s*)?(references|bibliography|works cited|notes|footnotes|endnotes|sources|citations)\s*:?$/i;

/** Footnote markers like <sup>12</sup> or <a href="#fn3">[3]</a> — dropped, as in the markdown path. */
function isFootnoteMarker(el: Element): boolean {
  const text = (el.textContent ?? '').trim();
  if (!/^\[?\d{1,3}\]?$/.test(text)) return false;
  if (el.tagName === 'SUP') return true;
  if (el.tagName === 'A') return (el.getAttribute('href') ?? '').startsWith('#');
  return false;
}

/**
 * Walk the DOM and produce text with a blank line between blocks and a newline per <br>/<li>/<tr>.
 * Stops at a "References"/"Notes" heading once some body text exists.
 */
export function htmlToText(root: Element): string {
  const parts: string[] = [];
  let stopped = false;
  const pushBreak = (br: string) => {
    if (!parts.length) return;
    const last = parts[parts.length - 1] as string;
    if (last === '\n\n' || (last === '\n' && br === '\n')) return;
    if (last === '\n' && br === '\n\n') {
      parts[parts.length - 1] = '\n\n';
      return;
    }
    parts.push(br);
  };
  const walk = (node: Node) => {
    if (stopped) return;
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(/\s+/g, ' ');
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return;
    if ((tag === 'SUP' || tag === 'A') && isFootnoteMarker(el)) return;
    if (/^H[1-6]$/.test(tag) && REFERENCE_HEADING.test((el.textContent ?? '').trim()) && parts.join('').length > 400) {
      stopped = true;
      return;
    }
    if (tag === 'BR') {
      pushBreak('\n');
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    const lineish = tag === 'LI' || tag === 'TR' || tag === 'DT' || tag === 'DD';
    if (block) pushBreak(lineish ? '\n' : '\n\n');
    for (const child of Array.from(el.childNodes)) walk(child);
    if (tag === 'TD' || tag === 'TH') parts.push(' ');
    if (block) pushBreak(lineish ? '\n' : '\n\n');
  };
  walk(root);
  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metaContent(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const v = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Parse untrusted HTML and extract the main article text with Readability. */
export function extractReadable(html: string, url: string, parser: DOMParser): ExtractedHtml {
  const doc = parser.parseFromString(html, 'text/html');
  // Remove anything executable or remote before Readability touches it (defence in depth;
  // DOMParser documents never run scripts or load subresources anyway).
  doc.querySelectorAll('script, style, noscript, iframe, object, embed, link[rel="preload"], link[rel="prefetch"]').forEach((n) => n.remove());
  try {
    const base = doc.createElement('base');
    base.setAttribute('href', url);
    doc.head?.prepend(base);
  } catch {
    // ignore bad URLs
  }
  const published = metaContent(doc, [
    'meta[property="article:published_time"]',
    'meta[name="citation_publication_date"]',
    'meta[name="citation_date"]',
    'meta[name="dc.date"]',
    'meta[name="DC.date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
  ]);
  const citationAuthors = Array.from(doc.querySelectorAll('meta[name="citation_author"]'))
    .map((m) => m.getAttribute('content')?.trim() ?? '')
    .filter(Boolean);
  const fallbackTitle = metaContent(doc, ['meta[name="citation_title"]', 'meta[property="og:title"]']) ?? doc.title?.trim();

  const reader = new Readability(doc, { charThreshold: 300, keepClasses: false });
  const article = reader.parse();
  let text = '';
  if (article?.content) {
    const container = parser.parseFromString(`<!doctype html><html><body>${article.content}</body></html>`, 'text/html').body;
    text = htmlToText(container);
  }
  if (!text && article?.textContent) text = article.textContent;

  const out: ExtractedHtml = { text };
  const title = article?.title?.trim() || fallbackTitle;
  if (title) out.title = title;
  const byline = citationAuthors.length ? citationAuthors.join('; ') : article?.byline?.trim();
  if (byline) out.byline = byline;
  const pub = published ?? article?.publishedTime ?? undefined;
  if (pub) out.published = pub;
  return out;
}
