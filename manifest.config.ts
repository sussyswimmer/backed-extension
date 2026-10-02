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
  action: {
    default_title: 'Open Backed',
    default_icon: {
      16: 'public/icons/icon16.png',
      32: 'public/icons/icon32.png',
    },
  },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['storage', 'sidePanel', 'contextMenus', 'offscreen', 'activeTab', 'scripting', 'clipboardRead', 'clipboardWrite'],
  // Only the APIs we call. Arbitrary pages/PDFs need <all_urls>, requested on first search.
  host_permissions: [
    'https://api.deepseek.com/*',
    'https://api.exa.ai/*',
    'https://api.openalex.org/*',
    'https://api.semanticscholar.org/*',
    'https://export.arxiv.org/*',
  ],
  optional_host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['https://docs.google.com/document/*'],
      js: ['src/content/docs.ts'],
      run_at: 'document_idle',
    },
  ],
  commands: {
    'find-source': {
      suggested_key: { default: 'Alt+Shift+E' },
      description: 'Find a source for the highlighted text',
    },
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
});
