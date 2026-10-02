// Exa returns page text as markdown-style plain text. Turn it into the same plain text our own
// HTML extraction produces, so a passage verified on Exa text reads exactly like the page.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const REFERENCE_HEADING = /^(?:#{1,6}\s*)?(?:\d+\.?\s*)?(references|bibliography|works cited|notes|footnotes|endnotes|sources|citations)\s*:?\s*$/i;

export function stripMarkdown(md: string): string {
  let s = md.replace(/\r\n?/g, '\n');
  // Fenced code blocks: keep the content, drop the fences.
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
  // Images.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Footnote-style links: [1](#fn1), [[2]](#cite-2) -> removed (HTML extraction drops them too).
  s = s.replace(/\[\[?\d{1,3}\]?\]\(#[^)]*\)/g, '');
  // Links -> text.
  s = s.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
  // Reference-style links and definitions.
  s = s.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '');
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // HTML line breaks and stray tags.
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '');
  const lines = s.split('\n');
  const out: string[] = [];
  for (let line of lines) {
    if (REFERENCE_HEADING.test(line.trim()) && out.join(' ').length > 400) break; // drop reference lists
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      out.push('');
      continue;
    }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // table separator
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*[-*+•]\s+/, '')
      .replace(/^\s*\d{1,3}[.)]\s+(?=\S)/, '');
    if (line.includes('|')) line = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\s*\|\s*/g, ' ');
    out.push(line);
  }
  s = out.join('\n');
  // Emphasis and inline code (keep inner text; avoid touching snake_case).
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  s = s.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  s = s.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=[\s).,;:!?]|$)/g, '$1$2');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Backslash escapes.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1');
  return decodeEntities(s);
}
