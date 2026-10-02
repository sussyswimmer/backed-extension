// Local, LLM-free pre-filter: BM25 over chunks (unigrams + bigrams, light stemming).
import type { Chunk, DocText, Plan } from '../../shared/types';
import { chunkText } from './chunk';

const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does doing for from had has have having he her hers him his how i if in into is it its ' +
    'itself just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their theirs them ' +
    'then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
    'yours also may might must shall about above after again against all am any because before below between both down during each few further here ' +
    'doesn don didn isn wasn weren aren hasn haven hadn won wouldn shouldn couldn really significantly'
  ).split(/\s+/),
);

/** Very light suffix stripping so "wages"/"wage", "reduces"/"reduced"/"reducing" meet. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return trimDouble(w.slice(0, -3));
  if (w.endsWith('edly') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ed') && w.length > 4) return trimDouble(w.slice(0, -2));
  if (w.endsWith('es') && w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

function trimDouble(w: string): string {
  // "reduc" from "reduced"/"reducing" vs "reduce" -> strip trailing e for a common root.
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) return w.slice(0, -1);
  return w;
}

function normalizeStem(w: string): string {
  const s = stem(w);
  return s.endsWith('e') && s.length > 4 ? s.slice(0, -1) : s;
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9%$]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return words.map(normalizeStem);
}

/** Unigrams plus adjacent bigrams ("minimum_wage"), so key phrases score as phrases. */
export function termsOf(text: string): string[] {
  const toks = tokenize(text);
  const out = [...toks];
  for (let i = 0; i + 1 < toks.length; i++) out.push(`${toks[i]}_${toks[i + 1]}`);
  return out;
}

export class Bm25 {
  private readonly docTerms: Map<string, number>[];
  private readonly docLens: number[];
  private readonly avgLen: number;
  private readonly df = new Map<string, number>();

  constructor(
    docs: string[][],
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {
    this.docTerms = docs.map((terms) => {
      const m = new Map<string, number>();
      for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return m;
    });
    this.docLens = docs.map((d) => d.length);
    this.avgLen = this.docLens.reduce((a, b2) => a + b2, 0) / Math.max(1, docs.length) || 1;
  }

  private idf(term: string): number {
    const n = this.docTerms.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Query terms may repeat; repetition weights a term (capped at 3). */
  score(queryTerms: string[]): number[] {
    const qtf = new Map<string, number>();
    for (const t of queryTerms) qtf.set(t, Math.min(3, (qtf.get(t) ?? 0) + 1));
    return this.docTerms.map((terms, i) => {
      let s = 0;
      const len = this.docLens[i] ?? 0;
      for (const [term, w] of qtf) {
        const tf = terms.get(term);
        if (!tf) continue;
        const norm = tf * (this.k1 + 1) / (tf + this.k1 * (1 - this.b + (this.b * len) / this.avgLen));
        s += w * this.idf(term) * norm;
      }
      return s;
    });
  }
}

export function queryTermsFor(plan: Plan, forCounter: boolean): string[] {
  const parts = [...plan.keyTerms, ...plan.keyTerms, ...plan.paraphrases, plan.coreProposition];
  if (forCounter) parts.push(plan.counterQuery, plan.counterQuery);
  return parts.flatMap(termsOf);
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

/**
 * Keep the top `perDoc` chunks per document and at most `total` overall.
 * Every document with a non-zero best chunk gets at least its best chunk (when `total` allows).
 */
export function selectChunks(args: {
  docs: DocText[];
  chunksByDoc: Map<string, Chunk[]>;
  plan: Plan;
  counterDocIds: Set<string>;
  perDoc?: number;
  total?: number;
}): ScoredChunk[] {
  const perDoc = args.perDoc ?? 3;
  const total = args.total ?? 25;
  const all: Chunk[] = [];
  for (const d of args.docs) all.push(...(args.chunksByDoc.get(d.docId) ?? []));
  if (!all.length) return [];
  const docById = new Map(args.docs.map((d) => [d.docId, d]));
  const index = new Bm25(all.map((c) => termsOf(chunkText(docById.get(c.docId) as DocText, c))));
  const mainQ = queryTermsFor(args.plan, false);
  const counterQ = queryTermsFor(args.plan, true);
  const mainScores = index.score(mainQ);
  const counterScores = args.counterDocIds.size ? index.score(counterQ) : mainScores;

  const byDoc = new Map<string, ScoredChunk[]>();
  all.forEach((chunk, i) => {
    const score = args.counterDocIds.has(chunk.docId) ? (counterScores[i] ?? 0) : (mainScores[i] ?? 0);
    if (score <= 0) return;
    const list = byDoc.get(chunk.docId) ?? [];
    list.push({ chunk, score });
    byDoc.set(chunk.docId, list);
  });

  const tiers: ScoredChunk[][] = [];
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score);
    // Drop overlapping picks within a doc so we don't send the same sentences twice.
    const picked: ScoredChunk[] = [];
    for (const sc of list) {
      if (picked.length >= perDoc) break;
      if (picked.some((p) => p.chunk.sentenceStart <= sc.chunk.sentenceEnd && sc.chunk.sentenceStart <= p.chunk.sentenceEnd)) continue;
      picked.push(sc);
    }
    picked.forEach((sc, rank) => {
      (tiers[rank] ??= []).push(sc);
    });
  }
  const out: ScoredChunk[] = [];
  for (const tier of tiers) {
    tier.sort((a, b) => b.score - a.score);
    for (const sc of tier) {
      if (out.length >= total) return out;
      out.push(sc);
    }
  }
  return out;
}
