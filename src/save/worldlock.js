// OWNER LANE: FEATURE-MENUS (save). One window per world (judge ROB-2): two tabs or windows on the same world
// would each autosave their own copy and silently overwrite the other's blocks.
//
// Web Locks: navigator.locks.request('blockcraft-world-<id>', {ifAvailable: true}) held for the life of the open
// world. The browser drops the lock by itself when the tab closes or crashes. Without Web Locks a BroadcastChannel
// probe arbitrates simultaneous claims by nonce, then waits PING_MS for replies. This fallback is best-effort:
// suspended tabs / delivery beyond the probe window cannot provide the atomic guarantee of Web Locks.
// Without either API, every claim succeeds (the old behaviour).

export const LOCK_PREFIX = 'blockcraft-world-';
export const PING_MS = 250;

/**
 * @param {{locks?: object|null, BroadcastChannel?: Function|null}} [env] injectable for unit tests
 * @returns {{claim(id: string): Promise<boolean>, release(): void, readonly heldId: string|null, readonly kind: string}}
 */
export function createWorldLock(env = {}) {
  const locks = 'locks' in env ? env.locks : (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null);
  const BC = 'BroadcastChannel' in env ? env.BroadcastChannel : (typeof BroadcastChannel === 'function' ? BroadcastChannel : null);
  let heldId = null;
  let releaseFn = null;         // resolves the Web Locks callback promise (drops the lock)
  let pending = null;           // {id, promise} of a claim in progress
  let channel = null;
  let contender = null;        // current BroadcastChannel probe {id, nonce, busy}
  let cancelProbe = null;
  let gen = 0;                  // bumped by release(): a claim that resolves after it does not keep the lock

  function ensureChannel() {
    if (channel || !BC) return channel;
    try {
      channel = new BC('blockcraft-worlds');
      channel.onmessage = (e) => {
        const m = e && e.data;
        if (!m || m.q !== 'open?' || !m.id) return;
        let busy = m.id === heldId;
        if (contender && contender.id === m.id) {
          // A held owner always wins. Pending peers use the same ordering; equal
          // nonces conservatively reject both claims rather than allowing two writers.
          if (typeof m.nonce !== 'string' || contender.nonce <= m.nonce) busy = true;
          if (typeof m.nonce !== 'string' || m.nonce <= contender.nonce) contender.busy = true;
        }
        if (busy) { try { channel.postMessage({ a: 'open', id: m.id, nonce: m.nonce }); } catch { /* ignore */ } }
      };
    } catch { channel = null; }
    return channel;
  }

  function claimWithLocks(id) {
    const g = gen;
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        const p = locks.request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
          if (!lock) { done(false); return undefined; }
          if (g !== gen) { done(false); return undefined; }
          heldId = id;
          done(true);
          return new Promise((r) => { releaseFn = r; });
        });
        if (p && p.catch) p.catch(() => done(false));
      } catch { done(false); /* A failed lock request is not proof of ownership. */ }
    });
  }

  function claimWithChannel(id) {
    const ch = ensureChannel();
    if (!ch) { heldId = id; return Promise.resolve(true); }
    const g = gen;
    return new Promise((resolve) => {
      const nonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      const probe = { id, nonce, busy: false };
      contender = probe;
      const listener = (e) => { const m = e && e.data; if (m && m.a === 'open' && m.id === id && m.nonce === nonce) probe.busy = true; };
      let timer;
      const finish = (ok) => {
        clearTimeout(timer);
        ch.removeEventListener('message', listener);
        if (contender === probe) contender = null;
        if (cancelProbe === cancel) cancelProbe = null;
        if (ok) heldId = id;
        resolve(ok);
      };
      const cancel = () => finish(false);
      cancelProbe = cancel;
      ch.addEventListener('message', listener);
      timer = setTimeout(() => finish(!probe.busy && g === gen), PING_MS);
      try { ch.postMessage({ q: 'open?', id, nonce }); } catch { finish(false); }
    });
  }

  const lock = {
    get heldId() { return heldId; },
    get kind() { return locks ? 'locks' : BC ? 'broadcast' : 'none'; },
    /** Claim world id for this window. Resolves false when another window has it open. */
    claim(id) {
      if (!id) return Promise.resolve(true);
      if (heldId === id) return Promise.resolve(true);
      if (pending && pending.id === id) return pending.promise;
      lock.release();
      const g = gen;
      const promise = (locks ? claimWithLocks(id) : claimWithChannel(id)).then((ok) => {
        if (pending && pending.promise === promise) pending = null;
        return ok && g === gen;
      });
      pending = { id, promise };
      if (!locks) ensureChannel();
      return promise;
    },
    /** Let other windows open the world again. */
    release() {
      gen++;
      pending = null;
      if (cancelProbe) cancelProbe();
      heldId = null;
      if (releaseFn) { const r = releaseFn; releaseFn = null; r(); }
    },
  };
  if (!locks) ensureChannel();
  return lock;
}
