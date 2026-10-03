// OWNER LANE: FEATURE-MOBS. Tiny Playwright driver for the mobs lane's in-world playtests (tools/mobs-play.mjs).
// Opens a build in real Chrome (file://), exposes call(method, ...args) -> window.__game[method](...) and
// ev(fn, arg) -> page.evaluate, plus shot(name) into .tmp/mobs-play/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, '.tmp', 'mobs-play');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function open({ file = join(ROOT, '.tmp', 'build-mobs', 'index.html'), swiftshader = false, touch = false, headed = false, width = 1280, height = 720 } = {}) {
  mkdirSync(OUT, { recursive: true });
  const args = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'];
  if (swiftshader) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await chromium.launch({ executablePath: CHROME, headless: !headed, args });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ReadPixels|CONTEXT_LOST/i.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
  const call = (method, ...a) => page.evaluate(async ({ method, a }) => window.__game[method](...a), { method, a });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => { const p = join(OUT, name + '.png'); await page.screenshot({ path: p }); return p; };
  const gameErrors = () => page.evaluate(() => window.__game.errors.map((e) => `${e.where}: ${e.message}`));
  const results = [];
  const check = (cond, msg, extra) => { results.push({ ok: !!cond, msg, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`); return !!cond; };
  return { browser, page, call, ev, shot, errors, gameErrors, results, check, close: () => browser.close() };
}
