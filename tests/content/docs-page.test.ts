// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://docs.google.com/document/d/abc123/edit" }
// On a Google Docs page: no DOM selection and (in edit mode) no mouse events at all — the button
// must still appear, found by watching the hidden selection Docs keeps in its text-input iframe.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BackedUi } from '../../src/content/main';

let ui: BackedUi;

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      getURL: (p: string) => `chrome-extension://ext-id/${p}`,
      sendMessage: vi.fn(async () => ({ token: 'f'.repeat(32) })),
      onMessage: { addListener: () => undefined },
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => undefined } },
  };
  if (!('requestAnimationFrame' in window)) (window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number;
  document.hasFocus = () => true;
  document.body.innerHTML = '<div class="kix-appview-editor"><div class="kix-cursor-caret"></div></div><iframe class="docs-texteventtarget-iframe"></iframe>';
  const mod = await import('../../src/content/main');
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
