// Turns a verified match into display segments: dimmed context, highlighted matching sentences,
// normal gap sentences, and " […] " between fragments. Text only — rendered through React.
import type { VerifiedMatchFields } from '../../shared/types';

export type QuoteSegKind = 'context' | 'match' | 'text' | 'gap';

export interface QuoteSeg {
  text: string;
  kind: QuoteSegKind;
}

export const FRAGMENT_GAP = ' […] ';

export type QuotableMatch = Pick<VerifiedMatchFields, 'fragments' | 'passage' | 'contextBefore' | 'contextAfter'>;

/**
 * Whitespace is collapsed across the whole run (as if it were one string), edge spaces are moved
 * out of highlighted parts so the marker never covers a space, and adjacent segments of the same
 * kind are merged.
 */
export function quoteSegments(m: QuotableMatch, opts: { context?: boolean } = {}): QuoteSeg[] {
  const withContext = opts.context ?? true;
  const raw: QuoteSeg[] = [];
  const before = withContext ? clean(m.contextBefore) : '';
  const after = withContext ? clean(m.contextAfter) : '';

  if (before) raw.push({ text: before, kind: 'context' }, { text: ' ', kind: 'text' });

  const fragments = (m.fragments ?? []).filter((f) => typeof f.text === 'string' && f.text.trim());
  if (fragments.length === 0) {
    const passage = clean(m.passage);
    if (passage) raw.push({ text: passage, kind: 'match' });
  }
  fragments.forEach((f, i) => {
    if (i > 0) raw.push({ text: FRAGMENT_GAP, kind: 'gap' });
    const parts = Array.isArray(f.parts) && f.parts.length > 0 ? f.parts : [{ text: f.text, match: true }];
    for (const p of parts) raw.push({ text: typeof p.text === 'string' ? p.text : '', kind: p.match ? 'match' : 'text' });
  });

  if (after) raw.push({ text: ' ', kind: 'text' }, { text: after, kind: 'context' });
  return normalize(raw);
}

/** The words of the quotation alone (no context), as one string. */
export function quoteText(m: QuotableMatch): string {
  return quoteSegments(m, { context: false })
    .map((s) => s.text)
    .join('');
}

function clean(s: string | undefined): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function normalize(segs: QuoteSeg[]): QuoteSeg[] {
  const out: QuoteSeg[] = [];
  let endsWithSpace = true; // drop leading whitespace
  const push = (text: string, kind: QuoteSegKind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
    endsWithSpace = text.endsWith(' ');
  };
  for (const seg of segs) {
    let text = seg.text.replace(/\s+/g, ' ');
    if (endsWithSpace) text = text.replace(/^ /, '');
    if (!text) continue;
    if (seg.kind !== 'match' && seg.kind !== 'context') {
      push(text, seg.kind);
      continue;
    }
    const lead = text.startsWith(' ');
    const trail = text.length > 1 && text.endsWith(' ');
    const core = text.slice(lead ? 1 : 0, trail ? -1 : undefined);
    if (lead) push(' ', 'text');
    push(core, seg.kind);
    if (trail) push(' ', 'text');
  }
  // Trim trailing whitespace.
  while (out.length) {
    const last = out[out.length - 1];
    if (!last) break;
    const t = last.text.replace(/ +$/, '');
    if (t) {
      last.text = t;
      break;
    }
    out.pop();
  }
  return out;
}
