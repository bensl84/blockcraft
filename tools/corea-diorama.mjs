// OWNER LANE: CORE-A. Renders the review diorama (tools/corea-diorama-page.js) in real headless Chrome and
// saves screenshots: .tmp/corea-diorama-<view>.png. Review aid only; nothing here ships.
//   node tools/corea-diorama.mjs [--views wide,close,cliff,ground] [--fast] [--swiftshader]
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp', 'corea-diorama');
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const views = (args.includes('--views') ? args[args.indexOf('--views') + 1] : 'wide,close,cliff,ground').split(',');
const res = await esbuild.build({ entryPoints: [join(ROOT, 'tools/corea-diorama-page.js')], bundle: true, format: 'iife', write: false, define: { __DEV__: 'true', __WORKER_SRC__: '""', __BUILD_VERSION__: '"diorama"' }, logLevel: 'silent' });
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000}</style><body><script>${res.outputFiles[0].text}</script></body>`);
const launchArgs = args.includes('--swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: launchArgs });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const v of views) {
  await page.goto(pathToFileURL(join(OUT, 'index.html')).href + `?view=${v}${args.includes('--fast') ? '&fast' : ''}&t=${args.includes('--t') ? args[args.indexOf('--t') + 1] : 0}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 20000 }).catch(() => { throw new Error("page did not finish: " + errors.join(" | ")); });
  await page.screenshot({ path: join(ROOT, '.tmp', `corea-diorama-${v}.png`) });
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`wrote .tmp/corea-diorama-{${views.join(',')}}.png`);
