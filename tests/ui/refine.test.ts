import { describe, expect, it } from 'vitest';
import { KEEP_AS_IS, type RefineCard } from '../../src/shared/types';
import { atMaxRounds, choiceOptions, collectAnswers, EMPTY_STATE_CHIPS, hasChanges, isKeepAsIs, refiningLabel, showQuestions } from '../../src/sidepanel/lib/refine';
import { demoState } from './fixtures';

const card: RefineCard = {
  round: 1,
  coverageNote: '3 sources',
  questions: [
    { id: 'a', text: 'Region?', kind: 'choice', options: ['Vietnam', 'keep as is', 'Vietnam ', 'Europe'], why: 'All US', affects: 'regions' },
    { id: 'b', text: 'Years?', kind: 'text', why: 'Old', affects: 'years' },
  ],
};

describe('choiceOptions', () => {
  it('dedupes options and puts exactly one "Keep as is" last', () => {
    expect(choiceOptions(card.questions[0]!)).toEqual(['Vietnam', 'Europe', KEEP_AS_IS]);
    expect(choiceOptions({ ...card.questions[0]!, options: undefined })).toEqual([KEEP_AS_IS]);
  });
});

describe('collectAnswers', () => {
  it('answers every question; blanks become "Keep as is"', () => {
    expect(collectAnswers(card, {})).toEqual([
      { questionId: 'a', answer: KEEP_AS_IS },
      { questionId: 'b', answer: KEEP_AS_IS },
    ]);
    expect(collectAnswers(card, { a: 'Vietnam', b: '  2015  onwards ' })).toEqual([
      { questionId: 'a', answer: 'Vietnam' },
      { questionId: 'b', answer: '2015 onwards' },
    ]);
  });

  it('hasChanges is false when everything is kept as is', () => {
    expect(hasChanges(collectAnswers(card, {}))).toBe(false);
    expect(hasChanges(collectAnswers(card, { a: KEEP_AS_IS, b: '   ' }))).toBe(false);
    expect(hasChanges(collectAnswers(card, { a: 'Europe' }))).toBe(true);
    expect(isKeepAsIs(' KEEP AS IS ')).toBe(true);
  });
});

describe('showQuestions', () => {
  it('shows questions until dismissed, while refining, or at the round limit', () => {
    const s = demoState();
    expect(showQuestions(s)).toBe(true);
    expect(showQuestions({ ...s, refineDismissed: true })).toBe(false);
    expect(showQuestions({ ...s, refining: 'Refining: Europe' })).toBe(false);
    expect(showQuestions({ ...s, round: 3, maxRounds: 3 })).toBe(false);
    expect(showQuestions({ ...s, refine: undefined })).toBe(false);
    expect(atMaxRounds({ round: 3, maxRounds: 3 })).toBe(true);
    expect(atMaxRounds({ round: 2, maxRounds: 3 })).toBe(false);
  });
});

describe('copy', () => {
  it('refining label reads well with or without the prefix', () => {
    expect(refiningLabel('Refining: Vietnam only, 2015+…')).toBe('Refining: Vietnam only, 2015+…');
    expect(refiningLabel('Vietnam only')).toBe('Refining: Vietnam only');
    expect(refiningLabel('')).toBe('Refining…');
  });

  it('empty-state chips send the fixed free text', () => {
    expect(EMPTY_STATE_CHIPS.map((c) => c.freeText)).toEqual([
      'Broaden the timeframe: any year is fine.',
      'Drop the region limit.',
      'Correlational evidence is fine.',
      'Show sources for the counter view too.',
    ]);
  });
});
