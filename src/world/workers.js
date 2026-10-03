// OWNER LANE: CORE-C. Main-thread side of the generation/meshing worker pool (SPEC §5.3.5, D6).
//
// The worker source is the build-time string WORKER_SRC (src/worker/worker.js bundled as a classic IIFE).
// A Blob URL classic worker works from file:// and http(s); module workers / importScripts do not. Creation is
// wrapped in try/catch: with no Worker (Node tests), no WORKER_SRC (unbundled dev), a CSP refusal, a worker
// error or a worker that answers ok:false to 'init', the pool reports `alive === false` and the world does
// everything on the main thread instead.

import { WORKER_SRC } from '../core/constants.js';

/**
 * @param {{count?: number, onDead?: (reason: string) => void}} [opts]
 * @returns {{alive: boolean, size: number, inFlight: () => number, canPost: (kind: 'gen'|'mesh') => boolean,
 *   post: (msg: object, transfer?: Transferable[]) => Promise<object>, init: (layers: Array) => Promise<boolean>,
 *   kill: (reason: string) => void, stats: () => object}}
 */
export function createWorkerPool(opts = {}) {
  const pool = {
    alive: false,
    size: 0,
    reason: 'not started',
    inFlight: () => 0,
    canPost: () => false,
    post: () => Promise.resolve({ ok: false, error: 'no workers' }),
    init: () => Promise.resolve(false),
    kill: () => {},
    stats: () => ({ alive: false, size: 0, reason: pool.reason }),
  };
  if (!WORKER_SRC || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    pool.reason = !WORKER_SRC ? 'no WORKER_SRC' : 'no Worker API';
    return pool;
  }
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const count = Math.max(1, Math.min(opts.count || 3, hc - 1 || 1));
  const workers = [];
  let nextId = 1;
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    for (let i = 0; i < count; i++) {
      const w = new Worker(url);
      const rec = { w, pending: new Map(), gen: 0, mesh: 0 };
      w.onmessage = (e) => {
        const d = e.data || {};
        const p = rec.pending.get(d.id);
        if (!p) return;
        rec.pending.delete(d.id);
        rec[p.kind]--;
        p.resolve(d);
      };
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); kill('worker error: ' + (e && e.message ? e.message : 'unknown')); };
      w.onmessageerror = () => kill('worker message error');
      workers.push(rec);
    }
  } catch (err) {
    for (const r of workers) { try { r.w.terminate(); } catch { /* ignore */ } }
    workers.length = 0;
    pool.reason = 'Worker creation failed: ' + (err && err.message ? err.message : err);
    return pool;
  }

  const LIMIT = { gen: 2, mesh: 8, init: 1 };
  function kill(reason) {
    if (!pool.alive) return;
    pool.alive = false;
    pool.reason = reason;
    for (const r of workers) {
      for (const p of r.pending.values()) p.resolve({ id: 0, ok: false, error: reason });
      r.pending.clear(); r.gen = 0; r.mesh = 0;
      try { r.w.terminate(); } catch { /* ignore */ }
    }
    if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
    if (opts.onDead) opts.onDead(reason);
  }
  function pick(kind) {
    let best = null;
    for (const r of workers) if (r[kind] < LIMIT[kind] && (!best || r.gen + r.mesh < best.gen + best.mesh)) best = r;
    return best;
  }
  pool.alive = true;
  pool.size = workers.length;
  pool.reason = '';
  pool.kill = kill;
  pool.inFlight = () => workers.reduce((a, r) => a + r.gen + r.mesh, 0);
  pool.canPost = (kind) => pool.alive && pick(kind) !== null;
  pool.post = (msg, transfer = [], kind = msg.op === 'generate' ? 'gen' : 'mesh') => {
    if (!pool.alive) return Promise.resolve({ ok: false, error: pool.reason });
    const r = pick(kind) || workers[0];
    const id = nextId++;
    return new Promise((resolve) => {
      r.pending.set(id, { resolve, kind });
      r[kind]++;
      try { r.w.postMessage({ ...msg, id }, transfer); } catch (err) {
        r.pending.delete(id); r[kind]--;
        resolve({ id, ok: false, error: String(err && err.message ? err.message : err) });
      }
    });
  };
  /** Send the texture layer table to every worker. Resolves false (and kills the pool) if any refuses. */
  pool.init = async (layers) => {
    if (!pool.alive) return false;
    const res = await Promise.all(workers.map((r) => new Promise((resolve) => {
      const id = nextId++;
      r.pending.set(id, { resolve, kind: 'mesh' });
      r.mesh++;
      try { r.w.postMessage({ id, op: 'init', layers }); } catch (err) { r.pending.delete(id); r.mesh--; resolve({ ok: false, error: String(err) }); }
    })));
    const ok = res.every((d) => d && d.ok);
    if (!ok) kill('worker init refused: ' + ((res.find((d) => !d || !d.ok) || {}).error || 'unknown'));
    return ok;
  };
  pool.stats = () => ({ alive: pool.alive, size: pool.size, reason: pool.reason, inFlight: pool.inFlight() });
  return pool;
}
