// Get the real text for a candidate, in order of preference:
// 1. open-access PDF, 2. Exa text already on the candidate, 3. fetch the landing page ourselves,
// 4. abstract/snippet only (marked abstract_only — we never pretend we read the full text).
import type { ExtractedHtml, ExtractedPdf } from '../../shared/messages';
import type { Candidate, DocText } from '../../shared/types';
import { fetchWithTimeout, isAbortError, type FetchLike } from '../net';
import { buildDoc } from './chunk';
import { stripMarkdown } from './markdown';
import { cleanPdfPages } from './pdfClean';

export const MIN_FULL_TEXT_CHARS = 400;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const PDF_FIRST_PAGES = 60;
export const PDF_MAX_SCAN_PAGES = 300;

export interface Extractor {
  html(html: string, url: string): Promise<ExtractedHtml>;
  pdf(bytes: Uint8Array, opts: { keyTerms: string[]; firstPages: number; maxScanPages: number }): Promise<ExtractedPdf>;
}

export interface TextContext {
  extractor: Extractor;
  signal: AbortSignal;
  keyTerms: string[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  /** False when the user hasn't granted <all_urls>: skip our own page/PDF fetches. */
  canFetchPages: boolean;
  now?: () => Date;
}

export class FetchFailure extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'FetchFailure';
  }
}

interface Fetched {
  kind: 'pdf' | 'html' | 'other';
  bytes: Uint8Array;
  finalUrl: string;
  contentType: string;
}

/** Read a response body, refusing anything over maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new FetchFailure('too large');
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchFailure('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function sniffKind(bytes: Uint8Array, contentType: string): Fetched['kind'] {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'pdf';
  if (/pdf/i.test(contentType)) return 'pdf';
  if (/html|xml|text\/plain/i.test(contentType) || !contentType) return 'html';
  return 'other';
}

export async function fetchDocument(url: string, ctx: Pick<TextContext, 'fetchImpl' | 'signal' | 'timeoutMs' | 'maxBytes'>): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs ?? 12_000,
      fetchImpl: ctx.fetchImpl,
      credentials: 'omit',
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' },
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new FetchFailure(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!res.ok) throw new FetchFailure(String(res.status));
  const contentType = res.headers.get('content-type') ?? '';
  const bytes = await readCapped(res, ctx.maxBytes ?? MAX_BODY_BYTES);
  return { kind: sniffKind(bytes, contentType), bytes, finalUrl: res.url || url, contentType };
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, '');
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const PAYWALL_HINT = /\b(subscribe to (?:read|continue)|subscription required|sign in to (?:read|continue)|create a free account to (?:read|continue)|enable javascript|you have reached your (?:free )?article limit)\b/i;

async function fromPdf(bytes: Uint8Array, finalUrl: string, c: Candidate, docId: string, ctx: TextContext): Promise<DocText | null> {
  const pdf = await raceAbort(
    ctx.extractor.pdf(bytes, { keyTerms: ctx.keyTerms, firstPages: PDF_FIRST_PAGES, maxScanPages: PDF_MAX_SCAN_PAGES }),
    ctx.signal,
  );
  const cleaned = cleanPdfPages(pdf.pages);
  if (cleaned.text.length < MIN_FULL_TEXT_CHARS) return null;
  return buildDoc({
    docId,
    candidateId: c.id,
    text: cleaned.text,
    pageStarts: cleaned.pageStarts,
    textSource: 'pdf',
    finalUrl,
    fetchedAt: (ctx.now?.() ?? new Date()).toISOString(),
    ...(pdf.title ? { title: pdf.title } : {}),
    ...(pdf.author ? { byline: pdf.author } : {}),
    pageCount: pdf.pageCount,
    pagesKept: pdf.pages.map((p) => p.page),
  });
}

async function fromHtml(bytes: Uint8Array, contentType: string, finalUrl: string, c: Candidate, docId: string, ctx: TextContext): Promise<DocText | { fail: string }> {
  const html = decodeHtml(bytes, contentType);
  const extracted = await raceAbort(ctx.extractor.html(html, finalUrl), ctx.signal);
  const text = extracted.text;
  if (text.length < MIN_FULL_TEXT_CHARS) return { fail: PAYWALL_HINT.test(html) ? 'paywall' : 'too short' };
  if (text.length < 1500 && PAYWALL_HINT.test(text)) return { fail: 'paywall' };
  return buildDoc({
    docId,
    candidateId: c.id,
    text,
    textSource: 'html',
    finalUrl,
    fetchedAt: (ctx.now?.() ?? new Date()).toISOString(),
    ...(extracted.title ? { title: extracted.title } : {}),
    ...(extracted.byline ? { byline: extracted.byline } : {}),
    ...(extracted.published ? { published: extracted.published } : {}),
  });
}

/** Race a non-cancellable promise (offscreen work) against the job's abort signal. */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Returns the best text we can get for a candidate, or null when we have nothing at all
 * (no fetchable text and no abstract/snippet).
 */
export async function acquireText(c: Candidate, docId: string, ctx: TextContext): Promise<DocText | null> {
  const reasons: string[] = [];
  const fetchedAt = () => (ctx.now?.() ?? new Date()).toISOString();

  // 1. Open-access PDF.
  if (c.pdfUrl && ctx.canFetchPages) {
    try {
      const f = await fetchDocument(c.pdfUrl, ctx);
      if (f.kind === 'pdf') {
        const doc = await fromPdf(f.bytes, f.finalUrl, c, docId, ctx);
        if (doc) return doc;
        reasons.push('pdf too short');
      } else if (f.kind === 'html') {
        // Some "pdf" links are HTML landing pages.
        const doc = await fromHtml(f.bytes, f.contentType, f.finalUrl, c, docId, ctx);
        if (!('fail' in doc)) return doc;
        reasons.push(doc.fail);
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
      reasons.push(e instanceof FetchFailure ? `pdf ${e.reason}` : 'pdf unreadable');
    }
  }

  // 2. Exa text that came with the search result.
  let exaText = '';
  if (c.text) {
    exaText = stripMarkdown(c.text);
    if (exaText.trim().length >= MIN_FULL_TEXT_CHARS) {
      return buildDoc({ docId, candidateId: c.id, text: exaText, textSource: 'exa', finalUrl: c.url, fetchedAt: fetchedAt() });
    }
  }

  // 3. Fetch the landing page ourselves.
  if (ctx.canFetchPages && c.url && c.url !== c.pdfUrl) {
    try {
      const f = await fetchDocument(c.url, ctx);
      if (f.kind === 'pdf') {
        const doc = await fromPdf(f.bytes, f.finalUrl, c, docId, ctx);
        if (doc) return doc;
        reasons.push('pdf too short');
      } else if (f.kind === 'html') {
        const doc = await fromHtml(f.bytes, f.contentType, f.finalUrl, c, docId, ctx);
        if (!('fail' in doc)) return doc;
        reasons.push(doc.fail);
      } else {
        reasons.push('unsupported content');
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
      reasons.push(e instanceof FetchFailure ? e.reason : 'unreadable');
    }
  } else if (!ctx.canFetchPages) {
    reasons.push('no page access');
  }

  // 4. Abstract / snippet only.
  const snippet = [c.snippet ?? '', exaText].sort((a, b) => b.length - a.length)[0] ?? '';
  if (snippet.trim().length >= 40) {
    return buildDoc({
      docId,
      candidateId: c.id,
      text: snippet,
      textSource: 'abstract_only',
      finalUrl: c.url,
      fetchedAt: fetchedAt(),
      fallbackReason: reasons.join(', ') || 'no full text',
    });
  }
  return null;
}
