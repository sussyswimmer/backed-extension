# Brief 05 — Results UI, refine + pick step, picked-sources view, history

Read `CLAUDE.md` first. Depends on 02 and 04.

## Goal
Show results fast, ask the refine questions right next to them (not instead of them), let the user pick what fits, and show each picked source as link + summary + quotation inside the extension, with citation/card formats one click away.

## Results view (side panel)
- Top: the normalized claim, output mode chip (Paper / Essay / Debate, switchable any time — re-formats, doesn't re-search), and constraint chips once set ("2010–2025", "Vietnam", "Causal only"). Edit claim → new job.
- Live progress bar with stage text; results stream in as they're verified. Round indicator ("Round 2 of search") when refining.
- Two sections: **Support (n)** and **Pushback (n)**. In Debate mode Pushback is a full tab; in Paper/Essay it's a collapsible section below Support.
- **Result card:**
  - Tier badge (Peer-reviewed / Gov-IGO / Think tank / Major news / Preprint / Web) + relation badge (Direct / Paraphrase / Partial / Contradicts) + "New" badge if it arrived in a later round.
  - Title (opens new tab), authors, publisher, year.
  - **Summary (AI)** — 2–3 sentences from Brief 04 §8, plus `howItRelates` in bold as the first line. Collapsed to the first line by default; tap to expand.
  - **Quotation** — the verified passage, matching sentences highlighted, 1 sentence of context dimmed on each side.
  - One-line `reason` from the matcher. Amber row if `scopeMismatch` or `abstract_only`.
  - Buttons: **Use this**, **Open at passage** (`#:~:text=` text fragment for HTML; `#page=N` for PDFs), **More passages**, **Not relevant** (removes it + feeds into the next refine round as a signal).
- Empty state: "Nothing solid found" + one-click chips (broaden timeframe, drop region, accept correlational evidence, show the counter view).

## Refine card (the questions, from Brief 02 Step B)
- Pinned above the results once first-round matching finishes. Results stay visible and usable underneath — the user can ignore the card entirely.
- Shows `coverageNote` ("7 sources · mostly US 2015–2022 · 2 contradict"), then 1–3 questions as chips (choice) or a short input (text), each with a "Keep as is" option and the `why` on hover.
- Buttons: **Search again with these** (sends `ANSWER_REFINE`) and **Looks good** (dismiss, go to pick).
- While re-searching: card collapses to "Refining: Vietnam only, 2015+…" with a spinner. New results slide in with the "New" badge.
- Below the questions, always: **"Which of these fits your argument best?"** — the user answers by tapping **Use this** on cards (multi-select). Counter shows "2 picked → Make output".
- "None of these fit" → text box "What's missing?" → treated as a free-text refine answer → `SEARCH_AGAIN`.

## Picked sources view (the main output)
Everything stays in the extension. "2 picked → Done" opens a clean list. For each picked source, in this order:
1. **Link** — title as a clickable link + "Open at quotation" link (text fragment / PDF page).
2. **Summary (AI)** — full 2–3 sentence summary + `limits` line if present.
3. **Quotation** — the verified similar part, matching sentences highlighted, with the relation label (Direct / Paraphrase / Partial) right above it.
4. **Copy as…** menu — Citation, In-text citation, Debate card, or "Link + summary + quote" as plain text.

Top of the view: the claim, how many sources, and a "Copy all" button (copies every source as link + summary + quote).

### "Copy as…" formats
Same verified data, formatted by the remembered format (Paper / Essay / Debate), switchable without re-searching:

**Research paper**
- Full citation in APA 7 (default) or Chicago author-date. DOI over URL when present. Page number(s) when the passage came from a PDF.
- In-text citation string ready to paste: `(Card & Krueger, 1994, p. 790)`.
- Passage as a block quote if ≥ 40 words, inline quote otherwise.

**School essay**
- MLA 9 (default) or APA works-cited entry + in-text `(Author page)` citation.
- Short passage (trim to the matching sentences only) so it drops into a paragraph.

**Debate card**
- **Tag**: one-line claim in the user's framing, written by DeepSeek, labelled as the user's tag, not the source's words.
- **Cite**: `Author, credentials if known, Year, "Title," Publication, URL, accessed DATE`.
- **Passage**: verbatim verified text, matching sentences **bold + underlined**, context in normal weight, reduced font for the rest.
- Copies as rich text (works in Google Docs and Verbatim-style Word templates) and plain text.

All modes:
- Build citations from structured fields; missing fields degrade gracefully (never "undefined", "n.d." where the style calls for it).
- **Honesty line** when relation ≠ direct: "Paraphrase match: the source supports this idea in different words." / "Partial: supports a weaker version." On by default, removable per card.
- Copy buttons: Citation, In-text (Paper/Essay), Card (Debate), All. "Export .md" for the whole set.

## History
- Save each finished job to `chrome.storage.local`: claim, mode, constraint answers per round, picked sources, outputs, timestamp (cap at last 200; oldest drop).
- History tab: search by claim text, filter by mode, reopen a job (no re-fetch), delete one / clear all.

## Polish
- Keyboard: `Enter` submits, `Esc` stops, `1–9` toggles "Use this" on visible cards, `R` focuses the refine card.
- Dark/light follows system. Panel works at 320px width.
- All UI copy in plain, short sentences.

## Acceptance
- Manual test on 5 claims from `tests/claims.json` (one started from a Google Doc highlight): results appear → refine card appears with grounded questions → answer one → new results merge in with "New" badges → pick → picked-sources view shows link + summary + quotation for each → "Copy as…" works in Google Docs (rich text keeps bold/underline) and in a plain textarea.
- Switching Paper / Essay / Debate re-formats the copy output instantly without a new search.
- Citation formatter unit tests per style for: journal article with DOI, news article, gov report with org author, web page with no date, PDF passage with page number.
- Text-fragment links scroll to the passage on at least 3 real sites.
