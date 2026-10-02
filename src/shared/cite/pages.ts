// Page references for passages that came from a PDF.

import type { VerifiedMatch } from '../types';

export type PageRef = { from: number; to?: number };

const isPage = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Pages the passage sits on: fragments' page/pageEnd and verification.page; a span gives from/to. */
export function pagesOf(match: VerifiedMatch): PageRef | undefined {
  const candidates: unknown[] = [match.verification?.page];
  for (const f of match.fragments ?? []) candidates.push(f.page, f.pageEnd);
  const pages = candidates.filter(isPage);
  if (pages.length === 0) return undefined;
  const from = Math.min(...pages);
  const to = Math.max(...pages);
  return to > from ? { from, to } : { from };
}

/** Validate a caller-supplied PageRef: positive integers, ordered, `to` only when it is a real span. */
export function validPages(p: PageRef | undefined): PageRef | undefined {
  if (!p || !isPage(p.from)) return undefined;
  if (!isPage(p.to) || p.to === p.from) return { from: p.from };
  return { from: Math.min(p.from, p.to), to: Math.max(p.from, p.to) };
}

/** "790" / "12–13" (en dash). */
export function pageRange(p: PageRef): string {
  return p.to ? `${p.from}–${p.to}` : String(p.from);
}

/** APA locator: "p. 790" / "pp. 12–13". */
export function apaPages(p: PageRef): string {
  return p.to ? `pp. ${pageRange(p)}` : `p. ${p.from}`;
}

/** MLA abbreviated range: 790–91, 1103–04, 12–13, 98–102. */
export function mlaPageRange(p: PageRef): string {
  if (!p.to) return String(p.from);
  const a = String(p.from);
  const b = String(p.to);
  if (p.from < 100 || a.length !== b.length) return `${a}–${b}`;
  let i = 0;
  while (i < b.length - 2 && a[i] === b[i]) i++;
  return `${a}–${b.slice(i)}`;
}
