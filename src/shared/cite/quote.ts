// Quotations of the verified passage, per output mode, plus relation labels and honesty lines.

import type { OutputMode, Relation, SourceResult, VerifiedMatch } from '../types';
import { countWords, normalizeWs } from '../text';
import { BLOCK_INDENT, plain, renderInline, renderParas, type Formatted, type Seg } from './rich';
import { clean } from './work';

/** Joiner between non-contiguous fragments (same as the matcher uses for `passage`). */
export const FRAGMENT_JOIN = ' […] ';

/** Paper mode switches from an inline quote to a block quote at this many words. */
export const BLOCK_QUOTE_WORDS = 40;

const HONESTY: Record<Relation, string | undefined> = {
  direct: undefined,
  paraphrase: 'Paraphrase match: the source supports this idea in different words.',
  partial: 'Partial: supports a weaker version.',
  contradicts: 'Contradicts: the source argues against this claim.',
};

/** The disclaimer shown when the source does not state the claim directly. */
export function honestyLine(relation: Relation): string | undefined {
  return HONESTY[relation];
}

const LABELS: Record<Relation, string> = {
  direct: 'Direct',
  paraphrase: 'Paraphrase',
  partial: 'Partial',
  contradicts: 'Contradicts',
};

/** Short badge text: Direct / Paraphrase / Partial / Contradicts. */
export function relationLabel(relation: Relation): string {
  return LABELS[relation] ?? 'Match';
}

/** The verified passage, whitespace collapsed. */
export function passageText(best: VerifiedMatch): string {
  return normalizeWs(typeof best.passage === 'string' ? best.passage : '');
}

/** The matching fragments' verbatim text (whitespace collapsed); falls back to the passage. */
export function fragmentTexts(best: VerifiedMatch): string[] {
  const texts = (best.fragments ?? []).map((f) => normalizeWs(f.text ?? '')).filter(Boolean);
  return texts.length > 0 ? texts : [passageText(best)].filter(Boolean);
}

/**
 * Debate-card passage: context in reduced font, matching sentences bold + underlined,
 * gap sentences inside a fragment in normal weight and size, fragments joined with " […] ".
 */
export function cardPassageSegs(best: VerifiedMatch): Seg[] {
  const segs: Seg[] = [];
  const before = clean(best.contextBefore);
  const after = clean(best.contextAfter);
  if (before) segs.push({ text: before, small: true }, plain(' '));
  const fragments = (best.fragments ?? []).filter((f) => normalizeWs(f.text ?? ''));
  if (fragments.length === 0) {
    segs.push({ text: passageText(best), bold: true, underline: true });
  }
  fragments.forEach((f, i) => {
    if (i > 0) segs.push(plain(FRAGMENT_JOIN));
    const parts = Array.isArray(f.parts) && f.parts.length > 0 ? f.parts : [{ text: f.text, match: true }];
    for (const part of parts) {
      segs.push(part.match ? { text: part.text, bold: true, underline: true } : plain(part.text));
    }
  });
  if (after) segs.push(plain(' '), { text: after, small: true });
  return segs;
}

export function inlineQuote(text: string): Formatted {
  return renderInline([plain(`"${text}"`)]);
}

/**
 * Paper: block quote (no quotation marks, indented) when ≥ 40 words, else an inline "quote".
 * Essay: only the matching fragments, joined with " […] ", inline.
 * Debate: the card passage (context small, matching sentences bold + underlined).
 */
export function formatQuote(result: SourceResult, mode: OutputMode): Formatted {
  const best = result.best;
  if (mode === 'debate') return renderParas([{ segs: cardPassageSegs(best) }]);
  if (mode === 'essay') return inlineQuote(fragmentTexts(best).join(FRAGMENT_JOIN));
  const passage = passageText(best);
  if (countWords(passage) >= BLOCK_QUOTE_WORDS) {
    return renderParas([{ segs: [plain(passage)], style: BLOCK_INDENT }]);
  }
  return inlineQuote(passage);
}
