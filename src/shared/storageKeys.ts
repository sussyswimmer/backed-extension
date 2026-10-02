// chrome.storage keys shared by more than one context.

/**
 * The selection-button preference, mirrored from settings under its own key: the content script
 * runs on every page and only ever reads this key, never the settings object with the API keys.
 */
export const SELECTION_BUTTON_KEY = 'selectionButton';
