import { describe, expect, it } from 'vitest';
import { applyAnswersLocally, compactResults, constraintChips, fallbackPlan, makeRefineCard, replan, toPlan } from '../src/background/plan';
import { LlmError, type LlmClient } from '../src/background/llm/deepseek';
import { PlanSchema } from '../src/background/llm/schemas';
import type { Plan, RefineCard, SourceResult, VerifiedMatch } from '../src/shared/types';
import { KEEP_AS_IS } from '../src/shared/types';

const basePlan: Plan = {
  normalizedClaim: 'Claim one.',
  claimType: 'causal',
  coreProposition: 'p',
  paraphrases: ['a', 'b', 'c'],
  keyTerms: ['k'],
  excludeTerms: [],
  constraints: { side: 'support', strength: 'any' },
  queries: { academic: ['q'], semantic: ['s'], news: [], policy: [] },
  counterQuery: 'cq',
};

function fakeLlm(data: unknown | Error): LlmClient {
  return {
    async json<T>() {
      if (data instanceof Error) throw data;
      return { data: data as T, usage: { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, costUsd: 0 }, repaired: false };
    },
  };
}

const signal = new AbortController().signal;

describe('toPlan / chips / fallback', () => {
  it('normalizes the parsed plan and builds constraint chips', () => {
    const p = toPlan(
      PlanSchema.parse({
        ...basePlan,
        constraints: { yearFrom: 2025, yearTo: 2010, regions: ['Vietnam'], side: 'attack', strength: 'causal' },
        inputLanguage: 'English',
        multipleClaims: ['only one'],
      }),
    );
    expect(p.constraints).toMatchObject({ yearFrom: 2010, yearTo: 2025 });
    expect(p.inputLanguage).toBeUndefined();
    expect(p.multipleClaims).toBeUndefined();
    expect(constraintChips(p)).toEqual(['2010–2025', 'Vietnam', 'Causal only', 'Counter view']);
  });

  it('fallback plan is a valid keyword plan built from the claim', () => {
    const f = fallbackPlan('Raising the minimum wage doesnt reduce employment');
    expect(PlanSchema.safeParse(f).success).toBe(true);
    expect(f.keyTerms).toEqual(expect.arrayContaining(['raising', 'minimum', 'wage', 'reduce', 'employment']));
  });
});

describe('makeRefineCard post-processing', () => {
  const results = [] as SourceResult[];

  it('adds "Keep as is" to choice questions and caps at 3', async () => {
    const llm = fakeLlm({
      coverageNote: '3 sources',
      questions: [
        { id: 'region', text: 'Region?', kind: 'choice', options: ['US', 'Vietnam', 'Keep as is'], why: 'All US', affects: 'regions' },
        { id: 'region', text: 'Dup id?', kind: 'choice', options: [], why: '', affects: 'years' },
      ],
    });
    const card = await makeRefineCard({ llm, plan: basePlan, results, notRelevantTitles: [], previousAnswers: [], round: 1, signal });
    expect(card.questions[0]?.options).toEqual(['US', 'Vietnam', KEEP_AS_IS]);
    expect(card.questions[1]?.kind).toBe('text'); // choice without options -> text
    expect(card.questions[1]?.id).not.toBe('region');
  });

  it('puts "which claim?" first when the input had several claims', async () => {
    const llm = fakeLlm({ coverageNote: '2 sources', questions: [{ id: 'yrs', text: 'Recent only?', kind: 'choice', options: ['2015+'], why: 'old', affects: 'years' }] });
    const plan = { ...basePlan, multipleClaims: ['Claim one.', 'Claim two.'] };
    const card = await makeRefineCard({ llm, plan, results, notRelevantTitles: [], previousAnswers: [], round: 1, signal });
    expect(card.questions[0]).toMatchObject({ id: 'which_claim', affects: 'which_claim', options: ['Claim one.', 'Claim two.', KEEP_AS_IS] });
    expect(card.questions[1]?.id).toBe('yrs');
    // Not asked again once answered.
    const again = await makeRefineCard({
      llm,
      plan,
      results,
      notRelevantTitles: [],
      previousAnswers: [{ round: 1, answers: [{ questionId: 'which_claim', question: 'Which?', answer: 'Claim two.' }] }],
      round: 2,
      signal,
    });
    expect(again.questions.some((q) => q.affects === 'which_claim')).toBe(false);
  });
});

describe('replan', () => {
  const card: RefineCard = {
    round: 1,
    coverageNote: '',
    questions: [
      { id: 'which_claim', text: 'Which?', kind: 'choice', options: ['Claim one.', 'Claim two.'], why: '', affects: 'which_claim' },
      { id: 'yrs', text: 'Years?', kind: 'choice', options: ['2015+'], why: '', affects: 'years' },
    ],
  };

  it('forces the chosen claim even if the model forgot to switch', async () => {
    const llm = fakeLlm(PlanSchema.parse({ ...basePlan, multipleClaims: ['Claim one.', 'Claim two.'] }));
    const next = await replan({ llm, plan: { ...basePlan, multipleClaims: ['Claim one.', 'Claim two.'] }, card, answers: [{ questionId: 'which_claim', answer: 'Claim two.' }], notRelevantTitles: [], mode: 'essay', signal });
    expect(next.normalizedClaim).toBe('Claim two.');
    expect(next.multipleClaims).toBeUndefined();
  });

  it('falls back to local answer application when the re-plan JSON is unusable', async () => {
    const llm = fakeLlm(new LlmError('malformed', 'bad'));
    const next = await replan({ llm, plan: basePlan, card, answers: [{ questionId: 'yrs', answer: '2015 or later' }], notRelevantTitles: [], mode: 'essay', signal });
    expect(next.constraints.yearFrom).toBe(2015);
  });

  it('applyAnswersLocally handles regions/strength/side', () => {
    const next = applyAnswersLocally(basePlan, [
      { question: { id: 'r', text: '', kind: 'text', why: '', affects: 'regions' }, answer: 'Vietnam' },
      { question: { id: 's', text: '', kind: 'text', why: '', affects: 'strength' }, answer: 'Causal only' },
      { question: { id: 'd', text: '', kind: 'text', why: '', affects: 'side' }, answer: 'Show the counter view' },
    ]);
    expect(next.constraints).toMatchObject({ regions: ['Vietnam'], strength: 'causal', side: 'attack' });
    expect(next.queries.semantic[0]).toContain('Vietnam');
  });
});

describe('compactResults', () => {
  it('summarizes results for the refine prompt without full passages', () => {
    const r = {
      candidateId: 'c',
      meta: { id: 'c', sourceId: 'openalex', tier: 'peer_reviewed', title: 'Minimum wages in the United States', url: 'u', authors: [], published: '2016-01-01' },
      best: { relation: 'direct', passage: 'A very long passage '.repeat(50), reason: 'Finds no job loss', scopeMismatch: 'US only', sentenceIds: [] } as unknown as VerifiedMatch,
      more: [],
      score: 1,
      textSource: 'abstract_only',
      finalUrl: 'u',
      round: 1,
    } as SourceResult;
    const [c] = compactResults([r]);
    expect(c).toMatchObject({ n: 1, tier: 'peer_reviewed', relation: 'direct', year: 2016, regions: ['United States'], scopeMismatch: 'US only', abstractOnly: true });
    expect(JSON.stringify(c)).not.toContain('A very long passage');
  });
});
