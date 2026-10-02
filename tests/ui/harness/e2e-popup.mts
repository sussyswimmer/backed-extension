// End-to-end check of the real built extension in Chromium (no API keys needed):
//   highlight text on a page → the "Find a source" button appears → click → the in-page popup opens,
//   connects to the service worker with its token and shows the job (here: "add your DeepSeek key").
// Also checks that a page can't get data by embedding the popup page itself.
//
//   npx vite build && npx tsx tests/ui/harness/e2e-popup.mts
// Screenshots go to docs/screenshots/popup-*.png.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
interface Page {
  goto(url: string): Promise<unknown>;
  click(selector: string, opts?: { clickCount?: number }): Promise<void>;
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
  evaluate<R>(fn: () => R): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts: { path: string }): Promise<unknown>;
  route(url: string, handler: (route: { fulfill(r: { status: number; contentType: string; body: string }): Promise<void> }) => Promise<void>): Promise<void>;
  frames(): Array<{ url(): string; evaluate<R>(fn: () => R): Promise<R> }>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
}
interface Context {
  newPage(): Promise<Page>;
  serviceWorkers(): Array<{ url(): string }>;
  waitForEvent(name: 'serviceworker'): Promise<{ url(): string }>;
  close(): Promise<void>;
}
interface PW {
  chromium: { launchPersistentContext(dir: string, opts: { channel?: string; headless?: boolean; args?: string[]; viewport?: { width: number; height: number } }): Promise<Context> };
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
const ARTICLE = `<!doctype html><html><head><title>Test article</title><style>body{font:18px/1.6 Georgia,serif;max-width:680px;margin:40px auto;padding:0 20px;color:#222}</style></head>
<body><h1>The minimum wage debate</h1>
<p>Economists have argued about the minimum wage for decades, and the evidence keeps piling up on both sides.</p>
<p id="claim">Raising the minimum wage does not significantly reduce employment.</p>
<p>Critics say large increases could still cost jobs in low-wage regions, especially for teenagers and small businesses.</p>
${'<p>More text so the page can scroll a little further down the screen.</p>'.repeat(12)}</body></html>`;

const context = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'backed-e2e-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}`);
};
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  check(!!extId, `extension loaded (${extId})`);

  const page = await context.newPage();
  await page.route('http://backed.test/**', async (route) => route.fulfill({ status: 200, contentType: 'text/html', body: ARTICLE }));
  await page.goto('http://backed.test/article');
  await page.waitForTimeout(600);

  // Highlight the claim like a person would (triple-click selects the paragraph).
  await page.click('#claim', { clickCount: 3 });
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getClientRects();
    const last = r[r.length - 1]!;
    return { x: last.right, y: last.bottom, text: window.getSelection()!.toString().trim() };
  });
  check(end.text.startsWith('Raising the minimum wage'), 'text selected');
  await page.screenshot({ path: join(shots, 'popup-1-button.png') });

  // The button sits just below the end of the selection (closed shadow root → click by position).
  const bx = Math.min(Math.max(end.x - 12, 4), 1100 - 150) + 50;
  const by = end.y + 6 + 13;
  await page.mouse.move(bx, by);
  await page.mouse.click(bx, by);
  await page.waitForTimeout(2500);
  const popup = page.frames().find((f) => f.url().startsWith(`chrome-extension://${extId}/src/popup/index.html#frame=`));
  check(!!popup, 'clicking the button opened the in-page popup');
  if (popup) {
    const text = await popup.evaluate(() => document.body.innerText);
    check(/Raising the minimum wage/.test(text), 'popup shows the highlighted claim');
    check(/DeepSeek key/i.test(text), 'popup is connected to the worker (shows the no-key message)');
  }
  await page.screenshot({ path: join(shots, 'popup-2-open.png') });

  // Esc (with focus on the page) closes it.
  await page.mouse.click(40, 760);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(!page.frames().some((f) => f.url().includes('/src/popup/index.html')), 'Esc closes the popup');

  // A web page embedding the popup page itself gets no data (no token from the worker).
  const evil = await context.newPage();
  await evil.route('http://evil.test/**', async (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<iframe id="f" src="chrome-extension://${extId}/src/popup/index.html#frame=${'0'.repeat(32)}" width="400" height="500"></iframe>` }),
  );
  await evil.goto('http://evil.test/');
  await evil.waitForTimeout(2000);
  const framed = evil.frames().find((f) => f.url().includes('/src/popup/index.html'));
  const leaked = framed ? await framed.evaluate(() => document.body.innerText) : '';
  check(!/Raising the minimum wage|DeepSeek key/.test(leaked), 'an embedding page with a fake token gets no job data');
} finally {
  await context.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
