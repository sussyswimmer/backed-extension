// pdf.js text content -> page texts. Huge PDFs: keep the first N pages plus any later page whose
// text mentions one of the plan's key terms (scanning at most maxScanPages pages).
import type { ExtractedPdf } from '../shared/messages';

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?: () => void;
}

export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  getMetadata?: () => Promise<{ info?: unknown }>;
}

function isTextItem(x: unknown): x is PdfTextItem {
  return typeof x === 'object' && x !== null && 'str' in x;
}

/** Turn one page's text items into lines; a big vertical gap becomes a blank line (paragraph). */
export function itemsToText(rawItems: unknown[]): string {
  const items = rawItems.filter(isTextItem);
  let out = '';
  let lastY: number | undefined;
  let lastH = 10;
  for (const it of items) {
    const str = it.str ?? '';
    const y = it.transform?.[5];
    const h = it.height && it.height > 0 ? it.height : lastH;
    if (y !== undefined && lastY !== undefined && Math.abs(y - lastY) > 0.5 && !out.endsWith('\n')) {
      out += '\n';
    }
    if (y !== undefined && lastY !== undefined && Math.abs(lastY - y) > h * 1.9 && out.endsWith('\n') && !out.endsWith('\n\n')) {
      out += '\n';
    }
    // pdf.js emits explicit space items between words; adjacent items on a line are glued as-is.
    if (str) out += str;
    if (it.hasEOL) out += '\n';
    if (y !== undefined) lastY = y;
    lastH = h;
  }
  return out;
}

export async function extractPdfPages(
  pdf: PdfDocLike,
  opts: { keyTerms: string[]; firstPages: number; maxScanPages: number; deadlineMs?: number; now?: () => number },
): Promise<ExtractedPdf> {
  const now = opts.now ?? Date.now;
  const start = now();
  const terms = opts.keyTerms.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 2);
  const pages: ExtractedPdf['pages'] = [];
  const last = Math.min(pdf.numPages, Math.max(opts.firstPages, opts.maxScanPages));
  for (let n = 1; n <= last; n++) {
    if (opts.deadlineMs && now() - start > opts.deadlineMs) break;
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = itemsToText(content.items);
    page.cleanup?.();
    if (n <= opts.firstPages) {
      pages.push({ page: n, text });
      continue;
    }
    const lower = text.toLowerCase();
    if (terms.some((t) => lower.includes(t))) pages.push({ page: n, text });
  }
  const out: ExtractedPdf = { pages, pageCount: pdf.numPages };
  try {
    const meta = await pdf.getMetadata?.();
    const info = meta?.info as { Title?: unknown; Author?: unknown } | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) out.title = info.Title.trim();
    if (typeof info?.Author === 'string' && info.Author.trim()) out.author = info.Author.trim();
  } catch {
    // metadata is optional
  }
  return out;
}
