# Brief 03 — Source adapters

Read `CLAUDE.md` first. Depends on 02 (uses `PlanSchema`).

## Goal
One interface, many sources, all queried in parallel, results normalized and deduped.

## Interface (`sources/types.ts`)
```ts
type SourceTier = 'peer_reviewed' | 'preprint' | 'gov_igo' | 'think_tank' | 'major_news' | 'web';
type SourceId = 'openalex' | 'semantic_scholar' | 'arxiv' | 'exa_web' | 'exa_news' | 'exa_policy' | 'exa_papers';

interface Candidate {
  id: string;                 // stable hash of canonical URL or DOI
  sourceId: SourceId;
  tier: SourceTier;
  title: string;
  url: string;                // landing page
  pdfUrl?: string;            // open-access PDF if known
  doi?: string;
  authors: string[];
  publisher?: string;         // journal, outlet, org
  published?: string;         // ISO date or year
  snippet?: string;           // abstract or search snippet
  citedByCount?: number;
  text?: string;              // full page text if the search API returned it (Exa contents)
  forCounter?: boolean;       // came from the counterQuery
}

interface SourceAdapter {
  id: SourceId;
  needsExaKey: boolean;
  search(plan: Plan, opts: { limit: number; signal: AbortSignal }): Promise<Candidate[]>;
}
```

## Adapters
Check each API's current docs before coding; endpoints below are the expected ones.

1. **OpenAlex** — `GET https://api.openalex.org/works?search=...&filter=from_publication_date:YYYY-01-01&per-page=N&mailto=...`
   - Abstract comes as `abstract_inverted_index` — rebuild it into text.
   - Use `best_oa_location.pdf_url` / `landing_page_url`. Tier: `peer_reviewed` if `type` is article in a journal, else `preprint`.
2. **Semantic Scholar** — `GET https://api.semanticscholar.org/graph/v1/paper/search?query=...&fields=title,abstract,year,authors,venue,url,openAccessPdf,externalIds,citationCount&limit=N`
   - Unauthenticated rate limit is tight: serialize S2 calls, back off on 429, never fail the whole job because of S2.
3. **arXiv** — `GET https://export.arxiv.org/api/query?search_query=all:...&max_results=N` (Atom XML, parse with a tiny XML parser). Tier `preprint`. Only run if the claim looks technical/scientific (plan keyTerms heuristic or a `domains` hint) to save time.
4. **Exa — one client, four adapters** (all need the Exa key). `POST https://api.exa.ai/search`, header `x-api-key`. Shared client in `sources/exa.ts`; each adapter is a preset of request options. Expected fields (verify in Exa docs): `query`, `type` (`auto` / `neural` / `keyword`), `numResults`, `includeDomains`, `excludeDomains`, `startPublishedDate`, `endPublishedDate`, `category` (e.g. `news`, `research paper`, `pdf`), and `contents: { text: { maxCharacters: 20000 } }` so we get page text back in the same call.
   - **`exa_web`** — plan `queries.semantic`, `type: 'neural'` (or `auto`). Tier by domain (see tiering). Exclude known low-quality domains.
   - **`exa_news`** — plan `queries.news`, `category: 'news'`. Tier `major_news` if on the news allowlist, else `web`.
   - **`exa_policy`** — plan `queries.policy`, `includeDomains` = think-tank list + gov/IGO list from `tiers.ts` (split into 2 calls if the API caps the list length). Tier from domain.
   - **`exa_papers`** — plan `queries.semantic`, `category: 'research paper'`. Catches papers OpenAlex keyword search misses because Exa matches meaning. Tier `peer_reviewed` only if domain is a known journal/publisher or a DOI is detectable; otherwise `preprint`.
   - Map `publishedDate` → `published`, `author` → `authors`, keep `text` on the candidate.
   - Date constraints from the plan go into `startPublishedDate` / `endPublishedDate`; region constraints get added to the query text (Exa has no region filter).
   - Exa returns its own relevance score — store it, use it as one input to pre-rank.

## Tiering (`sources/tiers.ts`)
Static, editable domain lists:
- `think_tank`: brookings.edu, cfr.org, piie.com, rand.org, cato.org, heritage.org, aei.org, csis.org, chathamhouse.org, carnegieendowment.org, urban.org, epi.org, nber.org (NBER working papers → `preprint`)...
- `major_news`: reuters.com, apnews.com, bbc.com, nytimes.com, wsj.com, ft.com, economist.com, bloomberg.com, theguardian.com, washingtonpost.com, nikkei.com, scmp.com, e.vnexpress.net (English edition)...
- `gov_igo`: `.gov`, `.gov.*`, `.int`, imf.org, worldbank.org, oecd.org, un.org, adb.org, bis.org, who.int, europa.eu, gov.vn, sbv.gov.vn
- Everything else: `web`. Flag known low-quality patterns (content farms, AI spam, wikis) as `web` with `lowQuality: true` and rank them last; Wikipedia allowed but tagged "use to find the real source".

## Language filter (English only)
- OpenAlex: add `language:en` to the filter. Semantic Scholar / arXiv: keep results whose title + abstract detect as English.
- Exa: no language filter in the request, so drop results whose `text` (or title + snippet) isn't English. Use a small detector (e.g. `franc-min` or a stopword-ratio check) and test it on fixtures.

## Orchestration (`sources/index.ts`)
- Run enabled adapters in parallel with `Promise.allSettled`, per-adapter timeout 10s.
- Also run the plan's `counterQuery` through OpenAlex + `exa_web` (limit 3 each), mark those candidates `forCounter: true`.
- **Dedupe** by DOI, then canonical URL (strip utm/query/fragments, http→https, trailing slash), then near-identical title (lowercased, punctuation stripped). Merge fields, keep the richest record (prefer one with `pdfUrl`).
- **Pre-rank** before extraction: score = tier weight + snippet keyword overlap with plan `keyTerms`/paraphrases + Exa score (if present) + recency (if constraints) + log(citedBy). Keep top ~15 for extraction (setting).
- **Re-search rounds** (from Brief 02 Step C): run only the adapters whose queries changed, merge into the existing candidate set, never drop candidates the user already saw.
- Emit progress per adapter ("OpenAlex: 6 results").

## Acceptance
- Each adapter has a unit test against a saved fixture response in `tests/fixtures/`.
- With no Exa key, the job still works on academic sources and the UI says web/news/think tanks/gov are off.
- A single adapter failing (timeout, 429, bad JSON) never breaks the job; it shows as a small warning.
- Dedupe test: the same paper from OpenAlex + S2 + an Exa hit collapses to one candidate (keep Exa's `text` if the others have none).
