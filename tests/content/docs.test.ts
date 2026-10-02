// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grabDocsSelection } from '../../src/content/docs';

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
    expect(grabDocsSelection()).toEqual({ text: 'Minimum wage hikes do not cost jobs.', method: 'selection' });
  });

  it('falls back to asking Docs to copy and reading the copy event', () => {
    document.execCommand = vi.fn(() => {
      const e = new Event('copy', { bubbles: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'Copied from the canvas.' } });
      document.dispatchEvent(e);
      return true;
    });
    expect(grabDocsSelection()).toEqual({ text: 'Copied from the canvas.', method: 'copy_event' });
  });

  it('reports nothing so the worker can try the clipboard and then show the hint', () => {
    document.execCommand = vi.fn(() => false);
    expect(grabDocsSelection()).toEqual({ text: '', method: 'none' });
  });
});
