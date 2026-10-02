// Per-source AI summaries (one batched call per round for the visible results), with a cheap
// guard: any summary sentence containing a number that isn't in the source text is dropped.
import type { DocText, SourceResult, SourceSummary } from '../../shared/types';
import { normalizeWs, truncate, yearOf } from '../../shared/text';
import type { LlmClient } from '../llm/deepseek';
import { summaryPrompt, type SummaryDocInput } from '../llm/prompts';
import { SummarySchema } from '../llm/schemas';

export const MAX_SUMMARY_DOCS = 10;
const ABSTRACT_PREFIX = 'Based on the abstract only.';

const NUMBER_RE = /(?<![\w.])\d+(?:[.,]\d+)*(?:\.\d+)?/g;

function canonicalNumber(n: string): string {
  // "1,234" and "1234" are the same; "6.5" stays "6.5"; trailing ".0" dropped.
  let s = n.replace(/,(?=\d{3}\b)/g, '');
  if (/\.\d+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

/** All numbers present in the source text, canonicalized. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) {
    out.add(canonicalNumber(m[0]));
    // Allow "34" when the text has "34.2"? No — that would let rounded numbers through. Keep exact.
  }
  return out;
}

function splitSentences(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  return Array.from(seg.segment(text), (s) => s.segment.trim()).filter(Boolean);
}

function numbersOk(sentence: string, allowed: Set<string>): boolean {
  for (const m of sentence.matchAll(NUMBER_RE)) {
    if (!allowed.has(canonicalNumber(m[0]))) return false;
  }
  return true;
}

/** Drop every sentence that contains a number not found in the source text. */
export function guardNumbers(summary: string, sourceText: string): { text: string; dropped: number } {
  const allowed = numbersIn(sourceText);
  const sentences = splitSentences(summary);
  const kept = sentences.filter((s) => numbersOk(s, allowed));
  return { text: kept.join(' '), dropped: sentences.length - kept.length };
}

export function lineOk(line: string | undefined, sourceText: string): boolean {
  if (!line) return false;
  return numbersOk(line, numbersIn(sourceText));
}

export interface SummaryTarget {
  result: SourceResult;
  doc: DocText;
}

export async function summarizeResults(args: { llm: LlmClient; claim: string; targets: SummaryTarget[]; signal: AbortSignal }): Promise<Map<string, SourceSummary>> {
  const targets = args.targets.slice(0, MAX_SUMMARY_DOCS);
  const out = new Map<string, SourceSummary>();
  if (!targets.length) return out;
  const docs: SummaryDocInput[] = targets.map(({ result, doc }) => {
    const passages = [result.best, ...result.more].slice(0, 2).map((m) => ({ relation: m.relation, text: m.passage }));
    const y = yearOf(result.meta.published);
    return {
      docId: doc.docId,
      title: result.meta.title,
      publisherYear: [result.meta.publisher, y].filter(Boolean).join(', '),
      abstractOnly: doc.textSource === 'abstract_only',
      opening: truncate(normalizeWs(doc.text), 800),
      passages,
    };
  });
  const prompt = summaryPrompt({ claim: args.claim, docs });
  const { data } = await args.llm.json({
    label: 'summaries',
    system: prompt.system,
    user: prompt.user,
    schema: SummarySchema,
    maxTokens: 260 * targets.length + 200,
    signal: args.signal,
    temperature: 0.2,
  });

  const byDoc = new Map(targets.map((t) => [t.doc.docId, t]));
  for (const s of data.sources) {
    const t = byDoc.get(s.docId.trim());
    if (!t) continue;
    // Numbers may come from the full text we have (not just what was sent).
    const sourceText = `${t.result.meta.title} ${t.result.meta.published ?? ''} ${t.doc.text}`;
    const abstractOnly = t.doc.textSource === 'abstract_only';
    const guarded = guardNumbers(s.summary, sourceText);
    let summary = guarded.text;
    if (abstractOnly && summary && !summary.startsWith(ABSTRACT_PREFIX)) summary = `${ABSTRACT_PREFIX} ${summary}`;
    if (!summary) continue; // everything dropped: show the quotation without a summary
    const how = lineOk(s.howItRelates, sourceText) ? s.howItRelates : lineOk(t.result.best.reason, sourceText) ? t.result.best.reason : 'See the quotation below.';
    const entry: SourceSummary = { summary, howItRelates: how, droppedSentences: guarded.dropped, abstractOnly };
    if (s.limits && lineOk(s.limits, sourceText)) entry.limits = s.limits;
    if (s.tag && lineOk(s.tag, sourceText)) entry.tag = s.tag;
    out.set(t.result.candidateId, entry);
  }
  return out;
}
