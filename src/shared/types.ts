// Core domain types shared by the service worker, offscreen document, content script and popup.
// Everything here must be JSON-serializable: it crosses chrome.runtime messaging and storage.

export type OutputMode = 'paper' | 'essay' | 'debate';

export type SourceTier = 'peer_reviewed' | 'preprint' | 'gov_igo' | 'think_tank' | 'major_news' | 'web';

export type SourceId =
  | 'openalex'
  | 'semantic_scholar'
  | 'arxiv'
  | 'exa_web'
  | 'exa_news'
  | 'exa_policy'
  | 'exa_papers';

export const ALL_SOURCE_IDS: readonly SourceId[] = [
  'openalex',
  'semantic_scholar',
  'arxiv',
  'exa_web',
  'exa_news',
  'exa_policy',
  'exa_papers',
] as const;

export const EXA_SOURCE_IDS: readonly SourceId[] = ['exa_web', 'exa_news', 'exa_policy', 'exa_papers'] as const;

export type ClaimType = 'empirical' | 'causal' | 'statistical' | 'normative' | 'definitional' | 'prediction';

export interface PlanConstraints {
  yearFrom?: number;
  yearTo?: number;
  regions?: string[];
  side: 'support' | 'attack' | 'either';
  strength: 'causal' | 'associational' | 'any';
}

export interface Plan {
  normalizedClaim: string;
  claimType: ClaimType;
  coreProposition: string;
  paraphrases: string[];
  keyTerms: string[];
  excludeTerms: string[];
  constraints: PlanConstraints;
  queries: {
    academic: string[];
    semantic: string[];
    news: string[];
    policy: string[];
  };
  counterQuery: string;
  multipleClaims?: string[];
  /** Broad field hints, e.g. ["economics"], ["computer science"]. Used to decide whether arXiv runs. */
  domains?: string[];
  /** Set when the raw claim was not in English: the language it was written in. */
  inputLanguage?: string;
}

export interface Candidate {
  /** Stable hash of DOI or canonical URL. */
  id: string;
  sourceId: SourceId;
  /** Every adapter that returned this candidate (after dedupe). */
  sourceIds?: SourceId[];
  tier: SourceTier;
  title: string;
  /** Landing page. */
  url: string;
  pdfUrl?: string;
  doi?: string;
  authors: string[];
  /** Journal, outlet or organization. */
  publisher?: string;
  /** ISO date or year. */
  published?: string;
  /** Abstract or search snippet. */
  snippet?: string;
  citedByCount?: number;
  /** Full page text returned by the search API (Exa contents). */
  text?: string;
  /** Came from the counterQuery. */
  forCounter?: boolean;
  /** Search engine relevance (Exa), higher is better, only comparable within one response. */
  searchScore?: number;
  /** Position in the adapter's result list (0-based). */
  searchRank?: number;
  lowQuality?: boolean;
  /** Wikipedia: allowed but tagged "use to find the real source". */
  isWikipedia?: boolean;
  /** Search round in which this candidate first appeared (1-based). */
  round?: number;
}

export interface SourceAdapter {
  id: SourceId;
  needsExaKey: boolean;
  /**
   * Deterministic description of the request(s) this adapter would send for a plan.
   * Re-search rounds only re-run adapters whose signature changed.
   */
  signature(plan: Plan): string;
  search(plan: Plan, opts: AdapterSearchOptions): Promise<Candidate[]>;
}

export interface AdapterSearchOptions {
  limit: number;
  signal: AbortSignal;
  /** Search with the plan's counterQuery instead of its normal queries. */
  counter?: boolean;
  /** Report money spent by this call (Exa returns costDollars). */
  onCost?: (usd: number) => void;
}

/** Error thrown by adapters so the orchestrator can decide what to skip for the rest of the job. */
export type AdapterErrorKind = 'auth' | 'rate_limited' | 'out_of_credits' | 'timeout' | 'bad_response' | 'network';

export type TextSource = 'pdf' | 'exa' | 'html' | 'abstract_only';

export interface Sentence {
  /** e.g. "d3.s41" */
  id: string;
  /** Exact text, equal to doc.text.slice(start, end). */
  text: string;
  start: number;
  end: number;
  page?: number;
}

export interface DocText {
  /** e.g. "d3" — unique within a job. */
  docId: string;
  candidateId: string;
  /** Normalized document text. Sentence offsets point into this string. */
  text: string;
  sentences: Sentence[];
  textSource: TextSource;
  /** URL after redirects (or the candidate URL for exa/abstract text). */
  finalUrl: string;
  fetchedAt: string;
  title?: string;
  byline?: string;
  published?: string;
  /** For PDFs: total pages in the file and which pages were kept. */
  pageCount?: number;
  pagesKept?: number[];
  /** Why we fell back (e.g. "403", "paywall", "too short"). */
  fallbackReason?: string;
}

export interface Chunk {
  /** e.g. "d3.c7" */
  id: string;
  docId: string;
  /** Inclusive sentence index range into doc.sentences. */
  sentenceStart: number;
  sentenceEnd: number;
  page?: number;
}

export type Relation = 'direct' | 'paraphrase' | 'partial' | 'contradicts';
export type MatchRelation = Relation | 'irrelevant';

export interface PassageFragment {
  /** Every sentence in the span, including gap sentences (≤ 2) between matching ones. */
  sentenceIds: string[];
  /** Exact slice doc.text.slice(charStart, charEnd). */
  text: string;
  /** `text` split into matching / non-matching pieces: parts.map(p => p.text).join('') === text. */
  parts: Array<{ text: string; match: boolean }>;
  charStart: number;
  charEnd: number;
  page?: number;
  /** Last page when the fragment spans a page break (PDF). */
  pageEnd?: number;
}

export interface Verification {
  verbatim: true;
  charStart: number;
  charEnd: number;
  page?: number;
}

declare const VERIFIED: unique symbol;

export interface VerifiedMatchFields {
  candidateId: string;
  docId: string;
  chunkId: string;
  relation: Relation;
  confidence: number;
  reason: string;
  scopeMismatch?: string;
  sentenceIds: string[];
  /** One fragment when the sentences are contiguous (gap ≤ 2), several otherwise. */
  fragments: PassageFragment[];
  /** Fragments joined with " […] ". Built only from our stored sentences. */
  passage: string;
  /** One sentence of context on each side (display only, dimmed). */
  contextBefore?: string;
  contextAfter?: string;
  verification: Verification;
}

/**
 * A match whose passage was proven to be a verbatim substring of the source text.
 * Only `verify()` in src/background/match/verify.ts may construct one (enforced by a test).
 */
export type VerifiedMatch = VerifiedMatchFields & { readonly [VERIFIED]: true };

export interface SourceSummary {
  /** 2–3 plain sentences. Sentences with numbers not found in the source text are dropped. */
  summary: string;
  howItRelates: string;
  limits?: string;
  /** Debate tag: the user's claim in their framing. Labelled as the user's words. */
  tag?: string;
  /** How many summary sentences were dropped by the number guard. */
  droppedSentences: number;
  abstractOnly: boolean;
}

export interface CandidateMeta {
  id: string;
  sourceId: SourceId;
  tier: SourceTier;
  title: string;
  url: string;
  pdfUrl?: string;
  doi?: string;
  authors: string[];
  publisher?: string;
  published?: string;
  citedByCount?: number;
  lowQuality?: boolean;
  isWikipedia?: boolean;
}

export interface SourceResult {
  candidateId: string;
  meta: CandidateMeta;
  best: VerifiedMatch;
  /** Other verified passages from the same source, best first. */
  more: VerifiedMatch[];
  score: number;
  textSource: TextSource;
  finalUrl: string;
  /** Round in which this result first appeared (for the "New" badge). */
  round: number;
  summary?: SourceSummary;
  /** Local scope note added after a constraint change (e.g. outside the chosen years). */
  localScopeNote?: string;
}

export interface RefineQuestion {
  id: string;
  text: string;
  kind: 'choice' | 'text';
  options?: string[];
  why: string;
  affects: 'regions' | 'years' | 'strength' | 'side' | 'source_mix' | 'claim_wording' | 'which_claim';
}

export interface RefineCard {
  round: number;
  coverageNote: string;
  questions: RefineQuestion[];
}

export interface RefineAnswer {
  questionId: string;
  /** Free text or the chosen option. "Keep as is" means no change. */
  answer: string;
}

export const KEEP_AS_IS = 'Keep as is';

export interface RoundAnswers {
  round: number;
  answers: Array<RefineAnswer & { question: string }>;
  freeText?: string;
}

export type JobStatus =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'matching'
  | 'refining'
  | 'ready'
  | 'stopped'
  | 'error'
  | 'interrupted';

export const ACTIVE_STATUSES: readonly JobStatus[] = ['planning', 'searching', 'reading', 'matching', 'refining'];

export interface Progress {
  stage: string;
  message: string;
  percent: number;
}

export interface JobWarning {
  code:
    | 'exa_missing'
    | 'exa_invalid'
    | 'exa_limited'
    | 's2_limited'
    | 'adapter_failed'
    | 'llm_batch_skipped'
    | 'llm_unavailable'
    | 'cost_cap'
    | 'max_rounds'
    | 'no_host_permission'
    | 'summary_failed';
  message: string;
}

export interface JobError {
  code: 'deepseek_key' | 'deepseek_balance' | 'deepseek_unavailable' | 'no_key' | 'internal';
  message: string;
  /** Show a link to the options page. */
  showOptionsLink?: boolean;
}

export interface DebugInfo {
  fabricatedIdsDropped: number;
  unverifiedDropped: number;
  injectionSentencesBlocked: number;
  batchesSkipped: number;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  llmCostUsd: number;
  exaCostUsd: number;
  candidatesFound: number;
  docsRead: number;
  chunksMatched: number;
  adapterCounts: Partial<Record<SourceId, number>>;
  timingsMs: Record<string, number>;
  firstResultMs?: number;
}

export interface JobState {
  jobId: string;
  rawClaim: string;
  mode: OutputMode;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  round: number;
  maxRounds: number;
  plan?: Plan;
  constraintChips: string[];
  support: SourceResult[];
  pushback: SourceResult[];
  refine?: RefineCard;
  /** True while the refine card is collapsed to "Refining: …". */
  refining?: string;
  refineDismissed: boolean;
  answers: RoundAnswers[];
  progress: Progress;
  warnings: JobWarning[];
  error?: JobError;
  notRelevant: string[];
  picked: string[];
  academicOnly: boolean;
  valuesClaim: boolean;
  debug: DebugInfo;
}

export interface HistoryEntry {
  jobId: string;
  claim: string;
  normalizedClaim?: string;
  mode: OutputMode;
  answers: RoundAnswers[];
  picked: SourceResult[];
  /** Formatted outputs at save time (Copy all, per mode). */
  outputs: { markdown: string };
  savedAt: number;
}

export interface CitationStyles {
  paper: 'apa' | 'chicago';
  essay: 'mla' | 'apa';
}

export interface Settings {
  deepseekKey: string;
  exaKey: string;
  openalexKey: string;
  contactEmail: string;
  model: string;
  enabledSources: Record<SourceId, boolean>;
  costCapUsdPerSearch: number;
  maxCandidates: number;
  exaResultsPerAdapter: number;
  lastMode: OutputMode;
  citationStyles: CitationStyles;
  honestyLine: boolean;
  showDebug: boolean;
  /** Show the small "Find a source" button when text is highlighted on a page. */
  selectionButton: boolean;
  /** DeepSeek prices in USD per 1M tokens (peak rates by default, so estimates err high). */
  prices: { inputCacheMiss: number; inputCacheHit: number; output: number };
}
