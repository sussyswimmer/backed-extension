# Brief 04 — Extract, match, verify

Read `CLAUDE.md` first. Depends on 03. **This is the most important brief: it's what makes Backed trustworthy.**

## Goal
For each pre-ranked candidate, get its real text, find the passages that express the claim (or its opposite), and prove every shown passage is real.

## 1. Get the text
Order of preference:
1. **Open-access PDF** (`pdfUrl`) — fetch ourselves; best for papers (page numbers for citations).
2. **Exa `text`** already on the candidate — use it directly, no fetch needed. Mark `textSource: 'exa'`. This is the fast path for most web/news/policy results.
3. **Fetch `url` ourselves** — `fetch` from the service worker with timeout 12s, max 8 concurrent, max body ~8 MB.
4. **Abstract/snippet only** — if everything above fails or yields < 400 chars. Mark `textSource: 'abstract_only'`. Never pretend we read the full text.

- Detect content type for fetched docs: HTML → Readability; PDF → pdf.js. Both run in the **offscreen document** (needs DOM/worker). Message the raw bytes/text over.
- Verification (step 5) always runs against whichever text we actually used. For `exa` text, the "Open at passage" link still works because the text came from that page; if a user reports a mismatch, the debug panel can re-fetch the live page and re-verify.
- Keep `fetchedAt`, `textSource`, and the final URL after redirects on every document.

## 2. Extract & chunk (`extract/`)
- Readability → title, byline, published date (if found), main text. Strip nav, refs, footnotes.
- PDF → page texts; drop running headers/footers (lines repeated on >50% of pages), de-hyphenate line breaks, keep page numbers per chunk (for citations).
- Split into **sentences** (use `Intl.Segmenter` with `granularity: 'sentence'`), keep each sentence's char offsets into the document text.
- Chunks = windows of 3–5 consecutive sentences with 1-sentence overlap. Each chunk keeps its sentence index range and page.

## 3. Local pre-filter (cheap, no LLM)
- BM25 over all chunks of all docs, query = plan `keyTerms` + paraphrases (and `counterQuery` terms for counter candidates).
- Keep top 3 chunks per doc and top ~25 overall. This keeps DeepSeek calls small and cheap.

## 4. LLM match (`match/score.ts`)
Send batches of ~8 chunks. Each chunk is sent as **numbered sentences**, e.g. `[d3.s41] Raising the minimum wage...`. DeepSeek returns:
```ts
const MatchSchema = z.object({
  results: z.array(z.object({
    chunkId: z.string(),
    relation: z.enum(['direct','paraphrase','partial','contradicts','irrelevant']),
    sentenceIds: z.array(z.string()).max(4), // which sentences carry the match, e.g. ["d3.s41","d3.s42"]
    confidence: z.number().min(0).max(1),
    reason: z.string(),                      // 1 line, shown in UI
    scopeMismatch: z.string().optional(),    // e.g. "about US teens, claim is about Vietnam"
  })),
});
```
Prompt rules:
- `direct`: the source states essentially the same proposition. `paraphrase`: same idea, different wording or framing. `partial`: supports part of it or a weaker version. `contradicts`: finds the opposite. Be strict; when unsure, go one level weaker.
- **Return sentence IDs only. Never return or rewrite passage text.**
- Flag scope mismatches (different country, time period, population) and causal vs. correlational gaps.

## 5. Verify (non-negotiable)
For each match:
- Every `sentenceId` must exist in our sentence table for that doc. Unknown ID → drop the match.
- Rebuild the passage from our stored sentences, then assert `docText.includes(passage)` (after whitespace normalization). Fail → drop.
- Sentences must be contiguous or within a small gap (≤ 2 sentences); otherwise show them as separate ellipsis-joined fragments with `[…]`.
- Keep a `verification` object on each result: `{ verbatim: true, charStart, charEnd, page? }`.

## 6. Rank (`match/rank.ts`)
Final score = relation weight (direct 1.0, paraphrase 0.85, partial 0.5) × confidence × tier weight × mode boost − scope-mismatch penalty − abstract-only penalty (small).
- Tier weights: peer_reviewed 1.0, gov_igo 0.95, think_tank 0.8, major_news 0.75, preprint 0.7, web 0.4.
- Mode boost: **Paper** ×1.15 for peer_reviewed/gov_igo; **Essay** none; **Debate** ×1.1 for recent (last 5 years) and for passages with a clear quotable claim sentence.
- Output two lists: **Support** (direct/paraphrase/partial) top 7, **Pushback** (contradicts) top 3.
- One result per source document (its best passage), with "more passages from this source" expandable.

## 7. Cost & speed guardrails
- Track tokens; stop sending new batches if the estimated cost hits `costCapUsdPerSearch`, and tell the user.
- Stream results to the panel as soon as each batch is verified — don't wait for everything. The first verified result should land before refine questions appear (Brief 02).
- Cache documents, chunks and match results by URL for the whole job, so re-search rounds only process new documents.

## 8. Per-source summary
Every result card shows a short summary next to the quotation (Brief 05).
- After each round's ranking, one batched DeepSeek call for the visible results (≤ 10 docs). Input per doc: title, abstract/first 800 chars, and the top 2 verified chunks. **Not** the full document.
- Returns per doc: `summary` (2–3 plain sentences: what the source studied/argues and what it says about the claim), `howItRelates` (1 line, e.g. "Finds no significant job losses from US minimum wage increases, 1990–2012"), `limits` (optional 1 line: sample, region, method caveats).
- Prompt rules: only state what's in the given text; if the text is abstract-only, say so; no numbers that aren't in the given text.
- Cheap guard: every number in `summary` must appear somewhere in the doc text we have, else drop that sentence.
- The UI labels it "Summary (AI)". The verified quotation is always shown alongside it, so the summary is never the only evidence.

## Acceptance
- Unit tests: sentence split with offsets; PDF header/footer stripping; BM25 ordering; verification rejects a fabricated sentence ID and a tampered passage; Exa-text path and fetched-HTML path produce the same verified passage on the same fixture page.
- Fixture test: a saved paper + a saved news article → expected relation labels on known passages.
- No passage ever reaches the UI without `verification.verbatim === true` (enforce with a type: `VerifiedMatch` can only be constructed by `verify()`).
