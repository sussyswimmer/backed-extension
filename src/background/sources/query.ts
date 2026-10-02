// Query building shared by adapters: which plan queries to use, regions, year bounds.

import type { Plan } from '../../shared/types';
import { normalizeWs } from '../../shared/text';

export interface YearBounds {
  from?: number;
  to?: number;
}

function validYear(y: unknown): number | undefined {
  return typeof y === 'number' && Number.isFinite(y) && y >= 1500 && y <= 2200 ? Math.trunc(y) : undefined;
}

/** Plan year constraints, sanitized (swapped if reversed). */
export function yearBounds(plan: Plan): YearBounds {
  let from = validYear(plan.constraints?.yearFrom);
  let to = validYear(plan.constraints?.yearTo);
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  const out: YearBounds = {};
  if (from !== undefined) out.from = from;
  if (to !== undefined) out.to = to;
  return out;
}

export function regionsOf(plan: Plan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of plan.constraints?.regions ?? []) {
    const t = normalizeWs(r ?? '');
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

function mentions(q: string, region: string): boolean {
  return q.toLowerCase().includes(region.toLowerCase());
}

/** Academic keyword query + region keywords not already in it ("minimum wage employment Vietnam"). */
export function withRegionKeywords(q: string, regions: string[]): string {
  const extra = regions.filter((r) => !mentions(q, r));
  return normalizeWs([q, ...extra].join(' '));
}

/** Exa sentence query + regions as natural text ("… had no effect on employment in Vietnam or Thailand"). */
export function withRegionSentence(q: string, regions: string[]): string {
  const base = normalizeWs(q);
  const extra = regions.filter((r) => !mentions(base, r));
  if (extra.length === 0) return base;
  const trimmed = base.replace(/[.!?]+$/, '');
  return `${trimmed} in ${extra.join(' or ')}`;
}

function clean(list: readonly string[] | undefined): string[] {
  return (list ?? []).map((q) => normalizeWs(q ?? '')).filter((q) => q.length > 0);
}

/** Academic queries (max `n`), with keyTerms as a fallback when the plan has none. */
export function academicQueries(plan: Plan, n: number): string[] {
  const qs = clean(plan.queries?.academic);
  if (qs.length > 0) return qs.slice(0, n);
  const terms = clean(plan.keyTerms).slice(0, 6).join(' ');
  if (terms) return [terms];
  const claim = normalizeWs(plan.coreProposition || plan.normalizedClaim || '');
  return claim ? [claim] : [];
}

/** First query from the named lists, in order (e.g. news, then semantic), else the claim. */
export function firstQuery(plan: Plan, lists: Array<keyof Plan['queries']>): string {
  for (const l of lists) {
    const q = clean(plan.queries?.[l])[0];
    if (q) return q;
  }
  return normalizeWs(plan.normalizedClaim || plan.coreProposition || '');
}

export function counterQueryOf(plan: Plan): string {
  return normalizeWs(plan.counterQuery ?? '');
}

/** Deterministic JSON (keys in insertion order, undefined dropped) for adapter signatures. */
export function stableSignature(id: string, parts: Record<string, unknown>): string {
  return `${id}:${JSON.stringify(parts)}`;
}
