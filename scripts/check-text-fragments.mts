// Dev check (Brief 05): "Open at passage" text-fragment links scroll to the passage on real sites.
// Fetches each page, extracts it with the same Readability path the extension uses, picks a
// sentence from the middle of the article, builds the link with textFragmentUrl(), opens it in
// Chromium, and checks the passage ends up in the viewport.
//
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/check-text-fragments.mts [url ...]
// Needs Playwright + Chromium (PLAYWRIGHT_BROWSERS_PATH); not part of npm test (network).
import { createRequire } from 'node:module';
import { nodeExtractor } from './nodeExtractor';
import { buildDoc } from '../src/background/extract/chunk';
import { textFragmentUrl } from '../src/shared/cite';
import { countWords } from '../src/shared/text';
import { looksBlocked } from '../src/background/extract/getText';

const require = createRequire(import.meta.url);
type PW = typeof import('playwright');
let pw: PW;
try {
  pw = require('playwright') as PW;
} catch {
  pw = require('/opt/node-tools/node_modules/playwright') as PW;
}

const URLS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://en.wikipedia.org/wiki/Minimum_wage_in_the_United_States',
      'https://www.dol.gov/agencies/whd/minimum-wage/history',
      'https://plato.stanford.edu/entries/equal-opportunity/',
      'https://www.gov.uk/national-minimum-wage',
      'https://www.britannica.com/topic/minimum-wage',
      'https://www.bbc.com/news/business-50271366',
    ];

// Full Chromium (new headless): the stripped-down headless shell ignores text fragments.
const browser = await pw.chromium.launch({
  channel: 'chromium',
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
let passed = 0;
for (const url of URLS) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Backed text-fragment check)', accept: 'text/html' } });
    const html = await res.text();
    const extracted = await nodeExtractor().html(html, res.url || url);
    if (looksBlocked(extracted.text) || !res.ok) {
      console.log(`- ${url}: skipped (HTTP ${res.status}${looksBlocked(extracted.text) ? ', bot-protection page' : ''})`);
      continue;
    }
    const doc = buildDoc({ docId: 'd1', candidateId: 'c', text: extracted.text, textSource: 'html', finalUrl: res.url || url, fetchedAt: '' });
    // Prose sentences only (table rows and figure captions aren't what Backed quotes).
    const prose = (t: string) => countWords(t) >= 12 && countWords(t) <= 45 && !/[\[\]{}|]/.test(t) && (t.match(/\d+/g) ?? []).length <= 3 && /[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(t) && /[.!?]$/.test(t);
    const candidates = doc.sentences.filter((s) => prose(s.text));
    const sentence = candidates[Math.floor(candidates.length * 0.6)];
    if (!sentence) {
      console.log(`- ${url}: no usable sentence extracted (HTTP ${res.status}, ${extracted.text.length} chars)`);
      continue;
    }
    const link = textFragmentUrl(res.url || url, sentence.text);
    const page = await context.newPage();
    await page.goto(link, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForTimeout(1500);
    const visible = await page.evaluate((needle: string) => {
      const words = needle.split(/\s+/).slice(0, 4).join(' ');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ');
        if (t.includes(words)) {
          const r = (n.parentElement as Element).getBoundingClientRect();
          return { found: true, top: r.top, inView: r.top >= -50 && r.top <= window.innerHeight, scrollY: window.scrollY };
        }
      }
      return { found: false, top: 0, inView: false, scrollY: window.scrollY };
    }, sentence.text);
    const ok = visible.found && visible.inView && visible.scrollY > 0;
    if (ok) passed++;
    console.log(`${ok ? '✓' : '✗'} ${url}\n    “${sentence.text.slice(0, 100)}…”\n    scrollY=${Math.round(visible.scrollY)} top=${Math.round(visible.top)} found=${visible.found}\n    ${link.slice(0, 160)}…`);
    await page.close();
  } catch (e) {
    console.log(`✗ ${url}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
}
await browser.close();
console.log(`\n${passed}/${URLS.length} sites scrolled to the passage.`);
process.exit(passed >= 3 ? 0 : 1);
