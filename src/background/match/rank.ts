// Final ranking: relation × confidence × tier × mode boost − penalties; one result per source.
import type { CandidateMeta, OutputMode, Relation, SourceResult, SourceTier, TextSource, VerifiedMatch } from '../../shared/types';
import { countWords, yearOf } from '../../shared/text';

export const RELATION_WEIGHT: Record<Relation, number> = { direct: 1.0, paraphrase: 0.85, partial: 0.5, contradicts: 1.0 };

export const TIER_WEIGHT: Record<SourceTier, number> = {
  peer_reviewed: 1.0,
  gov_igo: 0.95,
  think_tank: 0.8,
  major_news: 0.75,
  preprint: 0.7,
  web: 0.4,
};

export const SUPPORT_LIMIT = 7;
export const PUSHBACK_LIMIT = 3;

const SCOPE_PENALTY = 0.15;
const ABSTRACT_PENALTY = 0.05;
const LOW_QUALITY_PENALTY = 0.5;

export interface ScoredInput {
  meta: CandidateMeta;
  textSource: TextSource;
  localScopeNote?: string;
}

/** A "clear quotable claim sentence": one direct/paraphrase sentence of quotable length. */
function isQuotable(m: VerifiedMatch): boolean {
  if (m.sentenceIds.length !== 1 || (m.relation !== 'direct' && m.relation !== 'paraphrase' && m.relation !== 'contradicts')) return false;
  const w = countWords(m.passage);
  return w >= 8 && w <= 45;
}

export function scoreMatch(m: VerifiedMatch, src: ScoredInput, mode: OutputMode, nowYear: number): number {
  let boost = 1;
  if (mode === 'paper' && (src.meta.tier === 'peer_reviewed' || src.meta.tier === 'gov_igo')) boost *= 1.15;
  if (mode === 'debate') {
    const y = yearOf(src.meta.published);
    if (y !== undefined && nowYear - y <= 5) boost *= 1.1;
    if (isQuotable(m)) boost *= 1.1;
  }
  let s = RELATION_WEIGHT[m.relation] * m.confidence * TIER_WEIGHT[src.meta.tier] * boost;
  if (m.scopeMismatch || src.localScopeNote) s -= SCOPE_PENALTY;
  if (src.textSource === 'abstract_only') s -= ABSTRACT_PENALTY;
  if (src.meta.lowQuality) s -= LOW_QUALITY_PENALTY;
  return Math.round(s * 1000) / 1000;
}

export interface PoolEntry extends ScoredInput {
  candidateId: string;
  matches: VerifiedMatch[];
  finalUrl: string;
  round: number;
  summary?: SourceResult['summary'];
}

/** Two matches overlap if they share any sentence. */
function overlaps(a: VerifiedMatch, b: VerifiedMatch): boolean {
  return a.sentenceIds.some((id) => b.sentenceIds.includes(id));
}

/** Build one SourceResult per source and split into Support (top 7) and Pushback (top 3). */
export function rankResults(
  pool: PoolEntry[],
  opts: { mode: OutputMode; notRelevant: Set<string>; nowYear: number; side?: 'support' | 'attack' | 'either'; supportLimit?: number; pushbackLimit?: number },
): {
  support: SourceResult[];
  pushback: SourceResult[];
  all: SourceResult[];
} {
  const results: SourceResult[] = [];
  for (const entry of pool) {
    if (opts.notRelevant.has(entry.candidateId) || !entry.matches.length) continue;
    const scored = entry.matches
      .map((m) => ({ m, s: scoreMatch(m, entry, opts.mode, opts.nowYear) }))
      .sort((a, b) => b.s - a.s);
    // Distinct passages only.
    const distinct: typeof scored = [];
    for (const x of scored) if (!distinct.some((d) => overlaps(d.m, x.m))) distinct.push(x);
    // A source with passages on both sides goes on the user's side unless the other side is much stronger.
    const preferContra = opts.side === 'attack';
    const onSide = distinct.find((x) => (x.m.relation === 'contradicts') === preferContra);
    const offSide = distinct.find((x) => (x.m.relation === 'contradicts') !== preferContra);
    const best = onSide && (!offSide || onSide.s >= offSide.s * 0.8) ? onSide : distinct[0];
    if (!best) continue;
    // "More passages" stay on the same side as the best one.
    const sameSide = (r: Relation) => (best.m.relation === 'contradicts' ? r === 'contradicts' : r !== 'contradicts');
    const result: SourceResult = {
      candidateId: entry.candidateId,
      meta: entry.meta,
      best: best.m,
      more: distinct.filter((x) => x !== best && sameSide(x.m.relation)).map((x) => x.m),
      score: best.s,
      textSource: entry.textSource,
      finalUrl: entry.finalUrl,
      round: entry.round,
    };
    if (entry.summary) result.summary = entry.summary;
    if (entry.localScopeNote) result.localScopeNote = entry.localScopeNote;
    results.push(result);
  }
  results.sort((a, b) => b.score - a.score);
  const support = results.filter((r) => r.best.relation !== 'contradicts').slice(0, opts.supportLimit ?? SUPPORT_LIMIT);
  const pushback = results.filter((r) => r.best.relation === 'contradicts').slice(0, opts.pushbackLimit ?? PUSHBACK_LIMIT);
  return { support, pushback, all: results };
}

/** Local scope note when a later round adds a year range the source falls outside of. */
export function localScopeNote(published: string | undefined, yearFrom?: number, yearTo?: number): string | undefined {
  const y = yearOf(published);
  if (y === undefined || (yearFrom === undefined && yearTo === undefined)) return undefined;
  if ((yearFrom !== undefined && y < yearFrom) || (yearTo !== undefined && y > yearTo)) {
    return `Published ${y}, outside ${yearFrom ?? '…'}–${yearTo ?? '…'}`;
  }
  return undefined;
}
