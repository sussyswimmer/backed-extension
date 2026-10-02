// Job history in chrome.storage.local (last 200 jobs; oldest dropped).
import type { HistoryEntry, OutputMode } from './types';

export const HISTORY_KEY = 'history';
export const HISTORY_CAP = 200;

export function upsertEntry(list: HistoryEntry[], entry: HistoryEntry, cap = HISTORY_CAP): HistoryEntry[] {
  const rest = list.filter((e) => e.jobId !== entry.jobId);
  return [entry, ...rest].sort((a, b) => b.savedAt - a.savedAt).slice(0, cap);
}

export function filterHistory(list: HistoryEntry[], query: string, mode: OutputMode | 'all'): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  return list.filter((e) => {
    if (mode !== 'all' && e.mode !== mode) return false;
    if (!q) return true;
    return e.claim.toLowerCase().includes(q) || (e.normalizedClaim ?? '').toLowerCase().includes(q);
  });
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const got = await chrome.storage.local.get(HISTORY_KEY);
  const list = got[HISTORY_KEY];
  return Array.isArray(list) ? (list as HistoryEntry[]) : [];
}

export async function saveHistoryEntry(entry: HistoryEntry): Promise<void> {
  const list = await loadHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: upsertEntry(list, entry) });
}

export async function deleteHistoryEntry(jobId: string): Promise<void> {
  const list = await loadHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: list.filter((e) => e.jobId !== jobId) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}
