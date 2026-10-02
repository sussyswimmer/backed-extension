// Every cross-boundary message, typed in one place.
import type { JobState, OutputMode, RefineAnswer } from './types';

/* ------------------------------------------------------------------ */
/* Side panel <-> service worker (long-lived port named PANEL_PORT)    */
/* ------------------------------------------------------------------ */

export const PANEL_PORT = 'backed-panel';

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

export type ClaimOrigin = 'panel' | 'context_menu' | 'hotkey' | 'google_docs';

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
/* Service worker -> Google Docs content script (chrome.tabs.sendMessage) */
/* ------------------------------------------------------------------ */

export type ContentRequest = { type: 'GET_DOCS_SELECTION' };

export interface DocsSelectionResponse {
  text: string;
  method: 'selection' | 'copy_event' | 'none';
}

export function isOffscreenRequest(msg: unknown): msg is OffscreenRequest {
  return typeof msg === 'object' && msg !== null && (msg as { target?: unknown }).target === OFFSCREEN_TARGET;
}
