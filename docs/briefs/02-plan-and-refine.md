# Brief 02 — Quick plan + results-aware refine questions

Read `CLAUDE.md` first. Depends on 01.

## Goal
Get searching immediately with no questions, then ask 1–3 smart questions **based on what the first search actually found**, and re-plan from the answers. Questions should feel like a research librarian looking at the pile and saying "these are all US studies — is that OK?", not a generic form.

## Step A — Quick plan (no questions)
Call DeepSeek with the raw claim (+ output mode). It returns:
```ts
const PlanSchema = z.object({
  normalizedClaim: z.string(),          // cleaned, one sentence
  claimType: z.enum(['empirical','causal','statistical','normative','definitional','prediction']),
  coreProposition: z.string(),          // the idea in neutral words
  paraphrases: z.array(z.string()).min(3).max(6), // how a researcher/journalist would phrase it
  keyTerms: z.array(z.string()).max(12),  // incl. technical synonyms ("disemployment effect")
  excludeTerms: z.array(z.string()).max(6),
  constraints: z.object({
    yearFrom: z.number().optional(), yearTo: z.number().optional(),
    regions: z.array(z.string()).optional(),
    side: z.enum(['support','attack','either']).default('support'),
    strength: z.enum(['causal','associational','any']).default('any'),
  }),
  queries: z.object({
    academic: z.array(z.string()).max(3),   // short keyword queries for OpenAlex/S2/arXiv
    semantic: z.array(z.string()).max(3),   // Exa: full sentences phrased like the source would say it
    news: z.array(z.string()).max(2),
    policy: z.array(z.string()).max(2),     // for think tanks + gov/IGO domain-filtered Exa calls
  }),
  counterQuery: z.string(),               // one query that would find the opposing view
  multipleClaims: z.array(z.string()).optional(), // if the input contains 2+ distinct claims
});
```
Prompt rules:
- Paraphrases should sound like how the idea actually appears in papers and reports, including field jargon, not like the user's wording.
- **Exa `semantic` queries are written as the sentence a matching source would contain** (e.g. "Our estimates show minimum wage increases had no significant effect on employment."). Exa matches meaning, so this beats keyword soup.
- Academic queries: 3–7 keywords, no quotes, no boolean operators (adapters add their own syntax).
- Only set constraints the claim itself states. Don't guess timeframes or regions — that's what refine is for.
- Output mode nudges source mix: Paper → more academic/gov; Essay → balanced; Debate → balanced + stronger counter search.
- If `multipleClaims` has 2+ items, search the first one and make "which claim?" the first refine question.

## Step B — Refine questions (after first results)
Trigger when the first round has finished matching (or after ~20s with at least 3 verified results, whichever first). Send DeepSeek the plan + a compact summary of results: per result → tier, relation, year, region/population if detectable, `scopeMismatch`, one-line reason. **Never the full passages** (cost). It returns:
```ts
const RefineSchema = z.object({
  coverageNote: z.string(),             // 1 line: "7 sources, mostly US studies 2015–2022, 2 contradict"
  questions: z.array(z.object({
    id: z.string(),
    text: z.string(),                   // short, plain English, grounded in the results
    kind: z.enum(['choice','text']),
    options: z.array(z.string()).max(4).optional(),
    why: z.string(),                    // 1 line, shown on hover
    affects: z.enum(['regions','years','strength','side','source_mix','claim_wording','which_claim']),
  })).max(3),
});
```
Question rules for the prompt:
- Every question must be grounded in a visible gap or pattern in the results: scope mismatch, all-old sources, mostly correlational evidence, lots of pushback, too few academic sources, mostly abstract-only.
- Max 3. Prefer multiple choice with a "Keep as is" option. Zero questions is fine if results already look strong.
- Never ask something the claim or a previous answer already settled.
- The "Which of these fits best?" pick prompt is UI (Brief 05), not an LLM question.

## Step C — Re-plan
When the user answers (any answer that isn't "Keep as is"):
- Call DeepSeek with the old plan + answers → a new `PlanSchema` object. Only changed parts should change; keep good paraphrases.
- Re-run search only for adapters whose queries/constraints changed. Reuse cached candidates and fetched texts by URL.
- **Merge** new results into the existing list (dedupe, re-rank). Don't wipe what the user already saw; badge new ones "New".
- Refine can run again after the second round (max 3 rounds per job, then just show the pick prompt).

## Prompts
All prompts live in `llm/prompts.ts` as functions. System framing: "You are a research librarian helping a student find evidence. You do not answer the claim yourself. You plan searches and ask short questions about gaps in what was found." Include 2 short few-shot examples per prompt (one econ/causal, one statistical).

## Edge cases
- Claim typed in Vietnamese or another language: translate it to English inside the plan (`normalizedClaim` is always English) and plan English queries only. Show the English version in the UI so the user can check the translation.
- Very long input (pasted paragraph): normalize to the main claim; fill `multipleClaims` if there are several.
- Normative claims ("X is unfair"): plan for sources that make that argument (op-eds, think tanks, philosophy papers) and tag the job "values claim" in the UI.

## Acceptance
- 10 sample claims (in `tests/claims.json`) each produce valid Plan JSON in < 4s.
- Refine questions on fixture result sets point at real gaps (e.g. a fixture of all-US results produces a region question; an all-correlational set produces a strength question; a strong set produces 0 questions).
- Answering a region question re-searches only the affected adapters and merges results without losing earlier ones.
