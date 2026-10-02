// Content script on every page.
//  - Highlight some text → a small "Find a source" button appears next to it. Click it and the
//    Backed popup opens right there and starts searching.
//  - The keyboard shortcut (handled by the service worker) asks this script for the selection and
//    opens / closes the popup.
// The popup is an iframe of the extension's own popup page inside a closed shadow root, so the
// page's CSS can't touch it and the page can't read it. Styles are set through the CSSOM
// (element.style), which page Content-Security-Policies don't block.
import { FRAME_CLOSE, type ContentRequest, type ContentToBackground, type FindSourceResponse, type SelectionResponse } from '../shared/messages';
import { SELECTION_BUTTON_KEY } from '../shared/storageKeys';
import { grabDocsSelection } from './docs';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/**
 * Did this press/release look like a text selection? Docs in edit mode doesn't expose the
 * highlighted text, so we infer it from the gesture: a drag across the text, a triple-click
 * (paragraph), or a Shift+click that extends the selection.
 */
export function isSelectionGesture(g: { dx: number; dy: number; clicks: number; shift: boolean }): boolean {
  return Math.hypot(g.dx, g.dy) > 8 || g.clicks >= 3 || g.shift;
}

const MIN_CHARS = 12;
const MIN_WORDS = 3;
const MAX_CHARS = 4000;
const POPUP_W = 400;
const POPUP_H = 600;
const MARGIN = 12;
const TOP_Z = '2147483647';
const IS_GOOGLE_DOCS = location.hostname === 'docs.google.com' && location.pathname.startsWith('/document/');

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface PageSelection {
  text: string;
  /** Where the selection ends (for the button) and its overall box (for the popup). */
  end: Rect | null;
  box: Rect | null;
  method: 'selection' | 'input' | 'docs';
}

/**
 * Google Docs draws text on a canvas, so the page has no DOM selection. But Docs mirrors the
 * selected text into a hidden contenteditable inside `iframe.docs-texteventtarget-iframe`
 * (checked on a live Doc, Oct 2026); its selection is exactly what the user highlighted.
 */
export function docsSelectionText(doc: Document = document): string {
  const frame = doc.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
  try {
    return frame?.contentWindow?.getSelection()?.toString() ?? '';
  } catch {
    return '';
  }
}

/** Where Docs shows its text caret (the end of a keyboard selection). */
function docsCaretRect(): Rect | null {
  const caret = document.querySelector('.kix-cursor-caret');
  return caret ? toRect(caret.getBoundingClientRect()) : null;
}

/** Text worth searching: a few words, not a whole page. */
export function isClaimLike(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length >= MIN_CHARS && t.length <= MAX_CHARS && t.split(' ').length >= MIN_WORDS;
}

function toRect(r: DOMRect | undefined | null): Rect | null {
  if (!r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0)) return null;
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

/** The current selection, including text selected inside a textarea or text input. */
export function readSelection(isOurs: (n: Node | null) => boolean): PageSelection | null {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|)$/i.test(el.type))) {
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if (a !== null && b !== null && b > a) {
      const box = toRect(el.getBoundingClientRect());
      return { text: el.value.slice(a, b), end: box, box, method: 'input' };
    }
  }
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (isOurs(range.commonAncestorContainer)) return null;
  const text = sel.toString();
  let end: Rect | null = null;
  let box: Rect | null = null;
  if (typeof range.getClientRects === 'function') {
    const rects = range.getClientRects();
    end = toRect(rects[rects.length - 1]);
    box = toRect(range.getBoundingClientRect());
  }
  return { text, end, box, method: 'selection' };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Popup position: below the selection if it fits, else above, else pinned top-right. */
export function popupPosition(anchor: Rect | null, vw: number, vh: number): { top: number; left: number; width: number; height: number } {
  const width = Math.min(POPUP_W, vw - 2 * MARGIN);
  const height = Math.min(POPUP_H, vh - 2 * MARGIN);
  if (!anchor) return { top: MARGIN, left: vw - width - MARGIN, width, height };
  const left = clamp(anchor.left, MARGIN, vw - width - MARGIN);
  if (anchor.bottom + 8 + height <= vh - MARGIN) return { top: anchor.bottom + 8, left, width, height };
  if (anchor.top - 8 - height >= MARGIN) return { top: anchor.top - 8 - height, left, width, height };
  return { top: MARGIN, left: vw - width - MARGIN, width, height };
}

/* ------------------------------------------------------------------ */
/* UI                                                                   */
/* ------------------------------------------------------------------ */

type Styles = Partial<Record<keyof CSSStyleDeclaration, string>>;
function styled<K extends keyof HTMLElementTagNameMap>(tag: K, css: Styles): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el.style, css);
  return el;
}

function svgIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const box = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: '1', y: '1', width: '22', height: '22', rx: '6', fill: '#1e5a46' })) box.setAttribute(k, v);
  const check = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d: 'M7 12.5l3.2 3.2L17 9', fill: 'none', stroke: '#fff', 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) check.setAttribute(k, v);
  svg.append(box, check);
  return svg;
}

export interface BackedUi {
  /** Shown "Find a source" button, if any. */
  button(): HTMLButtonElement | null;
  /** The popup iframe, if open. */
  frame(): HTMLIFrameElement | null;
  openPopup(token: string, anchor: Rect | null): void;
  closePopup(): void;
  hideButton(): void;
}

export function installBacked(): BackedUi {
  const host = document.createElement('backed-extension-ui');
  host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;';
  const root = host.attachShadow({ mode: 'closed' });
  let buttonEnabled = true;
  let buttonEl: HTMLButtonElement | null = null;
  let buttonClaim = '';
  /** How the button's text was found: read directly, or (Docs edit mode) to be copied on click. */
  let buttonMethod: PageSelection['method'] = 'selection';
  let buttonFromMirror = false;
  /** Last text the user copied inside Google Docs (Cmd/Ctrl+C), as a fallback source. */
  let lastDocsCopy: { text: string; at: number } | null = null;
  let buttonAnchor: Rect | null = null;
  let frameWrap: HTMLDivElement | null = null;
  let frameEl: HTMLIFrameElement | null = null;
  let lastAnchor: Rect | null = null;

  // After the extension is reloaded or updated, this copy of the script is cut off from it
  // (chrome.runtime.id becomes undefined). The new copy takes over; this one removes itself.
  const orphaned = () => {
    let gone = true;
    try {
      gone = !chrome.runtime?.id;
    } catch {
      gone = true;
    }
    if (gone) host.remove();
    return gone;
  };
  // A newer copy announces itself; older copies step aside.
  let retired = false;
  document.dispatchEvent(new CustomEvent('backed:takeover'));
  document.addEventListener('backed:takeover', () => {
    host.remove();
    retired = true;
  });
  for (const old of Array.from(document.querySelectorAll('backed-extension-ui'))) old.remove();

  const mount = () => {
    if (retired) return;
    if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
  };
  const isOurs = (n: Node | null) => !!n && (n === host || host.contains(n));
  const eventIsOurs = (e: Event) => e.composedPath().includes(host);

  // The user's preference lives in its own storage key so this script never loads the API keys.
  try {
    void chrome.storage.local.get(SELECTION_BUTTON_KEY).then((got) => {
      buttonEnabled = got[SELECTION_BUTTON_KEY] !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SELECTION_BUTTON_KEY]) {
        buttonEnabled = changes[SELECTION_BUTTON_KEY].newValue !== false;
        if (!buttonEnabled) hideButton();
      }
    });
  } catch {
    // storage unavailable (e.g. extension reloaded): keep the default
  }

  function hideButton() {
    buttonEl?.remove();
    buttonEl = null;
  }

  function setButtonLabel(btn: HTMLButtonElement, label: string) {
    const textNode = Array.from(btn.childNodes).find((n) => n.nodeType === 3);
    if (textNode) textNode.nodeValue = label;
  }

  /**
   * The highlighted Docs text right now: Docs' hidden copy, a copy Docs makes for us, or — only if
   * the user copied *after* `since` — what they copied themselves. Never older clipboard content.
   */
  function readDocsSelectionNow(since: number): string {
    const mirror = docsSelectionText();
    if (isClaimLike(mirror)) return mirror.trim();
    const grabbed = grabDocsSelection().text.trim();
    if (grabbed) return grabbed;
    if (lastDocsCopy && lastDocsCopy.at >= since) return lastDocsCopy.text;
    return '';
  }
  let buttonShownAt = 0;

  /** Window scroll plus the Docs editor's own scroll container, as one number. */
  function scrollPositions(): number {
    const editor = IS_GOOGLE_DOCS ? document.querySelector('.kix-appview-editor') : null;
    return window.scrollY + window.scrollX + (editor ? editor.scrollTop + editor.scrollLeft : 0);
  }
  let buttonScroll = 0;
  let lastPointer: { x: number; y: number; at: number } | null = null;

  function showButton(sel: PageSelection, mouse: { x: number; y: number } | null) {
    hideButton();
    mount();
    const at = sel.end ? { x: sel.end.right, y: sel.end.bottom } : mouse;
    if (!at) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // In Google Docs the button goes above the pointer: Docs shows its own bubble just below.
    const top = sel.method === 'docs' ? (at.y - 44 >= 4 ? at.y - 44 : at.y + 22) : at.y + 6;
    const btn = styled('button', {
      position: 'fixed',
      top: `${clamp(top, 4, vh - 40)}px`,
      left: `${clamp(at.x - 12, 4, vw - 150)}px`,
      zIndex: TOP_Z,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 10px 5px 6px',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '999px',
      background: '#fffdf8',
      color: '#1d1b17',
      font: '600 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
      cursor: 'pointer',
      opacity: '0',
      transform: 'translateY(2px)',
      transition: 'opacity 120ms ease, transform 120ms ease',
    });
    btn.type = 'button';
    btn.title = 'Find a source for this (Backed)';
    btn.setAttribute('aria-label', 'Find a source for the highlighted text');
    btn.append(svgIcon(), document.createTextNode('Find a source'));
    // Keep the page's selection when the button is pressed.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let claim = buttonClaim;
      if (!claim && buttonMethod === 'docs') {
        // Docs edit mode: get the highlighted text now, the way Cmd/Ctrl+C would.
        claim = readDocsSelectionNow(buttonShownAt);
        if (!isClaimLike(claim)) {
          setButtonLabel(btn, claim ? 'Select a full sentence' : `Press ${IS_MAC ? '⌘C' : 'Ctrl+C'}, then click`);
          return;
        }
      }
      const anchor = buttonAnchor;
      hideButton();
      void findSource(claim, anchor);
    });
    root.appendChild(btn);
    buttonEl = btn;
    buttonScroll = scrollPositions();
    buttonClaim = sel.text;
    buttonMethod = sel.method;
    buttonShownAt = Date.now();
    buttonAnchor = sel.box ?? sel.end;
    requestAnimationFrame(() => {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    });
  }

  async function findSource(claim: string, anchor: Rect | null) {
    let res: FindSourceResponse | undefined;
    try {
      res = (await chrome.runtime.sendMessage({ type: 'FIND_SOURCE', claim } satisfies ContentToBackground)) as FindSourceResponse | undefined;
    } catch {
      return; // extension was reloaded; this old content script can't reach it
    }
    if (res?.token) openPopup(res.token, anchor);
  }

  function openPopup(token: string, anchor: Rect | null) {
    hideButton();
    mount();
    const pos = popupPosition(anchor, window.innerWidth, window.innerHeight);
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    if (!frameWrap) {
      frameWrap = styled('div', {
        position: 'fixed',
        zIndex: TOP_Z,
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 18px 50px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.10)',
        background: dark ? '#131210' : '#f5f2ea',
        opacity: '0',
        transition: 'opacity 140ms ease',
      });
      root.appendChild(frameWrap);
    }
    Object.assign(frameWrap.style, { top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px`, height: `${pos.height}px` });
    frameEl?.remove();
    const frame = styled('iframe', { width: '100%', height: '100%', border: '0', display: 'block', colorScheme: 'normal' });
    frame.title = 'Backed';
    frame.setAttribute('allow', 'clipboard-write');
    frame.src = `${chrome.runtime.getURL('src/popup/index.html')}#frame=${encodeURIComponent(token)}`;
    frame.addEventListener('load', () => {
      if (frameWrap) frameWrap.style.opacity = '1';
      frame.focus();
    });
    frameWrap.appendChild(frame);
    frameEl = frame;
    // In case 'load' doesn't fire (e.g. blocked), still show the card.
    setTimeout(() => {
      if (frameWrap) frameWrap.style.opacity = '1';
    }, 400);
  }

  function closePopup() {
    frameEl?.remove();
    frameEl = null;
    frameWrap?.remove();
    frameWrap = null;
  }

  /* ---------------------------- page events ---------------------------- */

  const maybeShowButton = (mouse: { x: number; y: number } | null, gesture = false) => {
    if (retired || orphaned() || !buttonEnabled || frameEl) return;
    if (IS_GOOGLE_DOCS) {
      checkDocsSelection(mouse, 0, gesture);
      return;
    }
    const sel = readSelection(isOurs);
    if (!sel || !isClaimLike(sel.text)) {
      hideButton();
      return;
    }
    lastAnchor = sel.box ?? sel.end;
    showButton(sel, mouse);
  };

  // Docs fills its hidden selection a moment after mouseup/keyup: look a few times.
  const DOCS_RETRIES = [40, 120, 300, 700];
  let docsCheck = 0;
  function docsAnchor(mouse: { x: number; y: number } | null): { point: { x: number; y: number }; anchor: Rect } {
    const caret = docsCaretRect();
    const point = mouse ?? (caret ? { x: caret.right, y: caret.top } : { x: window.innerWidth / 2, y: 140 });
    return { point, anchor: { top: point.y - 10, bottom: point.y + 10, left: point.x - 200, right: point.x } };
  }

  function checkDocsSelection(mouse: { x: number; y: number } | null, attempt: number, gesture: boolean) {
    const id = ++docsCheck;
    const run = (i: number) => {
      if (id !== docsCheck || frameEl) return;
      const text = docsSelectionText();
      if (isClaimLike(text)) {
        // View mode (and some edit modes): Docs hands over the exact text.
        if (buttonEl && buttonMethod === 'docs') {
          buttonClaim = text;
          buttonFromMirror = true;
          return;
        }
        const { point, anchor } = docsAnchor(mouse);
        lastAnchor = anchor;
        showButton({ text, end: null, box: anchor, method: 'docs' }, point);
        buttonFromMirror = true;
        return;
      }
      if (gesture && !buttonEl) {
        // Edit mode: the text isn't readable yet. Show the button now; read the text on click.
        const { point, anchor } = docsAnchor(mouse);
        lastAnchor = anchor;
        showButton({ text: '', end: null, box: anchor, method: 'docs' }, point);
        buttonFromMirror = false;
      }
      if (i + 1 < DOCS_RETRIES.length) setTimeout(() => run(i + 1), DOCS_RETRIES[i + 1]! - DOCS_RETRIES[i]!);
      else if (!gesture) hideButton();
    };
    setTimeout(() => run(attempt), DOCS_RETRIES[attempt]);
  }

  // Keyboard selections in Docs happen inside its hidden text iframe; listen there too.
  let docsFrameDoc: Document | null = null;
  function watchDocsFrame() {
    if (!IS_GOOGLE_DOCS) return;
    const d = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe')?.contentDocument ?? null;
    if (!d || d === docsFrameDoc) return;
    docsFrameDoc = d;
    d.addEventListener('keyup', (e) => {
      const arrows = /^(Arrow|Home|End|Page)/.test(e.key);
      if ((e.shiftKey && arrows) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) maybeShowButton(null, true);
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (buttonEl) hideButton();
        else if (frameEl) closePopup();
      } else if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) {
        hideButton(); // typing or moving the caret clears the selection
      }
    });
    // Remember what the user copies in Docs (Cmd/Ctrl+C): a fallback when the text can't be read.
    d.defaultView?.addEventListener('copy', (e) => {
      const t = e.clipboardData?.getData('text/plain')?.trim();
      if (t) lastDocsCopy = { text: t, at: Date.now() };
    });
  }
  // Safety net for Docs: watch the hidden selection itself, so the button shows up however the
  // text was selected (mouse, keyboard, double-click, Docs' own menus) even if no event reached us.
  let polled = '';
  function pollDocsSelection() {
    if (retired || frameEl || !buttonEnabled || !document.hasFocus()) return;
    const text = docsSelectionText();
    if (text === polled) return;
    polled = text;
    if (!isClaimLike(text)) {
      if (buttonEl && buttonFromMirror && !text.trim()) hideButton();
      return;
    }
    if (buttonEl && buttonClaim === text) return;
    if (buttonEl && buttonMethod === 'docs') {
      buttonClaim = text;
      buttonFromMirror = true;
      return;
    }
    if (orphaned()) return;
    const recent = lastPointer && Date.now() - lastPointer.at < 3000 ? lastPointer : null;
    const caret = docsCaretRect();
    // Last resort: top of the visible document, centred.
    const point = recent ?? (caret ? { x: caret.right, y: caret.top } : { x: window.innerWidth / 2, y: 140 });
    const anchor: Rect | null = point ? { top: point.y - 10, bottom: point.y + 10, left: point.x - 200, right: point.x } : null;
    lastAnchor = anchor;
    showButton({ text, end: null, box: anchor, method: 'docs' }, point);
    buttonFromMirror = true;
  }
  if (IS_GOOGLE_DOCS) {
    watchDocsFrame();
    setInterval(watchDocsFrame, 2000);
    setInterval(pollDocsSelection, 400);
  }

  // Pointer release. Listen for pointerup as well as mouseup: editors like Google Docs (edit mode)
  // cancel pointerdown, which stops the browser from sending mouse events at all.
  let lastRelease = { type: '', at: 0, x: -1, y: -1 };
  const onRelease = (e: MouseEvent) => {
    if (eventIsOurs(e) || e.button !== 0) return;
    const now = Date.now();
    // The same click arrives as pointerup and then mouseup: handle it once.
    const sameClick = e.type !== lastRelease.type && now - lastRelease.at < 80 && e.clientX === lastRelease.x && e.clientY === lastRelease.y;
    lastRelease = { type: e.type, at: now, x: e.clientX, y: e.clientY };
    if (sameClick) return;
    watchDocsFrame();
    lastPointer = { x: e.clientX, y: e.clientY, at: now };
    const mouse = { x: e.clientX, y: e.clientY };
    const gesture =
      IS_GOOGLE_DOCS && !!press?.inText && isSelectionGesture({ dx: e.clientX - press.x, dy: e.clientY - press.y, clicks: clicks.n, shift: e.shiftKey });
    setTimeout(() => maybeShowButton(mouse, gesture), 0);
  };
  window.addEventListener('pointerup', onRelease, true);
  window.addEventListener('mouseup', onRelease, true);
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) maybeShowButton(null);
    },
    true,
  );
  // Track presses in the Docs text area to recognise drags, triple-clicks and Shift+clicks.
  let press: { x: number; y: number; inText: boolean } | null = null;
  let clicks = { n: 0, at: 0, x: -1, y: -1, type: '' };
  const onPress = (e: Event) => {
    if (eventIsOurs(e)) return;
    hideButton();
    if (!IS_GOOGLE_DOCS || !(e instanceof MouseEvent) || e.button !== 0) return;
    const now = Date.now();
    // pointerdown + mousedown for the same press count once.
    if (e.type !== clicks.type && now - clicks.at < 80 && e.clientX === clicks.x && e.clientY === clicks.y) return;
    const near = Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) < 6 && now - clicks.at < 500;
    clicks = { n: near ? clicks.n + 1 : 1, at: now, x: e.clientX, y: e.clientY, type: e.type };
    const target = e.target instanceof Element ? e.target : null;
    press = { x: e.clientX, y: e.clientY, inText: !!target?.closest('.kix-appview-editor') };
  };
  window.addEventListener('pointerdown', onPress, true);
  window.addEventListener('mousedown', onPress, true);
  document.addEventListener('selectionchange', () => {
    if (IS_GOOGLE_DOCS) return; // Docs never has a DOM selection; its own handlers cover it
    const sel = document.getSelection();
    if (buttonEl && (!sel || sel.isCollapsed) && !(document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement)) hideButton();
  });
  // Hide on scroll only when the page really moved (Docs fires small scroll events on selection).
  window.addEventListener(
    'scroll',
    () => {
      if (!buttonEl) return;
      const pos = scrollPositions();
      if (Math.abs(pos - buttonScroll) > 24) hideButton();
    },
    true,
  );
  window.addEventListener('resize', () => {
    hideButton();
    if (frameWrap) {
      const pos = popupPosition(null, window.innerWidth, window.innerHeight);
      const cur = frameWrap.getBoundingClientRect();
      if (cur.right > window.innerWidth || cur.bottom > window.innerHeight) {
        Object.assign(frameWrap.style, { top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px`, height: `${pos.height}px` });
      }
    }
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (buttonEl) hideButton();
      else if (frameEl) closePopup();
    },
    true,
  );

  // The popup asks to be closed (its × button or Esc inside it). Only trust our own iframe.
  window.addEventListener('message', (e) => {
    if (!frameEl || e.source !== frameEl.contentWindow) return;
    if ((e.data as { type?: unknown } | null)?.type === FRAME_CLOSE) closePopup();
  });

  /* ---------------------------- service worker ---------------------------- */

  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse: (r: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || typeof msg !== 'object' || msg === null) return false;
    switch (msg.type) {
      case 'GET_SELECTION': {
        let res: SelectionResponse;
        if (IS_GOOGLE_DOCS) {
          const text = readDocsSelectionNow(Date.now() - 15_000);
          res = { text, method: text ? 'docs' : 'none', isGoogleDocs: true, panelOpen: !!frameEl };
        } else {
          const sel = readSelection(isOurs);
          if (sel) lastAnchor = sel.box ?? sel.end;
          res = { text: sel?.text.trim() ?? '', method: sel?.method ?? 'none', isGoogleDocs: false, panelOpen: !!frameEl };
        }
        sendResponse(res);
        return false;
      }
      case 'OPEN_PANEL':
        openPopup(msg.token, lastAnchor);
        lastAnchor = null;
        sendResponse({ ok: true });
        return false;
      case 'CLOSE_PANEL':
        closePopup();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  return {
    button: () => buttonEl,
    frame: () => frameEl,
    openPopup,
    closePopup,
    hideButton,
  };
}

// Run once per page (not inside frames: manifest has all_frames: false).
let installed: BackedUi | undefined;
if (typeof chrome !== 'undefined' && chrome.runtime?.id) installed = installBacked();
export const backedUi = (): BackedUi | undefined => installed;
