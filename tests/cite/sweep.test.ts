import { describe, expect, it } from 'vitest';
import {
  exportMarkdown,
  formatAll,
  formatCitation,
  formatDebateCard,
  formatDebateCite,
  formatForMode,
  formatInText,
  formatLinkSummaryQuote,
  type CiteStyle,
  type PageRef,
} from '../../src/shared/cite';
import type { CandidateMeta, Relation, SourceTier, VerifiedMatch } from '../../src/shared/types';
import { ACCESSED, expectClean, frag, fragParts, match, meta, result, summary } from './helpers';

const TIERS: SourceTier[] = ['peer_reviewed', 'preprint', 'gov_igo', 'think_tank', 'major_news', 'web'];

/** Sparse and odd metadata as adapters actually produce it. */
const ODD: Array<Partial<CandidateMeta>> = [
  { title: '', url: '', authors: [] },
  { title: 'undefined', url: 'undefined', authors: ['undefined', 'null', ''], publisher: 'null', published: 'NaN', doi: 'undefined' },
  { title: '   ', authors: ['By ', '   ', 'Anonymous', 'Unknown author'], published: 'garbage' },
  { title: '...', url: 'https://www.example.com/x', published: '2019-13-45' },
  { title: 'Ends with a period.', authors: ['Smith, J.'], publisher: 'Journal of Things.', published: '2018-00-00' },
  { title: 'Many authors', authors: Array.from({ length: 25 }, (_, i) => `Given${i} Family${i}`), publisher: 'Big Science', published: '2021' },
  { title: 'Org twice', authors: ['World Bank'], publisher: 'The World Bank', published: '2019' },
  { title: 'Why do wages stick?', authors: [], publisher: '' },
  { title: 'Wow!', authors: ['Jane Doe', 'John Roe', 'Ann Poe', 'Bo Lo'], publisher: 'Outlet', published: '2020-03' },
  { title: 'Bad link', url: 'javascript:alert(1)', doi: 'doi: 10.1000/xyz', authors: ['Jane Doe'] },
  { title: 'Dupes', authors: ['Card, David', 'David Card', 'Jane Doe and John Smith'] },
  { title: 'Reuters suffix | Reuters', publisher: 'Reuters', published: '2020-03-05T12:00:00Z', authors: ['Reuters'] },
  { title: '“Quoted title.”', authors: ['Martin Luther King, Jr.'], published: '1963' },
  { title: 'Acme report', authors: ['Acme Inc.'], publisher: 'Acme Inc.', published: '2017' },
  { title: 'Trailing commas,,', authors: ['Doe, Jane,'], publisher: 'Pub,', published: '2015' },
  { title: 'No url no doi', url: '', doi: '', authors: ['Jane Doe'], publisher: 'Somewhere' },
  { title: 'Weird date', published: 'March 5, 2020', authors: ['OECD'] },
  { title: 'Single name', authors: ['Plato'], published: '0380' },
  { title: 'Bad DOI', doi: 'not-a-doi', authors: ['Jane Doe'], published: '2001' },
  { title: 'Particles', authors: ['Ludwig van Beethoven', 'Beethoven, Ludwig van'], published: '1820' },
];

/** Authors that are not even an array (runtime junk from storage). */
const NOT_ARRAY = { ...meta(), authors: undefined } as unknown as CandidateMeta;

const ALL_METAS: CandidateMeta[] = [
  NOT_ARRAY,
  ...ODD.flatMap((over, i) => TIERS.map((tier) => meta({ id: `odd${i}`, tier, ...over }))),
];

const PAGES: Array<PageRef | undefined> = [undefined, { from: 3 }, { from: 12, to: 13 }];
const STYLES: CiteStyle[] = ['apa', 'chicago', 'mla'];
const RELATIONS: Relation[] = ['direct', 'paraphrase', 'partial', 'contradicts'];

const MATCHES: VerifiedMatch[] = [
  match(),
  match({ relation: 'paraphrase', fragments: [frag('One.', { page: 2 }), frag('Two.', { page: 3 })], page: 2, contextBefore: 'Before.', contextAfter: 'After.' }),
  match({ relation: 'partial', fragments: [fragParts([{ text: 'Hit.', match: true }, { text: ' Gap.\n', match: false }, { text: 'Hit two.', match: true }])] }),
  match({ relation: 'contradicts', fragments: [], passage: 'Only a passage.', contextBefore: '  ', contextAfter: '' }),
];

function check(label: string, s: string | undefined): void {
  if (s === undefined) return;
  expectClean(s, label);
  for (const line of s.split('\n')) {
    expect(line, `${label}: untrimmed line`).toBe(line.trim());
    expect(line.includes('  '), `${label}: double space in ${JSON.stringify(line)}`).toBe(false);
  }
}

describe('sparse / odd metadata never produces junk', () => {
  it(`citations and in-text (${ALL_METAS.length} metas × 3 styles × 3 page refs × 2 access dates)`, () => {
    for (const m of ALL_METAS) {
      for (const style of STYLES) {
        for (const pages of PAGES) {
          for (const accessed of [undefined, ACCESSED]) {
            const f = formatCitation(m, style, { pages, accessed });
            check(`${style} citation ${m.title}`, f.text);
            check(`${style} citation html ${m.title}`, f.html);
            expect(f.text.length).toBeGreaterThan(0);
          }
          const it = formatInText(m, style, { pages });
          check(`${style} in-text ${m.title}`, it);
          expect(it).toMatch(/^\(.+\)$/);
        }
      }
    }
  });

  it('debate cites with valid and invalid access dates', () => {
    for (const m of ALL_METAS) {
      for (const accessed of [ACCESSED, new Date(Number.NaN)]) {
        const f = formatDebateCite(m, accessed);
        check(`debate cite ${m.title}`, f.text);
        check(`debate cite html ${m.title}`, f.html);
        expect(f.text).not.toMatch(/^,|,$/);
      }
    }
  });

  it('every per-result output in every mode', () => {
    const summaries = [undefined, summary(), summary({ tag: '', howItRelates: '', summary: '', limits: '' })];
    for (const m of ALL_METAS) {
      MATCHES.forEach((best, i) => {
        const s = summaries[i % summaries.length];
        const r = result({ meta: m, best, textSource: i % 2 === 0 ? 'pdf' : 'html', summary: s });
        for (const mode of ['paper', 'essay', 'debate'] as const) {
          for (const honestyLine of [true, false]) {
            const out = formatForMode(r, mode, { styles: { paper: 'chicago', essay: 'mla' }, accessed: ACCESSED, honestyLine });
            for (const [k, v] of Object.entries(out)) {
              if (typeof v === 'string') check(`${mode} ${k}`, v);
              else if (v) {
                check(`${mode} ${k} text`, v.text);
                check(`${mode} ${k} html`, v.html);
              }
            }
          }
        }
        check('card', formatDebateCard(r, { accessed: new Date(Number.NaN), honestyLine: true }).text);
        check('lsq', formatLinkSummaryQuote(r, { honestyLine: true }).text);
      });
    }
  });

  it('Copy all and Markdown export over the whole odd set', () => {
    const results = ALL_METAS.map((m, i) =>
      result({ meta: m, best: MATCHES[i % MATCHES.length] ?? match(), textSource: i % 3 === 0 ? 'pdf' : 'exa' }),
    );
    const all = formatAll(results, { honestyLine: true });
    check('all text', all.text.replace(/\n\n/g, '\n'));
    check('all html', all.html);
    for (const mode of ['paper', 'essay', 'debate'] as const) {
      const md = exportMarkdown({ claim: '  A claim\nwith  breaks ', mode, results, styles: { paper: 'apa', essay: 'apa' }, accessed: ACCESSED, honestyLine: true });
      expectClean(md, `markdown ${mode}`);
      expect(md.startsWith('# A claim with breaks\n')).toBe(true);
    }
  });

  it('relations × honesty line never leak junk', () => {
    for (const relation of RELATIONS) {
      const r = result({ best: match({ relation }), summary: summary() });
      for (const honestyLine of [true, false]) {
        check(relation, formatDebateCard(r, { accessed: ACCESSED, honestyLine }).text);
        check(relation, formatLinkSummaryQuote(r, { honestyLine }).text);
      }
    }
  });
});
