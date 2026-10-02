// Canned UI data for unit tests and the screenshot harness. All sources are fictional
// (example.org domains, invented authors) so no real author is quoted.
import type {
  CandidateMeta,
  HistoryEntry,
  JobState,
  PassageFragment,
  Plan,
  Relation,
  Settings,
  SourceResult,
  SourceSummary,
  TextSource,
  VerifiedMatch,
} from '../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

type Part = { text: string; match: boolean };

export function fragment(parts: Part[], page?: number): PassageFragment {
  const text = parts.map((p) => p.text).join('');
  const f: PassageFragment = { sentenceIds: ['d1.s1'], text, parts, charStart: 0, charEnd: text.length };
  if (page !== undefined) f.page = page;
  return f;
}

export function verified(opts: {
  candidateId: string;
  relation: Relation;
  fragments: PassageFragment[];
  reason: string;
  contextBefore?: string;
  contextAfter?: string;
  scopeMismatch?: string;
  confidence?: number;
}): VerifiedMatch {
  const passage = opts.fragments.map((f) => f.text).join(' […] ');
  const m = {
    candidateId: opts.candidateId,
    docId: `doc-${opts.candidateId}`,
    chunkId: `doc-${opts.candidateId}.c1`,
    relation: opts.relation,
    confidence: opts.confidence ?? 0.86,
    reason: opts.reason,
    scopeMismatch: opts.scopeMismatch,
    sentenceIds: opts.fragments.flatMap((f) => f.sentenceIds),
    fragments: opts.fragments,
    passage,
    contextBefore: opts.contextBefore,
    contextAfter: opts.contextAfter,
    verification: { verbatim: true, charStart: 0, charEnd: passage.length, page: opts.fragments[0]?.page },
  };
  // Only verify() may build a VerifiedMatch in production code; fixtures cast.
  return m as unknown as VerifiedMatch;
}

export function result(opts: {
  meta: CandidateMeta;
  best: VerifiedMatch;
  more?: VerifiedMatch[];
  textSource?: TextSource;
  finalUrl?: string;
  round?: number;
  summary?: SourceSummary;
  localScopeNote?: string;
  score?: number;
}): SourceResult {
  const r: SourceResult = {
    candidateId: opts.meta.id,
    meta: opts.meta,
    best: opts.best,
    more: opts.more ?? [],
    score: opts.score ?? 0.8,
    textSource: opts.textSource ?? 'html',
    finalUrl: opts.finalUrl ?? opts.meta.url,
    round: opts.round ?? 1,
  };
  if (opts.summary) r.summary = opts.summary;
  if (opts.localScopeNote) r.localScopeNote = opts.localScopeNote;
  return r;
}

/* ------------------------------ sources ------------------------------ */

const RIVERA: CandidateMeta = {
  id: 'rivera2019',
  sourceId: 'openalex',
  tier: 'peer_reviewed',
  title: 'Minimum Wages and Teen Employment: Evidence from 140 Contiguous County Pairs',
  url: 'https://journals.example.org/jls/article/rivera-2019',
  pdfUrl: 'https://journals.example.org/jls/article/rivera-2019.pdf',
  doi: '10.5555/jls.2019.4417',
  authors: ['Ana Rivera', 'Mei Chen', 'Tomás Okafor'],
  publisher: 'Journal of Labor Studies',
  published: '2019-06-01',
  citedByCount: 212,
};

const NATARAJAN: CandidateMeta = {
  id: 'natarajan2021',
  sourceId: 'exa_papers',
  tier: 'peer_reviewed',
  title: 'Bunching Estimates of Minimum Wage Effects on Low-Wage Jobs',
  url: 'https://review.example.org/rep/2021/bunching-minimum-wage',
  authors: ['Priya Natarajan', 'Jonas Weber'],
  publisher: 'Review of Economic Policy',
  published: '2021-03-15',
};

const FISCAL_OFFICE: CandidateMeta = {
  id: 'ofa2014',
  sourceId: 'exa_policy',
  tier: 'gov_igo',
  title: 'Raising the Minimum Wage: Projected Effects on Employment and Family Income',
  url: 'https://fiscal.example.gov/reports/2014/minimum-wage-projections',
  authors: [],
  publisher: 'Office of Fiscal Analysis',
  published: '2014-02',
};

const HALE: CandidateMeta = {
  id: 'hale2008',
  sourceId: 'semantic_scholar',
  tier: 'peer_reviewed',
  title: 'Minimum Wages and Employment: A Review of the Evidence',
  url: 'https://lequarterly.example.org/articles/hale-simmons-2008',
  authors: ['David Hale', 'Ruth Simmons'],
  publisher: 'Labour Economics Quarterly',
  published: '2008',
};

export const WIKI_META: CandidateMeta = {
  id: 'wiki-mw',
  sourceId: 'exa_web',
  tier: 'web',
  title: 'Minimum wage (encyclopedia article)',
  url: 'https://en.wikipedia.org/wiki/Minimum_wage',
  authors: [],
  publisher: 'Wikipedia',
  isWikipedia: true,
};

export function supportResults(): SourceResult[] {
  return [
    result({
      meta: RIVERA,
      textSource: 'pdf',
      finalUrl: RIVERA.pdfUrl,
      score: 0.93,
      best: verified({
        candidateId: RIVERA.id,
        relation: 'direct',
        reason: 'States the claim directly for teen employment.',
        contextBefore: 'Our design compares adjacent counties that face the same local labor market shocks.',
        contextAfter: 'These results are robust to county-specific trends.',
        fragments: [
          fragment(
            [
              {
                text: 'Across 140 county pairs that straddle state borders, we find no statistically significant decline in teen employment following minimum wage increases of up to 25 percent. ',
                match: true,
              },
              { text: 'Hours worked fall slightly, but the estimate is small and imprecise.', match: false },
            ],
            14,
          ),
        ],
      }),
      more: [
        verified({
          candidateId: RIVERA.id,
          relation: 'partial',
          reason: 'Restaurant jobs only, not all employment.',
          fragments: [fragment([{ text: 'Restaurant employment, the sector most exposed to the minimum wage, shows a point estimate close to zero.', match: true }], 17)],
        }),
      ],
      summary: {
        howItRelates: 'Finds no significant job losses for teens after minimum wage rises.',
        summary:
          'The study compares neighboring counties on opposite sides of state borders. Teen employment did not fall significantly after increases of up to 25 percent. Hours fell slightly.',
        limits: 'US counties only; increases above 25 percent were not studied.',
        tag: 'Minimum wage hikes don’t cost teen jobs — 140 border-county pairs show no significant decline',
        droppedSentences: 0,
        abstractOnly: false,
      },
    }),
    result({
      meta: NATARAJAN,
      round: 2,
      score: 0.84,
      best: verified({
        candidateId: NATARAJAN.id,
        relation: 'paraphrase',
        reason: 'Says job counts held steady overall, in different words.',
        scopeMismatch: 'Counts low-wage jobs, not total employment.',
        contextBefore: 'We track the full distribution of hourly wages around each increase.',
        fragments: [
          fragment([
            {
              text: 'The number of jobs paying below the new minimum fell sharply, but this was almost fully offset by new jobs paying at or slightly above it.',
              match: true,
            },
          ]),
        ],
      }),
      summary: {
        howItRelates: 'Jobs below the new minimum were replaced by jobs just above it.',
        summary: 'Looks at how wages bunch around each new minimum. Lost low-paid jobs were almost fully offset by new ones at or above the minimum.',
        droppedSentences: 0,
        abstractOnly: false,
      },
    }),
    result({
      meta: FISCAL_OFFICE,
      textSource: 'abstract_only',
      score: 0.71,
      localScopeNote: 'Published in 2014, before your timeframe.',
      best: verified({
        candidateId: FISCAL_OFFICE.id,
        relation: 'partial',
        reason: 'Projects only a small job loss: supports a weaker version.',
        fragments: [
          fragment([
            { text: 'In the median projection, a phased increase would reduce employment by a small amount ', match: true },
            { text: 'while raising the earnings of most affected workers.', match: false },
          ]),
        ],
      }),
      summary: {
        howItRelates: 'Projects a small employment loss, not a large one.',
        summary: 'A government projection of a phased minimum wage increase. It expects a small drop in employment and higher earnings for most affected workers.',
        droppedSentences: 0,
        abstractOnly: true,
      },
    }),
  ];
}

export function pushbackResults(): SourceResult[] {
  return [
    result({
      meta: HALE,
      score: 0.77,
      best: verified({
        candidateId: HALE.id,
        relation: 'contradicts',
        reason: 'Reviews many studies and finds job losses.',
        contextAfter: 'We discuss why some case studies reach different conclusions.',
        fragments: [
          fragment([
            {
              text: 'A clear majority of the studies we review find negative employment effects, which are strongest for the least-skilled groups.',
              match: true,
            },
          ]),
        ],
      }),
      summary: {
        howItRelates: 'Argues most studies find job losses, especially for the least skilled.',
        summary: 'A literature review of minimum wage research. Most studies it covers report negative employment effects.',
        limits: 'Covers research up to 2007.',
        droppedSentences: 0,
        abstractOnly: false,
      },
    }),
  ];
}

export function demoPlan(over: Partial<Plan> = {}): Plan {
  return {
    normalizedClaim: 'Raising the minimum wage does not significantly reduce employment.',
    claimType: 'causal',
    coreProposition: 'Minimum wage increases have small or no negative employment effects.',
    paraphrases: ['no disemployment effect', 'employment effects close to zero', 'no significant job losses'],
    keyTerms: ['minimum wage', 'employment', 'disemployment effect'],
    excludeTerms: [],
    constraints: { side: 'support', strength: 'any', regions: ['United States'] },
    queries: { academic: ['minimum wage employment effect'], semantic: [], news: [], policy: [] },
    counterQuery: 'minimum wage increases reduce employment',
    ...over,
  };
}

export function demoState(over: Partial<JobState> = {}): JobState {
  const now = Date.UTC(2026, 9, 2, 9, 30);
  return {
    jobId: 'job_demo_1',
    rawClaim: 'minimum wage hikes don’t really cost jobs',
    mode: 'essay',
    createdAt: now,
    updatedAt: now,
    status: 'ready',
    round: 2,
    maxRounds: 3,
    plan: demoPlan(),
    constraintChips: ['United States', 'Correlational OK'],
    support: supportResults(),
    pushback: pushbackResults(),
    refine: {
      round: 2,
      coverageNote: '4 sources · mostly US studies 2008–2021 · 1 contradicts',
      questions: [
        {
          id: 'q-region',
          text: 'These are all US studies. Want sources from elsewhere?',
          kind: 'choice',
          options: ['Southeast Asia', 'Europe', 'Any country', 'Keep as is'],
          why: 'Every result studies US states or counties.',
          affects: 'regions',
        },
        {
          id: 'q-strength',
          text: 'Is “associated with” enough, or do you need causal evidence?',
          kind: 'choice',
          options: ['Causal only', 'Correlational is fine', 'Keep as is'],
          why: 'Two results are projections or correlations, not causal designs.',
          affects: 'strength',
        },
        {
          id: 'q-years',
          text: 'Any timeframe you need?',
          kind: 'text',
          why: 'One source is from 2014 and one from 2008.',
          affects: 'years',
        },
      ],
    },
    refineDismissed: false,
    answers: [{ round: 1, answers: [{ questionId: 'q0', question: 'Which country?', answer: 'United States' }] }],
    progress: { stage: 'ready', message: 'Done. Pick the sources that fit your argument.', percent: 100 },
    warnings: [
      { code: 's2_limited', message: 'Semantic Scholar is busy, so it was skipped for this search.' },
      { code: 'no_host_permission', message: 'Backed can’t open web pages itself, so some sources show their abstract only.' },
    ],
    notRelevant: [],
    picked: [],
    academicOnly: false,
    valuesClaim: false,
    debug: {
      fabricatedIdsDropped: 2,
      unverifiedDropped: 1,
      injectionSentencesBlocked: 0,
      batchesSkipped: 0,
      llmCalls: 9,
      tokensIn: 41250,
      tokensOut: 3120,
      llmCostUsd: 0.01612,
      exaCostUsd: 0.0125,
      candidatesFound: 37,
      docsRead: 14,
      chunksMatched: 25,
      adapterCounts: { openalex: 8, semantic_scholar: 0, exa_papers: 6, exa_policy: 4 },
      timingsMs: { plan: 2140, search1: 3380, read1: 6020, match1: 7410, refine1: 2650 },
      firstResultMs: 11840,
    },
    ...over,
  };
}

/** Mid-round 2: translated claim, progress bar, refine card collapsed to "Refining: …". */
export function runningState(): JobState {
  const s = demoState({
    status: 'matching',
    rawClaim: 'Tăng lương tối thiểu không làm giảm đáng kể việc làm.',
    plan: demoPlan({ inputLanguage: 'Vietnamese' }),
    refining: 'Refining: Southeast Asia, Causal only',
    refine: undefined,
    progress: { stage: 'matching', message: 'Checked 3 of 5 batches · 4 verified', percent: 72 },
    warnings: [],
    academicOnly: true,
    valuesClaim: false,
  });
  s.support = s.support.map((r) => ({ ...r, summary: undefined }) as SourceResult);
  return s;
}

export function emptyState(): JobState {
  return demoState({
    status: 'ready',
    round: 1,
    support: [],
    pushback: [],
    refine: undefined,
    warnings: [],
    progress: { stage: 'ready', message: 'Nothing solid found.', percent: 100 },
    error: undefined,
  });
}

export function demoSettings(over: Partial<Settings> = {}): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), deepseekKey: 'sk-demo-not-a-real-key', exaKey: '', ...over };
}

export function demoHistory(): HistoryEntry[] {
  const s = demoState();
  return [
    {
      jobId: 'job_hist_1',
      claim: s.rawClaim,
      normalizedClaim: s.plan?.normalizedClaim,
      mode: 'essay',
      answers: s.answers,
      picked: [s.support[0] as SourceResult, s.support[1] as SourceResult],
      outputs: { markdown: '# demo' },
      savedAt: Date.UTC(2026, 9, 1, 15, 0),
    },
    {
      jobId: 'job_hist_2',
      claim: 'Nuclear deterrence reduces the likelihood of great-power war.',
      mode: 'debate',
      answers: [],
      picked: [s.pushback[0] as SourceResult],
      outputs: { markdown: '# demo' },
      savedAt: Date.UTC(2026, 8, 28, 11, 0),
    },
  ];
}
