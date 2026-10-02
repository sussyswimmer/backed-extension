// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://docs.google.com/document/d/abc123/edit" }
// On a Google Docs page: no DOM selection and (in edit mode) no mouse events at all — the button
// must still appear, found by watching the hidden selection Docs keeps in its text-input iframe.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BackedUi } from '../../src/content/main';

let ui: BackedUi;
let sendMessage: ReturnType<typeof vi.fn>;
let mod: typeof import('../../src/content/main');

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      getURL: (p: string) => `chrome-extension://ext-id/${p}`,
      sendMessage: (sendMessage = vi.fn(async (_m: unknown) => ({ token: 'f'.repeat(32) }))),
      onMessage: { addListener: () => undefined },
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => undefined } },
  };
  if (!('requestAnimationFrame' in window)) (window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number;
  document.hasFocus = () => true;
  document.body.innerHTML = '<div class="kix-appview-editor"><div class="kix-cursor-caret"></div></div><iframe class="docs-texteventtarget-iframe"></iframe>';
  mod = await import('../../src/content/main');
  ui = mod.backedUi()!;
});

function docsSelect(text: string): void {
  const frame = document.querySelector('iframe')!;
  const fdoc = frame.contentDocument!;
  fdoc.body.innerHTML = `<div contenteditable="true" id="e">${text}</div>`;
  const range = fdoc.createRange();
  range.selectNodeContents(fdoc.getElementById('e')!);
  const sel = frame.contentWindow!.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('Google Docs page', () => {
  it('shows the button from the hidden selection without any mouse or pointer event', async () => {
    expect(location.hostname).toBe('docs.google.com');
    docsSelect('Congress can prevent an economic disaster by creating government regulations');
    await new Promise((r) => setTimeout(r, 900)); // two polling ticks
    expect(ui.button()?.textContent).toBe('Find a source');
  });

  it('hides it again when the selection goes away', async () => {
    docsSelect('');
    await new Promise((r) => setTimeout(r, 900));
    expect(ui.button()).toBeNull();
  });
});

/** Edit mode: Docs keeps only a space in its hidden selection, as seen on a real editable Doc. */
function editModeHidden(): Document {
  docsSelect(' ');
  return document.querySelector('iframe')!.contentDocument!;
}

function drag(fromX: number, toX: number): void {
  const target = document.querySelector('.kix-appview-editor')!;
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: fromX, clientY: 300, button: 0 }));
  target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: toX, clientY: 302, button: 0 }));
}

describe('Google Docs edit mode (text not exposed)', () => {
  it('recognises selection gestures', () => {
    expect(mod.isSelectionGesture({ dx: 120, dy: 0, clicks: 1, shift: false })).toBe(true); // drag
    expect(mod.isSelectionGesture({ dx: 0, dy: 0, clicks: 3, shift: false })).toBe(true); // triple-click
    expect(mod.isSelectionGesture({ dx: 0, dy: 0, clicks: 1, shift: true })).toBe(true); // shift+click
    expect(mod.isSelectionGesture({ dx: 2, dy: 1, clicks: 1, shift: false })).toBe(false); // plain click
    expect(mod.isSelectionGesture({ dx: 0, dy: 0, clicks: 2, shift: false })).toBe(false); // double-click = one word
  });

  it('a drag across the text shows the button; clicking it copies the selection out of Docs', async () => {
    const fdoc = editModeHidden();
    await new Promise((r) => setTimeout(r, 450)); // let the poller see the blank selection
    ui.hideButton();
    fdoc.execCommand = vi.fn((cmd: string) => {
      if (cmd !== 'copy') return false;
      const e = new Event('copy', { bubbles: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'Congress can prevent an economic disaster by creating government regulations.' } });
      fdoc.dispatchEvent(e);
      return true;
    });
    drag(200, 600);
    await new Promise((r) => setTimeout(r, 120));
    const btn = ui.button();
    expect(btn?.textContent).toBe('Find a source');
    btn!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'FIND_SOURCE', claim: 'Congress can prevent an economic disaster by creating government regulations.' });
    expect(ui.frame()).not.toBeNull();
    ui.closePopup();
  });

  it('a plain click does not show the button', async () => {
    editModeHidden();
    ui.hideButton();
    drag(300, 302);
    await new Promise((r) => setTimeout(r, 120));
    expect(ui.button()).toBeNull();
  });

  it('if Docs will not copy, the button asks for Cmd/Ctrl+C and then uses what the user copied', async () => {
    const fdoc = editModeHidden();
    ui.hideButton();
    sendMessage.mockClear();
    fdoc.execCommand = vi.fn(() => false);
    drag(200, 650);
    await new Promise((r) => setTimeout(r, 120));
    const btn = ui.button()!;
    btn.click();
    expect(btn.textContent).toMatch(/(⌘C|Ctrl\+C), then click/);
    expect(sendMessage).not.toHaveBeenCalled();
    // The user presses Cmd/Ctrl+C: Docs fills the copy event, which Backed remembers.
    const e = new Event('copy', { bubbles: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'This would also stop inflating economic bubble and help mitigate the fallout.' } });
    fdoc.dispatchEvent(e);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'FIND_SOURCE', claim: 'This would also stop inflating economic bubble and help mitigate the fallout.' });
    ui.closePopup();
  });
});
