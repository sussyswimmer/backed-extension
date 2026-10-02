// Live smoke test: runs golden claims end-to-end against the real APIs and prints sources,
// relations, cost and time for a human to review.
//
//   1. Put real keys in .env.local (never committed):
//        DEEPSEEK_API_KEY=sk-...
//        EXA_API_KEY=...            (optional: without it the run is academic-only)
//        OPENALEX_API_KEY=...       (optional)
//        CONTACT_EMAIL=you@example.com (optional)
//        DEEPSEEK_MODEL=deepseek-flash (optional)
//   2. npm run smoke                 -> the 5 claims marked "smoke" in tests/claims.json
//      npm run smoke -- --all        -> every golden claim
//      npm run smoke -- econ-minwage false-claim
//      npm run smoke -- --refine     -> also answer the first refine question (first option) to test round 2
//
// Behind a corporate/sandbox proxy, run with NODE_USE_ENV_PROXY=1 so Node's fetch uses HTTPS_PROXY.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Job } from '../src/background/pipeline';
import { DeepSeekClient } from '../src/background/llm/deepseek';
import { createAdapters } from '../src/background/sources';
import { isVerbatimIn } from '../src/background/match/verify';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { JobState, OutputMode, Settings, SourceResult } from '../src/shared/types';
import { nodeExtractor } from './nodeExtractor';

interface GoldenClaim {
  id: string;
  type: string;
  claim: string;
  mode: OutputMode;
  smoke?: boolean;
  expect: string;
}

const ROOT = join(import.meta.dirname, '..');

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const file = join(ROOT, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m?.[1] && m[2] !== undefined && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')) };
}

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function line(r: SourceResult, verified: boolean): string {
  const year = r.meta.published?.slice(0, 4) ?? 'n.d.';
  const flags = [r.textSource === 'abstract_only' ? c.amber('abstract-only') : r.textSource, r.best.scopeMismatch ? c.amber(`scope: ${r.best.scopeMismatch}`) : '']
    .filter(Boolean)
    .join(' · ');
  return [
    `  ${c.bold(`[${r.best.relation}]`)} ${r.meta.tier} · ${r.meta.title} (${year}) ${c.dim(r.finalUrl || r.meta.url)}`,
    `     ${flags} · score ${r.score} · conf ${r.best.confidence}`,
    `     “${r.best.passage.length > 300 ? r.best.passage.slice(0, 297) + '…' : r.best.passage}” ${verified ? c.green('✓ verbatim') : c.red('✗ NOT VERIFIED')}`,
    r.summary ? `     ${c.dim('Summary (AI): ' + r.summary.howItRelates)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runOne(g: GoldenClaim, settings: Settings, refine: boolean): Promise<{ state: JobState; ok: boolean; problems: string[] }> {
  const extractor = nodeExtractor();
  const job = new Job(g.claim, g.mode, {
    settings,
    makeLlm: (onUsage) => new DeepSeekClient({ apiKey: settings.deepseekKey, model: settings.model, prices: settings.prices, onUsage }),
    adapters: createAdapters({ exaKey: settings.exaKey, openalexKey: settings.openalexKey, contactEmail: settings.contactEmail, exaResultsPerAdapter: settings.exaResultsPerAdapter }),
    extractor,
    canFetchPages: true,
    emit: () => undefined,
  });
  const t0 = Date.now();
  await job.start();
  if (refine && job.state.refine?.questions[0]?.options?.[0]) {
    const q = job.state.refine.questions[0];
    console.log(c.dim(`  answering refine: "${q.text}" → "${q.options?.[0]}"`));
    await job.answerRefine([{ questionId: q.id, answer: q.options?.[0] ?? '' }]);
  }
  const s = job.state;
  const problems: string[] = [];
  console.log(`\n${c.bold(`■ ${g.id}`)} ${c.dim(`(${g.type}, ${g.mode})`)}`);
  console.log(`  claim: ${g.claim}`);
  if (s.plan) {
    console.log(`  plan: ${s.plan.normalizedClaim} ${c.dim(`[${s.plan.claimType}${s.plan.inputLanguage ? `, from ${s.plan.inputLanguage}` : ''}]`)}`);
    if (s.constraintChips.length) console.log(`  constraints: ${s.constraintChips.join(' · ')}`);
    if (s.plan.multipleClaims) console.log(`  multiple claims: ${s.plan.multipleClaims.join(' | ')}`);
  }
  console.log(`  expect: ${c.dim(g.expect)}`);
  const all = [...s.support, ...s.pushback];
  const check = (r: SourceResult) => {
    const doc = job.docFor(r.candidateId);
    const ok = !!doc && [r.best, ...r.more].every((m) => m.verification.verbatim && m.fragments.every((f) => isVerbatimIn(doc.text, f.text)));
    if (!ok) problems.push(`unverified passage shown for ${r.meta.title}`);
    return ok;
  };
  console.log(c.bold(`  Support (${s.support.length})`));
  for (const r of s.support) console.log(line(r, check(r)));
  console.log(c.bold(`  Pushback (${s.pushback.length})`));
  for (const r of s.pushback) console.log(line(r, check(r)));
  if (s.refine) {
    console.log(c.bold('  Refine: ') + s.refine.coverageNote);
    for (const q of s.refine.questions) console.log(`    ? ${q.text} ${c.dim(`[${q.affects}] ${q.options?.join(' / ') ?? '(text)'} — ${q.why}`)}`);
  }
  for (const w of s.warnings) console.log(c.amber(`  ! ${w.code}: ${w.message}`));
  if (s.error) console.log(c.red(`  ✗ ${s.error.code}: ${s.error.message}`));
  const d = s.debug;
  console.log(
    c.dim(
      `  cost: DeepSeek $${d.llmCostUsd.toFixed(4)} (${d.llmCalls} calls, ${d.tokensIn}/${d.tokensOut} tok) + Exa $${d.exaCostUsd.toFixed(4)} = $${(d.llmCostUsd + d.exaCostUsd).toFixed(4)}` +
        ` · time ${((Date.now() - t0) / 1000).toFixed(1)}s · first result ${d.firstResultMs ? (d.firstResultMs / 1000).toFixed(1) + 's' : '—'}` +
        ` · dropped: ${d.fabricatedIdsDropped} fabricated IDs, ${d.unverifiedDropped} unverified, ${d.injectionSentencesBlocked} injection, ${d.batchesSkipped} skipped batches`,
    ),
  );
  if (g.type === 'deliberately_false' && s.support.some((r) => r.best.relation === 'direct')) problems.push('false claim got a DIRECT supporting source');
  if (d.firstResultMs && d.firstResultMs > 20_000) problems.push(`first verified result took ${(d.firstResultMs / 1000).toFixed(1)}s (target < 20s)`);
  for (const p of problems) console.log(c.red(`  ✗ ${p}`));
  return { state: s, ok: problems.length === 0 && !s.error, problems };
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DEEPSEEK_API_KEY) {
    console.error('Set DEEPSEEK_API_KEY in .env.local (see the comment at the top of scripts/smoke.ts).');
    process.exit(2);
  }
  const settings: Settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    deepseekKey: env.DEEPSEEK_API_KEY,
    exaKey: env.EXA_API_KEY ?? '',
    openalexKey: env.OPENALEX_API_KEY ?? '',
    contactEmail: env.CONTACT_EMAIL ?? '',
    model: env.DEEPSEEK_MODEL || DEFAULT_SETTINGS.model,
  };
  const golden = (JSON.parse(readFileSync(join(ROOT, 'tests/claims.json'), 'utf8')) as { claims: GoldenClaim[] }).claims;
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith('--'));
  const chosen = args.includes('--all') ? golden : ids.length ? golden.filter((g) => ids.includes(g.id)) : golden.filter((g) => g.smoke);
  console.log(c.bold(`Backed smoke run: ${chosen.length} claims · model ${settings.model} · Exa ${settings.exaKey ? 'on' : 'off (academic only)'}`));

  const report: unknown[] = [];
  let failures = 0;
  let totalCost = 0;
  for (const g of chosen) {
    try {
      const { state, ok, problems } = await runOne(g, settings, args.includes('--refine'));
      totalCost += state.debug.llmCostUsd + state.debug.exaCostUsd;
      if (!ok) failures++;
      report.push({ id: g.id, ok, problems, state });
    } catch (e) {
      failures++;
      console.log(c.red(`  ✗ crashed: ${e instanceof Error ? e.message : String(e)}`));
      report.push({ id: g.id, ok: false, problems: ['crashed'] });
    }
  }
  const outDir = join(ROOT, 'smoke-output');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, (k, v: unknown) => (k === 'deepseekKey' || k === 'exaKey' || k === 'openalexKey' ? '[redacted]' : v), 2));
  console.log(`\n${c.bold('Total cost')} $${totalCost.toFixed(4)} · avg $${(totalCost / Math.max(1, chosen.length)).toFixed(4)}/claim · ${failures ? c.red(`${failures} with problems`) : c.green('no automatic problems')} · full JSON: ${file}`);
  console.log(c.dim('Now review by hand: real sources? correct relation labels? false claim in Pushback/nothing?'));
  process.exit(failures ? 1 : 0);
}

void main();
