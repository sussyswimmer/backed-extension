// "Open at passage" links: text fragments for HTML pages, #page=N for PDFs.

import type { SourceResult } from '../types';
import { normalizeWs } from '../text';
import { pagesOf } from './pages';

const FRAGMENT_JOIN_RE = /\s*\[(?:…|\.\.\.)\]\s*/;

function stripFragment(url: string): string {
  const i = url.indexOf('#');
  return (i >= 0 ? url.slice(0, i) : url).trim();
}

/** encodeURIComponent plus the characters that are syntax inside a text directive. */
function encodeTextDirective(s: string): string {
  return encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
}

/**
 * URL that scrolls to (and highlights) the passage: `url#:~:text=…`.
 * Uses only the first fragment of a " […] "-joined passage. Up to 8 words → the whole passage;
 * longer → `start,end` from the first 5 and last 5 words (the end shrinks for 9–10 word passages
 * so start and end never overlap, which would make the directive unmatchable).
 */
export function textFragmentUrl(url: string, passage: string): string {
  const base = stripFragment(typeof url === 'string' ? url : '');
  if (!base) return '';
  const first = normalizeWs((typeof passage === 'string' ? passage : '').split(FRAGMENT_JOIN_RE)[0] ?? '');
  const words = first ? first.split(' ') : [];
  if (words.length === 0) return base;
  if (words.length <= 8) return `${base}#:~:text=${encodeTextDirective(first)}`;
  const start = words.slice(0, 5).join(' ');
  const end = words.slice(-Math.min(5, words.length - 5)).join(' ');
  return `${base}#:~:text=${encodeTextDirective(start)},${encodeTextDirective(end)}`;
}

/** `pdfUrl#page=N` (existing fragment stripped); without a valid page the URL is returned unchanged. */
export function pdfPageUrl(pdfUrl: string, page?: number): string {
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return pdfUrl;
  const base = stripFragment(pdfUrl);
  return base ? `${base}#page=${page}` : pdfUrl;
}

/** PDF text → the PDF at the passage's page; anything else → a text-fragment link to the passage. */
export function openAtPassageUrl(result: SourceResult): string {
  if (result.textSource === 'pdf') {
    const pdf = result.finalUrl || result.meta.pdfUrl || result.meta.url;
    return pdfPageUrl(pdf, pagesOf(result.best)?.from);
  }
  return textFragmentUrl(result.finalUrl || result.meta.url, result.best.passage);
}
