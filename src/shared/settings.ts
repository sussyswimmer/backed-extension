import type { OutputMode, Settings, SourceId } from './types';
import { SELECTION_BUTTON_KEY } from './storageKeys';

export const DEFAULT_MODEL = 'deepseek-flash';

export const DEFAULT_SETTINGS: Settings = {
  deepseekKey: '',
  exaKey: '',
  openalexKey: '',
  contactEmail: '',
  model: DEFAULT_MODEL,
  enabledSources: {
    openalex: true,
    semantic_scholar: true,
    arxiv: true,
    exa_web: true,
    exa_news: true,
    exa_policy: true,
    exa_papers: true,
  },
  costCapUsdPerSearch: 0.05,
  maxCandidates: 15,
  exaResultsPerAdapter: 3,
  lastMode: 'essay',
  citationStyles: { paper: 'apa', essay: 'mla' },
  honestyLine: true,
  showDebug: false,
  selectionButton: true,
  // deepseek-flash peak prices (USD / 1M tokens) from api-docs.deepseek.com, Oct 2026.
  prices: { inputCacheMiss: 0.3, inputCacheHit: 0.006, output: 1.2 },
};

const SETTINGS_KEY = 'settings';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merge stored (possibly partial or outdated) settings over the defaults. */
export function mergeSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const s = stored as Partial<Settings>;
  const out: Settings = structuredClone(DEFAULT_SETTINGS);
  if (typeof s.deepseekKey === 'string') out.deepseekKey = s.deepseekKey.trim();
  if (typeof s.exaKey === 'string') out.exaKey = s.exaKey.trim();
  if (typeof s.openalexKey === 'string') out.openalexKey = s.openalexKey.trim();
  if (typeof s.contactEmail === 'string') out.contactEmail = s.contactEmail.trim();
  if (typeof s.model === 'string' && s.model.trim()) out.model = s.model.trim();
  if (isRecord(s.enabledSources)) {
    for (const id of Object.keys(out.enabledSources) as SourceId[]) {
      const v = (s.enabledSources as Record<string, unknown>)[id];
      if (typeof v === 'boolean') out.enabledSources[id] = v;
    }
  }
  if (typeof s.costCapUsdPerSearch === 'number' && s.costCapUsdPerSearch > 0) out.costCapUsdPerSearch = s.costCapUsdPerSearch;
  if (typeof s.maxCandidates === 'number' && s.maxCandidates >= 3) out.maxCandidates = Math.min(40, Math.round(s.maxCandidates));
  if (typeof s.exaResultsPerAdapter === 'number' && s.exaResultsPerAdapter >= 1)
    out.exaResultsPerAdapter = Math.min(10, Math.round(s.exaResultsPerAdapter));
  if (s.lastMode === 'paper' || s.lastMode === 'essay' || s.lastMode === 'debate') out.lastMode = s.lastMode;
  if (isRecord(s.citationStyles)) {
    const cs = s.citationStyles as Record<string, unknown>;
    if (cs.paper === 'apa' || cs.paper === 'chicago') out.citationStyles.paper = cs.paper;
    if (cs.essay === 'mla' || cs.essay === 'apa') out.citationStyles.essay = cs.essay;
  }
  if (typeof s.honestyLine === 'boolean') out.honestyLine = s.honestyLine;
  if (typeof s.showDebug === 'boolean') out.showDebug = s.showDebug;
  if (typeof s.selectionButton === 'boolean') out.selectionButton = s.selectionButton;
  if (isRecord(s.prices)) {
    const p = s.prices as Record<string, unknown>;
    if (typeof p.inputCacheMiss === 'number') out.prices.inputCacheMiss = p.inputCacheMiss;
    if (typeof p.inputCacheHit === 'number') out.prices.inputCacheHit = p.inputCacheHit;
    if (typeof p.output === 'number') out.prices.output = p.output;
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = mergeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next, [SELECTION_BUTTON_KEY]: next.selectionButton });
  return next;
}

export async function rememberMode(mode: OutputMode): Promise<void> {
  await saveSettings({ lastMode: mode });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[SETTINGS_KEY]) cb(mergeSettings(changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Replace any API key that appears in a string. Used on every error shown to the user. */
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  }
  // Belt and braces: anything that looks like a bearer token or sk- key.
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[redacted]');
  return out;
}
