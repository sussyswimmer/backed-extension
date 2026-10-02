import { describe, expect, it } from 'vitest';
import type { JobWarning } from '../../src/shared/types';
import {
  ABSTRACT_ONLY_NOTE,
  authorsShort,
  displayClaim,
  displayLists,
  isEmptyResult,
  isNew,
  languageName,
  metaLine,
  pickedResults,
  scopeNotes,
  visibleWarnings,
  warningKey,
} from '../../src/popup/lib/view';
import { demoState, emptyState } from './fixtures';

const none = new Set<string>();

describe('displayLists', () => {
  it('Paper/Essay: support first, pushback only when the section is open', () => {
    const s = demoState();
    const closed = displayLists(s, { mode: 'essay', debateTab: 'support', pushbackOpen: false, hidden: none });
    expect(closed.ordered.map((r) => r.candidateId)).toEqual(['rivera2019', 'natarajan2021', 'ofa2014']);
    const open = displayLists(s, { mode: 'paper', debateTab: 'support', pushbackOpen: true, hidden: none });
    expect(open.ordered.map((r) => r.candidateId)).toEqual(['rivera2019', 'natarajan2021', 'ofa2014', 'hale2008']);
  });

  it('Debate: only the active tab is visible', () => {
    const s = demoState();
    const lists = displayLists(s, { mode: 'debate', debateTab: 'pushback', pushbackOpen: false, hidden: none });
    expect(lists.ordered.map((r) => r.candidateId)).toEqual(['hale2008']);
    expect(lists.support).toHaveLength(3);
  });

  it('drops cards marked not relevant (server) or hidden optimistically (panel)', () => {
    const s = demoState({ notRelevant: ['ofa2014'] });
    const lists = displayLists(s, { mode: 'essay', debateTab: 'support', pushbackOpen: true, hidden: new Set(['hale2008']) });
    expect(lists.ordered.map((r) => r.candidateId)).toEqual(['rivera2019', 'natarajan2021']);
  });
});

describe('empty state and picks', () => {
  it('"Nothing solid found" only when finished or stopped with nothing left', () => {
    const e = emptyState();
    const lists = { support: [], pushback: [] };
    expect(isEmptyResult(e, lists)).toBe(true);
    expect(isEmptyResult({ ...e, status: 'stopped' }, lists)).toBe(true);
    expect(isEmptyResult({ ...e, status: 'matching' }, lists)).toBe(false);
    expect(isEmptyResult({ ...e, status: 'error' }, lists)).toBe(false);
  });

  it('picked results come back in pick order and skip unknown ids', () => {
    const s = demoState({ picked: ['hale2008', 'missing', 'rivera2019'] });
    expect(pickedResults(s).map((r) => r.candidateId)).toEqual(['hale2008', 'rivera2019']);
  });
});

describe('card details', () => {
  it('amber notes: scope mismatch, local scope note, abstract only', () => {
    const [rivera, natarajan, office] = demoState().support;
    expect(scopeNotes(rivera!)).toEqual([]);
    expect(scopeNotes(natarajan!)).toEqual(['Counts low-wage jobs, not total employment.']);
    expect(scopeNotes(office!)).toEqual(['Published in 2014, before your timeframe.', ABSTRACT_ONLY_NOTE]);
  });

  it('New badge for results from a later round', () => {
    expect(isNew({ round: 1 })).toBe(false);
    expect(isNew({ round: 2 })).toBe(true);
  });

  it('meta line drops missing parts', () => {
    expect(metaLine({ authors: ['By Jane Doe'], publisher: 'Reuters', published: '2020-03-05' })).toBe('Jane Doe · Reuters · 2020');
    expect(metaLine({ authors: [], publisher: undefined, published: undefined })).toBe('');
    expect(authorsShort(['A One', 'B Two', 'C Three'])).toBe('A One et al.');
  });

  it('header claim prefers the English normalized claim', () => {
    expect(displayClaim(demoState())).toBe('Raising the minimum wage does not significantly reduce employment.');
    expect(displayClaim({ rawClaim: 'raw', plan: undefined })).toBe('raw');
  });

  it('language names from codes or words', () => {
    expect(languageName('vi')).toBe('Vietnamese');
    expect(languageName('Vietnamese')).toBe('Vietnamese');
    expect(languageName('tagalog')).toBe('Tagalog');
  });
});

describe('visibleWarnings', () => {
  const w = (code: JobWarning['code'], message: string): JobWarning => ({ code, message });

  it('dedupes, hides dismissed ones, and drops exa_missing when the academic-only banner shows', () => {
    const warnings = [w('exa_missing', 'Add an Exa key'), w('s2_limited', 'S2 busy'), w('s2_limited', 'S2 busy'), w('cost_cap', 'Cap hit')];
    const state = { warnings, academicOnly: true };
    expect(visibleWarnings(state, new Set()).map((x) => x.code)).toEqual(['s2_limited', 'cost_cap']);
    expect(visibleWarnings(state, new Set([warningKey(w('cost_cap', 'Cap hit'))])).map((x) => x.code)).toEqual(['s2_limited']);
    expect(visibleWarnings({ warnings, academicOnly: false }, new Set()).map((x) => x.code)).toEqual(['exa_missing', 's2_limited', 'cost_cap']);
  });
});
