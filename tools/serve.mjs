// OWNER: LEAD (tooling). Zero-dependency static file server.
//   node tools/serve.mjs [port] [dir]        (defaults: 8080, project root)
//   node tools/serve.mjs --port 9000 --dir .tmp/build-x
// Exported startServer() is used by tools/smoke.mjs --http.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.map': 'application/json',
};

export function startServer({ port = 8080, dir = ROOT, quiet = false } = {}) {
  const base = resolve(dir);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(base, p));
      if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403); res.end('forbidden'); return; }
      let st;
      try { st = statSync(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      if (st.isDirectory()) { res.writeHead(302, { location: url.pathname.replace(/\/?$/, '/') }); res.end(); return; }
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-cache',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file).pipe(res);
      if (!quiet) console.log(`[serve] ${req.method} ${url.pathname}`);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      if (!quiet) console.log(`[serve] http://127.0.0.1:${actual}/  (dir: ${base})`);
      resolveP({ server, port: actual, url: `http://127.0.0.1:${actual}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 8080, dir = ROOT;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--dir') dir = resolve(ROOT, args[++i]);
    else positional.push(args[i]);
  }
  if (positional[0] !== undefined) port = Number(positional[0]);
  if (positional[1] !== undefined) dir = resolve(ROOT, positional[1]);
  startServer({ port, dir }).catch((e) => { console.error('[serve] failed:', e.message); process.exit(1); });
}
