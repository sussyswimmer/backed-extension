// Panel-wide shortcuts. Pure mapping from a key press to an action so it can be unit-tested.
// Enter-to-submit lives on the claim textarea itself; everything here ignores keys typed into fields.

export type KeyAction = { type: 'close' } | { type: 'togglePick'; index: number } | { type: 'focusRefine' };

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  /** Focus is in a text field, select or contenteditable element. */
  editable: boolean;
}

export interface KeyContext {
  /** A job is running (planning … refining). */
  running: boolean;
  /** The results list is on screen (not the input, picked view or history). */
  resultsVisible: boolean;
  /** How many cards are visible, in display order. */
  visibleCount: number;
  /** The refine card or pick prompt is on screen. */
  refineVisible: boolean;
}

export function keyAction(k: KeyInput, ctx: KeyContext): KeyAction | null {
  if (k.isComposing || k.defaultPrevented) return null;
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  // Esc closes the popup, even from a text field. A running search keeps going in the background
  // (reopen with the shortcut); the Stop button stops it.
  if (k.key === 'Escape' || k.key === 'Esc') return { type: 'close' };
  if (k.editable) return null;
  if (!ctx.resultsVisible) return null;
  if (/^[1-9]$/.test(k.key)) {
    const index = Number(k.key) - 1;
    return index < ctx.visibleCount ? { type: 'togglePick', index } : null;
  }
  if ((k.key === 'r' || k.key === 'R') && ctx.refineVisible) return { type: 'focusRefine' };
  return null;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** True when the event target is somewhere the user types (so shortcuts must not fire). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  return false;
}

/** Enter submits the claim; Shift+Enter (or IME composition) inserts a newline. */
export function isSubmitKey(k: { key: string; shiftKey?: boolean; isComposing?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return k.key === 'Enter' && !k.shiftKey && !k.isComposing && !k.altKey;
}
