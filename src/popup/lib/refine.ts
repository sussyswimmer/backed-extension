// Refine card helpers: options with exactly one "Keep as is", collecting answers, empty-state chips.
import type { JobState, RefineAnswer, RefineCard, RefineQuestion } from '../../shared/types';
import { KEEP_AS_IS } from '../../shared/types';

/** questionId -> chosen option or typed text. */
export type Selections = Record<string, string>;

export function isKeepAsIs(answer: string): boolean {
  return answer.trim().toLowerCase() === KEEP_AS_IS.toLowerCase();
}

/** The question's options, trimmed and de-duplicated, with "Keep as is" exactly once, last. */
export function choiceOptions(q: RefineQuestion): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of q.options ?? []) {
    const o = typeof raw === 'string' ? raw.trim() : '';
    if (!o || isKeepAsIs(o)) continue;
    const key = o.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  out.push(KEEP_AS_IS);
  return out;
}

/** One answer per question; blank or unanswered questions become "Keep as is". */
export function collectAnswers(card: RefineCard, selections: Selections): RefineAnswer[] {
  return card.questions.map((q) => {
    const raw = (selections[q.id] ?? '').replace(/\s+/g, ' ').trim();
    return { questionId: q.id, answer: raw || KEEP_AS_IS };
  });
}

/** Whether "Search again with these" would change anything. */
export function hasChanges(answers: RefineAnswer[]): boolean {
  return answers.some((a) => a.answer.trim() !== '' && !isKeepAsIs(a.answer));
}

/** Show the questions (not just the pick prompt)? */
export function showQuestions(state: Pick<JobState, 'refine' | 'refineDismissed' | 'refining' | 'round' | 'maxRounds'>): boolean {
  return !!state.refine && !state.refineDismissed && !state.refining && state.round < state.maxRounds;
}

/** No more search rounds allowed for this job. */
export function atMaxRounds(state: Pick<JobState, 'round' | 'maxRounds'>): boolean {
  return state.round >= state.maxRounds;
}

/** One-click chips on the "Nothing solid found" screen. Each sends SEARCH_AGAIN with fixed text. */
export const EMPTY_STATE_CHIPS: ReadonlyArray<{ label: string; freeText: string }> = [
  { label: 'Any year is fine', freeText: 'Broaden the timeframe: any year is fine.' },
  { label: 'Drop the region limit', freeText: 'Drop the region limit.' },
  { label: 'Correlational is fine', freeText: 'Correlational evidence is fine.' },
  { label: 'Show the counter view', freeText: 'Show sources for the counter view too.' },
];

/** "Refining: Vietnam only, 2015+…" — the background already prefixes it; make sure it reads well. */
export function refiningLabel(refining: string): string {
  const t = refining.trim();
  if (!t) return 'Refining…';
  return /^refining\b/i.test(t) ? t : `Refining: ${t}`;
}
