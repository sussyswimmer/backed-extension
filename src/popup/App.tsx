import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { OutputMode, RefineAnswer } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { useSettings } from '../shared/ui/useSettings';
import { Spinner } from '../shared/ui/Icons';
import { isEditableTarget, keyAction, type KeyContext } from './lib/keyboard';
import { displayClaim, displayLists, isActive, isEmptyResult, pickedResults, visibleWarnings, type DebateTab } from './lib/view';
import { usePanelPort } from './usePanelPort';
import { closePopup, isFramed } from './embed';

/** Inside a web page, show nothing until the service worker has accepted this popup's token. */
const FRAMED = isFramed();
import { Banners } from './components/Banners';
import { ClaimHeader } from './components/ClaimHeader';
import { ClaimInput } from './components/ClaimInput';
import { DebugPanel } from './components/DebugPanel';
import { HistoryView } from './components/HistoryView';
import { PickedView } from './components/PickedView';
import { ProgressBar, StartingBar } from './components/ProgressBar';
import { RefinePanel } from './components/RefinePanel';
import type { ReverifyState } from './components/ResultCard';
import { Results } from './components/Results';
import { Toast, type ToastMessage } from './components/Toast';
import { TopBar, type PanelTab } from './components/TopBar';
import { btn, NotifyContext } from './components/ui';

export function App() {
  const settingsLive = useSettings();
  const settings = settingsLive ?? DEFAULT_SETTINGS;

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((message: string) => setToast({ id: Date.now() + Math.random(), message }), []);
  const closeToast = useCallback(() => setToast(null), []);

  const [tab, setTab] = useState<PanelTab>('search');
  const [screen, setScreen] = useState<'results' | 'picked'>('results');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [pendingStart, setPendingStart] = useState<{ prevJobId: string | undefined; claim: string } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [debateTab, setDebateTab] = useState<DebateTab>('support');
  const [pushbackOpen, setPushbackOpen] = useState<boolean | null>(null);
  const [reverify, setReverify] = useState<Record<string, ReverifyState>>({});
  const [modeOverride, setModeOverride] = useState<OutputMode | null>(null);
  const [waited, setWaited] = useState(false);
  const [accessed, setAccessed] = useState(() => new Date());

  const refineRef = useRef<HTMLElement | null>(null);
  const modeRef = useRef<OutputMode>('essay');
  const startRef = useRef<(claim: string) => void>(() => undefined);

  const { state, loaded, connected, send } = usePanelPort({
    onPendingClaim: (m) => {
      setDraft(m.claim);
      setTab('search');
      setScreen('results');
      if (m.autoStart) startRef.current(m.claim);
    },
    onHint: notify,
    onReverify: (m) => setReverify((prev) => ({ ...prev, [m.candidateId]: { pending: false, ok: m.ok, message: m.message } })),
  });

  /* ------------------------------ derived ------------------------------ */

  const mode: OutputMode = modeOverride ?? state?.mode ?? settingsLive?.lastMode ?? 'essay';
  useLayoutEffect(() => {
    modeRef.current = mode;
  });
  // Drop the local override once the service worker has applied it.
  useEffect(() => {
    if (modeOverride && state?.mode === modeOverride) setModeOverride(null);
  }, [state?.mode, modeOverride]);

  const running = !!state && isActive(state.status);
  const pbOpen = pushbackOpen ?? (state ? state.support.length === 0 && state.pushback.length > 0 : false);
  const lists = useMemo(
    () => (state ? displayLists(state, { mode, debateTab, pushbackOpen: pbOpen, hidden }) : { support: [], pushback: [], ordered: [] }),
    [state, mode, debateTab, pbOpen, hidden],
  );
  const hasResults = lists.support.length + lists.pushback.length > 0;
  const empty = !!state && isEmptyResult(state, lists);
  const warnings = useMemo(() => (state ? visibleWarnings(state, dismissed) : []), [state, dismissed]);
  const picked = useMemo(() => (state ? pickedResults(state) : []), [state]);

  const showInput = (!state && (loaded || (waited && !FRAMED))) || editing;
  const resultsVisible = tab === 'search' && !showInput && !pendingStart && screen === 'results' && !!state;

  /* ------------------------------ effects ------------------------------ */

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 900);
    return () => clearTimeout(t);
  }, []);

  // A different job arrived (started here, from the context menu or the hotkey): reset per-job UI.
  const jobId = state?.jobId;
  const lastJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (jobId === lastJob.current) return;
    const hadJob = lastJob.current !== undefined;
    lastJob.current = jobId;
    setHidden(new Set());
    setReverify({});
    setPushbackOpen(null);
    setDebateTab('support');
    if (jobId && hadJob) {
      setEditing(false);
      setScreen('results');
    }
  }, [jobId]);

  useEffect(() => {
    if (pendingStart && state && state.jobId !== pendingStart.prevJobId) setPendingStart(null);
  }, [state, pendingStart]);
  useEffect(() => {
    if (!pendingStart) return;
    const t = setTimeout(() => setPendingStart(null), 10_000);
    return () => clearTimeout(t);
  }, [pendingStart]);

  /* ------------------------------ actions ------------------------------ */

  const changeMode = useCallback(
    (m: OutputMode) => {
      setModeOverride(m);
      if (m !== 'debate') setDebateTab('support');
      send({ type: 'SET_MODE', mode: m });
    },
    [send],
  );

  const startJob = (claim: string) => {
    const text = claim.trim();
    if (!text) return;
    setPendingStart({ prevJobId: state?.jobId, claim: text });
    setEditing(false);
    setScreen('results');
    setTab('search');
    send({ type: 'START_JOB', claim: text, mode: modeRef.current });
  };
  useLayoutEffect(() => {
    startRef.current = startJob;
  });

  const togglePick = useCallback((id: string) => send({ type: 'TOGGLE_PICK', candidateId: id }), [send]);
  const notRelevant = useCallback(
    (id: string) => {
      setHidden((prev) => new Set(prev).add(id));
      send({ type: 'MARK_NOT_RELEVANT', candidateId: id });
    },
    [send],
  );
  const doReverify = useCallback(
    (id: string) => {
      setReverify((prev) => ({ ...prev, [id]: { pending: true } }));
      send({ type: 'REVERIFY_LIVE', candidateId: id });
    },
    [send],
  );
  const stop = useCallback(() => send({ type: 'STOP_JOB' }), [send]);
  const retry = useCallback(() => send({ type: 'RETRY_JOB' }), [send]);
  const searchAgain = useCallback((freeText: string) => send({ type: 'SEARCH_AGAIN', freeText }), [send]);
  const answerRefine = useCallback((answers: RefineAnswer[]) => send({ type: 'ANSWER_REFINE', answers }), [send]);
  const dismissRefine = useCallback(() => send({ type: 'DISMISS_REFINE' }), [send]);
  const dismissWarning = useCallback((key: string) => setDismissed((prev) => new Set(prev).add(key)), []);

  const makeOutput = useCallback(() => {
    setAccessed(new Date());
    setScreen('picked');
    send({ type: 'SAVE_HISTORY' });
    window.scrollTo({ top: 0 });
  }, [send]);

  const editClaim = () => {
    setDraft(state?.rawClaim ?? draft);
    setEditing(true);
    setScreen('results');
  };

  const focusRefine = useCallback(() => {
    const el = refineRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])') ?? el;
    target.focus();
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  /* ------------------------------ keyboard ------------------------------ */

  const keyCtx = useRef<KeyContext>({ running: false, resultsVisible: false, visibleCount: 0, refineVisible: false });
  const orderedRef = useRef(lists.ordered);
  useLayoutEffect(() => {
    keyCtx.current = {
      running: running && tab === 'search',
      resultsVisible,
      visibleCount: Math.min(9, lists.ordered.length),
      refineVisible: !!refineRef.current,
    };
    orderedRef.current = lists.ordered;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
          defaultPrevented: e.defaultPrevented,
          editable: isEditableTarget(e.target),
        },
        keyCtx.current,
      );
      if (!action) return;
      e.preventDefault();
      if (action.type === 'close') closePopup();
      else if (action.type === 'togglePick') {
        const r = orderedRef.current[action.index];
        if (r) send({ type: 'TOGGLE_PICK', candidateId: r.candidateId });
      } else focusRefine();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, focusRefine]);

  /* ------------------------------ render ------------------------------ */

  let body;
  if (tab === 'history') {
    body = <HistoryView settings={settings} />;
  } else if (showInput) {
    body = (
      <ClaimInput
        draft={draft}
        onDraft={setDraft}
        mode={mode}
        onMode={changeMode}
        onSubmit={startJob}
        onCancel={state && editing ? () => setEditing(false) : undefined}
        needsKey={!!settingsLive && !settingsLive.deepseekKey}
      />
    );
  } else if (pendingStart) {
    body = (
      <div className="bk-enter">
        <section aria-label="Claim" className="px-3 pt-3 pb-2.5">
          <span className="bk-label">Claim</span>
          <h1 className="mt-1 font-serif text-[16.5px] leading-snug font-semibold text-ink">{pendingStart.claim}</h1>
        </section>
        <StartingBar />
      </div>
    );
  } else if (!state) {
    body = (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-3">
        <Spinner className="h-4 w-4" /> Connecting…
      </div>
    );
  } else if (screen === 'picked') {
    body = (
      <PickedView
        claim={displayClaim(state)}
        results={picked}
        mode={mode}
        onModeChange={changeMode}
        settings={settings}
        accessed={accessed}
        onBack={() => setScreen('results')}
        backLabel="Back to results"
        onRemove={togglePick}
      />
    );
  } else {
    body = (
      <div>
        <ClaimHeader state={state} mode={mode} onMode={changeMode} onEdit={editClaim} />
        {running ? <ProgressBar progress={state.progress} round={state.round} onStop={stop} /> : null}
        <Banners state={state} warnings={warnings} dismissed={dismissed} onDismiss={dismissWarning} onRetry={retry} />
        <RefinePanel
          state={state}
          // In the final "refining" stage (summaries + questions) the worker queues answers.
          running={running && state.status !== 'refining'}
          pickedCount={picked.length}
          hasResults={hasResults}
          focusRef={refineRef}
          onAnswer={answerRefine}
          onDismiss={dismissRefine}
          onSearchAgain={searchAgain}
          onMakeOutput={makeOutput}
        />
        <Results
          state={state}
          mode={mode}
          lists={lists}
          running={running}
          empty={empty}
          debateTab={debateTab}
          onDebateTab={setDebateTab}
          pushbackOpen={pbOpen}
          onPushbackOpen={setPushbackOpen}
          showDebug={settings.showDebug}
          reverify={reverify}
          onTogglePick={togglePick}
          onNotRelevant={notRelevant}
          onReverify={doReverify}
          onSearchAgain={searchAgain}
        />
        {settings.showDebug ? <DebugPanel debug={state.debug} /> : null}
      </div>
    );
  }

  const showPickBar = resultsVisible && picked.length > 0;

  if (FRAMED && !loaded) {
    // No STATE yet: either still connecting, or the token was refused (a page embedding us).
    // Render nothing from storage — no input, no history — so there is nothing to click.
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-[13px] text-ink-3" aria-live="polite">
        <Spinner className="h-4 w-4" /> Connecting…
      </div>
    );
  }

  return (
    <NotifyContext.Provider value={notify}>
      <div className="flex min-h-screen flex-col">
        <TopBar tab={tab} onTab={setTab} connected={connected || !loaded} />
        <main className={`flex-1 ${showPickBar ? 'pb-20' : 'pb-8'}`}>{body}</main>
        {showPickBar ? (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/92 px-3 py-2 backdrop-blur">
            <button type="button" className={btn('primary', 'md', 'w-full')} onClick={makeOutput}>
              {picked.length} picked → Make output
            </button>
          </div>
        ) : null}
        <Toast toast={toast} onClose={closeToast} raised={showPickBar} />
      </div>
    </NotifyContext.Provider>
  );
}
