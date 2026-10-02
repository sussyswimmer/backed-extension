// Display derivations for the results view: labels, visible order, empty state, banners.
import type { CandidateMeta, JobState, JobStatus, JobWarning, OutputMode, Relation, SourceResult, SourceTier } from '../../shared/types';
import { ACTIVE_STATUSES } from '../../shared/types';
import { yearOf } from '../../shared/text';

export const TIER_LABELS: Record<SourceTier, string> = {
  peer_reviewed: 'Peer-reviewed',
  gov_igo: 'Gov-IGO',
  think_tank: 'Think tank',
  major_news: 'Major news',
  preprint: 'Preprint',
  web: 'Web',
};

export const RELATION_LABELS: Record<Relation, string> = {
  direct: 'Direct',
  paraphrase: 'Paraphrase',
  partial: 'Partial',
  contradicts: 'Contradicts',
};

export const MODE_LABELS: Record<OutputMode, string> = { paper: 'Paper', essay: 'Essay', debate: 'Debate' };
export const MODES: readonly OutputMode[] = ['paper', 'essay', 'debate'];

export const ABSTRACT_ONLY_NOTE = 'Abstract only — we couldn’t read the full text';
export const ACADEMIC_ONLY_NOTE = 'Web, news, think tanks and gov are off — add an Exa key';

export function isActive(status: JobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Arrived in a later search round. */
export function isNew(r: Pick<SourceResult, 'round'>): boolean {
  return typeof r.round === 'number' && r.round > 1;
}

function cleanAuthor(a: string): string {
  return a.replace(/^\s*by\s+/i, '').replace(/\s+/g, ' ').trim();
}

/** "Jane Doe", "Jane Doe, John Roe", "Jane Doe et al." */
export function authorsShort(authors: readonly string[]): string {
  const list = authors.map(cleanAuthor).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length <= 2) return list.join(', ');
  return `${list[0]} et al.`;
}

/** "Card, Krueger · American Economic Review · 1994" with missing parts dropped. */
export function metaLine(meta: Pick<CandidateMeta, 'authors' | 'publisher' | 'published'>): string {
  const year = yearOf(meta.published);
  const publisher = (meta.publisher ?? '').replace(/\s+/g, ' ').trim();
  return [authorsShort(meta.authors ?? []), publisher, year ? String(year) : ''].filter(Boolean).join(' · ');
}

/** Amber notes for a card: scope mismatch, outside the chosen constraints, abstract only. */
export function scopeNotes(r: Pick<SourceResult, 'best' | 'localScopeNote' | 'textSource'>): string[] {
  const notes: string[] = [];
  const mismatch = r.best.scopeMismatch?.trim();
  if (mismatch) notes.push(mismatch);
  const local = r.localScopeNote?.trim();
  if (local && local !== mismatch) notes.push(local);
  if (r.textSource === 'abstract_only') notes.push(ABSTRACT_ONLY_NOTE);
  return notes;
}

export type DebateTab = 'support' | 'pushback';

export interface DisplayOptions {
  mode: OutputMode;
  debateTab: DebateTab;
  pushbackOpen: boolean;
  /** Cards hidden optimistically after "Not relevant". */
  hidden: ReadonlySet<string>;
}

export interface DisplayLists {
  support: SourceResult[];
  pushback: SourceResult[];
  /** Cards on screen, top to bottom (what the 1–9 keys address). */
  ordered: SourceResult[];
}

export function displayLists(state: Pick<JobState, 'support' | 'pushback' | 'notRelevant'>, opts: DisplayOptions): DisplayLists {
  const gone = new Set<string>([...state.notRelevant, ...opts.hidden]);
  const support = state.support.filter((r) => !gone.has(r.candidateId));
  const pushback = state.pushback.filter((r) => !gone.has(r.candidateId));
  let ordered: SourceResult[];
  if (opts.mode === 'debate') ordered = opts.debateTab === 'pushback' ? pushback : support;
  else ordered = opts.pushbackOpen ? [...support, ...pushback] : support;
  return { support, pushback, ordered };
}

/** "Nothing solid found": the job is finished (or stopped) and nothing verified is left. */
export function isEmptyResult(state: Pick<JobState, 'status'>, lists: Pick<DisplayLists, 'support' | 'pushback'>): boolean {
  return (state.status === 'ready' || state.status === 'stopped') && lists.support.length === 0 && lists.pushback.length === 0;
}

/** Picked results in the order they were picked. */
export function pickedResults(state: Pick<JobState, 'picked' | 'support' | 'pushback'>): SourceResult[] {
  const byId = new Map<string, SourceResult>();
  for (const r of [...state.support, ...state.pushback]) byId.set(r.candidateId, r);
  return state.picked.map((id) => byId.get(id)).filter((r): r is SourceResult => !!r);
}

export function warningKey(w: JobWarning): string {
  return `${w.code}:${w.message}`;
}

/**
 * Warnings to show as amber banners: de-duplicated, minus the ones dismissed this session, minus
 * "Exa missing" when the academic-only banner already says the same thing.
 */
export function visibleWarnings(state: Pick<JobState, 'warnings' | 'academicOnly'>, dismissed: ReadonlySet<string>): JobWarning[] {
  const seen = new Set<string>();
  return state.warnings.filter((w) => {
    if (state.academicOnly && w.code === 'exa_missing') return false;
    const key = warningKey(w);
    if (seen.has(key) || dismissed.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "1 source" / "3 sources". */
export function countLabel(n: number, one = 'source', many = 'sources'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The claim shown in headers: the English normalized claim once known. */
export function displayClaim(state: Pick<JobState, 'plan' | 'rawClaim'>): string {
  return state.plan?.normalizedClaim?.trim() || state.rawClaim;
}

/** "Vietnamese" from "vi", "Vietnamese" or "vietnamese"; leaves unknown values readable. */
export function languageName(lang: string): string {
  const t = lang.trim();
  if (!t) return '';
  if (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(t)) {
    try {
      const names = new Intl.DisplayNames(['en'], { type: 'language' });
      const name = names.of(t);
      if (name && name.toLowerCase() !== t.toLowerCase()) return name;
    } catch {
      // fall through
    }
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
