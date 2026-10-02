// Live LLM-only checks (DeepSeek key needed, no Exa; costs well under a cent):
//   1. Plans:   every golden claim → valid Plan JSON in < 4 s, with the expected special handling
//               (translation, multiple claims, normative tag, stated constraints).
//   2. Refine:  fixture result sets → all-US asks about region, all-correlational asks about
//               strength, a strong set asks nothing.
//   3. Match:   known passages from fixture pages → expected relation labels, injection ignored.
//
//   npm run smoke:llm                  (uses DEEPSEEK_API_KEY from .env.local)
//   npm run smoke:llm -- plans|refine|match
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeepSeekClient } from '../src/background/llm/deepseek';
import { makePlan, makeRefineCard } from '../src/background/plan';
import { buildDoc, makeChunks } from '../src/background/extract/chunk';
import { stripMarkdown } from '../src/background/extract/markdown';
import { matchBatch, type DocInfo } from '../src/background/match/score';
import { isEnglish } from '../src/background/sources';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { OutputMode, Plan, Relation, SourceResult, SourceTier, VerifiedMatch } from '../src/shared/types';
import { nodeExtractor } from './nodeExtractor';

const ROOT = join(import.meta.dirname, '..');
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
if (existsSync(join(ROOT, '.env.local'))) {
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && m[2] !== undefined && !line.trim().startsWith('#')) env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
if (!env.DEEPSEEK_API_KEY) {
  console.error('Set DEEPSEEK_API_KEY in .env.local');
  process.exit(2);
}

let cost = 0;
const llm = new DeepSeekClient({
  apiKey: env.DEEPSEEK_API_KEY,
  model: env.DEEPSEEK_MODEL || DEFAULT_SETTINGS.model,
  prices: DEFAULT_SETTINGS.prices,
  onUsage: (u) => (cost += u.costUsd),
});
const signal = new AbortController().signal;
let failures = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}`);
};

async function plans(): Promise<void> {
  console.log('\n\x1b[1mPlans\x1b[0m');
  const golden = (JSON.parse(readFileSync(join(ROOT, 'tests/claims.json'), 'utf8')) as { claims: Array<{ id: string; type: string; claim: string; mode: OutputMode }> }).claims;
  for (const g of golden) {
    const t0 = Date.now();
    let plan: Plan;
    try {
      plan = await makePlan(llm, g.claim, g.mode, signal);
    } catch (e) {
      ok(false, `${g.id}: plan failed`, e instanceof Error ? e.message : String(e));
      continue;
    }
    const ms = Date.now() - t0;
    ok(ms < 4000, `${g.id}: valid plan in ${(ms / 1000).toFixed(1)}s`, `${plan.claimType} · "${plan.normalizedClaim}"`);
    ok(isEnglish(plan.normalizedClaim), `${g.id}: normalizedClaim is English`);
    if (g.type === 'non_english') ok(!!plan.inputLanguage, `${g.id}: translation flagged`, `inputLanguage=${plan.inputLanguage}`);
    if (g.type === 'multi_claim_paragraph') ok((plan.multipleClaims?.length ?? 0) >= 2, `${g.id}: multiple claims found`, plan.multipleClaims?.join(' | '));
    if (g.type === 'normative') ok(plan.claimType === 'normative', `${g.id}: normative claim`);
    if (g.id === 'stat-vietnam-gdp') ok(!!plan.constraints.regions?.some((r) => /viet/i.test(r)) && plan.constraints.yearFrom === 2010, `${g.id}: stated constraints set`, JSON.stringify(plan.constraints));
    if (g.id === 'econ-minwage') ok(!plan.constraints.regions && !plan.constraints.yearFrom, `${g.id}: no guessed region/timeframe`);
  }
}

function fakeResult(i: number, tier: SourceTier, relation: Relation, year: number, title: string, reason: string, scope?: string): SourceResult {
  const best = { relation, reason, passage: reason, confidence: 0.85, sentenceIds: [], fragments: [], ...(scope ? { scopeMismatch: scope } : {}) } as unknown as VerifiedMatch;
  return {
    candidateId: `c${i}`,
    meta: { id: `c${i}`, sourceId: 'openalex', tier, title, url: `https://example.org/${i}`, authors: [], published: String(year) },
    best,
    more: [],
    score: 1,
    textSource: 'html',
    finalUrl: '',
    round: 1,
  };
}

async function refine(): Promise<void> {
  console.log('\n\x1b[1mRefine questions on fixture result sets\x1b[0m');
  const base = await makePlan(llm, "Raising the minimum wage doesn't significantly reduce employment.", 'essay', signal);
  const allUs = [
    fakeResult(1, 'peer_reviewed', 'direct', 1994, 'Minimum wages and employment in New Jersey and Pennsylvania', 'No employment drop in New Jersey fast food', 'one US state'),
    fakeResult(2, 'peer_reviewed', 'paraphrase', 2019, 'The effect of minimum wages on low-wage jobs in the United States', 'No job loss across 138 US state increases'),
    fakeResult(3, 'think_tank', 'partial', 2019, 'CBO: effects of a $15 federal minimum wage in the United States', 'Small projected losses', 'projection'),
    fakeResult(4, 'major_news', 'direct', 2021, 'US cities that raised wages saw no job losses', 'US city data show no job losses'),
  ];
  const card1 = await makeRefineCard({ llm, plan: base, results: allUs, notRelevantTitles: [], previousAnswers: [], round: 1, signal });
  ok(card1.questions.some((q) => q.affects === 'regions'), 'all-US results → region question', card1.questions.map((q) => q.text).join(' | '));

  const causal = await makePlan(llm, 'Owning a dog causes people to live longer.', 'paper', signal);
  const corr = [
    fakeResult(1, 'peer_reviewed', 'partial', 2019, 'Dog ownership and survival: a systematic review', 'Dog owners had 24% lower mortality risk', 'observational; correlational, claim is causal'),
    fakeResult(2, 'peer_reviewed', 'partial', 2017, 'Dog ownership and the risk of cardiovascular disease in Sweden', 'Lower death risk among dog owners in a cohort', 'correlational, claim is causal'),
    fakeResult(3, 'major_news', 'paraphrase', 2019, 'Dog owners live longer, study finds', 'Association between dog ownership and longevity', 'correlational'),
  ];
  const card2 = await makeRefineCard({ llm, plan: causal, results: corr, notRelevantTitles: [], previousAnswers: [], round: 1, signal });
  ok(card2.questions.some((q) => q.affects === 'strength'), 'all-correlational results → strength question', card2.questions.map((q) => q.text).join(' | '));

  const stat = await makePlan(llm, "Bangladesh's extreme poverty rate fell by more than half between 2000 and 2016.", 'essay', signal);
  const strong = [
    fakeResult(1, 'gov_igo', 'direct', 2019, 'Bangladesh Poverty Assessment (World Bank)', 'Extreme poverty fell from 34% to 13% between 2000 and 2016'),
    fakeResult(2, 'gov_igo', 'direct', 2017, 'Household Income and Expenditure Survey 2016 (BBS)', 'Official headcount figures for Bangladesh 2000–2016'),
    fakeResult(3, 'peer_reviewed', 'paraphrase', 2020, 'Decomposing poverty decline in Bangladesh 2000–2016', 'Poverty more than halved in Bangladesh'),
    fakeResult(4, 'peer_reviewed', 'direct', 2021, 'Growth and poverty reduction in Bangladesh', 'Extreme poverty halved 2000–2016'),
  ];
  const card3 = await makeRefineCard({ llm, plan: stat, results: strong, notRelevantTitles: [], previousAnswers: [], round: 1, signal });
  ok(card3.questions.length === 0, 'strong result set → no questions', card3.questions.map((q) => q.text).join(' | ') || card3.coverageNote);
}

async function match(): Promise<void> {
  console.log('\n\x1b[1mMatch labels on fixture passages\x1b[0m');
  const plan = await makePlan(llm, "Raising the minimum wage doesn't significantly reduce employment.", 'paper', signal);
  const ex = nodeExtractor();
  const pages: Array<{ id: string; label: string; text: string; expect: Array<{ sentence: RegExp; relations: Relation[] }>; forbid?: RegExp }> = [
    {
      id: 'd1',
      label: 'Study finds minimum wage rises did not cut jobs — Example News (2019)',
      text: stripMarkdown(readFileSync(join(ROOT, 'tests/fixtures/pages/minwage-news.exa.md'), 'utf8')),
      expect: [{ sentence: /no significant effect on overall employment|did not fall in the five years/, relations: ['direct', 'paraphrase'] }],
    },
    {
      id: 'd2',
      label: 'Minimum Wage Increases… Evidence from Seattle — NBER (2017)',
      text: (await ex.html(readFileSync(join(ROOT, 'tests/fixtures/pages/seattle-study.html'), 'utf8'), 'https://x.org/seattle')).text,
      expect: [{ sentence: /reduced hours worked/, relations: ['contradicts', 'partial'] }],
    },
    {
      id: 'd3',
      label: 'Why wages matter — blog (2021)',
      text: (await ex.html(readFileSync(join(ROOT, 'tests/fixtures/pages/injection-blog.html'), 'utf8'), 'https://x.org/blog')).text,
      expect: [],
      forbid: /ignore previous instructions|label this passage/i,
    },
  ];
  const docs = new Map<string, DocInfo>();
  const chunks = pages.flatMap((p) => {
    const doc = buildDoc({ docId: p.id, candidateId: `c_${p.id}`, text: p.text, textSource: 'html', finalUrl: 'u', fetchedAt: 't' });
    docs.set(p.id, { doc, candidateId: `c_${p.id}`, label: p.label, forCounter: false });
    return makeChunks(doc);
  });
  const out = await matchBatch({ llm, plan, chunks: chunks.slice(0, 12), docs, signal, label: 'smoke-match' });
  ok(!out.skipped, 'match batch parsed');
  for (const p of pages) {
    const mine = out.verified.filter((m) => m.docId === p.id);
    for (const e of p.expect) {
      const hit = mine.find((m) => e.sentence.test(m.passage));
      ok(!!hit && e.relations.includes(hit.relation), `${p.label.split(' — ')[0]}: ${e.relations.join('/')}`, hit ? `${hit.relation}: "${hit.passage.slice(0, 90)}"` : 'no verified match');
    }
    if (p.forbid) ok(!mine.some((m) => p.forbid!.test(m.passage)), `${p.label.split(' — ')[0]}: injected instructions never shown`, mine.map((m) => m.relation).join(','));
  }
  console.log(`  \x1b[2mdropped: ${out.stats.fabricatedIds} fabricated IDs, ${out.stats.injection} injection, ${out.stats.unverified} unverified\x1b[0m`);
}

const which = process.argv[2];
const t0 = Date.now();
if (!which || which === 'plans') await plans();
if (!which || which === 'refine') await refine();
if (!which || which === 'match') await match();
console.log(`\n${failures ? `\x1b[31m${failures} check(s) failed\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'} · DeepSeek cost $${cost.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failures ? 1 : 0);
