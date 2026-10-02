import { describe, expect, it } from 'vitest';
import type { Plan, SourceId } from '../../src/shared/types';
import { counterSignature, createAdapters } from '../../src/background/sources';
import { makePlan } from './helpers';

const adapters = createAdapters({ exaKey: 'SECRET', openalexKey: 'OAKEY', contactEmail: 'me@x.org', exaResultsPerAdapter: 4 });

function sigs(plan: Plan): Record<SourceId, string> {
  return Object.fromEntries(adapters.map((a) => [a.id, a.signature(plan)])) as Record<SourceId, string>;
}

function changed(a: Plan, b: Plan): SourceId[] {
  const sa = sigs(a);
  const sb = sigs(b);
  return (Object.keys(sa) as SourceId[]).filter((id) => sa[id] !== sb[id]).sort();
}

const base = makePlan();

describe('adapter signatures', () => {
  it('are deterministic and do not contain keys', () => {
    expect(sigs(base)).toEqual(sigs(structuredClone(base)));
    for (const s of Object.values(sigs(base))) {
      expect(s).not.toContain('SECRET');
      expect(s).not.toContain('OAKEY');
    }
  });

  it('ignore plan fields the requests do not use', () => {
    expect(changed(base, makePlan({ paraphrases: ['other'], keyTerms: ['k'], normalizedClaim: 'different claim' }))).toEqual([]);
    expect(changed(base, makePlan({ queries: { ...base.queries, academic: [...base.queries.academic, 'third query'] } }))).toEqual([]);
  });

  it('changing years changes the date-filtered adapters (all of them)', () => {
    const p = makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2020 } });
    expect(changed(base, p)).toEqual(['arxiv', 'exa_news', 'exa_papers', 'exa_policy', 'exa_web', 'openalex', 'semantic_scholar']);
    const p2 = makePlan({ constraints: { side: 'support', strength: 'any', yearFrom: 2010, yearTo: 2021 } });
    expect(changed(p, p2)).toContain('openalex');
    expect(changed(p, p2)).toContain('exa_web');
  });

  it('changing only side/strength changes nothing', () => {
    expect(changed(base, makePlan({ constraints: { side: 'attack', strength: 'causal' } }))).toEqual([]);
  });

  it('changing only news queries changes only exa_news', () => {
    expect(changed(base, makePlan({ queries: { ...base.queries, news: ['different news query'] } }))).toEqual(['exa_news']);
  });

  it('changing only policy queries changes only exa_policy', () => {
    expect(changed(base, makePlan({ queries: { ...base.queries, policy: ['different policy query'] } }))).toEqual(['exa_policy']);
  });

  it('changing semantic queries changes exa_web and exa_papers (news/policy have their own queries)', () => {
    expect(changed(base, makePlan({ queries: { ...base.queries, semantic: ['A different sentence.'] } }))).toEqual(['exa_papers', 'exa_web']);
  });

  it('academic query changes: first → OpenAlex, S2, arXiv; second → OpenAlex only', () => {
    const [a0, a1] = base.queries.academic as [string, string];
    expect(changed(base, makePlan({ queries: { ...base.queries, academic: ['new first', a1] } }))).toEqual(['arxiv', 'openalex', 'semantic_scholar']);
    expect(changed(base, makePlan({ queries: { ...base.queries, academic: [a0, 'new second'] } }))).toEqual(['openalex']);
  });

  it('regions change every adapter (appended to queries)', () => {
    expect(changed(base, makePlan({ constraints: { side: 'support', strength: 'any', regions: ['Vietnam'] } }))).toHaveLength(7);
  });

  it('counterQuery is excluded from signatures but has its own counterSignature', () => {
    const p = makePlan({ counterQuery: 'something else entirely' });
    expect(changed(base, p)).toEqual([]);
    const oa = adapters[0]!;
    const web = adapters[3]!;
    expect(counterSignature(oa, base)).not.toBe(counterSignature(oa, p));
    expect(counterSignature(web, base)).not.toBe(counterSignature(web, p));
    expect(counterSignature(oa, base)).toBe(counterSignature(oa, structuredClone(base)));
  });
});
