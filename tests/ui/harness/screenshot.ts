// Visual check for the side panel and options page.
//
//   npx vite build && npx tsx tests/ui/harness/screenshot.ts [name-filter]
//
// Serves dist/ over HTTP, injects a fake `chrome` (chrome-stub.js) that replays canned JobStates
// from tests/ui/fixtures.ts, and screenshots each scenario with Playwright's Chromium into
// docs/screenshots/. Playwright is not a project dependency: it is loaded from $PLAYWRIGHT_MODULE,
// the project, or the global npm root. Fails on page errors and on horizontal overflow.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoryEntry, JobState, Settings } from '../../../src/shared/types';
import { demoHistory, demoSettings, demoState, emptyState, runningState } from '../fixtures';

/* ------------------------------ minimal Playwright types ------------------------------ */

interface PwLocator {
  first(): PwLocator;
  click(): Promise<void>;
  waitFor(opts?: { state?: 'visible' | 'attached'; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
}
interface PwPage {
  on(event: 'pageerror', cb: (err: Error) => void): void;
  on(event: 'console', cb: (msg: { type(): string; text(): string }) => void): void;
  addInitScript(script: { content: string }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: 'load' | 'networkidle' }): Promise<unknown>;
  getByRole(role: string, opts?: { name?: string | RegExp; exact?: boolean }): PwLocator;
  getByText(text: string | RegExp, opts?: { exact?: boolean }): PwLocator;
  locator(selector: string): PwLocator;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(opts: { viewport: { width: number; height: number }; colorScheme: 'light' | 'dark'; deviceScaleFactor?: number; reducedMotion?: 'reduce' }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwModule {
  chromium: { launch(opts?: { executablePath?: string }): Promise<PwBrowser> };
}

/* ------------------------------ setup ------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const dist = join(repo, 'dist');
const outDir = join(repo, 'docs', 'screenshots');

function loadPlaywright(): PwModule {
  const req = createRequire(import.meta.url);
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright');
  try {
    candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch {
    // no global npm
  }
  for (const c of candidates) {
    try {
      return req(c) as PwModule;
    } catch {
      // try the next one
    }
  }
  throw new Error('Playwright not found. Install it globally (npm i -g playwright) or set PLAYWRIGHT_MODULE.');
}

async function launch(pw: PwModule): Promise<PwBrowser> {
  try {
    return await pw.chromium.launch();
  } catch (first) {
    for (const p of ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']) {
      if (existsSync(p) && statSync(p).isFile()) return pw.chromium.launch({ executablePath: p });
    }
    throw first;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve(root: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

/* ------------------------------ scenarios ------------------------------ */

interface StubConfig {
  state: JobState | null;
  settings: Settings;
  history?: HistoryEntry[];
  hint?: string;
  pageAccess?: boolean;
}

interface Scenario {
  name: string;
  page: 'sidepanel' | 'options';
  width: number;
  height?: number;
  scheme: 'light' | 'dark';
  config: StubConfig;
  act?: (page: PwPage) => Promise<void>;
  /** Capture only the viewport as it is after `act` (shows fixed bars where the user sees them). */
  viewportOnly?: boolean;
}

const base = (state: JobState | null, over: Partial<StubConfig> = {}): StubConfig => ({ state, settings: demoSettings(), history: demoHistory(), ...over });

async function makeOutput(page: PwPage): Promise<void> {
  await page.getByRole('button', { name: /picked → Make output/ }).first().click();
  await page.getByText('Your sources for').waitFor();
}

const picked = () => demoState({ picked: ['rivera2019', 'natarajan2021'] });

const scenarios: Scenario[] = [];
for (const width of [320, 420]) {
  for (const scheme of ['light', 'dark'] as const) {
    scenarios.push({ name: `results-${width}-${scheme}`, page: 'sidepanel', width, scheme, config: base(demoState()) });
  }
}
scenarios.push(
  {
    name: 'results-picked-320-light',
    page: 'sidepanel',
    width: 320,
    height: 720,
    scheme: 'light',
    config: base(picked()),
    viewportOnly: true,
    act: async (page) => {
      await page.evaluate("document.querySelector('article')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -56)");
    },
  },
  { name: 'running-320-light', page: 'sidepanel', width: 320, scheme: 'light', config: base(runningState()) },
  { name: 'running-420-dark', page: 'sidepanel', width: 420, scheme: 'dark', config: base(runningState()) },
  {
    name: 'picked-320-light',
    page: 'sidepanel',
    width: 320,
    scheme: 'light',
    config: base(picked()),
    act: makeOutput,
  },
  { name: 'picked-420-dark', page: 'sidepanel', width: 420, scheme: 'dark', config: base(picked()), act: makeOutput },
  {
    name: 'picked-debate-420-light',
    page: 'sidepanel',
    width: 420,
    scheme: 'light',
    config: base(demoState({ mode: 'debate', picked: ['rivera2019', 'natarajan2021'] })),
    act: async (page) => {
      await makeOutput(page);
      await page.getByRole('button', { name: 'Copy as…' }).first().click();
    },
  },
  {
    name: 'debate-pushback-420-light',
    page: 'sidepanel',
    width: 420,
    scheme: 'light',
    config: base(demoState({ mode: 'debate', refineDismissed: true })),
    act: async (page) => {
      await page.getByRole('tab', { name: /Pushback/ }).click();
    },
  },
  { name: 'input-320-dark', page: 'sidepanel', width: 320, scheme: 'dark', config: base(null, { hint: 'Copy the sentence first (Ctrl/Cmd+C), then press the hotkey again.' }) },
  { name: 'input-nokey-420-light', page: 'sidepanel', width: 420, scheme: 'light', config: base(null, { settings: demoSettings({ deepseekKey: '' }) }) },
  { name: 'empty-320-light', page: 'sidepanel', width: 320, scheme: 'light', config: base(emptyState()) },
  {
    name: 'error-320-dark',
    page: 'sidepanel',
    width: 320,
    scheme: 'dark',
    config: base(
      demoState({
        status: 'interrupted',
        refine: undefined,
        error: { code: 'deepseek_key', message: 'Check your DeepSeek key.', showOptionsLink: true },
        academicOnly: true,
      }),
    ),
  },
  {
    name: 'history-420-light',
    page: 'sidepanel',
    width: 420,
    scheme: 'light',
    config: base(demoState()),
    act: async (page) => {
      await page.getByRole('tab', { name: 'History' }).click();
      await page.getByText('Finished searches').waitFor();
    },
  },
  {
    name: 'debug-420-dark',
    page: 'sidepanel',
    width: 420,
    height: 1100,
    scheme: 'dark',
    config: base(demoState({ refineDismissed: true }), { settings: demoSettings({ showDebug: true }) }),
    act: async (page) => {
      await page.locator('details summary').click();
      await page.getByRole('button', { name: 'Re-verify on live page' }).first().click();
      await page.waitForTimeout(500);
    },
  },
  { name: 'options-light', page: 'options', width: 820, scheme: 'light', config: base(null, { pageAccess: false }) },
  { name: 'options-dark', page: 'options', width: 820, scheme: 'dark', config: base(null, { pageAccess: true, settings: demoSettings({ exaKey: 'exa-demo' }) }) },
);

/* ------------------------------ run ------------------------------ */

async function main(): Promise<void> {
  const filter = process.argv[2];
  if (!existsSync(join(dist, 'src/sidepanel/index.html'))) throw new Error('dist/ is missing. Run `npx vite build` first.');
  mkdirSync(outDir, { recursive: true });
  const stub = readFileSync(join(here, 'chrome-stub.js'), 'utf8');
  const pw = loadPlaywright();
  const browser = await launch(pw);
  const { server, base: origin } = await serve(dist);
  const problems: string[] = [];
  try {
    for (const sc of scenarios) {
      if (filter && !sc.name.includes(filter)) continue;
      const ctx = await browser.newContext({
        viewport: { width: sc.width, height: sc.height ?? 900 },
        colorScheme: sc.scheme,
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      page.on('pageerror', (err) => problems.push(`${sc.name}: page error: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`${sc.name}: console error: ${msg.text()}`);
      });
      await page.addInitScript({ content: `${stub}\nwindow.__installChromeStub(${JSON.stringify(sc.config)});` });
      const path = sc.page === 'options' ? 'src/options/index.html' : 'src/sidepanel/index.html';
      await page.goto(`${origin}/${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      if (sc.act) await sc.act(page);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      if (typeof overflow === 'number' && overflow > 0) problems.push(`${sc.name}: horizontal overflow of ${overflow}px`);
      // Sticky headers render mid-page in full-page captures when the page is scrolled.
      if (!sc.viewportOnly) await page.evaluate('window.scrollTo(0, 0)');
      const file = join(outDir, `${sc.name}.png`);
      await page.screenshot({ path: file, fullPage: !sc.viewportOnly });
      console.log(`saved ${file}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
