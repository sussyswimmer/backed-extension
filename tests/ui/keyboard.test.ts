import { describe, expect, it } from 'vitest';
import { isSubmitKey, keyAction, type KeyContext } from '../../src/sidepanel/lib/keyboard';

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({ running: false, resultsVisible: true, visibleCount: 4, refineVisible: true, ...over });

describe('keyAction', () => {
  it('Esc stops only while a job is running', () => {
    expect(keyAction({ key: 'Escape', editable: false }, ctx({ running: true }))).toEqual({ type: 'stop' });
    expect(keyAction({ key: 'Escape', editable: false }, ctx({ running: false }))).toBeNull();
  });

  it('1–9 toggle the visible cards in display order', () => {
    expect(keyAction({ key: '1', editable: false }, ctx())).toEqual({ type: 'togglePick', index: 0 });
    expect(keyAction({ key: '4', editable: false }, ctx())).toEqual({ type: 'togglePick', index: 3 });
    // Only 4 cards visible: 5 does nothing; 0 is never a card.
    expect(keyAction({ key: '5', editable: false }, ctx())).toBeNull();
    expect(keyAction({ key: '0', editable: false }, ctx())).toBeNull();
  });

  it('R focuses the refine card when it is on screen', () => {
    expect(keyAction({ key: 'r', editable: false }, ctx())).toEqual({ type: 'focusRefine' });
    expect(keyAction({ key: 'R', editable: false }, ctx())).toEqual({ type: 'focusRefine' });
    expect(keyAction({ key: 'r', editable: false }, ctx({ refineVisible: false }))).toBeNull();
  });

  it('never hijacks keys typed into fields or with modifiers', () => {
    expect(keyAction({ key: '1', editable: true }, ctx())).toBeNull();
    expect(keyAction({ key: 'r', editable: true }, ctx())).toBeNull();
    expect(keyAction({ key: 'Escape', editable: true }, ctx({ running: true }))).toBeNull();
    expect(keyAction({ key: '1', ctrlKey: true, editable: false }, ctx())).toBeNull();
    expect(keyAction({ key: 'r', metaKey: true, editable: false }, ctx())).toBeNull();
    expect(keyAction({ key: '2', altKey: true, editable: false }, ctx())).toBeNull();
    expect(keyAction({ key: '1', isComposing: true, editable: false }, ctx())).toBeNull();
    expect(keyAction({ key: '1', defaultPrevented: true, editable: false }, ctx())).toBeNull();
  });

  it('card keys only work on the results list', () => {
    expect(keyAction({ key: '1', editable: false }, ctx({ resultsVisible: false }))).toBeNull();
    expect(keyAction({ key: 'r', editable: false }, ctx({ resultsVisible: false }))).toBeNull();
    // Esc still stops a running job from anywhere in the search tab.
    expect(keyAction({ key: 'Escape', editable: false }, ctx({ resultsVisible: false, running: true }))).toEqual({ type: 'stop' });
  });
});

describe('isSubmitKey', () => {
  it('Enter submits; Shift+Enter and IME composition do not', () => {
    expect(isSubmitKey({ key: 'Enter' })).toBe(true);
    expect(isSubmitKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSubmitKey({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isSubmitKey({ key: 'a' })).toBe(false);
  });
});
