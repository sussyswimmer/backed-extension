// Google Docs selection grabber. Docs renders text on a canvas, so window.getSelection() is
// usually empty. We try, in order:
//   1. the normal DOM selection (works in some Docs modes),
//   2. the hidden text-event iframe's selection,
//   3. asking Docs to copy the selection and reading it from the copy event.
// If all fail, the service worker falls back to the clipboard and finally shows a hint.
// Used by the main content script (src/content/main.ts) on docs.google.com.
import type { DocsSelectionResponse } from '../shared/messages';

function domSelection(win: Window | null | undefined): string {
  try {
    return win?.getSelection()?.toString().trim() ?? '';
  } catch {
    return '';
  }
}

function textEventFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
}

/** Ask Docs to copy the current selection and capture what it puts on the clipboard. */
function viaCopyEvent(): string {
  const frame = textEventFrame();
  const targetDoc = frame?.contentDocument ?? document;
  let captured = '';
  const onCopy = (e: Event) => {
    const data = (e as ClipboardEvent).clipboardData?.getData('text/plain');
    if (data) captured = data;
  };
  // Bubble phase on the window runs after Docs' own handler has filled clipboardData.
  const win = targetDoc.defaultView ?? window;
  win.addEventListener('copy', onCopy);
  try {
    targetDoc.execCommand('copy');
  } catch {
    // ignore
  } finally {
    win.removeEventListener('copy', onCopy);
  }
  return captured.trim();
}

export function grabDocsSelection(): DocsSelectionResponse {
  const direct = domSelection(window);
  if (direct) return { text: direct, method: 'selection' };
  const frameSel = domSelection(textEventFrame()?.contentWindow);
  if (frameSel) return { text: frameSel, method: 'selection' };
  const copied = viaCopyEvent();
  if (copied) return { text: copied, method: 'copy_event' };
  return { text: '', method: 'none' };
}
