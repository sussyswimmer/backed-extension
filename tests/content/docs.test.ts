// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Grab = () => { text: string; method: string };
let grabSelection: Grab;
let listener: ((msg: unknown, sender: { id?: string }, respond: (r: unknown) => void) => boolean) | undefined;

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext-id', onMessage: { addListener: (fn: typeof listener) => (listener = fn) } },
  };
  ({ grabSelection } = (await import('../../src/content/docs')) as unknown as { grabSelection: Grab });
});

beforeEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('Google Docs selection grabber', () => {
  it('uses the DOM selection when Docs exposes one', () => {
    document.body.innerHTML = '<p id="p">Minimum wage hikes do not cost jobs.</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    window.getSelection()!.addRange(range);
    expect(grabSelection()).toEqual({ text: 'Minimum wage hikes do not cost jobs.', method: 'selection' });
  });

  it('falls back to asking Docs to copy and reading the copy event', () => {
    document.execCommand = vi.fn(() => {
      const e = new Event('copy', { bubbles: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'Copied from the canvas.' } });
      document.dispatchEvent(e);
      return true;
    });
    expect(grabSelection()).toEqual({ text: 'Copied from the canvas.', method: 'copy_event' });
  });

  it('reports nothing so the worker can try the clipboard and then show the hint', () => {
    document.execCommand = vi.fn(() => false);
    expect(grabSelection()).toEqual({ text: '', method: 'none' });
  });

  it('only answers our own extension', () => {
    const respond = vi.fn();
    listener?.({ type: 'GET_DOCS_SELECTION' }, { id: 'someone-else' }, respond);
    expect(respond).not.toHaveBeenCalled();
    listener?.({ type: 'GET_DOCS_SELECTION' }, { id: 'ext-id' }, respond);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ method: expect.any(String) }));
  });
});
