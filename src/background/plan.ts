// Brief 02: quick plan (no questions), results-aware refine questions, re-plan from answers.
import type { OutputMode, Plan, RefineCard, RefineQuestion, RoundAnswers, SourceResult } from '../shared/types';
import { KEEP_AS_IS } from '../shared/types';
import { yearOf } from '../shared/text';
import { LlmError, type LlmClient } from './llm/deepseek';
import { planPrompt, refinePrompt, replanPrompt, type CompactResult } from './llm/prompts';
import { PlanSchema, RefineSchema, type PlanOut } from './llm/schemas';
import { detectRegions } from './match/regions';

export function toPlan(p: PlanOut): Plan {
  const plan: Plan = {
    normalizedClaim: p.normalizedClaim,
    claimType: p.claimType,
    coreProposition: p.coreProposition,
    paraphrases: p.paraphrases,
    keyTerms: p.keyTerms,
    excludeTerms: p.excludeTerms,
    constraints: { side: p.constraints.side, strength: p.constraints.strength },
    queries: { academic: p.queries.academic, semantic: p.queries.semantic, news: p.queries.news, policy: p.queries.policy },
    counterQuery: p.counterQuery,
  };
  const c = p.constraints;
  if (c.yearFrom !== undefined) plan.constraints.yearFrom = c.yearFrom;
  if (c.yearTo !== undefined) plan.constraints.yearTo = c.yearTo;
  if (plan.constraints.yearFrom && plan.constraints.yearTo && plan.constraints.yearFrom > plan.constraints.yearTo) {
    [plan.constraints.yearFrom, plan.constraints.yearTo] = [plan.constraints.yearTo, plan.constraints.yearFrom];
  }
  if (c.regions?.length) plan.constraints.regions = c.regions;
  if (p.multipleClaims && p.multipleClaims.length > 1) plan.multipleClaims = p.multipleClaims;
  if (p.domains?.length) plan.domains = p.domains;
  if (p.inputLanguage && !/^en(glish)?$/i.test(p.inputLanguage)) plan.inputLanguage = p.inputLanguage;
  return plan;
}

export async function makePlan(llm: LlmClient, rawClaim: string, mode: OutputMode, signal: AbortSignal): Promise<Plan> {
  const prompt = planPrompt(rawClaim, mode);
  const { data } = await llm.json({ label: 'plan', ...prompt, schema: PlanSchema, maxTokens: 1400, signal, temperature: 0.3 });
  return toPlan(data);
}

const FALLBACK_STOP = new Set(
  'a an and are as at be by do does doesnt dont for from has have in into is it its of on or that the their this to was were will with than then not no really very more most less'.split(' '),
);

/** Used only if planning fails twice with malformed JSON: a crude keyword plan from the claim itself. */
export function fallbackPlan(rawClaim: string): Plan {
  const claim = rawClaim.replace(/\s+/g, ' ').trim().slice(0, 400);
  const words = claim
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FALLBACK_STOP.has(w));
  const keyTerms = Array.from(new Set(words)).slice(0, 8);
  const academic = keyTerms.slice(0, 6).join(' ') || claim;
  return {
    normalizedClaim: claim,
    claimType: 'empirical',
    coreProposition: claim,
    paraphrases: [claim, claim, claim],
    keyTerms,
    excludeTerms: [],
    constraints: { side: 'support', strength: 'any' },
    queries: { academic: [academic], semantic: [claim], news: [academic], policy: [academic] },
    counterQuery: `evidence against: ${academic}`,
  };
}

export function constraintChips(plan: Plan): string[] {
  const c = plan.constraints;
  const chips: string[] = [];
  if (c.yearFrom && c.yearTo) chips.push(`${c.yearFrom}–${c.yearTo}`);
  else if (c.yearFrom) chips.push(`${c.yearFrom}+`);
  else if (c.yearTo) chips.push(`Up to ${c.yearTo}`);
  if (c.regions?.length) chips.push(c.regions.join(', '));
  if (c.strength === 'causal') chips.push('Causal only');
  if (c.strength === 'associational') chips.push('Correlational OK');
  if (c.side === 'attack') chips.push('Counter view');
  if (c.side === 'either') chips.push('Both sides');
  return chips;
}

export function compactResults(results: SourceResult[]): CompactResult[] {
  return results.map((r, i) => {
    const regionText = `${r.meta.title} ${r.best.passage} ${r.best.scopeMismatch ?? ''} ${r.best.reason}`;
    const c: CompactResult = {
      n: i + 1,
      tier: r.meta.tier,
      relation: r.best.relation,
      reason: r.best.reason.slice(0, 160),
      abstractOnly: r.textSource === 'abstract_only',
    };
    const y = yearOf(r.meta.published);
    if (y) c.year = y;
    const regions = detectRegions(regionText);
    if (regions.length) c.regions = regions;
    if (r.best.scopeMismatch) c.scopeMismatch = r.best.scopeMismatch.slice(0, 120);
    return c;
  });
}

export async function makeRefineCard(args: {
  llm: LlmClient;
  plan: Plan;
  results: SourceResult[];
  notRelevantTitles: string[];
  previousAnswers: RoundAnswers[];
  round: number;
  signal: AbortSignal;
}): Promise<RefineCard> {
  const prompt = refinePrompt({
    plan: args.plan,
    results: compactResults(args.results),
    notRelevantTitles: args.notRelevantTitles,
    previousAnswers: args.previousAnswers,
    round: args.round,
  });
  const { data } = await args.llm.json({ label: 'refine', ...prompt, schema: RefineSchema, maxTokens: 700, signal: args.signal, temperature: 0.3 });
  const multi = args.plan.multipleClaims;
  const alreadyChose = args.previousAnswers.some((r) => r.answers.some((a) => a.questionId === 'which_claim'));
  const questions: RefineQuestion[] = [];
  const seenIds = new Set<string>();
  for (const q of data.questions) {
    let id = q.id.replace(/[^\w-]/g, '').slice(0, 40) || `q${questions.length + 1}`;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);
    if (q.affects === 'which_claim' && (alreadyChose || !multi || multi.length < 2)) continue;
    const question: RefineQuestion = { id, text: q.text, kind: q.kind, why: q.why, affects: q.affects };
    if (q.kind === 'choice') {
      const opts = (q.options ?? []).filter((o) => o.trim().toLowerCase() !== KEEP_AS_IS.toLowerCase());
      if (!opts.length) {
        question.kind = 'text';
      } else {
        question.options = [...opts.slice(0, 4), KEEP_AS_IS];
      }
    }
    questions.push(question);
  }
  // Multiple claims: "which claim?" must be first, even if the model forgot it.
  if (multi && multi.length > 1 && !alreadyChose) {
    const idx = questions.findIndex((q) => q.affects === 'which_claim');
    const which: RefineQuestion =
      idx >= 0
        ? (questions.splice(idx, 1)[0] as RefineQuestion)
        : { id: 'which_claim', text: 'Your text has more than one claim. Which one should I find sources for?', kind: 'choice', why: 'I searched the first claim only.', affects: 'which_claim' };
    which.id = 'which_claim';
    which.kind = 'choice';
    which.options = [...multi.slice(0, 4), KEEP_AS_IS];
    questions.unshift(which);
  }
  return { round: args.round, coverageNote: data.coverageNote, questions: questions.slice(0, 3) };
}

export async function replan(args: {
  llm: LlmClient;
  plan: Plan;
  card: RefineCard | undefined;
  answers: Array<{ questionId: string; answer: string }>;
  freeText?: string;
  notRelevantTitles: string[];
  mode: OutputMode;
  signal: AbortSignal;
}): Promise<Plan> {
  const effective = args.answers.filter((a) => a.answer.trim() && a.answer.trim().toLowerCase() !== KEEP_AS_IS.toLowerCase());
  const answers = effective.map((a) => {
    const q = args.card?.questions.find((x) => x.id === a.questionId);
    return { question: q, questionText: q?.text ?? a.questionId, answer: a.answer.trim() };
  });
  const prompt = replanPrompt({
    plan: args.plan,
    answers,
    ...(args.freeText ? { freeText: args.freeText } : {}),
    notRelevantTitles: args.notRelevantTitles,
    mode: args.mode,
  });
  try {
    const { data } = await args.llm.json({ label: 'replan', ...prompt, schema: PlanSchema, maxTokens: 1400, signal: args.signal, temperature: 0.2 });
    const next = toPlan(data);
    // A which_claim answer must actually switch the claim even if the model kept the old one.
    const which = answers.find((a) => a.question?.affects === 'which_claim');
    if (which && next.normalizedClaim === args.plan.normalizedClaim && which.answer !== args.plan.normalizedClaim) {
      next.normalizedClaim = which.answer;
    }
    if (args.plan.inputLanguage && !next.inputLanguage) next.inputLanguage = args.plan.inputLanguage;
    if (which) delete next.multipleClaims;
    else if (args.plan.multipleClaims && !next.multipleClaims) next.multipleClaims = args.plan.multipleClaims;
    return next;
  } catch (e) {
    if (e instanceof LlmError && e.kind === 'malformed') return applyAnswersLocally(args.plan, answers);
    throw e;
  }
}

/** Deterministic fallback when the re-plan JSON is unusable: apply what we can understand. */
export function applyAnswersLocally(plan: Plan, answers: Array<{ question: RefineQuestion | undefined; answer: string }>): Plan {
  const next: Plan = structuredClone(plan);
  for (const a of answers) {
    const affects = a.question?.affects;
    const years = /(\d{4})/.exec(a.answer);
    if (affects === 'years' && years) next.constraints.yearFrom = Number(years[1]);
    if (affects === 'regions' && !/any|fine|keep/i.test(a.answer)) next.constraints.regions = [a.answer];
    if (affects === 'strength') next.constraints.strength = /causal/i.test(a.answer) ? 'causal' : 'any';
    if (affects === 'side') next.constraints.side = /counter|against|oppos/i.test(a.answer) ? 'attack' : 'either';
    if (affects === 'which_claim') {
      next.normalizedClaim = a.answer;
      next.coreProposition = a.answer;
      next.queries.semantic = [a.answer];
      delete next.multipleClaims;
    }
  }
  if (next.constraints.regions?.length) {
    const r = next.constraints.regions.join(' ');
    next.queries.semantic = next.queries.semantic.map((q) => (q.includes(r) ? q : `${q} (${r})`));
  }
  return next;
}

export function isValuesClaim(plan: Plan): boolean {
  return plan.claimType === 'normative';
}
