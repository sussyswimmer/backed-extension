// Cheap pre-ranking before extraction (no network, no LLM).

import type { Candidate, Plan } from '../../shared/types';
import { yearOf } from '../../shared/text';
import { TIER_WEIGHT } from './tiers';
import { yearBounds } from './query';

const STOP = new Set(
  (
    'the of and to in a is that for on with as by are was be this it from at or an have has had not which their we our ' +
    'these were been can more than but also its between they there how what will would do does did into about after over ' +
    'under such may might should could who when where why while if then those them all any each other some most many much ' +
    'both only very no nor so too just being because through during before against among within without across per up out ' +
    'study studies evidence paper effect effects result results show shows find finds found'
  ).split(' '),
);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);
}

/** 0–1: how much of the plan's vocabulary the title + snippet covers. */
export function keywordOverlap(c: Candidate, plan: Plan): number {
  const doc = new Set(contentTokens(`${c.title ?? ''} ${c.snippet ?? ''}`));
  if (doc.size === 0) return 0;
  const terms = (plan.keyTerms ?? []).map(contentTokens).filter((t) => t.length > 0);
  const termHits = terms.filter((t) => t.every((w) => doc.has(w))).length;
  const termScore = terms.length ? Math.min(1, termHits / Math.min(terms.length, 5)) : 0;

  const paraText = [...(plan.paraphrases ?? []), plan.coreProposition ?? '', c.forCounter ? plan.counterQuery ?? '' : ''].join(' ');
  const para = new Set(contentTokens(paraText));
  let paraHits = 0;
  for (const w of para) if (doc.has(w)) paraHits++;
  const paraScore = para.size ? Math.min(1, (paraHits / para.size) * 2) : 0;

  if (!terms.length) return paraScore;
  return 0.6 * termScore + 0.4 * paraScore;
}

/**
 * score = tier weight + keyword overlap (0–1) + search score (≤ 0.3, or a small rank bonus)
 *       + recency (±, only with year constraints) + 0.1·log10(citedBy+1) − low-quality/Wikipedia penalties.
 * Sorted by score, descending (stable for ties).
 */
export function preRank(cands: Candidate[], plan: Plan): Array<{ candidate: Candidate; score: number }> {
  const maxSearch = Math.max(0, ...cands.map((c) => (typeof c.searchScore === 'number' && c.searchScore > 0 ? c.searchScore : 0)));
  const years = yearBounds(plan);
  const hasYears = years.from !== undefined || years.to !== undefined;
  const scored = cands.map((candidate, i) => {
    let score = TIER_WEIGHT[candidate.tier] ?? TIER_WEIGHT.web;
    score += keywordOverlap(candidate, plan);
    if (typeof candidate.searchScore === 'number' && maxSearch > 0) {
      score += 0.3 * Math.max(0, Math.min(1, candidate.searchScore / maxSearch));
    } else if (typeof candidate.searchRank === 'number') {
      score += 0.1 * Math.max(0, 1 - candidate.searchRank / 10);
    }
    if (hasYears) {
      const y = yearOf(candidate.published);
      if (y !== undefined) {
        const inside = (years.from === undefined || y >= years.from) && (years.to === undefined || y <= years.to);
        score += inside ? 0.2 : -0.3;
      }
    }
    if (typeof candidate.citedByCount === 'number' && candidate.citedByCount > 0) score += 0.1 * Math.log10(candidate.citedByCount + 1);
    if (candidate.lowQuality) score -= 1.0;
    if (candidate.isWikipedia) score -= 0.3;
    return { candidate, score: Math.round(score * 1e6) / 1e6, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ candidate, score }) => ({ candidate, score }));
}

/**
 * Top `max` candidates for extraction, reserving up to `reserveCounter` (default 3) slots for
 * counter-query candidates so the Pushback section has material. Ids in `exclude` are skipped.
 * Returned in ranked order.
 */
export function selectForExtraction(
  ranked: Array<{ candidate: Candidate; score: number }>,
  max: number,
  opts: { reserveCounter?: number; exclude?: Set<string> } = {},
): Candidate[] {
  if (max <= 0) return [];
  const pool = ranked.filter((r) => !opts.exclude?.has(r.candidate.id));
  const reserve = Math.max(0, Math.min(opts.reserveCounter ?? 3, max));
  const reserved = new Set(pool.filter((r) => r.candidate.forCounter).slice(0, reserve).map((r) => r.candidate.id));
  const picked = new Set(reserved);
  for (const r of pool) {
    if (picked.size >= max) break;
    picked.add(r.candidate.id);
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of pool) {
    if (picked.has(r.candidate.id) && !seen.has(r.candidate.id)) {
      seen.add(r.candidate.id);
      out.push(r.candidate);
    }
  }
  return out.slice(0, max);
}

const TECH_DOMAIN =
  /\b(computer|computing|cs|physics|physical|math|mathematics|mathematical|statistics|statistical|stats|quantitative|engineering|artificial intelligence|ai|machine learning|robotics|astronomy|astrophysics|cosmology|electrical|signal processing|information theory|cryptography|econometrics|quantitative finance|q-fin|q-bio|computational|data science|materials science|condensed matter|quantum)\b/i;

const TECH_TERMS =
  /\b(algorithms?|neural|deep learning|machine learning|transformers?|large language models?|llms?|language models?|gpt|reinforcement learning|computer vision|datasets?|benchmarks?|artificial intelligence|\bai\b|robots?|robotics|quantum|qubits?|cryptograph\w*|blockchain|encryption|semiconductors?|gpus?|chips?|photovoltaic|solar cells?|batter(?:y|ies)|superconduct\w*|particles?|galax(?:y|ies)|black holes?|dark matter|cosmolog\w*|exoplanets?|gravitational|relativity|thermodynamic\w*|entropy|theorem|proofs?|topolog\w*|bayesian|stochastic|monte carlo|simulations?|optimization|graph theory|genomics?|protein folding|crispr|neural networks?|climate models?|epidemiological models?|computational|software|compilers?|networks? security|signal processing|autonomous vehicles?|self-driving|nlp|natural language processing|econometric\w*)\b/i;

/** arXiv only pays off for technical/scientific claims: use the plan's domain hints, else its key terms. */
export function shouldRunArxiv(plan: Plan): boolean {
  const domains = (plan.domains ?? []).filter((d) => typeof d === 'string' && d.trim());
  if (domains.some((d) => TECH_DOMAIN.test(d))) return true;
  const text = [...(plan.keyTerms ?? []), ...(plan.queries?.academic ?? []), plan.coreProposition ?? ''].join(' | ');
  const hits = new Set((text.toLowerCase().match(new RegExp(TECH_TERMS.source, 'gi')) ?? []).map((m) => m.toLowerCase()));
  // With explicit non-technical domain hints, require stronger evidence from the terms.
  return domains.length > 0 ? hits.size >= 2 : hits.size >= 1;
}
