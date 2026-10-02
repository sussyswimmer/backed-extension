// Debate cite and debate card.

import type { CandidateMeta, SourceResult } from '../types';
import { debateAuthorList } from './names';
import { cardPassageSegs, honestyLine } from './quote';
import { bold, italic, plain, renderParas, urlSeg, type Formatted, type Para, type Seg } from './rich';
import { buildWork, clean, dateOf, endsWithTerminal, isValidDate, longDate } from './work';

/**
 * `Author, Year, "Title," Publication, URL, accessed DATE` — credentials are never known, so that
 * slot is left out; missing parts are dropped without leaving empty commas. Author and year are bold.
 */
export function debateCiteSegs(meta: CandidateMeta, accessed: Date | undefined): Seg[] {
  const work = buildWork(meta);
  const parts: Array<{ segs: Seg[]; title?: boolean }> = [];
  const author = debateAuthorList(work.authors);
  if (author) parts.push({ segs: [bold(author)] });
  if (work.date.year) parts.push({ segs: [bold(String(work.date.year))] });
  parts.push({ segs: [], title: true });
  if (work.container) parts.push({ segs: [plain(work.container)] });
  if (work.locator) parts.push({ segs: [urlSeg(work.locator)] });
  if (isValidDate(accessed)) parts.push({ segs: [plain(`accessed ${longDate(dateOf(accessed)) ?? ''}`)] });

  const out: Seg[] = [];
  parts.forEach((part, i) => {
    const prevWasTitle = i > 0 && parts[i - 1]?.title === true;
    if (i > 0) out.push(plain(prevWasTitle ? ' ' : ', '));
    if (part.title) {
      // American style: the comma goes inside the quotes ("Title,"); a ? or ! replaces it.
      const hasNext = i < parts.length - 1;
      const punct = hasNext && !endsWithTerminal(work.title) ? ',' : '';
      out.push(plain(`"${work.title}${punct}"`));
    } else {
      out.push(...part.segs);
    }
  });
  return out;
}

export function formatDebateCite(meta: CandidateMeta, accessed: Date): Formatted {
  return renderParas([{ segs: debateCiteSegs(meta, accessed) }]);
}

/** The debate tag: the user's claim in their framing (summary.tag), else the howItRelates line. */
export function debateTag(result: SourceResult): string | undefined {
  return clean(result.summary?.tag) ?? clean(result.summary?.howItRelates);
}

export function debateCardParas(result: SourceResult, opts: { accessed: Date; honestyLine: boolean }): Para[] {
  const paras: Para[] = [];
  const tag = debateTag(result);
  if (tag) paras.push({ segs: [bold(tag)] });
  paras.push({ segs: debateCiteSegs(result.meta, opts.accessed) });
  const honesty = opts.honestyLine ? honestyLine(result.best.relation) : undefined;
  if (honesty) paras.push({ segs: [italic(honesty)] });
  paras.push({ segs: cardPassageSegs(result.best) });
  return paras;
}

/** Tag (bold) / cite / optional honesty line (italic) / passage with matching sentences bold + underlined. */
export function formatDebateCard(result: SourceResult, opts: { accessed: Date; honestyLine: boolean }): Formatted {
  return renderParas(debateCardParas(result, opts));
}
