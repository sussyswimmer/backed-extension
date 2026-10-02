// PDF page texts -> one clean document text with page offsets.
// Drops running headers/footers (lines repeated on >50% of pages), page numbers, and
// de-hyphenates words broken across lines.
import { normalizeDocText } from '../../shared/text';
import type { PageStart } from './sentences';

const EDGE_LINES = 3;

function lineKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

const PAGE_NUMBER_LINE = /^(?:page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

export interface CleanPdfResult {
  text: string;
  pageStarts: PageStart[];
}

export function cleanPdfPages(pages: Array<{ page: number; text: string }>): CleanPdfResult {
  const pageLines = pages.map((p) => p.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()));

  // Count, per normalized line, on how many pages it appears near the top or bottom.
  const counts = new Map<string, number>();
  for (const lines of pageLines) {
    const nonEmpty = lines.filter(Boolean);
    const edge = new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)].map(lineKey));
    for (const k of edge) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = pages.length >= 3 ? pages.length * 0.5 : Infinity;
  const repeated = new Set([...counts].filter(([, n]) => n > threshold).map(([k]) => k));

  const cleanedPages: string[] = pageLines.map((lines) => {
    const nonEmptyIdx = lines.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
    const edgeIdx = new Set([...nonEmptyIdx.slice(0, EDGE_LINES), ...nonEmptyIdx.slice(-EDGE_LINES)]);
    const kept = lines.filter((l, i) => {
      if (!edgeIdx.has(i)) return true;
      if (!l) return true;
      if (repeated.has(lineKey(l))) return false;
      if (PAGE_NUMBER_LINE.test(l)) return false;
      return true;
    });
    return joinLines(kept);
  });

  // Each page is normalized on its own and joined with a clean separator, so the joined text
  // is already in normalizeDocText form and page offsets stay exact.
  let text = '';
  const pageStarts: PageStart[] = [];
  cleanedPages.forEach((pageText, i) => {
    const page = pages[i]?.page ?? i + 1;
    const t = normalizeDocText(pageText);
    if (!t) return;
    if (text) {
      if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(t)) {
        text = text.slice(0, -1); // word broken across pages
      } else {
        text += /[.!?:;"”’)\]]$/.test(text) ? '\n\n' : ' ';
      }
    }
    pageStarts.push({ page, start: text.length });
    text += t;
  });
  return { text, pageStarts };
}

/** Join the lines of one page: blank lines are paragraph breaks, hyphenated breaks are healed. */
function joinLines(lines: string[]): string {
  let out = '';
  let paragraphBreak = false;
  for (const line of lines) {
    if (!line) {
      paragraphBreak = out.length > 0;
      continue;
    }
    if (!out) {
      out = line;
    } else if (paragraphBreak) {
      out += '\n\n' + line;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else {
      out += ' ' + line;
    }
    paragraphBreak = false;
  }
  return out;
}
