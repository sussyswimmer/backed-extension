// URL + DOI normalization used for candidate ids and dedupe.

import { hash32 } from '../../shared/text';

/** Path endings whose query string usually identifies the page (kept, minus tracking params). */
const DYNAMIC_PATH = /\.(php|asp|aspx|jsp|cfm)$/i;

/** Query params that identify content even on "pretty" paths; kept so different pages don't collapse. */
const IDENTITY_PARAMS = new Set(['id', 'p', 'v', 'abstract_id', 'article_id', 'articleid', 'docid', 'doc_id', 'story_id']);

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'ref_src',
  'ref_url',
  'cmpid',
  'smid',
  'sref',
  'ocid',
  'mkt_tok',
  'spm',
  'share',
]);

function isTracking(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || n.startsWith('pk_') || TRACKING_PARAMS.has(n);
}

/**
 * Canonical form of a URL for dedupe: https, lowercase host without "www.", no fragment,
 * no tracking params, no query string (unless the path is dynamic like .php or "/", or the
 * param identifies the content like ?id=), no trailing slash. Returns the trimmed input if unparsable.
 */
export function canonicalUrl(url: string): string {
  const raw = url.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
  const host = u.hostname.toLowerCase().replace(/^www\d?\./, '');
  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
  const pathname = u.pathname || '/';
  const keepAllQuery = pathname === '/' || DYNAMIC_PATH.test(pathname);
  const params: Array<[string, string]> = [];
  u.searchParams.forEach((value, name) => {
    if (isTracking(name)) return;
    if (keepAllQuery || IDENTITY_PARAMS.has(name.toLowerCase())) params.push([name, value]);
  });
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const path = pathname.replace(/\/+$/, '');
  const base = `https://${host}${port}`;
  if (params.length === 0) return base + path;
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${base}${path || '/'}?${qs}`;
}

/** Lowercased bare DOI ("10.xxxx/…"), with doi.org / "doi:" prefixes and trailing punctuation removed. */
export function normalizeDoi(doi: string): string {
  let d = doi.trim();
  try {
    d = decodeURIComponent(d);
  } catch {
    // keep as is
  }
  d = d
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
  return trimDoiTail(d);
}

/** Strip trailing punctuation and unbalanced closing brackets ("(see doi:10.1/abc)." -> "10.1/abc"). */
function trimDoiTail(d: string): string {
  let out = d;
  for (;;) {
    const last = out.slice(-1);
    if (/[.,;:'">}]/.test(last)) out = out.slice(0, -1);
    else if (last === ')' && count(out, '(') < count(out, ')')) out = out.slice(0, -1);
    else if (last === ']' && count(out, '[') < count(out, ']')) out = out.slice(0, -1);
    else return out;
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// Brackets are excluded so markdown links "[10.1/x](https://doi.org/10.1/x)" don't swallow the link.
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>{}[\]|\\^`]+)/i;

/** DOI embedded in a URL: doi.org/10…, or a publisher path like /doi/10…, /doi/abs/10…, /doi/pdf/10…. */
export function doiFromUrl(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    path = u.pathname;
  }
  if (/(^|\.)doi\.org$/.test(host)) {
    const m = DOI_RE.exec(path);
    return m?.[1] ? cleanDoi(m[1]) : undefined;
  }
  const m = /\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect|epub|book)\/)?(10\.\d{4,9}\/[^?#\s]+)/i.exec(path);
  return m?.[1] ? cleanDoi(m[1]) : undefined;
}

/** First DOI-looking string in a piece of text. */
export function findDoiInText(text: string): string | undefined {
  const m = DOI_RE.exec(text);
  return m?.[1] ? cleanDoi(m[1]) : undefined;
}

function cleanDoi(raw: string): string | undefined {
  let d = normalizeDoi(raw);
  // Publisher paths sometimes append the format after the DOI.
  d = d.replace(/\/(full|abstract|pdf|epdf|html)$/i, '');
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : undefined;
}

/** Stable candidate id: "c_" + hash of the normalized DOI, else of the canonical URL. */
export function candidateIdFor(c: { doi?: string; url: string }): string {
  const key = c.doi ? normalizeDoi(c.doi) : canonicalUrl(c.url);
  return 'c_' + hash32(key);
}

/** Keep http(s) URLs only. */
export function isHttpUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Upgrade http:// to https:// (all our sources serve https). */
export function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}
