// @vitest-environment jsdom
// The page script: "Find a source" button on highlight, the in-page popup, and the shortcut.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackedUi } from '../../src/content/main';

type Listener = (msg: unknown, sender: { id?: string }, respond: (r: unknown) => void) => boolean;
let onMessage: Listener | undefined;
const sendMessage = vi.fn(async (_msg: unknown) => ({ token: 'a'.repeat(32) }));
let storageGet = vi.fn(async (_k: string) => ({}) as Record<string, unknown>);
let ui: BackedUi;
let mod: typeof import('../../src/content/main');

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      getURL: (p: string) => `chrome-extension://ext-id/${p}`,
      sendMessage: (m: unknown) => sendMessage(m),
      onMessage: { addListener: (fn: Listener) => (onMessage = fn) },
    },
    storage: { local: { get: (k: string) => storageGet(k) }, onChanged: { addListener: () => undefined } },
  };
  if (!('requestAnimationFrame' in window)) (window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number;
  mod = await import('../../src/content/main');
  ui = mod.backedUi()!;
});

function select(text: string): void {
  document.body.innerHTML = `<p id="p">${text}</p>`;
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('p')!);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

async function mouseUp(): Promise<void> {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 120, button: 0 }));
  await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  ui.closePopup();
  ui.hideButton();
  sendMessage.mockClear();
});

describe('selection helpers', () => {
  it('only offers the button for claim-sized text', () => {
    expect(mod.isClaimLike('Minimum wage hikes do not cost jobs.')).toBe(true);
    expect(mod.isClaimLike('wage')).toBe(false);
    expect(mod.isClaimLike('two words')).toBe(false);
    expect(mod.isClaimLike('word '.repeat(2000))).toBe(false);
  });

  it('places the popup below the selection, else above, else top-right', () => {
    expect(mod.popupPosition({ top: 100, bottom: 120, left: 50, right: 300 }, 1200, 900)).toEqual({ top: 128, left: 50, width: 400, height: 600 });
    expect(mod.popupPosition({ top: 700, bottom: 720, left: 1100, right: 1150 }, 1200, 900)).toEqual({ top: 92, left: 788, width: 400, height: 600 });
    expect(mod.popupPosition(null, 1200, 900)).toEqual({ top: 12, left: 788, width: 400, height: 600 });
    expect(mod.popupPosition(null, 360, 500)).toEqual({ top: 12, left: 12, width: 336, height: 476 });
  });
});

describe('Find a source button', () => {
  it('appears when a claim is highlighted and not for a single word', async () => {
    select('Minimum wage hikes do not cost jobs.');
    await mouseUp();
    expect(ui.button()?.textContent).toBe('Find a source');
    select('word');
    await mouseUp();
    expect(ui.button()).toBeNull();
  });

  it('click → asks the worker to search, then opens the popup with the token it got back', async () => {
    select('Minimum wage hikes do not cost jobs.');
    await mouseUp();
    ui.button()!.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'FIND_SOURCE', claim: 'Minimum wage hikes do not cost jobs.' });
    const frame = ui.frame();
    expect(frame?.src).toBe(`chrome-extension://ext-id/src/popup/index.html#frame=${'a'.repeat(32)}`);
    expect(frame?.getAttribute('allow')).toBe('clipboard-write');
    expect(ui.button()).toBeNull();
  });

  it('hides on Escape and on clicking elsewhere; Escape also closes the popup', async () => {
    select('Minimum wage hikes do not cost jobs.');
    await mouseUp();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ui.button()).toBeNull();
    await mouseUp();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ui.button()).toBeNull();
    ui.openPopup('b'.repeat(32), null);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ui.frame()).toBeNull();
  });

  it('respects the "show the button" setting being off', async () => {
    vi.resetModules();
    storageGet = vi.fn(async () => ({ selectionButton: false }));
    const keepListener = onMessage;
    const fresh = await import('../../src/content/main');
    const ui2 = fresh.backedUi()!;
    onMessage = keepListener;
    await new Promise((r) => setTimeout(r, 5));
    ui.hideButton();
    select('Minimum wage hikes do not cost jobs.');
    await mouseUp();
    expect(ui2.button()).toBeNull();
    storageGet = vi.fn(async () => ({}));
  });
});

describe('popup ⇄ page', () => {
  it('closes only when its own iframe asks', () => {
    ui.openPopup('c'.repeat(32), null);
    const frame = ui.frame()!;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'backed:close' }, source: window }));
    expect(ui.frame()).toBe(frame); // the page itself can't close it
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'backed:close' }, source: frame.contentWindow }));
    expect(ui.frame()).toBeNull();
  });
});

describe('shortcut messages from the worker', () => {
  const ask = (msg: unknown, id = 'ext-id') => {
    let reply: unknown;
    onMessage?.(msg, { id }, (r) => (reply = r));
    return reply;
  };

  it('GET_SELECTION reports the selected text and whether the popup is open', () => {
    select('Minimum wage hikes do not cost jobs.');
    expect(ask({ type: 'GET_SELECTION' })).toEqual({ text: 'Minimum wage hikes do not cost jobs.', method: 'selection', isGoogleDocs: false, panelOpen: false });
    ui.openPopup('d'.repeat(32), null);
    expect(ask({ type: 'GET_SELECTION' })).toMatchObject({ panelOpen: true });
  });

  it('OPEN_PANEL / CLOSE_PANEL open and close the popup; other senders are ignored', () => {
    ask({ type: 'OPEN_PANEL', token: 'e'.repeat(32) });
    expect(ui.frame()?.src).toContain('#frame=' + 'e'.repeat(32));
    expect(ask({ type: 'CLOSE_PANEL' }, 'evil-ext')).toBeUndefined();
    expect(ui.frame()).not.toBeNull();
    ask({ type: 'CLOSE_PANEL' });
    expect(ui.frame()).toBeNull();
  });

  it('reads text selected inside a textarea', () => {
    document.body.innerHTML = '<textarea id="t">My essay says remote work makes people more productive.</textarea>';
    const ta = document.getElementById('t') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(14, ta.value.length);
    expect(ask({ type: 'GET_SELECTION' })).toMatchObject({ text: 'remote work makes people more productive.', method: 'input' });
  });
});

describe('Google Docs hidden selection', () => {
  it('reads the text Docs mirrors into its hidden text iframe', () => {
    document.body.innerHTML = '<iframe class="docs-texteventtarget-iframe"></iframe>';
    const frame = document.querySelector('iframe')!;
    const fdoc = frame.contentDocument!;
    fdoc.body.innerHTML = '<div contenteditable="true" id="e">PJM Interconnection also has a capacity market</div>';
    const range = fdoc.createRange();
    range.selectNodeContents(fdoc.getElementById('e')!);
    frame.contentWindow!.getSelection()!.removeAllRanges();
    frame.contentWindow!.getSelection()!.addRange(range);
    expect(mod.docsSelectionText()).toBe('PJM Interconnection also has a capacity market');
  });

  it('returns nothing outside Docs', () => {
    document.body.innerHTML = '<p>no docs here</p>';
    expect(mod.docsSelectionText()).toBe('');
  });
});
