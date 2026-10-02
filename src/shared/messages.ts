// Every cross-boundary message, typed in one place.
import type { JobState, OutputMode, RefineAnswer } from './types';

/* ------------------------------------------------------------------ */
/* Popup <-> service worker (long-lived port named PANEL_PORT)          */
/* ------------------------------------------------------------------ */

/**
 * The toolbar popup connects as `PANEL_PORT`. The in-page popup (an iframe on a web page) connects
 * as `PANEL_PORT:<token>`, with a one-time token the service worker handed to the content script,
 * so a web page that embeds the popup page itself gets nothing.
 */
export const PANEL_PORT = 'backed-panel';

export function panelPortName(token?: string): string {
  return token ? `${PANEL_PORT}:${token}` : PANEL_PORT;
}

/** Message the in-page popup posts to its parent page to ask the content script to close it. */
export const FRAME_CLOSE = 'backed:close';

export type PanelToBackground =
  | { type: 'GET_STATE' }
  | { type: 'START_JOB'; claim: string; mode: OutputMode }
  | { type: 'STOP_JOB' }
  | { type: 'RETRY_JOB' }
  | { type: 'ANSWER_REFINE'; answers: RefineAnswer[] }
  /** "None of these fit" -> "What's missing?" free text, or an empty-state chip. */
  | { type: 'SEARCH_AGAIN'; freeText: string }
  | { type: 'DISMISS_REFINE' }
  | { type: 'MARK_NOT_RELEVANT'; candidateId: string }
  | { type: 'TOGGLE_PICK'; candidateId: string }
  | { type: 'SET_MODE'; mode: OutputMode }
  | { type: 'REVERIFY_LIVE'; candidateId: string }
  | { type: 'SAVE_HISTORY' }
  | { type: 'CLEAR_JOB' };

export type BackgroundToPanel =
  | { type: 'STATE'; state: JobState | null }
  | { type: 'PENDING_CLAIM'; claim: string; origin: ClaimOrigin; autoStart: boolean }
  | { type: 'HINT'; message: string }
  | { type: 'REVERIFY_RESULT'; candidateId: string; ok: boolean; message: string };

export type ClaimOrigin = 'panel' | 'context_menu' | 'hotkey' | 'google_docs' | 'selection_button';

/* ------------------------------------------------------------------ */
/* Service worker -> offscreen document (chrome.runtime.sendMessage)    */
/* ------------------------------------------------------------------ */

export const OFFSCREEN_TARGET = 'backed-offscreen';

export interface ExtractedHtml {
  title?: string;
  byline?: string;
  published?: string;
  /** Main text with blank lines between blocks. */
  text: string;
}

export interface ExtractedPdf {
  /** Raw page texts (lines joined by \n), only for kept pages. */
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  title?: string;
  author?: string;
}

export type OffscreenRequest =
  | { target: typeof OFFSCREEN_TARGET; type: 'EXTRACT_HTML'; html: string; url: string }
  | {
      target: typeof OFFSCREEN_TARGET;
      type: 'EXTRACT_PDF';
      /** base64-encoded PDF bytes */
      dataBase64: string;
      keyTerms: string[];
      firstPages: number;
      maxScanPages: number;
    }
  | { target: typeof OFFSCREEN_TARGET; type: 'READ_CLIPBOARD' };

export type OffscreenResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Service worker <-> content script (every page)                      */
/* ------------------------------------------------------------------ */

export type ContentRequest =
  /** Hotkey pressed: report the selection (Google Docs-aware) and whether a popup is open. */
  | { type: 'GET_SELECTION' }
  | { type: 'OPEN_PANEL'; token: string }
  | { type: 'CLOSE_PANEL' };

export interface SelectionResponse {
  text: string;
  method: 'selection' | 'input' | 'docs' | 'copy_event' | 'none';
  isGoogleDocs: boolean;
  panelOpen: boolean;
}

/** Content script -> service worker (chrome.runtime.sendMessage). */
export type ContentToBackground =
  /** The user clicked the "Find a source" button next to a selection. Reply: { token }. */
  { type: 'FIND_SOURCE'; claim: string };

export interface FindSourceResponse {
  token: string;
}

/** Back-compat name used by tests of the Docs grabber. */
export interface DocsSelectionResponse {
  text: string;
  method: 'selection' | 'copy_event' | 'none';
}

export function isContentToBackground(msg: unknown): msg is ContentToBackground {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'FIND_SOURCE' && typeof (msg as { claim?: unknown }).claim === 'string';
}

export function isOffscreenRequest(msg: unknown): msg is OffscreenRequest {
  return typeof msg === 'object' && msg !== null && (msg as { target?: unknown }).target === OFFSCREEN_TARGET;
}
