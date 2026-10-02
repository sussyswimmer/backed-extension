// Documents -> overlapping sentence windows, and DocText construction.
import type { Chunk, DocText, TextSource } from '../../shared/types';
import { normalizeDocText } from '../../shared/text';
import { segmentSentences, type PageStart } from './sentences';

export const CHUNK_SIZE = 4; // sentences per chunk (3–5)
export const CHUNK_OVERLAP = 1;

/** Cap on document size we keep in memory and send through BM25 (~60 PDF pages). */
export const MAX_DOC_CHARS = 250_000;

export interface BuildDocInput {
  docId: string;
  candidateId: string;
  text: string;
  textSource: TextSource;
  finalUrl: string;
  fetchedAt: string;
  pageStarts?: PageStart[];
  title?: string;
  byline?: string;
  published?: string;
  pageCount?: number;
  pagesKept?: number[];
  fallbackReason?: string;
}

/**
 * Build a DocText. If `pageStarts` is given, its offsets must refer to `text` AFTER
 * normalizeDocText (cleanPdfPages produces already-normalized text for that reason).
 */
export function buildDoc(input: BuildDocInput): DocText {
  const normalized = input.pageStarts ? input.text : normalizeDocText(input.text);
  const text = normalized.length > MAX_DOC_CHARS ? normalized.slice(0, MAX_DOC_CHARS) : normalized;
  const doc: DocText = {
    docId: input.docId,
    candidateId: input.candidateId,
    text,
    sentences: segmentSentences(text, input.docId, input.pageStarts),
    textSource: input.textSource,
    finalUrl: input.finalUrl,
    fetchedAt: input.fetchedAt,
  };
  if (input.title) doc.title = input.title;
  if (input.byline) doc.byline = input.byline;
  if (input.published) doc.published = input.published;
  if (input.pageCount !== undefined) doc.pageCount = input.pageCount;
  if (input.pagesKept) doc.pagesKept = input.pagesKept;
  if (input.fallbackReason) doc.fallbackReason = input.fallbackReason;
  return doc;
}

/** Windows of CHUNK_SIZE consecutive sentences with CHUNK_OVERLAP sentence overlap. */
export function makeChunks(doc: DocText, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Chunk[] {
  const n = doc.sentences.length;
  if (n === 0) return [];
  const step = Math.max(1, size - overlap);
  const chunks: Chunk[] = [];
  for (let start = 0, i = 0; start < n; start += step, i++) {
    const end = Math.min(n - 1, start + size - 1);
    const chunk: Chunk = { id: `${doc.docId}.c${i}`, docId: doc.docId, sentenceStart: start, sentenceEnd: end };
    const page = doc.sentences[start]?.page;
    if (page !== undefined) chunk.page = page;
    chunks.push(chunk);
    if (end === n - 1) break;
  }
  return chunks;
}

export function chunkText(doc: DocText, chunk: Chunk): string {
  return doc.sentences
    .slice(chunk.sentenceStart, chunk.sentenceEnd + 1)
    .map((s) => s.text)
    .join(' ');
}
