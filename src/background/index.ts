// Service worker: message router, selection button, hotkey, context menu, job lifecycle, persistence.
import type { BackgroundToPanel, ContentRequest, FindSourceResponse, PanelToBackground, SelectionResponse } from '../shared/messages';
import { isContentToBackground } from '../shared/messages';
import type { HistoryEntry, JobState, OutputMode, SourceResult } from '../shared/types';
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
import { restoreJobState } from './session';
import { TokenStore } from './panelTokens';
import { isRestrictedUrl } from './tabs';

const SESSION_KEY = 'jobState';
const MENU_ID = 'backed-find-source';
const COMMAND = 'find-source';

let job: Job | null = null;
/** Last state shown when there is no live Job (e.g. restored after the worker restarted). */
let restored: JobState | null = null;
const ports = new Set<chrome.runtime.Port>();
const tokens = new TokenStore();

/* ------------------------------ setup ------------------------------ */

// Toolbar icon → the sidebar (side panel). Highlighting text or the shortcut → the in-page popup.
void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Find a source for this', contexts: ['selection'] }, () => void chrome.runtime.lastError);
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  // Tabs that were already open (including Google Docs) get the "Find a source" button now,
  // without needing a refresh.
  void injectIntoOpenTabs();
});

const CONTENT_SCRIPT = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];

async function injectContentScript(tabId: number): Promise<boolean> {
  if (!CONTENT_SCRIPT) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return true;
  } catch {
    return false; // restricted page
  }
}

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((t) => (t.id && !t.discarded ? injectContentScript(t.id) : Promise.resolve(false))));
}

// Restore the last job; a job that was mid-flight when the worker died is marked interrupted.
const restoring = chrome.storage.session.get(SESSION_KEY).then((got) => {
  const saved = got[SESSION_KEY] as JobState | undefined;
  const s = restoreJobState(saved);
  if (!s || job) return;
  if (s.status !== saved?.status) void chrome.storage.session.set({ [SESSION_KEY]: s });
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
      await flushPendingHint();
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
  if (port.sender?.id !== chrome.runtime.id) return;
  // The toolbar popup connects without a token; the in-page popup (inside a tab) must bring one.
  const allowed = tokens.allows(port.name, !!port.sender?.tab);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((msg: PanelToBackground) => {
    void allowed.then((ok) => {
      if (!ok) return;
      return handlePanelMessage(msg, port).catch((e: unknown) => {
        post({ type: 'HINT', message: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` });
      });
    });
  });
  void allowed.then((ok) => {
    if (ok) ports.add(port);
    else port.disconnect();
  });
});

/* ------------------------------ claim capture ------------------------------ */

let pendingHint: string | null = null;

async function flushPendingHint(): Promise<void> {
  if (!pendingHint || !ports.size) return;
  const message = pendingHint;
  pendingHint = null;
  post({ type: 'HINT', message });
}

/** Start a search for text the user picked on a page (button, hotkey or right-click). */
async function searchFor(claim: string): Promise<void> {
  const text = claim.replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!text) return;
  const settings = await loadSettings();
  await startJob(text, settings.lastMode);
}

async function sendToTab<T>(tabId: number, msg: ContentRequest): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T | undefined;
  } catch {
    return undefined; // no content script here (chrome:// pages, Web Store, tab opened before install)
  }
}

/** Open the in-page popup; returns false if this tab can't show it. */
async function openInPagePopup(tabId: number): Promise<boolean> {
  const res = await sendToTab<{ ok: boolean }>(tabId, { type: 'OPEN_PANEL', token: tokens.issue() });
  return !!res?.ok;
}

function openSidePanel(windowId: number | undefined): void {
  if (windowId === undefined) return;
  void chrome.sidePanel?.open({ windowId }).catch(() => undefined);
}

/** Ask the tab's content script; if it isn't there (tab opened before install), inject it and retry. */
async function askTab<T>(tabId: number, msg: ContentRequest): Promise<T | undefined> {
  const first = await sendToTab<T>(tabId, msg);
  if (first !== undefined) return first;
  if (!(await injectContentScript(tabId))) return undefined;
  await new Promise((r) => setTimeout(r, 150));
  return sendToTab<T>(tabId, msg);
}

async function selectionViaScripting(tabId: number): Promise<string> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.getSelection()?.toString() ?? '' });
    return typeof res?.result === 'string' ? res.result.trim() : '';
  } catch {
    return '';
  }
}

// The "Find a source" button next to highlighted text.
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: FindSourceResponse) => void) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || !isContentToBackground(msg)) return false;
  sendResponse({ token: tokens.issue() });
  void searchFor(msg.claim);
  return false;
});

// Keyboard shortcut (Alt+Shift+E by default; change it at chrome://extensions/shortcuts).
async function onHotkey(active: chrome.tabs.Tab): Promise<void> {
  if (!active.id) return;
  const sel = await askTab<SelectionResponse>(active.id, { type: 'GET_SELECTION' });
  if (!sel) {
    // Couldn't reach the page at all: search what we can read and show results in the sidebar.
    const text = await selectionViaScripting(active.id);
    if (text) await searchFor(text);
    return;
  }
  let text = sel.text.trim();
  // Google Docs draws text on a canvas; if Docs wouldn't hand over the selection, try the clipboard.
  if (!text && sel.isGoogleDocs) text = (await readClipboardViaOffscreen()).trim();
  if (text) {
    const search = searchFor(text);
    await openInPagePopup(active.id);
    await search;
    return;
  }
  // Nothing selected: the shortcut toggles the popup.
  if (sel.panelOpen) {
    await sendToTab(active.id, { type: 'CLOSE_PANEL' });
    return;
  }
  if (sel.isGoogleDocs) pendingHint = 'Highlight a sentence first (or copy it with Ctrl/Cmd+C), then press the shortcut again.';
  await openInPagePopup(active.id);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== COMMAND) return;
  // Pages where no script can run (chrome://, the Web Store…): open the sidebar right away,
  // while we still have the user gesture.
  if (!tab || isRestrictedUrl(tab.url)) {
    openSidePanel(tab?.windowId);
    return;
  }
  void onHotkey(tab);
});

// Right-click → "Find a source for this".
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id || isRestrictedUrl(tab.url)) openSidePanel(tab?.windowId);
  void (async () => {
    const search = searchFor(info.selectionText ?? '');
    if (tab?.id && !isRestrictedUrl(tab.url)) {
      const ok = await askTab<{ ok: boolean }>(tab.id, { type: 'OPEN_PANEL', token: tokens.issue() });
      void ok;
    }
    await search;
  })();
});
