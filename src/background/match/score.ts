// LLM matching: send batches of numbered sentences, get relation labels + sentence IDs back,
// verify each one. The model never returns passage text.
import type { Chunk, DocText, Plan, VerifiedMatch } from '../../shared/types';
import { yearOf } from '../../shared/text';
import { LlmError, type LlmClient } from '../llm/deepseek';
import { matchPrompt, type MatchChunkInput } from '../llm/prompts';
import { MatchSchema } from '../llm/schemas';
import { verify, type VerifyFailure } from './verify';

export const BATCH_SIZE = 8;

export interface DocInfo {
  doc: DocText;
  candidateId: string;
  label: string;
  forCounter: boolean;
}

export interface MatchStats {
  fabricatedIds: number;
  unverified: number;
  injection: number;
  irrelevant: number;
}

export interface BatchOutcome {
  verified: VerifiedMatch[];
  stats: MatchStats;
  /** True when the LLM output stayed malformed after one repair retry: the batch was skipped. */
  skipped: boolean;
}

export function sourceLabel(title: string, publisher?: string, published?: string): string {
  const y = yearOf(published);
  return `${title.slice(0, 140)}${publisher ? ` — ${publisher.slice(0, 60)}` : ''}${y ? ` (${y})` : ''}`;
}

export function toBatches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildChunkInputs(chunks: Chunk[], docs: Map<string, DocInfo>): MatchChunkInput[] {
  return chunks.map((c) => {
    const info = docs.get(c.docId) as DocInfo;
    return {
      chunkId: c.id,
      label: info.label,
      forCounter: info.forCounter,
      sentences: info.doc.sentences.slice(c.sentenceStart, c.sentenceEnd + 1).map((s) => ({ id: s.id, text: s.text })),
    };
  });
}

export async function matchBatch(args: {
  llm: LlmClient;
  plan: Plan;
  chunks: Chunk[];
  docs: Map<string, DocInfo>;
  signal: AbortSignal;
  label: string;
}): Promise<BatchOutcome> {
  const stats: MatchStats = { fabricatedIds: 0, unverified: 0, injection: 0, irrelevant: 0 };
  const inputs = buildChunkInputs(args.chunks, args.docs);
  const prompt = matchPrompt({ plan: args.plan, chunks: inputs });
  let data;
  try {
    ({ data } = await args.llm.json({
      label: args.label,
      system: prompt.system,
      user: prompt.user,
      schema: MatchSchema,
      maxTokens: 160 * args.chunks.length + 200,
      signal: args.signal,
      temperature: 0.1,
    }));
  } catch (e) {
    if (e instanceof LlmError && e.kind === 'malformed') return { verified: [], stats, skipped: true };
    throw e;
  }

  const chunkById = new Map(args.chunks.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const verified: VerifiedMatch[] = [];
  for (const raw of data.results) {
    const chunk = chunkById.get(raw.chunkId.trim());
    if (!chunk) {
      // A chunk ID we never sent: fabricated.
      if (raw.relation !== 'irrelevant') stats.fabricatedIds++;
      continue;
    }
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    const info = args.docs.get(chunk.docId) as DocInfo;
    const outcome = verify(
      {
        chunkId: chunk.id,
        relation: raw.relation,
        sentenceIds: raw.sentenceIds,
        confidence: raw.confidence,
        reason: raw.reason,
        ...(raw.scopeMismatch ? { scopeMismatch: raw.scopeMismatch } : {}),
      },
      info.doc,
      chunk,
      info.candidateId,
    );
    if (outcome.ok) verified.push(outcome.match);
    else countFailure(stats, outcome.reason);
  }
  return { verified, stats, skipped: false };
}

function countFailure(stats: MatchStats, reason: VerifyFailure): void {
  switch (reason) {
    case 'irrelevant':
    case 'no_sentences':
      stats.irrelevant++;
      break;
    case 'fabricated_id':
      stats.fabricatedIds++;
      break;
    case 'injection':
      stats.injection++;
      break;
    case 'not_verbatim':
      stats.unverified++;
      break;
  }
}
