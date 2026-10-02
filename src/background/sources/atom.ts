// Minimal Atom feed parser (regex/string based: the service worker has no DOMParser).
// Handles what arXiv's API returns: entries, nested authors, link attributes, CDATA, XML entities.

export interface AtomLink {
  href: string;
  rel?: string;
  type?: string;
  title?: string;
}

export interface AtomEntry {
  id: string;
  title: string;
  summary: string;
  published?: string;
  updated?: string;
  authors: string[];
  links: AtomLink[];
  categories: string[];
  /** arxiv:doi */
  doi?: string;
  /** arxiv:journal_ref */
  journalRef?: string;
  /** arxiv:primary_category term */
  primaryCategory?: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode XML entities in one pass (so "&amp;lt;" becomes "&lt;", not "<"). */
export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body] ?? whole;
  });
}

/** Text content of an element body: CDATA kept verbatim, everything else entity-decoded, tags dropped. */
function textContent(inner: string): string {
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    out += decodeXmlEntities(inner.slice(last, m.index).replace(/<[^>]*>/g, ''));
    out += m[1] ?? '';
    last = m.index + m[0].length;
  }
  out += decodeXmlEntities(inner.slice(last).replace(/<[^>]*>/g, ''));
  return out.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Atom elements may carry a namespace prefix ("atom:title"); prefixed extensions are matched exactly. */
function elementRe(name: string, flags: string): RegExp {
  const n = name.includes(':') ? escapeRe(name) : `(?:[\\w-]+:)?${escapeRe(name)}`;
  return new RegExp(`<(${n})\\b[^>]*?(?:/>|>([\\s\\S]*?)</\\1\\s*>)`, flags);
}

function firstText(block: string, name: string): string | undefined {
  const m = elementRe(name, '').exec(block);
  if (!m) return undefined;
  const t = textContent(m[2] ?? '');
  return t || undefined;
}

function allBlocks(block: string, name: string): string[] {
  const out: string[] = [];
  const re = elementRe(name, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[0]);
  return out;
}

export function parseAttrs(tag: string): Record<string, string> {
  const open = /^<[^>]*>/.exec(tag)?.[0] ?? tag;
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(open))) attrs[m[1] as string] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  return attrs;
}

/** Parse an Atom feed into entries. Returns [] for input that has no <entry> elements. */
export function parseAtomFeed(xml: string): AtomEntry[] {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '');
  const entries: AtomEntry[] = [];
  for (const block of allBlocks(src, 'entry')) {
    const inner = block.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>\s*$/, '');
    const authors = allBlocks(inner, 'author')
      .map((a) => firstText(a, 'name') ?? '')
      .filter((n) => n.length > 0);
    const links: AtomLink[] = allBlocks(inner, 'link')
      .map((l) => parseAttrs(l))
      .filter((a) => !!a.href)
      .map((a) => {
        const link: AtomLink = { href: a.href as string };
        if (a.rel) link.rel = a.rel;
        if (a.type) link.type = a.type;
        if (a.title) link.title = a.title;
        return link;
      });
    const categories = allBlocks(inner, 'category')
      .map((c) => parseAttrs(c).term ?? '')
      .filter((t) => t.length > 0);
    const primary = allBlocks(inner, 'arxiv:primary_category')[0];
    const entry: AtomEntry = {
      id: firstText(inner, 'id') ?? '',
      title: firstText(inner, 'title') ?? '',
      summary: firstText(inner, 'summary') ?? '',
      authors,
      links,
      categories,
    };
    const published = firstText(inner, 'published');
    const updated = firstText(inner, 'updated');
    const doi = firstText(inner, 'arxiv:doi');
    const journalRef = firstText(inner, 'arxiv:journal_ref');
    if (published) entry.published = published;
    if (updated) entry.updated = updated;
    if (doi) entry.doi = doi;
    if (journalRef) entry.journalRef = journalRef;
    if (primary) {
      const term = parseAttrs(primary).term;
      if (term) entry.primaryCategory = term;
    }
    entries.push(entry);
  }
  return entries;
}
