// Verification: the only place a VerifiedMatch is ever constructed.
// The LLM returns sentence IDs; we rebuild the passage from OUR stored sentences and prove it is
// a verbatim substring of the source text we actually have. Anything else is dropped.
import type { Chunk, DocText, MatchRelation, PassageFragment, Relation, Sentence, VerifiedMatch, VerifiedMatchFields } from '../../shared/types';
import { normalizeWs } from '../../shared/text';
import { looksLikeInjection } from '../llm/prompts';

/** Max number of non-matching sentences allowed between two matching ones inside one fragment. */
export const MAX_GAP = 2;

export interface RawMatch {
  chunkId: string;
  relation: MatchRelation;
  sentenceIds: string[];
  confidence: number;
  reason: string;
  scopeMismatch?: string;
}

export type VerifyFailure = 'irrelevant' | 'no_sentences' | 'fabricated_id' | 'not_verbatim' | 'injection';

export type VerifyOutcome = { ok: true; match: VerifiedMatch } | { ok: false; reason: VerifyFailure; detail?: string };

const SENTENCE_ID = /^d(\d+)\.s(\d+)$/;

/** Index of a sentence id in doc.sentences, or -1 if it isn't one of ours. */
function sentenceIndex(doc: DocText, id: string): number {
  const m = SENTENCE_ID.exec(id.trim());
  if (!m || `d${m[1]}` !== doc.docId) return -1;
  const idx = Number(m[2]);
  return doc.sentences[idx]?.id === id.trim() ? idx : -1;
}

function sentenceIsExact(doc: DocText, s: Sentence): boolean {
  return s.start >= 0 && s.end <= doc.text.length && s.start < s.end && doc.text.slice(s.start, s.end) === s.text;
}

/** Check that `passage` occurs verbatim (whitespace-normalized) in the document text. */
export function isVerbatimIn(docText: string, passage: string): boolean {
  const p = normalizeWs(passage);
  return p.length > 0 && normalizeWs(docText).includes(p);
}

/**
 * Verify one LLM match against the document and chunk it claims to come from.
 * Rules: every ID must exist in our sentence table AND inside the chunk the model was shown;
 * the passage is rebuilt from stored sentences and must be a verbatim substring of doc.text.
 */
export function verify(raw: RawMatch, doc: DocText, chunk: Chunk, candidateId: string): VerifyOutcome {
  if (raw.relation === 'irrelevant') return { ok: false, reason: 'irrelevant' };
  if (!raw.sentenceIds.length) return { ok: false, reason: 'no_sentences' };
  if (chunk.docId !== doc.docId) return { ok: false, reason: 'fabricated_id', detail: 'chunk/doc mismatch' };

  const indices: number[] = [];
  for (const id of raw.sentenceIds) {
    const idx = sentenceIndex(doc, id);
    if (idx < 0 || idx < chunk.sentenceStart || idx > chunk.sentenceEnd) {
      return { ok: false, reason: 'fabricated_id', detail: id };
    }
    if (!indices.includes(idx)) indices.push(idx);
  }
  indices.sort((a, b) => a - b);

  const matching = indices.map((i) => doc.sentences[i] as Sentence);
  if (matching.some((s) => looksLikeInjection(s.text))) return { ok: false, reason: 'injection' };

  // Group into fragments: contiguous or gap ≤ MAX_GAP.
  const groups: number[][] = [];
  for (const idx of indices) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last !== undefined && idx - last - 1 <= MAX_GAP) g.push(idx);
    else groups.push([idx]);
  }

  const matchSet = new Set(indices);
  const fragments: PassageFragment[] = [];
  for (const g of groups) {
    const first = g[0] as number;
    const last = g[g.length - 1] as number;
    const span = doc.sentences.slice(first, last + 1);
    if (span.some((s) => !sentenceIsExact(doc, s))) return { ok: false, reason: 'not_verbatim', detail: 'sentence table mismatch' };
    if (span.some((s, k) => !matchSet.has(first + k) && looksLikeInjection(s.text))) return { ok: false, reason: 'injection' };
    const charStart = (span[0] as Sentence).start;
    const charEnd = (span[span.length - 1] as Sentence).end;
    const text = doc.text.slice(charStart, charEnd);
    // Split into parts by sentence (match / gap), keeping inter-sentence whitespace with the preceding part.
    const parts: PassageFragment['parts'] = [];
    span.forEach((s, k) => {
      const nextStart = k + 1 < span.length ? (span[k + 1] as Sentence).start : charEnd;
      const piece = doc.text.slice(s.start, nextStart);
      const match = matchSet.has(first + k);
      const prev = parts[parts.length - 1];
      if (prev && prev.match === match) prev.text += piece;
      else parts.push({ text: piece, match });
    });
    if (parts.map((p) => p.text).join('') !== text) return { ok: false, reason: 'not_verbatim', detail: 'parts mismatch' };
    const frag: PassageFragment = { sentenceIds: span.map((s) => s.id), text, parts, charStart, charEnd };
    const page = span[0]?.page;
    const pageEnd = span[span.length - 1]?.page;
    if (page !== undefined) frag.page = page;
    if (pageEnd !== undefined && pageEnd !== page) frag.pageEnd = pageEnd;
    fragments.push(frag);
  }

  const passage = fragments.map((f) => normalizeWs(f.text)).join(' […] ');
  // The non-negotiable check: every fragment must be a verbatim substring of the document.
  for (const f of fragments) {
    if (doc.text.slice(f.charStart, f.charEnd) !== f.text || !isVerbatimIn(doc.text, f.text)) {
      return { ok: false, reason: 'not_verbatim' };
    }
  }

  const firstIdx = indices[0] as number;
  const lastIdx = indices[indices.length - 1] as number;
  const before = doc.sentences[firstIdx - 1];
  const after = doc.sentences[lastIdx + 1];
  const firstFrag = fragments[0] as PassageFragment;
  const lastFrag = fragments[fragments.length - 1] as PassageFragment;

  const fields: VerifiedMatchFields = {
    candidateId,
    docId: doc.docId,
    chunkId: chunk.id,
    relation: raw.relation as Relation,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
    reason: raw.reason.trim(),
    sentenceIds: indices.map((i) => (doc.sentences[i] as Sentence).id),
    fragments,
    passage,
    verification: { verbatim: true, charStart: firstFrag.charStart, charEnd: lastFrag.charEnd },
  };
  if (raw.scopeMismatch?.trim()) fields.scopeMismatch = raw.scopeMismatch.trim();
  if (before && sentenceIsExact(doc, before) && !looksLikeInjection(before.text)) fields.contextBefore = before.text;
  if (after && sentenceIsExact(doc, after) && !looksLikeInjection(after.text)) fields.contextAfter = after.text;
  if (firstFrag.page !== undefined) fields.verification.page = firstFrag.page;

  return { ok: true, match: fields as VerifiedMatch };
}
