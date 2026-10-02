// URLs from sources are untrusted. Only well-formed http(s) URLs are ever linked or opened.

/** The trimmed URL when it is a valid http(s) URL, else undefined. */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const u = url.trim();
  if (!u || /\s/.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (!parsed.hostname) return undefined;
    return u;
  } catch {
    return undefined;
  }
}

/** Open an http(s) URL in a new tab. Returns false (and does nothing) for anything else. */
export function openExternal(url: unknown): boolean {
  const u = safeHttpUrl(url);
  if (!u) return false;
  const fallback = () => {
    window.open(u, '_blank', 'noopener,noreferrer');
  };
  if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
    chrome.tabs.create({ url: u }).catch(fallback);
  } else {
    fallback();
  }
  return true;
}

/** Hostname without "www." for compact display; '' when the URL is not http(s). */
export function displayHost(url: unknown): string {
  const u = safeHttpUrl(url);
  if (!u) return '';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
