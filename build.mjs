// OWNER: LEAD (build tooling). Do not edit from a lane; ask the integrator.
//
// Bundles src/main.js (and every CSS file it imports) into ONE self-contained index.html.
//   node build.mjs                 -> minified build into the project root (index.html, sw.js, manifest, icons)
//   node build.mjs --dev           -> unminified, keeps names (for debugging/tests)
//   node build.mjs --out <dir>     -> write into <dir> instead of the root (parallel agents: use .tmp/build-<lane>)
//   node build.mjs --quiet         -> no summary line
//
// Optional worker: if src/worker/worker.js exists it is bundled first as a classic IIFE string and
// injected as the compile-time constant __WORKER_SRC__ (see src/core/constants.js WORKER_SRC).
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawAppIcon, encodePNG } from './tools/png.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERSION_PLACEHOLDER = '__BC_BUILD_VERSION_PLACEHOLDER__';

function parseArgs(argv) {
  const a = { dev: false, out: ROOT, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dev') a.dev = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--out') a.out = resolve(ROOT, argv[++i]);
    else if (k.startsWith('--out=')) a.out = resolve(ROOT, k.slice(6));
    else throw new Error(`build.mjs: unknown argument ${k}`);
  }
  return a;
}

export async function build(opts = {}) {
  const o = { dev: false, out: ROOT, quiet: false, ...opts };
  const t0 = performance.now();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  // 1) Optional worker bundle (classic IIFE; module/blob-import workers fail on file://).
  let workerSrc = '';
  const workerEntry = join(ROOT, 'src/worker/worker.js');
  if (existsSync(workerEntry)) {
    const w = await esbuild.build({
      entryPoints: [workerEntry],
      bundle: true,
      format: 'iife',
      target: 'es2020',
      minify: !o.dev,
      write: false,
      legalComments: 'none',
      define: { __DEV__: JSON.stringify(o.dev), __WORKER_SRC__: '""', __BUILD_VERSION__: '"worker"' },
      logLevel: 'silent',
    });
    workerSrc = w.outputFiles[0].text;
  }

  // 2) Main bundle (JS + CSS imported from JS).
  const res = await esbuild.build({
    entryPoints: [join(ROOT, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !o.dev,
    keepNames: o.dev,
    write: false,
    outdir: join(ROOT, '.tmp/esbuild-virtual'),
    loader: { '.css': 'css', '.png': 'dataurl', '.txt': 'text' },
    legalComments: 'none',
    charset: 'utf8',
    define: {
      __DEV__: JSON.stringify(o.dev),
      __WORKER_SRC__: JSON.stringify(workerSrc),
      __BUILD_VERSION__: JSON.stringify(VERSION_PLACEHOLDER),
    },
    logLevel: 'silent',
  });
  if (res.warnings.length && !o.quiet) {
    for (const w of res.warnings) console.warn('[build] warning:', w.text, w.location ? `${w.location.file}:${w.location.line}` : '');
  }
  let js = '', css = '';
  for (const f of res.outputFiles) {
    if (f.path.endsWith('.js')) js += f.text;
    else if (f.path.endsWith('.css')) css += f.text;
  }
  const hash = createHash('sha256').update(js).update(css).digest('hex').slice(0, 8);
  const version = `${pkg.version}-${hash}${o.dev ? '-dev' : ''}`;
  js = js.split(VERSION_PLACEHOLDER).join(version);

  // 3) Inline into the template. Use split/join (never String.replace with the bundle: `$` patterns).
  const template = readFileSync(join(ROOT, 'src/index.template.html'), 'utf8');
  if (!template.includes('<!--__CSS__-->') || !template.includes('<!--__JS__-->')) {
    throw new Error('src/index.template.html must contain <!--__CSS__--> and <!--__JS__--> placeholders');
  }
  const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  const html = template
    .split('<!--__VERSION__-->').join(version)
    .split('<!--__CSS__-->').join(safeCss)
    .split('<!--__JS__-->').join(safeJs);

  // 4) Write outputs.
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'index.html'), html);
  writeFileSync(join(o.out, 'sw.js'), serviceWorkerSource(version));
  writeFileSync(join(o.out, 'manifest.webmanifest'), JSON.stringify(manifest(), null, 2) + '\n');
  writeFileSync(join(o.out, 'icon-192.png'), encodePNG(192, 192, drawAppIcon(192)));
  writeFileSync(join(o.out, 'icon-512.png'), encodePNG(512, 512, drawAppIcon(512)));

  const ms = Math.round(performance.now() - t0);
  const kb = (html.length / 1024).toFixed(0);
  if (!o.quiet) console.log(`[build] ${version} -> ${join(o.out, 'index.html')} (${kb} KB, ${ms} ms${o.dev ? ', dev' : ''})`);
  return { version, out: o.out, file: join(o.out, 'index.html'), bytes: html.length, ms };
}

function manifest() {
  return {
    name: 'Blockcraft',
    short_name: 'Blockcraft',
    description: 'Build, explore and play with blocks.',
    start_url: './',
    scope: './',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#78a7ff',
    theme_color: '#5a9a33',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

function serviceWorkerSource(version) {
  return `// Generated by build.mjs - do not edit. Blockcraft offline cache.
const CACHE = 'blockcraft-${version}';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blockcraft-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first so a new build arrives when online; cached copy when offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('[build] FAILED:', e && e.errors ? e.errors.map((x) => `${x.text} ${x.location ? x.location.file + ':' + x.location.line : ''}`).join('\n') : e);
    process.exit(1);
  });
}
