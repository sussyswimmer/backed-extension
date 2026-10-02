// Small text helpers shared by extraction, verification and the UI.

/** Collapse all whitespace runs to single spaces and trim. Used for verbatim comparisons. */
export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a whole document while keeping paragraph breaks:
 * NFC, unify newlines, NBSP/zero-width -> space/nothing, collapse spaces, max one blank line.
 * Sentence offsets are computed against the output of this function.
 */
export function normalizeDocText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** FNV-1a 32-bit hash as 8 hex chars. Stable across runs, good enough for ids. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function yearOf(published?: string): number | undefined {
  if (!published) return undefined;
  const m = /(\d{4})/.exec(published);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y > 1500 && y < 2200 ? y : undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}
