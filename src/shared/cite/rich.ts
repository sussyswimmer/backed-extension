// Tiny rich-text model used by every formatter: a run of styled segments that renders to
// plain text, paste-safe HTML (inline markup only) and Markdown from one source of truth.

/** Plain text (no markdown markers) + HTML with inline markup only (paste-safe for Google Docs & Word). */
export interface Formatted {
  text: string;
  html: string;
}

export interface Seg {
  text: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  /** Reduced font (debate-card context). */
  small?: boolean;
  /** Link target. Only http(s) URLs are ever rendered as links; anything else stays text. */
  href?: string;
}

/** A paragraph: one line in plain text, one `<p>` in HTML. */
export interface Para {
  segs: Seg[];
  /** Inline CSS for the `<p>` (HTML only). */
  style?: string;
}

export const SMALL_FONT = 'font-size:8pt';
export const HANGING_INDENT = 'margin-left:0.5in;text-indent:-0.5in';
export const BLOCK_INDENT = 'margin-left:0.5in';

export const plain = (text: string): Seg => ({ text });
export const italic = (text: string): Seg => ({ text, italic: true });
export const bold = (text: string): Seg => ({ text, bold: true });

/** A URL rendered as a link (when http(s)) whose visible text is the URL itself. */
export const urlSeg = (url: string): Seg => ({ text: url, href: url });

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** The URL if it is a well-formed http(s) URL, else undefined. Never trust a scheme we did not check. */
export function httpUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const u = url.trim();
  if (!/^https?:\/\/\S+$/i.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

const isStyled = (s: Seg): boolean => Boolean(s.italic || s.bold || s.underline || s.href);

/**
 * Collapse whitespace across a whole run of segments (as if it were one string), trim the ends,
 * and move leading/trailing spaces out of styled segments so underlines/links don't cover spaces.
 */
export function normalizeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  let endsWithSpace = true; // treat the start as "after a space" so leading whitespace is dropped
  const push = (seg: Seg): void => {
    if (!seg.text) return;
    out.push(seg);
    endsWithSpace = seg.text.endsWith(' ');
  };
  for (const seg of segs) {
    let text = seg.text.replace(/\s+/g, ' ');
    if (endsWithSpace) text = text.replace(/^ /, '');
    if (!text) continue;
    if (!isStyled(seg)) {
      push({ ...seg, text });
      continue;
    }
    const lead = text.startsWith(' ');
    const trail = text.length > 1 && text.endsWith(' ');
    const core = text.slice(lead ? 1 : 0, trail ? -1 : undefined);
    if (lead) push({ text: ' ', small: seg.small });
    push({ ...seg, text: core });
    if (trail) push({ text: ' ', small: seg.small });
  }
  // Trim trailing whitespace.
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (!last) break;
    const trimmed = last.text.replace(/ +$/, '');
    if (trimmed) {
      out[out.length - 1] = { ...last, text: trimmed };
      break;
    }
    out.pop();
  }
  return out;
}

export function renderText(segs: Seg[]): string {
  return segs.map((s) => s.text).join('');
}

export function renderHtml(segs: Seg[]): string {
  return segs
    .map((s) => {
      let h = escapeHtml(s.text);
      if (s.underline) h = `<u>${h}</u>`;
      if (s.italic) h = `<i>${h}</i>`;
      if (s.bold) h = `<b>${h}</b>`;
      if (s.small) h = `<span style="${SMALL_FONT}">${h}</span>`;
      const href = httpUrl(s.href);
      if (href) h = `<a href="${escapeHtml(href)}">${h}</a>`;
      return h;
    })
    .join('');
}

export function renderParas(paras: Para[]): Formatted {
  const kept = paras.map((p) => ({ ...p, segs: normalizeSegs(p.segs) })).filter((p) => p.segs.length > 0);
  return {
    text: kept.map((p) => renderText(p.segs)).join('\n'),
    html: kept.map((p) => `<p${p.style ? ` style="${p.style}"` : ''}>${renderHtml(p.segs)}</p>`).join(''),
  };
}

/** A single run with no block wrapper (for inline snippets such as an inline quote). */
export function renderInline(segs: Seg[]): Formatted {
  const norm = normalizeSegs(segs);
  return { text: renderText(norm), html: renderHtml(norm) };
}

// ---------- Markdown ----------

/** Escape Markdown syntax in source-derived text so it renders literally. */
export function mdEscape(s: string): string {
  return s.replace(/[\\`*_[\]<>]/g, '\\$&');
}

/**
 * Minimal escaping for verbatim quotations: only neutralize what would start raw HTML
 * (`<tag`, `</`, `<!`, `<?`). Everything else stays byte-for-byte as in the source.
 */
export function mdEscapeVerbatim(s: string): string {
  return s.replace(/<(?=[A-Za-z/!?])/g, '\\<');
}

/** URL safe to put inside a Markdown link destination (only http(s)). */
export function mdUrl(url: string | undefined): string | undefined {
  const u = httpUrl(url);
  if (!u) return undefined;
  return u.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export function mdLink(text: string, url: string | undefined): string {
  const href = mdUrl(url);
  return href ? `[${mdEscape(text)}](${href})` : mdEscape(text);
}

function mdWrap(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return text;
  return `${m[1] ?? ''}${marker}${m[2]}${marker}${m[3] ?? ''}`;
}

export function renderMarkdown(segs: Seg[], escape: (s: string) => string = mdEscape): string {
  return normalizeSegs(segs)
    .map((s) => {
      const href = mdUrl(s.href);
      if (href) return `[${escape(s.text)}](${href})`;
      let t = escape(s.text);
      if (s.bold && s.italic) t = mdWrap(t, '***');
      else if (s.bold) t = mdWrap(t, '**');
      else if (s.italic) t = mdWrap(t, '*');
      return t;
    })
    .join('');
}
