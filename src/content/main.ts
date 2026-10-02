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
  method: 'selection' | 'input';
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
  let buttonAnchor: Rect | null = null;
  let frameWrap: HTMLDivElement | null = null;
  let frameEl: HTMLIFrameElement | null = null;
  let lastAnchor: Rect | null = null;

  const mount = () => {
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

  function showButton(sel: PageSelection, mouse: { x: number; y: number } | null) {
    hideButton();
    mount();
    const at = sel.end ? { x: sel.end.right, y: sel.end.bottom } : mouse;
    if (!at) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btn = styled('button', {
      position: 'fixed',
      top: `${clamp(at.y + 6, 4, vh - 40)}px`,
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
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const claim = buttonClaim;
      const anchor = buttonAnchor;
      hideButton();
      void findSource(claim, anchor);
    });
    root.appendChild(btn);
    buttonEl = btn;
    buttonClaim = sel.text;
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

  const maybeShowButton = (mouse: { x: number; y: number } | null) => {
    if (!buttonEnabled || frameEl) return;
    const sel = readSelection(isOurs);
    if (!sel || !isClaimLike(sel.text)) {
      hideButton();
      return;
    }
    lastAnchor = sel.box ?? sel.end;
    showButton(sel, mouse);
  };

  document.addEventListener(
    'mouseup',
    (e) => {
      if (eventIsOurs(e) || e.button !== 0) return;
      const mouse = { x: e.clientX, y: e.clientY };
      setTimeout(() => maybeShowButton(mouse), 0);
    },
    true,
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) maybeShowButton(null);
    },
    true,
  );
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!eventIsOurs(e)) hideButton();
    },
    true,
  );
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (buttonEl && (!sel || sel.isCollapsed) && !(document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement)) hideButton();
  });
  window.addEventListener('scroll', () => hideButton(), true);
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
          const d = grabDocsSelection();
          res = { text: d.text, method: d.method, isGoogleDocs: true, panelOpen: !!frameEl };
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
