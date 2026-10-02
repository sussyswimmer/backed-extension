# Backed — Find a real source for any claim

> Working name. Rename freely; it's only used in the manifest, UI header and package.json.

## What it is
A personal Chrome extension (MV3). You type or highlight any claim — on a webpage or **inside a Google Doc you're writing** — like "minimum wage hikes don't cause big job losses" or "Malaysia's capital controls worked better than IMF austerity", and Backed finds real English-language sources that say something **similar** (paraphrase counts, not just exact quotes). It searches first and shows results fast, **then** asks you a few questions to sharpen the search and pick the sources that fit your argument.

For every source you pick, Backed shows, right in the extension: **the link**, **a short summary** of what the source says about your claim, and **the exact quotation** where it says the similar thing. Citation and debate-card formats are one "Copy as…" click away.

## Copy formats (secondary — the in-extension result is the main output)
One user (me), three jobs. The chosen format only changes what "Copy as…" produces, not the search:
- **Research papers** — peer-reviewed and gov/IGO sources ranked first, full APA/Chicago citations, DOI when available, page numbers for PDFs.
- **School essays** — MLA by default, accessible sources (papers, reputable news, think tanks), short passage + citation.
- **Debate cards** — tag + debate cite + verbatim passage with the matching sentences bolded/underlined. Pushback section matters most here.

## Core user flow (search first, ask after)
1. **Input** — side panel text box, right-click "Find a source for this" on selected text on any webpage, **highlight a sentence in Google Docs + hotkey** (`Alt+Shift+E`), or hotkey anywhere. Copy format remembered from last time (Paper / Essay / Debate).
2. **Quick plan** — DeepSeek turns the raw claim into a query plan (paraphrases, keywords, per-source queries) with **no questions asked**.
3. **First search** — parallel source adapters: OpenAlex, Semantic Scholar, arXiv, and Exa (semantic web search for general web, news, think tanks, and gov/IGO domains).
4. **Extract & match** — get page text (Exa contents or our own fetch; HTML + PDF), chunk, pre-rank locally (BM25), then DeepSeek labels each passage: `direct`, `paraphrase`, `partial`, `contradicts`, `irrelevant`. Verified results stream into the panel.
5. **Refine (the questions)** — once first results are in, DeepSeek looks at what came back and asks 1–3 targeted questions: scope gaps ("These are mostly US studies — want Vietnam/Southeast Asia?"), strength ("Is 'associated with' enough, or do you need causal evidence?"), side, timeframe. Plus: "Which of these fits your argument best?" User answers, picks, or both.
6. **Re-search (if answers changed anything)** — re-plan with answers, search again, merge with existing results (cached fetches reused). Can loop.
7. **Result** — for each picked source: link, AI summary (labelled as a summary), verified quotation of the similar part. "Copy as…" for citation / debate card. Saved to history.

## Non-negotiable principles
- **Never fabricate a source or passage.** The LLM never writes passage text. It only returns sentence IDs from text we actually have. Every displayed passage is verified as a verbatim substring of the source text before it is shown (see `04-extract-and-match.md`).
- **Similar ≠ same.** Paraphrase matches must be labelled as paraphrase. Never present a paraphrase match as a direct statement of the user's claim.
- **Show contradictions too.** Strong contradicting sources go in a separate "Pushback" section.
- **Personal tool, BYO keys, no backend.** DeepSeek key (required) and Exa key (optional, unlocks web/news/think tanks/gov) live in `chrome.storage.local`. No server, no analytics, no accounts.
- **Credibility is visible.** Every result shows a tier badge (Peer-reviewed / Gov-IGO / Think tank / Major news / Preprint / Web).
- **English sources only.** All queries are in English; non-English results are filtered out. A claim typed in another language is translated to English before planning.
- **Summaries are labelled.** The per-source summary is AI-written and says so; it is generated only from text we actually have and never stands in for the quotation.
- **Fast first, smart second.** First verified result should appear before any question is asked.

## Stack
- Vite + TypeScript, MV3 (use `@crxjs/vite-plugin`)
- React + Tailwind for the side panel and options page
- Service worker = orchestrator (all network calls live here; it bypasses CORS via `host_permissions`)
- `@mozilla/readability` for HTML extraction, `pdfjs-dist` for PDFs — both in an **offscreen document** (needs DOM)
- Content script on `docs.google.com/document/*` to grab the highlighted text from Google Docs (see Brief 01)
- `zod` for validating every LLM JSON response
- `vitest` for tests
- DeepSeek via its OpenAI-compatible endpoint (`https://api.deepseek.com/chat/completions`), JSON mode on. Model name is a setting, default `deepseek-chat`. Check DeepSeek's docs for current model names before hardcoding anything.
- Exa search API (`https://api.exa.ai/search`, `x-api-key` header). Check Exa's docs for current request fields before coding.

## Repo layout
```
backed/
  manifest.config.ts
  src/
    background/        # service worker: orchestrator, message router
      pipeline.ts      # runs a job: plan -> search -> extract -> match -> refine loop
      llm/deepseek.ts  # client, retries, JSON mode, token/cost tracking
      llm/prompts.ts   # all prompts in one place
      llm/schemas.ts   # zod schemas for every LLM response
      sources/         # one file per adapter + index.ts registry
      extract/         # fetch, readability, pdf, chunking, bm25
      match/           # passage scoring, verification, ranking
      cite/            # citation formatters
    offscreen/         # DOM-needing work (readability, pdf.js)
    content/docs.ts    # Google Docs selection grabber
    sidepanel/         # React app: input, results, refine, output, history
    options/           # React: keys, model, source toggles, cost cap
    shared/            # types, messages, storage helpers
  tests/
    fixtures/          # saved HTML/PDF/API responses
    claims.json        # golden test claims
```

## Build order (one brief per phase — do them in order, finish each before moving on)
1. `01-scaffold-and-settings.md` — extension skeleton, side panel, options, keys, message bus
2. `02-plan-and-refine.md` — quick plan, results-aware refine questions, re-plan loop
3. `03-source-adapters.md` — OpenAlex, Semantic Scholar, arXiv, Exa behind one interface
4. `04-extract-and-match.md` — getting text, matching, verification
5. `05-results-refine-and-output.md` — results UI, refine/pick step, citations, cards, history
6. `06-testing-and-hardening.md` — golden tests, failure modes, cost caps

## Conventions
- Strict TypeScript, no `any`. Every cross-boundary message typed in `shared/messages.ts`.
- Every LLM call goes through `llm/deepseek.ts` and is parsed with a zod schema. On parse failure: one retry with the error appended, then fail gracefully.
- Every network call has a timeout (default 12s) and is cancellable via `AbortController` (user can hit Stop).
- Pipeline emits progress events to the side panel (`stage`, `message`, `percent`) so the UI never looks frozen.
- No secrets in logs. Redact keys in any error shown to the user.

## Definition of done (whole project)
- From a cold install: paste keys, type a claim (or highlight one in a Google Doc), see the first verified source in under ~20s, answer refine questions, end with at least 3 verified, real, clickable sources, each with a link, a summary and a highlighted quotation.
- Every shown quotation passes verbatim verification.
- Works with only a DeepSeek key (academic sources only) and fully with an Exa key added.
- All three "Copy as…" formats (Paper / Essay / Debate) produce correct, paste-ready output.
- All tests in `06` pass.
