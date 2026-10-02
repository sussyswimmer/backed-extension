# Backed — privacy note

Backed is a personal tool. It has **no server, no analytics and no accounts**. Everything runs in your browser.

## What is stored, and where

| Data | Where | How long |
|---|---|---|
| DeepSeek key, Exa key, OpenAlex key, contact email, settings | `chrome.storage.local` on your computer | Until you remove them in Options |
| The current search (claim, results, answers) | `chrome.storage.session` | Until the browser closes |
| History (claim, mode, answers, picked sources, formatted output) | `chrome.storage.local` | Last 200 searches; delete one or clear all in the History tab |

Keys are only sent to the service they belong to, always in a request **header** (never in a URL), and are never written to logs or shown in error messages.

## What is sent where

| Service | What Backed sends | Why |
|---|---|---|
| **DeepSeek** (`api.deepseek.com`) | Your claim, the search plan, and short numbered passages from sources (plus titles and the first ~800 characters of picked sources for summaries) | Planning searches, labelling passages, writing summaries and follow-up questions |
| **OpenAlex** (`api.openalex.org`) | Short keyword queries; your contact email if you set one (OpenAlex "polite pool") | Finding academic papers |
| **Semantic Scholar** (`api.semanticscholar.org`) | Short keyword queries | Finding academic papers |
| **arXiv** (`export.arxiv.org`) | Short keyword queries (technical claims only) | Finding preprints |
| **Exa** (`api.exa.ai`), only if you add a key | Search sentences and domain filters | Finding web, news, think-tank and government sources |
| **The source websites themselves** | A normal page request (no cookies) for the pages and PDFs that were found | Reading the real text so every quotation can be verified |

Backed never sends your browsing history, other tabs, page content, or Google Docs content beyond the sentence you highlight and ask about.

## Permissions

- `storage`, `sidePanel`, `contextMenus`, `offscreen`: the extension itself.
- `activeTab`, `scripting`: read the text you highlighted when you use the shortcut on pages where the content script isn't running, and add the "Find a source" button to tabs that were already open when Backed was installed or updated.
- `clipboardRead`, `clipboardWrite`: Google Docs fallback (Docs draws text on a canvas, so the highlighted sentence is read from a copy) and the "Copy as…" buttons.
- Access to all sites, for two things:
  - the small **"Find a source" button** that appears when you highlight text. It runs on every page but sends nothing anywhere until you click it (or press the shortcut). It only reads its own on/off setting, never your keys.
  - downloading the pages and PDFs that a search found (no cookies sent), so every quotation can be checked against the real text.
