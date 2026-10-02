// Sentence segmentation with exact character offsets into the (normalized) document text.
import type { Sentence } from '../../shared/types';

const MAX_SENTENCE_CHARS = 600;

// Abbreviations after which a sentence boundary is almost always wrong.
const ABBREV_END =
  /(?:\b(?:e\.g|i\.e|et al|etc|vs|cf|approx|fig|figs|no|nos|vol|pp|p|ch|sec|eq|dr|mr|mrs|ms|prof|jr|sr|st|inc|ltd|co|corp|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|est|resp|ibid|op|cit|al)\.|\b[A-Z]\.(?:[A-Z]\.)+|\b(?:U\.S|U\.K|U\.N|E\.U)\.)$/i;

export interface PageStart {
  page: number;
  start: number;
}

let segmenter: Intl.Segmenter | undefined;
function getSegmenter(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
  return segmenter;
}

interface Span {
  start: number;
  end: number;
}

/** Trim whitespace from a span, returning null if nothing is left. */
function trimSpan(text: string, start: number, end: number): Span | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s] as string)) s++;
  while (e > s && /\s/.test(text[e - 1] as string)) e--;
  return e > s ? { start: s, end: e } : null;
}

/** Split an over-long span at whitespace near MAX_SENTENCE_CHARS (tables, run-on lists). */
function splitLong(text: string, span: Span): Span[] {
  const out: Span[] = [];
  let s = span.start;
  while (span.end - s > MAX_SENTENCE_CHARS) {
    const window = text.slice(s, s + MAX_SENTENCE_CHARS);
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '));
    if (cut < MAX_SENTENCE_CHARS * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = MAX_SENTENCE_CHARS - 1;
    const piece = trimSpan(text, s, s + cut + 1);
    if (piece) out.push(piece);
    s = s + cut + 1;
  }
  const rest = trimSpan(text, s, span.end);
  if (rest) out.push(rest);
  return out;
}

/**
 * Segment text into sentences. Every returned sentence satisfies
 * `text.slice(s.start, s.end) === s.text`. Newlines always end a sentence.
 */
export function segmentSentences(text: string, docId: string, pageStarts?: PageStart[]): Sentence[] {
  const raw: Span[] = [];
  for (const seg of getSegmenter().segment(text)) {
    // A segment may still contain internal newlines in some ICU versions; split on them.
    let offset = seg.index;
    for (const line of seg.segment.split('\n')) {
      const span = trimSpan(text, offset, offset + line.length);
      if (span) raw.push(span);
      offset += line.length + 1;
    }
  }

  // Merge false breaks after abbreviations when the next piece continues on the same line.
  const merged: Span[] = [];
  for (const span of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const prevText = text.slice(prev.start, prev.end);
      const between = text.slice(prev.end, span.start);
      const nextChar = text[span.start] ?? '';
      if (!between.includes('\n') && ABBREV_END.test(prevText) && !/^[A-Z][a-z]+\s[A-Z]/.test(text.slice(span.start, span.start + 30)) && /[a-z0-9(]/.test(nextChar)) {
        prev.end = span.end;
        continue;
      }
      // Lone fragments like "1." or "(a)" glue onto the following sentence on the same line.
      if (!between.includes('\n') && prev.end - prev.start <= 3 && /^[(\[]?[\dA-Za-z]{1,2}[.)\]]$/.test(prevText)) {
        prev.end = span.end;
        continue;
      }
    }
    merged.push({ ...span });
  }

  const spans = merged.flatMap((s) => (s.end - s.start > MAX_SENTENCE_CHARS ? splitLong(text, s) : [s]));

  return spans.map((s, i) => {
    const sentence: Sentence = { id: `${docId}.s${i}`, text: text.slice(s.start, s.end), start: s.start, end: s.end };
    const page = pageFor(s.start, pageStarts);
    if (page !== undefined) sentence.page = page;
    return sentence;
  });
}

export function pageFor(offset: number, pageStarts?: PageStart[]): number | undefined {
  if (!pageStarts?.length) return undefined;
  let page: number | undefined;
  for (const p of pageStarts) {
    if (p.start <= offset) page = p.page;
    else break;
  }
  return page ?? pageStarts[0]?.page;
}
