import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Backed',
  version: pkg.version,
  description: 'Find a real, verified source for any claim — with the exact quotation.',
  minimum_chrome_version: '116',
  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  // Toolbar icon → the sidebar. Highlighting text or the shortcut → the in-page popup.
  action: {
    default_title: 'Backed — find a source',
    default_icon: {
      16: 'public/icons/icon16.png',
      32: 'public/icons/icon32.png',
    },
  },
  side_panel: { default_path: 'src/popup/sidepanel.html' },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['storage', 'sidePanel', 'contextMenus', 'offscreen', 'activeTab', 'scripting', 'clipboardRead', 'clipboardWrite'],
  // <all_urls>: the "Find a source" button runs on every page, and the worker downloads the pages
  // and PDFs it found so every quotation can be checked against the real text.
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  // The content script shows the popup page in an iframe next to the selection. Any site could
  // embed it too, so it only gets data with a one-time token from the worker (panelTokens.ts).
  web_accessible_resources: [{ resources: ['src/popup/index.html'], matches: ['<all_urls>'] }],
  commands: {
    'find-source': {
      suggested_key: { default: 'Alt+Shift+E' },
      description: 'Find a source for the highlighted text (or open/close Backed)',
    },
  },
  content_security_policy: {
    // No frame-ancestors restriction: the popup page must load inside web pages (in-page popup).
    // Only it is web-accessible, and it gets data only with a worker-issued token.
    extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'",
  },
});
