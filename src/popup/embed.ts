// The popup page runs in two places: Chrome's toolbar popup, and an iframe the content script
// shows next to highlighted text on a web page (URL hash "#frame=<token>").
import { FRAME_CLOSE } from '../shared/messages';

export function frameToken(): string | undefined {
  const m = /(?:^#|&)frame=([0-9a-f]{32})(?:&|$)/.exec(typeof location !== 'undefined' ? location.hash : '');
  return m?.[1];
}

export function isFramed(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/** Close the popup: ask the page's content script to remove the iframe, or close the toolbar popup. */
export function closePopup(): void {
  if (isFramed()) window.parent.postMessage({ type: FRAME_CLOSE }, '*');
  else window.close();
}
