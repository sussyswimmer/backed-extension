import { useEffect, useMemo, useState } from 'react';
import { clearHistory, deleteHistoryEntry, filterHistory, HISTORY_KEY, loadHistory } from '../../shared/history';
import type { HistoryEntry, OutputMode, Settings } from '../../shared/types';
import { IconSearch, IconTrash } from '../../shared/ui/Icons';
import { shortDate } from '../lib/format';
import { countLabel, MODE_LABELS, MODES } from '../lib/view';
import { PickedView } from './PickedView';
import { btn, useNotify } from './ui';

export function HistoryView({ settings }: { settings: Settings }) {
  const notify = useNotify();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<OutputMode | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<OutputMode>('essay');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let alive = true;
    const reload = () =>
      loadHistory().then(
        (list) => {
          if (alive) setEntries(list);
        },
        () => {
          if (alive) setEntries([]);
        },
      );
    void reload();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[HISTORY_KEY]) void reload();
    };
    try {
      chrome.storage.onChanged.addListener(onChanged);
    } catch {
      // no storage events
    }
    return () => {
      alive = false;
      try {
        chrome.storage.onChanged.removeListener(onChanged);
      } catch {
        // ignore
      }
    };
  }, []);

  const shown = useMemo(() => filterHistory(entries ?? [], query, modeFilter), [entries, query, modeFilter]);
  const open = openId ? (entries ?? []).find((e) => e.jobId === openId) : undefined;
  const openSavedAt = open?.savedAt;
  const accessed = useMemo(() => new Date(openSavedAt ?? Date.now()), [openSavedAt]);

  if (open) {
    return (
      <PickedView
        claim={open.normalizedClaim || open.claim}
        results={open.picked}
        mode={openMode}
        onModeChange={setOpenMode}
        settings={settings}
        accessed={accessed}
        onBack={() => setOpenId(null)}
        backLabel="Back to history"
        readOnly
        subtitle={`Saved ${shortDate(open.savedAt)} · read-only`}
        answers={open.answers}
      />
    );
  }

  const remove = async (id: string) => {
    await deleteHistoryEntry(id).catch(() => undefined);
    setEntries((list) => (list ?? []).filter((e) => e.jobId !== id));
    notify('Deleted from history');
  };
  const clearAll = async () => {
    await clearHistory().catch(() => undefined);
    setEntries([]);
    setConfirmClear(false);
    notify('History cleared');
  };

  return (
    <div className="bk-enter px-3 pt-3 pb-6">
      <h1 className="font-serif text-[18px] font-semibold tracking-tight">History</h1>
      <p className="text-[12px] text-ink-3">Finished searches with the sources you picked. Opens without searching again.</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <label className="relative min-w-0 flex-1 basis-40">
          <span className="sr-only">Search history</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search claims"
            className="h-8 w-full rounded-md border border-rule-strong bg-card pr-2.5 pl-8 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
        <label>
          <span className="sr-only">Filter by format</span>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value === 'all' ? 'all' : (e.target.value as OutputMode))}
            className="h-8 rounded-md border border-rule-strong bg-card px-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          >
            <option value="all">All formats</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entries === null ? (
        <p className="mt-6 text-center text-[13px] text-ink-3">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-3">Nothing here yet. Pick sources and press “Make output” to save a search.</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-center text-[13px] text-ink-3">No saved searches match.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((e) => (
            <li key={e.jobId} className="group flex items-start gap-1 rounded-xl border border-rule bg-card transition-colors hover:border-rule-strong">
              <button
                type="button"
                onClick={() => {
                  setOpenMode(e.mode);
                  setOpenId(e.jobId);
                }}
                className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left"
              >
                <span className="line-clamp-2 font-serif text-[14.5px] leading-snug font-semibold text-ink">{e.normalizedClaim || e.claim}</span>
                <span className="mt-1 block text-[11.5px] text-ink-3">
                  {MODE_LABELS[e.mode]} · {countLabel(e.picked.length)} · {shortDate(e.savedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void remove(e.jobId)}
                aria-label={`Delete “${(e.normalizedClaim || e.claim).slice(0, 60)}” from history`}
                title="Delete"
                className={btn('ghost', 'icon', 'mt-2 mr-1.5 opacity-60 group-hover:opacity-100 focus-visible:opacity-100')}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {entries && entries.length > 0 ? (
        <div className="mt-5 border-t border-rule pt-3">
          {confirmClear ? (
            <div role="alertdialog" aria-label="Clear all history?" className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              <span>Delete all {countLabel(entries.length, 'saved search', 'saved searches')}?</span>
              <button type="button" className={btn('danger', 'xs')} onClick={() => void clearAll()} autoFocus>
                Clear all
              </button>
              <button type="button" className={btn('secondary', 'xs')} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className={btn('quiet', 'bare')} onClick={() => setConfirmClear(true)}>
              Clear all history
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
