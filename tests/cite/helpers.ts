import { expect } from 'vitest';
import type {
  CandidateMeta,
  PassageFragment,
  Relation,
  SourceResult,
  SourceSummary,
  TextSource,
  VerifiedMatch,
} from '../../src/shared/types';

/** Local-time date so formatted access dates don't depend on the test machine's time zone. */
export const ACCESSED = new Date(2026, 9, 2);

export function meta(over: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    id: 'c1',
    sourceId: 'exa_web',
    tier: 'web',
    title: 'A Title',
    url: 'https://example.org/page',
    authors: [],
    ...over,
  };
}

export const CARD_KRUEGER = meta({
  id: 'card',
  sourceId: 'openalex',
  tier: 'peer_reviewed',
  title: 'Minimum Wages and Employment: A Case Study of the Fast-Food Industry in New Jersey and Pennsylvania',
  url: 'https://www.jstor.org/stable/2118030',
  doi: 'https://doi.org/10.1257/aer.84.4.772',
  authors: ['David Card', 'Alan B. Krueger'],
  publisher: 'American Economic Review',
  published: '1994-09-01',
});
export const CARD_TITLE = CARD_KRUEGER.title;
export const CARD_DOI_URL = 'https://doi.org/10.1257/aer.84.4.772';

export const REUTERS_URL = 'https://www.reuters.com/business/minimum-wage-study-2020-03-05/';
export const REUTERS = meta({
  id: 'reuters',
  sourceId: 'exa_news',
  tier: 'major_news',
  title: 'Minimum wage hikes did not cut jobs, study finds | Reuters',
  url: REUTERS_URL,
  authors: ['By Jane Doe'],
  publisher: 'Reuters',
  published: '2020-03-05',
});

export const WDR_TITLE = 'World Development Report 2019: The Changing Nature of Work';
export const WDR_DOI_URL = 'https://doi.org/10.1596/978-1-4648-1328-3';
export const WORLD_BANK = meta({
  id: 'wdr',
  sourceId: 'exa_policy',
  tier: 'gov_igo',
  title: WDR_TITLE,
  url: 'https://www.worldbank.org/en/publication/wdr2019',
  doi: '10.1596/978-1-4648-1328-3',
  authors: [],
  publisher: 'World Bank',
  published: '2019',
});

export const WEB_NO_DATE = meta({
  id: 'web',
  sourceId: 'exa_web',
  tier: 'web',
  title: 'How to Read a Minimum Wage Study',
  url: 'https://example.org/guide',
  authors: ['Jane Doe'],
  publisher: 'Example Blog',
});

type Part = { text: string; match: boolean };

/** A fragment whose `parts` default to one matching part covering the whole text. */
export function frag(text: string, opts: { page?: number; pageEnd?: number; parts?: Part[] } = {}): PassageFragment {
  const f: PassageFragment = {
    sentenceIds: ['d1.s1'],
    text,
    parts: opts.parts ?? [{ text, match: true }],
    charStart: 0,
    charEnd: text.length,
  };
  if (opts.page !== undefined) f.page = opts.page;
  if (opts.pageEnd !== undefined) f.pageEnd = opts.pageEnd;
  return f;
}

/** A fragment built from parts (text = parts joined, as the matcher guarantees). */
export function fragParts(parts: Part[], opts: { page?: number; pageEnd?: number } = {}): PassageFragment {
  return frag(parts.map((p) => p.text).join(''), { ...opts, parts });
}

export function match(
  opts: {
    fragments?: PassageFragment[];
    passage?: string;
    relation?: Relation;
    contextBefore?: string;
    contextAfter?: string;
    page?: number;
  } = {},
): VerifiedMatch {
  const fragments = opts.fragments ?? [frag('Raising the minimum wage did not reduce employment.')];
  const passage = opts.passage ?? fragments.map((f) => f.text).join(' […] ');
  const m = {
    candidateId: 'c1',
    docId: 'd1',
    chunkId: 'd1.c1',
    relation: opts.relation ?? 'direct',
    confidence: 0.9,
    reason: 'States the claim.',
    sentenceIds: fragments.flatMap((f) => f.sentenceIds),
    fragments,
    passage,
    contextBefore: opts.contextBefore,
    contextAfter: opts.contextAfter,
    verification: { verbatim: true, charStart: 0, charEnd: passage.length, page: opts.page },
  };
  return m as unknown as VerifiedMatch;
}

export function summary(over: Partial<SourceSummary> = {}): SourceSummary {
  return {
    summary: 'The study compares fast-food employment in two states. It finds no job losses.',
    howItRelates: 'Finds no job losses after a minimum wage rise',
    droppedSentences: 0,
    abstractOnly: false,
    ...over,
  };
}

export function result(
  opts: {
    meta?: CandidateMeta;
    best?: VerifiedMatch;
    textSource?: TextSource;
    finalUrl?: string;
    summary?: SourceSummary;
  } = {},
): SourceResult {
  const m = opts.meta ?? CARD_KRUEGER;
  const r: SourceResult = {
    candidateId: m.id,
    meta: m,
    best: opts.best ?? match(),
    more: [],
    score: 0.9,
    textSource: opts.textSource ?? 'html',
    finalUrl: opts.finalUrl ?? m.url,
    round: 1,
  };
  if (opts.summary) r.summary = opts.summary;
  return r;
}

export function words(n: number, prefix = 'word'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(' ');
}

/** Substrings that must never appear in any formatter output. */
export const FORBIDDEN = ['undefined', 'null', 'NaN', '()', ' ,', ',,', '. .', '..', ',.', ' .'];

export function expectClean(s: string, label = ''): void {
  for (const bad of FORBIDDEN) {
    expect(s.includes(bad), `${label} contains ${JSON.stringify(bad)}: ${s}`).toBe(false);
  }
}

/** Strip tags and decode the entities escapeHtml produces (for comparing HTML to text). */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
