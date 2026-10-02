// One-time tokens for the in-page popup.
// The popup page must be web-accessible so the content script can show it in an iframe, which
// also means any website could embed it. So: the service worker hands a random token to its own
// content script, the iframe connects with it, and a popup page running inside a tab without a
// valid token gets no data. The toolbar popup (not in a tab) needs no token.
import { PANEL_PORT } from '../shared/messages';

const STORE_KEY = 'panelTokens';
const MAX_TOKENS = 50;

export function makeToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pure check used by the port handler (and tests). */
export function portAllowed(name: string, inTab: boolean, tokens: ReadonlySet<string>): boolean {
  if (name === PANEL_PORT) return !inTab;
  if (!name.startsWith(`${PANEL_PORT}:`)) return false;
  const token = name.slice(PANEL_PORT.length + 1);
  return /^[0-9a-f]{32}$/.test(token) && tokens.has(token);
}

export class TokenStore {
  private tokens = new Set<string>();
  private readonly loaded: Promise<void>;

  constructor(private readonly storage: chrome.storage.StorageArea | undefined = globalThis.chrome?.storage?.session) {
    this.loaded = (async () => {
      try {
        const got = await this.storage?.get(STORE_KEY);
        const list = got?.[STORE_KEY];
        if (Array.isArray(list)) this.tokens = new Set(list.filter((t): t is string => typeof t === 'string'));
      } catch {
        // start empty
      }
    })();
  }

  /** New token, remembered for this browser session (survives service-worker restarts). */
  issue(): string {
    const t = makeToken();
    this.tokens.add(t);
    if (this.tokens.size > MAX_TOKENS) this.tokens = new Set([...this.tokens].slice(-MAX_TOKENS));
    void this.storage?.set({ [STORE_KEY]: [...this.tokens] }).catch(() => undefined);
    return t;
  }

  async allows(name: string, inTab: boolean): Promise<boolean> {
    await this.loaded;
    return portAllowed(name, inTab, this.tokens);
  }
}
