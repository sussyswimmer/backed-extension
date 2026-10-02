// Zod schemas for every LLM response. Lenient where it is safe (null -> undefined, over-long
// arrays trimmed to their cap) and strict where it matters (enums, required fields).
import { z } from 'zod';

/** Treat JSON null like a missing field. */
function nn<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === null ? undefined : v), schema);
}

/** Array trimmed to `max` before validation (models sometimes return one extra item). */
function capped<T extends z.ZodType>(item: T, max: number, min = 0) {
  return z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v), z.array(item).min(min).max(max));
}

const str = z.string().trim();
const nonEmpty = z.string().trim().min(1);

const year = z.preprocess((v) => {
  if (typeof v === 'string' && /^\d{4}$/.test(v.trim())) return Number(v.trim());
  return v === null ? undefined : v;
}, z.number().int().min(1800).max(2100).optional());

export const PlanSchema = z.object({
  normalizedClaim: nonEmpty,
  claimType: z.enum(['empirical', 'causal', 'statistical', 'normative', 'definitional', 'prediction']),
  coreProposition: nonEmpty,
  paraphrases: capped(nonEmpty, 6, 3),
  keyTerms: capped(nonEmpty, 12),
  excludeTerms: nn(capped(nonEmpty, 6).default([])),
  constraints: z.object({
    yearFrom: year,
    yearTo: year,
    regions: nn(capped(nonEmpty, 6).optional()),
    side: nn(z.enum(['support', 'attack', 'either']).default('support')),
    strength: nn(z.enum(['causal', 'associational', 'any']).default('any')),
  }),
  queries: z.object({
    academic: capped(nonEmpty, 3, 1),
    semantic: capped(nonEmpty, 3, 1),
    news: nn(capped(nonEmpty, 2).default([])),
    policy: nn(capped(nonEmpty, 2).default([])),
  }),
  counterQuery: nonEmpty,
  multipleClaims: nn(capped(nonEmpty, 5).optional()),
  domains: nn(capped(nonEmpty, 3).optional()),
  inputLanguage: nn(str.optional()),
});

export type PlanOut = z.infer<typeof PlanSchema>;

export const REFINE_AFFECTS = ['regions', 'years', 'strength', 'side', 'source_mix', 'claim_wording', 'which_claim'] as const;

export const RefineSchema = z.object({
  coverageNote: nonEmpty,
  questions: capped(
    z.object({
      id: nonEmpty,
      text: nonEmpty,
      kind: z.enum(['choice', 'text']),
      options: nn(capped(nonEmpty, 4).optional()),
      why: nn(str.default('')),
      affects: z.enum(REFINE_AFFECTS),
    }),
    3,
  ),
});

export type RefineOut = z.infer<typeof RefineSchema>;

export const MatchSchema = z.object({
  results: z.array(
    z.object({
      chunkId: nonEmpty,
      relation: z.enum(['direct', 'paraphrase', 'partial', 'contradicts', 'irrelevant']),
      sentenceIds: nn(capped(nonEmpty, 4).default([])),
      confidence: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().min(0).max(1)),
      reason: nn(str.default('')),
      scopeMismatch: nn(str.optional()),
    }),
  ),
});

export type MatchOut = z.infer<typeof MatchSchema>;

export const SummarySchema = z.object({
  sources: z.array(
    z.object({
      docId: nonEmpty,
      summary: nonEmpty,
      howItRelates: nonEmpty,
      limits: nn(str.optional()),
      tag: nn(str.optional()),
    }),
  ),
});

export type SummaryOut = z.infer<typeof SummarySchema>;
