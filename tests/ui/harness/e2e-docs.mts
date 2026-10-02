// End-to-end check on a REAL Google Doc (needs network): load the built extension, open a public
// Doc, select a paragraph like a person would, and check the "Find a source" button appears and
// opens the popup with the selected text. Also checks the toolbar icon is set to open the sidebar.
//
//   npx vite build && NODE_USE_ENV_PROXY=1 npx tsx tests/ui/harness/e2e-docs.mts [doc-url]
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
interface Frame {
  url(): string;
  evaluate<R>(fn: () => R): Promise<R>;
}
interface Page {
  on(event: 'console', fn: (m: { type(): string; text(): string }) => void): void;
  on(event: 'requestfailed', fn: (r: { url(): string; failure(): { errorText: string } | null }) => void): void;
  goto(url: string, opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  mouse: { click(x: number, y: number, opts?: { clickCount?: number }): Promise<void>; move(x: number, y: number): Promise<void> };
  evaluate<R>(fn: () => R): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts: { path: string }): Promise<unknown>;
  frames(): Frame[];
}
interface Worker {
  url(): string;
  evaluate<R>(fn: () => R): Promise<R>;
}
interface Context {
  newPage(): Promise<Page>;
  serviceWorkers(): Worker[];
  waitForEvent(name: 'serviceworker'): Promise<Worker>;
  close(): Promise<void>;
}
interface PW {
  chromium: {
    launchPersistentContext(dir: string, opts: { channel?: string; headless?: boolean; args?: string[]; viewport?: { width: number; height: number }; proxy?: { server: string }; ignoreHTTPSErrors?: boolean }): Promise<Context>;
  };
}
let pw: PW;
try {
  pw = require('playwright') as PW;
} catch {
  pw = require('/opt/node-tools/node_modules/playwright') as PW;
}

const repo = join(import.meta.dirname, '..', '..', '..');
const dist = join(repo, 'dist');
const shots = join(repo, 'docs', 'screenshots');
const DOC = process.argv[2] ?? 'https://docs.google.com/document/d/1YB7mhT1bQFAkicR3ycouX-cxHZL3xffM7iS3qTv7qZk/edit?usp=sharing';

const context = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'backed-docs-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY }, ignoreHTTPSErrors: true } : {}),
});
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
};
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  // Headless Chromium has no side panel UI, so the API may be missing there.
  const behavior = await sw.evaluate(() => (chrome.sidePanel ? chrome.sidePanel.getPanelBehavior() : null));
  if (behavior) check(behavior.openPanelOnActionClick === true, 'toolbar icon opens the sidebar');
  else console.log('- sidebar check skipped (no side panel in headless Chromium)');

  const page = await context.newPage();
  const consoleLines: string[] = [];
  if (process.env.DEBUG) page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`));
  if (process.env.DEBUG) page.on('requestfailed', (r) => { if (r.url().startsWith('chrome-extension://')) consoleLines.push(`FAILED ${r.url()} ${r.failure()?.errorText}`); });
  // Docs occasionally fails to start ("Loading issue") on flaky networks: retry a few times.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.goto(DOC, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (e) {
      console.log(`- navigation failed (attempt ${attempt}): ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      await page.waitForTimeout(15_000);
      continue;
    }
    await page.waitForTimeout(9000);
    const ready = await page.evaluate(() => !!document.querySelector('iframe.docs-texteventtarget-iframe') && !document.body.innerText.includes('Loading issue'));
    if (ready) break;
    console.log(`- Docs didn't load (attempt ${attempt}), retrying`);
  }
  // A body paragraph a little below the top of the first page.
  const at = await page.evaluate(() => {
    const pageEl = document.querySelector('.kix-page-paginated') ?? document.querySelector('.kix-appview-editor');
    const r = pageEl!.getBoundingClientRect();
    return { x: Math.round(r.left + 220), y: Math.round(r.top + 137) };
  });
  // Triple-click selects the paragraph, like a person would.
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { clickCount: 3 });
  await page.waitForTimeout(900);
  const hidden = await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('iframe.docs-texteventtarget-iframe');
    return f?.contentWindow?.getSelection()?.toString() ?? '';
  });
  check(hidden.trim().split(/\s+/).length >= 3, `Docs exposes the selection ("${hidden.trim().slice(0, 60)}…")`);
  await page.screenshot({ path: join(shots, 'docs-1-button.png') });

  // Our button sits 44px above where the mouse was released.
  const bx = Math.min(Math.max(at.x - 12, 4), 1280 - 150) + 50;
  const by = at.y - 44 + 13;
  await page.mouse.move(bx, by);
  await page.mouse.click(bx, by);
  await page.waitForTimeout(2500);
  const popup = page.frames().find((f) => f.url().startsWith(`chrome-extension://${extId}/src/popup/index.html#frame=`));
  check(!!popup, 'clicking "Find a source" in Google Docs opened the popup');
  if (popup && process.env.DEBUG) {
    await page.waitForTimeout(3000);
    console.log(await popup.evaluate(() => JSON.stringify({ ready: document.readyState, href: location.href, root: document.getElementById('root')?.innerHTML.length, text: document.body.innerText.slice(0, 200), cls: document.documentElement.className })));
    console.log(consoleLines.filter((l) => /FAILED|refused|blocked|backed|CORS|Cross-Origin|policy/i.test(l)).slice(0, 30).join('\n'));
  }
  if (popup) {
    const text = await popup.evaluate(() => document.body.innerText);
    const first = hidden.trim().split(/\s+/).slice(0, 4).join(' ');
    check(!!first && text.replace(/\s+/g, ' ').includes(first), `popup shows the highlighted Docs text ("${first}…")`);
  }
  await page.screenshot({ path: join(shots, 'docs-2-popup.png') });
} finally {
  await context.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
