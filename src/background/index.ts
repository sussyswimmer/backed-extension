// Service worker: message router, context menu, hotkey, job lifecycle, persistence.
import type { BackgroundToPanel, ClaimOrigin, ContentRequest, DocsSelectionResponse, PanelToBackground } from '../shared/messages';
import { PANEL_PORT } from '../shared/messages';
import type { HistoryEntry, JobState, OutputMode, SourceResult } from '../shared/types';
import { ACTIVE_STATUSES } from '../shared/types';
import { loadSettings, rememberMode } from '../shared/settings';
import { saveHistoryEntry } from '../shared/history';
import { exportMarkdown } from '../shared/cite';
import { normalizeDocText } from '../shared/text';
import { DeepSeekClient } from './llm/deepseek';
import { createAdapters } from './sources';
import { Job, newJobState } from './pipeline';
import { offscreenExtractor, readClipboardViaOffscreen } from './offscreenClient';
import { fetchDocument, MIN_FULL_TEXT_CHARS } from './extract/getText';
import { cleanPdfPages } from './extract/pdfClean';
import { stripMarkdown } from './extract/markdown';
import { isVerbatimIn } from './match/verify';

const SESSION_KEY = 'jobState';
const MENU_ID = 'backed-find-source';
const COMMAND = 'find-source';

let job: Job | null = null;
/** Last state shown when there is no live Job (e.g. restored after the worker restarted). */
let restored: JobState | null = null;
const ports = new Set<chrome.runtime.Port>();

/* ------------------------------ setup ------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Find a source for this', contexts: ['selection'] }, () => void chrome.runtime.lastError);
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

// Restore the last job; a job that was mid-flight when the worker died is marked interrupted.
const restoring = chrome.storage.session.get(SESSION_KEY).then((got) => {
  const s = got[SESSION_KEY] as JobState | undefined;
  if (!s || job) return;
  if (ACTIVE_STATUSES.includes(s.status)) {
    s.status = 'interrupted';
    s.refining = undefined;
    s.progress = { stage: 'interrupted', message: 'Search interrupted. Press Retry to run it again.', percent: s.progress.percent };
    void chrome.storage.session.set({ [SESSION_KEY]: s });
  }
  restored = s;
});

/* ------------------------------ broadcasting ------------------------------ */

let emitTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function currentState(): JobState | null {
  return job?.state ?? restored;
}

function post(msg: BackgroundToPanel): void {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      ports.delete(p);
    }
  }
}

function scheduleEmit(): void {
  if (!emitTimer) {
    emitTimer = setTimeout(() => {
      emitTimer = null;
      post({ type: 'STATE', state: currentState() });
    }, 120);
  }
  if (!persistTimer) {
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const s = currentState();
      void chrome.storage.session.set({ [SESSION_KEY]: s }).catch(() => undefined);
    }, 800);
  }
}

/* ------------------------------ keepalive ------------------------------ */

let keepAlive: ReturnType<typeof setInterval> | null = null;
function setKeepAlive(on: boolean): void {
  if (on && !keepAlive) keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  if (!on && keepAlive) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
}

/* ------------------------------ jobs ------------------------------ */

async function hasPageAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

async function startJob(claim: string, mode: OutputMode): Promise<void> {
  const text = claim.trim();
  if (!text) return;
  job?.stop();
  const settings = await loadSettings();
  await rememberMode(mode);
  if (!settings.deepseekKey) {
    job = null;
    const s = newJobState(text, mode, Date.now());
    s.status = 'error';
    s.error = { code: 'no_key', message: 'Add your DeepSeek key in options to start searching.', showOptionsLink: true };
    s.progress = { stage: 'error', message: s.error.message, percent: 0 };
    restored = s;
    scheduleEmit();
    return;
  }
  restored = null;
  const current = new Job(text, mode, {
    settings,
    makeLlm: (onUsage) => new DeepSeekClient({ apiKey: settings.deepseekKey, model: settings.model, prices: settings.prices, onUsage }),
    adapters: createAdapters({
      exaKey: settings.exaKey,
      openalexKey: settings.openalexKey,
      contactEmail: settings.contactEmail,
      exaResultsPerAdapter: settings.exaResultsPerAdapter,
    }),
    extractor: offscreenExtractor,
    canFetchPages: await hasPageAccess(),
    emit: () => scheduleEmit(),
  });
  job = current;
  setKeepAlive(true);
  try {
    await current.start();
  } finally {
    if (job === current && !current.isRunning) setKeepAlive(false);
  }
}

async function withJob(fn: (j: Job) => Promise<void> | void): Promise<void> {
  if (!job) return;
  const j = job;
  setKeepAlive(true);
  try {
    await fn(j);
  } finally {
    if (!j.isRunning) setKeepAlive(false);
    scheduleEmit();
  }
}

function pickedResults(state: JobState): SourceResult[] {
  const all = [...state.support, ...state.pushback];
  return state.picked.map((id) => all.find((r) => r.candidateId === id)).filter((r): r is SourceResult => !!r);
}

async function saveHistory(): Promise<void> {
  const s = currentState();
  if (!s) return;
  const settings = await loadSettings();
  const picked = pickedResults(s);
  const entry: HistoryEntry = {
    jobId: s.jobId,
    claim: s.rawClaim,
    mode: s.mode,
    answers: s.answers,
    picked,
    outputs: {
      markdown: exportMarkdown({
        claim: s.plan?.normalizedClaim ?? s.rawClaim,
        mode: s.mode,
        results: picked,
        styles: settings.citationStyles,
        accessed: new Date(),
        honestyLine: settings.honestyLine,
      }),
    },
    savedAt: Date.now(),
  };
  if (s.plan?.normalizedClaim) entry.normalizedClaim = s.plan.normalizedClaim;
  await saveHistoryEntry(entry);
}

/** Debug panel: re-fetch the live page and check the shown passage is still on it. */
async function reverifyLive(candidateId: string): Promise<void> {
  const s = currentState();
  const result = s && [...s.support, ...s.pushback].find((r) => r.candidateId === candidateId);
  if (!result) return;
  const reply = (ok: boolean, message: string) => post({ type: 'REVERIFY_RESULT', candidateId, ok, message });
  if (!(await hasPageAccess())) return reply(false, 'Allow page access first (Options → Page access).');
  try {
    const url = result.textSource === 'pdf' ? result.finalUrl : result.meta.url;
    const ctrl = new AbortController();
    const f = await fetchDocument(url, { signal: ctrl.signal, timeoutMs: 15_000 });
    let text = '';
    if (f.kind === 'pdf') {
      const pdf = await offscreenExtractor.pdf(f.bytes, { keyTerms: [], firstPages: 400, maxScanPages: 400 });
      text = cleanPdfPages(pdf.pages).text;
    } else {
      const html = new TextDecoder().decode(f.bytes);
      text = normalizeDocText((await offscreenExtractor.html(html, f.finalUrl)).text);
    }
    if (text.length < MIN_FULL_TEXT_CHARS) return reply(false, 'The live page has too little readable text (paywall or script-only page).');
    const ok = result.best.fragments.every((fr) => isVerbatimIn(text, fr.text) || isVerbatimIn(stripMarkdown(text), fr.text));
    reply(ok, ok ? 'Passage found verbatim on the live page.' : 'Passage NOT found on the live page. The page may have changed since it was indexed.');
  } catch (e) {
    reply(false, `Couldn’t load the live page (${e instanceof Error ? e.message : 'error'}).`);
  }
}

async function handlePanelMessage(msg: PanelToBackground, port: chrome.runtime.Port): Promise<void> {
  switch (msg.type) {
    case 'GET_STATE':
      await restoring;
      port.postMessage({ type: 'STATE', state: currentState() } satisfies BackgroundToPanel);
      await flushPendingClaim();
      return;
    case 'START_JOB':
      await startJob(msg.claim, msg.mode);
      return;
    case 'STOP_JOB':
      job?.stop();
      setKeepAlive(false);
      scheduleEmit();
      return;
    case 'RETRY_JOB': {
      const s = currentState();
      if (s) await startJob(s.rawClaim, s.mode);
      return;
    }
    case 'ANSWER_REFINE':
      await withJob((j) => j.answerRefine(msg.answers));
      return;
    case 'SEARCH_AGAIN':
      await withJob((j) => j.searchAgain(msg.freeText));
      return;
    case 'DISMISS_REFINE':
      await withJob((j) => j.dismissRefine());
      return;
    case 'MARK_NOT_RELEVANT':
      await withJob((j) => j.markNotRelevant(msg.candidateId));
      return;
    case 'TOGGLE_PICK':
      if (job) await withJob((j) => j.togglePick(msg.candidateId));
      else if (restored) {
        const i = restored.picked.indexOf(msg.candidateId);
        if (i >= 0) restored.picked.splice(i, 1);
        else restored.picked.push(msg.candidateId);
        scheduleEmit();
      }
      return;
    case 'SET_MODE':
      await rememberMode(msg.mode);
      if (job) await withJob((j) => j.setMode(msg.mode));
      else if (restored) {
        restored.mode = msg.mode;
        scheduleEmit();
      }
      return;
    case 'REVERIFY_LIVE':
      await reverifyLive(msg.candidateId);
      return;
    case 'SAVE_HISTORY':
      await saveHistory();
      return;
    case 'CLEAR_JOB':
      job?.stop();
      job = null;
      restored = null;
      setKeepAlive(false);
      await chrome.storage.session.remove(SESSION_KEY);
      scheduleEmit();
      return;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((msg: PanelToBackground) => {
    void handlePanelMessage(msg, port).catch((e: unknown) => {
      post({ type: 'HINT', message: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` });
    });
  });
});

/* ------------------------------ claim capture ------------------------------ */

interface PendingClaim {
  claim: string;
  origin: ClaimOrigin;
  autoStart: boolean;
}
let pending: PendingClaim | null = null;

async function flushPendingClaim(): Promise<void> {
  if (!pending || !ports.size) return;
  const p = pending;
  pending = null;
  post({ type: 'PENDING_CLAIM', claim: p.claim, origin: p.origin, autoStart: p.autoStart });
}

async function deliverClaim(claim: string, origin: ClaimOrigin): Promise<void> {
  const text = claim.replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!text) return;
  const settings = await loadSettings();
  // Start right away (search first, ask after); the panel picks up the state when it connects.
  pending = { claim: text, origin, autoStart: false };
  await flushPendingClaim();
  await startJob(text, settings.lastMode);
}

function openPanel(windowId: number | undefined): void {
  // Must be called synchronously inside the user gesture.
  if (windowId === undefined) return;
  void chrome.sidePanel.open({ windowId }).catch(() => undefined);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  openPanel(tab?.windowId);
  void deliverClaim(info.selectionText ?? '', 'context_menu');
});

async function selectionFromTab(tab: chrome.tabs.Tab): Promise<{ text: string; origin: ClaimOrigin }> {
  if (!tab.id) return { text: '', origin: 'hotkey' };
  if (tab.url?.startsWith('https://docs.google.com/document/')) {
    let text = '';
    try {
      const res = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_DOCS_SELECTION' } satisfies ContentRequest)) as DocsSelectionResponse | undefined;
      text = res?.text ?? '';
    } catch {
      // Content script not injected (tab opened before install) — fall through to the clipboard.
    }
    if (!text) text = await readClipboardViaOffscreen();
    return { text, origin: 'google_docs' };
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.getSelection()?.toString() ?? '' });
    return { text: typeof res?.result === 'string' ? res.result : '', origin: 'hotkey' };
  } catch {
    return { text: '', origin: 'hotkey' };
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== COMMAND) return;
  openPanel(tab?.windowId);
  void (async () => {
    const active = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!active) return;
    const { text, origin } = await selectionFromTab(active);
    if (text.trim()) {
      await deliverClaim(text, origin);
    } else if (origin === 'google_docs') {
      // Give the panel a moment to open before showing the hint.
      setTimeout(() => post({ type: 'HINT', message: 'Copy the sentence first (Ctrl/Cmd+C), then press the hotkey again.' }), 600);
    }
  })();
});
