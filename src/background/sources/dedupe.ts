// Dedupe + merge of candidates from several adapters and rounds.
// Same item = same normalized DOI, or same canonical URL (landing or PDF), or same title (≥ 4 words).

import type { Candidate, SourceId } from '../../shared/types';
import { yearOf } from '../../shared/text';
import { betterTier } from './tiers';
import { candidateIdFor, canonicalUrl, normalizeDoi } from './url';

/** Lowercased, accent- and punctuation-free title; undefined for titles under 4 words (too generic to match on). */
export function titleKey(title: string): string | undefined {
  const t = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t && t.split(' ').length >= 4 ? t : undefined;
}

function keysOf(c: Candidate): string[] {
  const keys: string[] = [];
  if (c.doi) keys.push('doi:' + normalizeDoi(c.doi));
  if (c.url) keys.push('url:' + canonicalUrl(c.url));
  if (c.pdfUrl) keys.push('url:' + canonicalUrl(c.pdfUrl));
  const t = titleKey(c.title ?? '');
  if (t) keys.push('title:' + t);
  return keys;
}

/** Richness order: has pdfUrl, then has text, then snippet length. */
function richer(a: Candidate, b: Candidate): boolean {
  const pa = a.pdfUrl ? 1 : 0;
  const pb = b.pdfUrl ? 1 : 0;
  if (pa !== pb) return pa > pb;
  const ta = a.text ? 1 : 0;
  const tb = b.text ? 1 : 0;
  if (ta !== tb) return ta > tb;
  return (a.snippet?.length ?? 0) > (b.snippet?.length ?? 0);
}

function sourceIdsOf(c: Candidate): SourceId[] {
  return c.sourceIds && c.sourceIds.length ? c.sourceIds : [c.sourceId];
}

/**
 * Merge `others` into `base`. base's fields win; missing ones are filled from others.
 * keepIdentity: keep base's id and round (merging into a candidate the user may already have seen).
 */
function mergeRecords(base: Candidate, others: Candidate[], keepIdentity: boolean): Candidate {
  const all = [base, ...others];
  const out: Candidate = { ...base, authors: [...(base.authors ?? [])] };

  if (!out.title) out.title = others.find((o) => o.title)?.title ?? '';
  if (out.authors.length === 0) {
    const best = others.reduce<string[]>((acc, o) => ((o.authors?.length ?? 0) > acc.length ? o.authors : acc), []);
    out.authors = [...best];
  }
  for (const o of others) {
    if (!out.pdfUrl && o.pdfUrl) out.pdfUrl = o.pdfUrl;
    if (!out.doi && o.doi) out.doi = o.doi;
    if (!out.publisher && o.publisher) out.publisher = o.publisher;
    if (!out.snippet && o.snippet) out.snippet = o.snippet;
    if (out.searchScore === undefined && o.searchScore !== undefined) out.searchScore = o.searchScore;
    if (!out.published && o.published) out.published = o.published;
    // Prefer a full date over a bare year when they agree on the year.
    else if (out.published && o.published && /^\d{4}$/.test(out.published) && o.published.length > 4 && yearOf(o.published) === yearOf(out.published)) {
      out.published = o.published;
    }
  }
  if (!out.text) {
    const withText = others.filter((o) => o.text).sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0))[0];
    if (withText?.text) out.text = withText.text;
  }

  const cited = all.map((c) => c.citedByCount).filter((n): n is number => typeof n === 'number');
  if (cited.length) out.citedByCount = Math.max(...cited);

  const ids: SourceId[] = [];
  for (const c of all) for (const s of sourceIdsOf(c)) if (!ids.includes(s)) ids.push(s);
  out.sourceIds = ids;

  out.tier = all.reduce((t, c) => betterTier(t, c.tier), base.tier);

  if (all.every((c) => c.forCounter)) out.forCounter = true;
  else delete out.forCounter;
  if (all.every((c) => c.lowQuality)) out.lowQuality = true;
  else delete out.lowQuality;
  if (all.every((c) => c.isWikipedia)) out.isWikipedia = true;
  else delete out.isWikipedia;

  const ranks = all.map((c) => c.searchRank).filter((n): n is number => typeof n === 'number');
  if (ranks.length) out.searchRank = Math.min(...ranks);

  if (keepIdentity) {
    out.id = base.id;
    if (base.round !== undefined) out.round = base.round;
    else {
      const r = others.map((c) => c.round).filter((n): n is number => typeof n === 'number');
      if (r.length) out.round = Math.min(...r);
    }
  } else {
    const rounds = all.map((c) => c.round).filter((n): n is number => typeof n === 'number');
    if (rounds.length) out.round = Math.min(...rounds);
    out.id = candidateIdFor(out);
  }
  return out;
}

/** Group indices of candidates that refer to the same item (transitively), groups in first-seen order. */
function groupIndices(list: Candidate[]): number[][] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const owner = new Map<string, number>();
  list.forEach((c, i) => {
    for (const k of keysOf(c)) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else union(i, j);
    }
  });
  const groups = new Map<number, number[]>();
  list.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/** Collapse duplicates; the richest record of each group is the base, others fill its gaps. */
export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const g of groupIndices(list)) {
    const members = g.map((i) => list[i] as Candidate);
    if (members.length === 1) {
      const only = members[0] as Candidate;
      out.push({ ...only, sourceIds: sourceIdsOf(only) });
      continue;
    }
    let base = members[0] as Candidate;
    for (const m of members.slice(1)) if (richer(m, base)) base = m;
    out.push(
      mergeRecords(
        base,
        members.filter((m) => m !== base),
        false,
      ),
    );
  }
  return out;
}

/**
 * Merge a new round's candidates into the existing list. Never drops or reorders an existing candidate;
 * a match enriches it in place (keeping its id and round). Unmatched newcomers are appended.
 */
export function mergeCandidates(existing: Candidate[], incoming: Candidate[]): Candidate[] {
  const result = existing.map((c) => ({ ...c }));
  const owner = new Map<string, number>();
  const register = (c: Candidate, idx: number) => {
    for (const k of keysOf(c)) if (!owner.has(k)) owner.set(k, idx);
  };
  result.forEach((c, i) => register(c, i));
  for (const inc of dedupeCandidates(incoming)) {
    let idx: number | undefined;
    for (const k of keysOf(inc)) {
      idx = owner.get(k);
      if (idx !== undefined) break;
    }
    if (idx !== undefined) {
      const merged = mergeRecords(result[idx] as Candidate, [inc], true);
      result[idx] = merged;
      register(merged, idx);
    } else {
      result.push(inc);
      register(inc, result.length - 1);
    }
  }
  return result;
}
