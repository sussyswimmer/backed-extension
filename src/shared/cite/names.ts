// Author-name parsing and per-style author lists.

import { normalizeWs } from '../text';

export type ParsedName =
  | { kind: 'person'; family: string; given: string[]; suffix?: string }
  | { kind: 'org'; name: string };

type Person = Extract<ParsedName, { kind: 'person' }>;

/** Lower-case, letters-only words that mark an organization. */
const ORG_WORDS = new Set([
  // From the brief.
  'bank', 'organization', 'organisation', 'institute', 'institution', 'fund', 'office', 'department',
  'bureau', 'council', 'agency', 'commission', 'university', 'association', 'center', 'centre',
  'foundation', 'ministry', 'reserve', 'board', 'committee', 'nations', 'group', 'inc', 'ltd',
  'corporation', 'society', 'program', 'programme', 'service', 'authority', 'forum', 'federation', 'union',
  // Common bylines and institutional authors seen in web/news metadata.
  'services', 'institutes', 'press', 'news', 'staff', 'team', 'editors', 'editorial', 'contributors',
  'network', 'laboratory', 'laboratories', 'trust', 'coalition', 'alliance', 'consortium', 'initiative',
  'project', 'administration', 'government', 'secretariat', 'parliament', 'congress', 'senate', 'school',
  'college', 'academy', 'hospital', 'llc', 'plc', 'corp', 'company', 'partners', 'associates', 'reuters',
  'statistics', 'observatory', 'directorate', 'division',
]);

/** Name particles that belong to the family name ("van Beethoven", "de la Cruz"). */
const PARTICLES = new Set([
  'van', 'von', 'de', 'da', 'del', 'della', 'di', 'le', 'la', 'du', 'dos', 'bin', 'al',
  'der', 'den', 'ter', 'ten', 'ibn',
]);

const SUFFIX_RE = /^(jr|sr|ii|iii|iv)\.?$/i;
const DEGREE_RE = /^(Ph\.?D|PHD|M\.?D|MPH|MBA|MSc|BSc|DPhil|J\.?D|Esq|FRS)\.?$/;
const HONORIFIC_RE = /^(dr|prof|professor|mr|mrs|ms|mx|sir|dame)\.?\s+/i;
/** Tokens whose trailing period is part of the word, not stray punctuation. */
const KEEP_PERIOD_RE = /(^|[\s.])(\p{L}|inc|ltd|co|corp|jr|sr|st|bros|plc|llc)\.$/iu;
/** Values that mean "no author" (junk from upstream metadata). */
const JUNK_RE = /^(unknown( author)?|anonymous|anon|n\/?a|none|null|undefined|nan|staff|admin|editor|editors|author)$/i;

function normalizeSuffix(s: string): string {
  const bare = s.replace(/\.$/, '');
  return /^(jr|sr)$/i.test(bare) ? `${bare.charAt(0).toUpperCase()}${bare.slice(1).toLowerCase()}.` : bare.toUpperCase();
}

/** Strip junk around a raw name: "By ", honorifics, quotes, a trailing "(Outlet)", stray punctuation. */
function cleanRaw(raw: string): string {
  let s = normalizeWs(typeof raw === 'string' ? raw : '');
  s = s.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '');
  s = s.replace(/^by(\s*:\s*|\s+|$)/i, '');
  s = s.replace(/^[([]\s*(.*?)\s*[)\]]$/, '$1'); // "(Jane Doe)"
  s = s.replace(/\s*\([^()]*\)$/, ''); // "Jane Doe (Reuters)"
  s = s.replace(HONORIFIC_RE, '');
  s = s.replace(/[\s,;:]+$/, '');
  if (s.endsWith('.') && !KEEP_PERIOD_RE.test(s)) s = s.replace(/\.+$/, '');
  return normalizeWs(s);
}

function isOrgName(s: string): boolean {
  const words = s.split(' ').filter(Boolean);
  if (words.length > 5) return true;
  if (s.includes('&')) return true;
  if (/^the\s/i.test(s)) return true;
  if (words.some((w) => ORG_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))) return true;
  // A single all-caps acronym: "OECD", "IMF", "U.N.".
  if (words.length === 1 && (/^[A-Z][A-Z0-9&-]+$/.test(s) || /^([A-Z]\.){2,}$/.test(s))) return true;
  return false;
}

/** "JOHN SMITH" -> "John Smith" (only used when a whole person name is upper-case). */
function fixCaps(token: string): string {
  if (token.length <= 1 || /^(\p{L}\.)+$/u.test(token)) return token;
  return token.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

function tokens(s: string): string[] {
  return s.split(' ').map((t) => t.trim()).filter(Boolean);
}

function makePerson(familyTokens: string[], given: string[], suffix?: string): ParsedName {
  const person: Person = { kind: 'person', family: familyTokens.join(' '), given };
  if (suffix) person.suffix = suffix;
  return person;
}

/**
 * Parse a raw display name ("David Card", "Krueger, Alan B.", "World Bank", "By Jane Doe") into
 * a person (family + given names, particles attached to the family name, suffix kept apart)
 * or an organization.
 */
export function parseAuthorName(raw: string): ParsedName {
  let s = cleanRaw(raw);
  if (!s) return { kind: 'org', name: '' };
  if (isOrgName(s)) return { kind: 'org', name: s };
  if (!/\p{Ll}/u.test(s) && /\p{Lu}{2}/u.test(s)) s = tokens(s).map(fixCaps).join(' ');

  let suffix: string | undefined;
  const parts: string[] = [];
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (DEGREE_RE.test(part)) continue;
    if (SUFFIX_RE.test(part)) {
      suffix = normalizeSuffix(part);
      continue;
    }
    parts.push(part);
  }

  // Drop trailing degrees / suffix written without a comma ("Martin Luther King Jr").
  const takeTail = (toks: string[]): string[] => {
    const out = [...toks];
    while (out.length > 1) {
      const last = out[out.length - 1] ?? '';
      if (DEGREE_RE.test(last)) out.pop();
      else if (SUFFIX_RE.test(last)) {
        suffix = normalizeSuffix(last);
        out.pop();
      } else break;
    }
    return out;
  };

  if (parts.length >= 2) {
    // "Family, Given" form. Trailing particles in the given part belong to the family name.
    const family = takeTail(tokens(parts[0] ?? ''));
    const given = tokens(parts.slice(1).join(' '));
    while (given.length > 1 && PARTICLES.has((given[given.length - 1] ?? '').toLowerCase())) {
      const particle = given.pop();
      if (particle) family.unshift(particle);
    }
    return makePerson(family, given, suffix);
  }

  const toks = takeTail(tokens(parts[0] ?? s));
  if (toks.length <= 1) return makePerson(toks, [], suffix);
  // First particle after the first given name starts the family name ("Ludwig van Beethoven").
  for (let i = 1; i < toks.length - 1; i++) {
    if (PARTICLES.has((toks[i] ?? '').toLowerCase())) return makePerson(toks.slice(i), toks.slice(0, i), suffix);
  }
  return makePerson(toks.slice(-1), toks.slice(0, -1), suffix);
}

/** Split an author entry that holds several people ("Jane Doe and John Smith", "A; B"). */
function splitMulti(raw: string): string[] {
  const s = normalizeWs(raw);
  const bySemicolon = s.split(';').map((p) => p.trim()).filter(Boolean);
  if (bySemicolon.length > 1) return bySemicolon.flatMap(splitMulti);
  const personLike = (p: string): boolean => {
    const cleaned = cleanRaw(p);
    return tokens(cleaned).length >= 2 && !isOrgName(cleaned);
  };
  const andParts = s.split(/\s+(?:and|&)\s+/i);
  if (andParts.length > 1 && andParts.every(personLike)) return andParts.flatMap(splitMulti);
  // "Jane Doe, John Smith, Ann Lee": 3+ comma parts that each look like a full name.
  const commaParts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length >= 3 && commaParts.every((p) => personLike(p) && !SUFFIX_RE.test(p) && !DEGREE_RE.test(p))) {
    return commaParts;
  }
  return [s];
}

function nameKey(n: ParsedName): string {
  const text = n.kind === 'org' ? n.name : `${n.given.join(' ')} ${n.family}`;
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Raw author strings -> parsed names, with junk removed, multi-name entries split and duplicates dropped. */
export function normalizeAuthors(raw: unknown): ParsedName[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedName[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    for (const piece of splitMulti(entry)) {
      const cleaned = cleanRaw(piece);
      if (!cleaned || JUNK_RE.test(cleaned) || /@|https?:\/\/|www\./i.test(cleaned)) continue;
      const parsed = parseAuthorName(cleaned);
      const key = nameKey(parsed);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
  }
  return out;
}

// ---------- Rendering single names ----------

function firstLetter(s: string): string | undefined {
  const m = /\p{L}/u.exec(s);
  return m ? m[0].toUpperCase() : undefined;
}

/** APA initials: "Alan B." -> "A. B.", "Jean-Paul" -> "J.-P.", "J.R.R." -> "J. R. R." */
export function initials(given: string[]): string {
  const out: string[] = [];
  for (const tok of given) {
    if (/^(\p{L}\.)+\p{L}\.?$/u.test(tok)) {
      for (const c of tok.match(/\p{L}/gu) ?? []) out.push(`${c.toUpperCase()}.`);
    } else if (tok.includes('-')) {
      const hyphenated = tok
        .split('-')
        .map(firstLetter)
        .filter((c): c is string => Boolean(c))
        .map((c) => `${c}.`)
        .join('-');
      if (hyphenated) out.push(hyphenated);
    } else {
      const c = firstLetter(tok);
      if (c) out.push(`${c}.`);
    }
  }
  return out.join(' ');
}

/** Given names for display; a bare initial gets its period ("Alan B" -> "Alan B."). */
function givenText(given: string[]): string {
  return given.map((g) => (/^\p{Lu}$/u.test(g) ? `${g}.` : g)).join(' ');
}

/** "Card" / "World Bank": what in-text citations use. */
export function familyOf(n: ParsedName): string {
  return n.kind === 'org' ? n.name : n.family;
}

/** APA reference form: "Card, D." / "King, M. L., Jr." / "World Bank". */
export function apaName(n: ParsedName): string {
  if (n.kind === 'org') return n.name;
  const init = initials(n.given);
  const base = init ? `${n.family}, ${init}` : n.family;
  return n.suffix ? `${base}, ${n.suffix}` : base;
}

/** Inverted full form: "Card, David" / "King, Martin Luther, Jr." */
export function invertedName(n: ParsedName): string {
  if (n.kind === 'org') return n.name;
  const given = givenText(n.given);
  const base = given ? `${n.family}, ${given}` : n.family;
  return n.suffix ? `${base}, ${n.suffix}` : base;
}

/** Natural order: "Alan B. Krueger" / "Martin Luther King Jr." */
export function naturalName(n: ParsedName): string {
  if (n.kind === 'org') return n.name;
  const base = [givenText(n.given), n.family].filter(Boolean).join(' ');
  return n.suffix ? `${base} ${n.suffix}` : base;
}

/** Comparable form of any name (for "author === publisher" checks). */
export function nameText(n: ParsedName): string {
  return n.kind === 'org' ? n.name : naturalName(n);
}

// ---------- Author lists ----------

const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

/** APA 7: "Card, D., & Krueger, A. B."; 21+ authors: first 19, "…", last. */
export function apaAuthorList(names: ParsedName[]): string {
  const parts = names.map(apaName);
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length <= 20) return `${parts.slice(0, -1).join(', ')}, & ${last(parts) ?? ''}`;
  return `${parts.slice(0, 19).join(', ')}, … ${last(parts) ?? ''}`;
}

/** Chicago author-date: "Card, David, and Alan B. Krueger"; 11+ authors: first seven + "et al." */
export function chicagoAuthorList(names: ParsedName[]): string {
  const [first, ...rest] = names;
  if (!first) return '';
  const head = invertedName(first);
  if (rest.length === 0) return head;
  if (names.length > 10) return [head, ...rest.slice(0, 6).map(naturalName)].join(', ') + ', et al.';
  const others = rest.map(naturalName);
  return `${[head, ...others.slice(0, -1)].join(', ')}, and ${last(others) ?? ''}`;
}

/** MLA 9: "Card, David." / "Card, David, and Alan B. Krueger." / "Card, David, et al." */
export function mlaAuthorList(names: ParsedName[]): string {
  const [first, second] = names;
  if (!first) return '';
  const head = invertedName(first);
  if (!second) return head;
  if (names.length === 2) return `${head}, and ${naturalName(second)}`;
  return `${head}, et al.`;
}

/** Debate cite: "David Card and Alan B. Krueger" / "David Card et al." */
export function debateAuthorList(names: ParsedName[]): string {
  const [first, second] = names;
  if (!first) return '';
  if (!second) return naturalName(first);
  if (names.length === 2) return `${naturalName(first)} and ${naturalName(second)}`;
  return `${naturalName(first)} et al.`;
}

/** In-text author part per style. */
export function inTextAuthors(names: ParsedName[], style: 'apa' | 'chicago' | 'mla'): string {
  const fams = names.map(familyOf);
  const [a, b, c] = fams;
  if (!a) return '';
  const and = style === 'apa' ? '&' : 'and';
  if (fams.length === 1) return a;
  if (fams.length === 2) return `${a} ${and} ${b ?? ''}`;
  if (style === 'chicago' && fams.length === 3) return `${a}, ${b ?? ''}, and ${c ?? ''}`;
  return `${a} et al.`;
}
