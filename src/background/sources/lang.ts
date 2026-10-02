// Tiny English detector: Latin-script check + stopword ratios + diacritic density.
// Runs in the service worker (no DOM, no deps). Tuned to be lenient on short English titles,
// which often contain no stopwords at all ("Myopic Loss Aversion").

const EN = new Set(
  (
    'the of and to in a is that for on with as by are was be this it from at or an have has had not which ' +
    'their we our these were been can more than but also its between they there how what will would do does ' +
    'did into about after over under such may might should could who whom whose when where why while if then ' +
    'those them he she his her you your i my me us all any each other some most many much both only very ' +
    'no nor so too just being because through during before against among within without across per up out'
  ).split(' '),
);

// Function words of other languages, minus anything that is also an English stopword ("a", "no", "in", "on"...).
const OTHER: Record<string, Set<string>> = {
  es: new Set(
    'de la que el en y los del se las por un para con una su al es lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros os mío son fue ser han efecto efectos sobre según'.split(
      ' ',
    ),
  ),
  fr: new Set(
    "de la le et les des en un du une que est pour qui dans par sur pas au avec ce il ne se plus sont ou mais comme leur aux cette ont été être elle nous vous ils sa son ses ces dont entre sans sous chez où très aussi même donc car l d qu n c s j effet effets selon".split(
      ' ',
    ),
  ),
  de: new Set(
    'der die und den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei ihre ihr wir können kann sowie gegen zwischen unter wenn diese dieser diesem jedoch'.split(
      ' ',
    ),
  ),
  pt: new Set(
    'de que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele sobre efeito efeitos'.split(
      ' ',
    ),
  ),
  it: new Set(
    'di e il la che per un in è del della le una non con si da al dei sono gli nel alla delle anche come più ma lo degli ha questo nella tra sul sulla dalla essere stato questa loro ad cui o perché quando già effetto effetti'.split(
      ' ',
    ),
  ),
  vi: new Set(
    'và của có là được các trong những cho không với này một người đã để theo từ khi về như tại đến cũng nhưng nhiều đó thì sẽ ra lại vào nên mà hơn trên năm việc làm tác động lương tối thiểu kinh tế'.split(' '),
  ),
  id: new Set('dan yang di ini itu dengan untuk dari dalam tidak akan pada adalah juga ke oleh karena atau sebagai bisa ada mereka kami kita telah sudah'.split(' ')),
  nl: new Set('de het een en van in is dat op te zijn voor met niet aan er om ook als bij door maar uit dan nog wordt werd heeft hebben deze naar'.split(' ')),
};

// Drop overlaps with English and bare ASCII letters ("U.S." and "e.g." would otherwise look foreign).
for (const set of Object.values(OTHER)) {
  for (const w of EN) set.delete(w);
  for (const w of [...set]) if (/^[a-z]$/.test(w)) set.delete(w);
}

/** French/Italian elision: l'emploi, d'une, qu'il, dell'economia. */
const ELISION = /(?:^|[^\p{L}])(?:[ldjnmcst]|qu|dell|nell|all|sull)['’]\p{L}/giu;

const LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}]+)?/gu;

function sampleOf(text: string): string {
  const t = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ') // markdown link targets
    .replace(/[#*_>|`~=]+/g, ' ');
  if (t.length <= 4000) return t;
  const mid = Math.floor(t.length / 2);
  return t.slice(0, 2000) + ' ' + t.slice(mid, mid + 2000);
}

function countMatches(s: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) n++;
  return n;
}

/**
 * True when the text looks like English.
 * - Mostly non-Latin letters (Chinese, Cyrillic, Arabic…) → false.
 * - Many words with diacritics (Vietnamese, French, Spanish…) → false.
 * - More foreign function words than English ones → false.
 * - Short, plain-ASCII text without foreign function words → true (titles).
 * - Longer text needs a minimum English stopword ratio.
 */
export function isEnglish(text: string): boolean {
  if (!text) return false;
  const sample = sampleOf(text.normalize('NFC'));
  const letters = countMatches(sample, LETTER);
  if (letters === 0) return false;
  const latin = countMatches(sample, LATIN_LETTER);
  if (latin / letters < 0.7) return false;

  const words = (sample.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/['’].*$/, ''));
  if (words.length === 0) return false;

  let en = 0;
  let accented = 0;
  const other: Record<string, number> = {};
  for (const w of words) {
    if (EN.has(w)) en++;
    if (/[^\x00-\x7f]/.test(w)) accented++;
    for (const [lang, set] of Object.entries(OTHER)) if (set.has(w)) other[lang] = (other[lang] ?? 0) + 1;
  }
  const elisions = countMatches(sample, ELISION);
  if (elisions > 0) other.fr = (other.fr ?? 0) + elisions;
  const foreign = Math.max(0, ...Object.values(other));
  const n = words.length;
  const accentedRatio = accented / n;
  const enRatio = en / n;

  if (n < 8) {
    // Titles. Foreign function words decide; with none on either side, plain ASCII wins ("Myopic Loss Aversion").
    if (foreign > en) return false;
    if (foreign >= 1 && en === 0) return false;
    if (foreign >= 1 && foreign === en) return accented === 0;
    if (en > 0) return accentedRatio <= 0.5; // "Nguyễn and Trần on Vietnam's Economy"
    return accentedRatio <= 0.15;
  }
  if (accentedRatio > 0.2) return false;
  if (foreign > en && foreign >= 2) return false;
  if (n < 30) return en >= foreign && (en > 0 || foreign === 0);
  return enRatio >= 0.1 && en > foreign * 1.5;
}
