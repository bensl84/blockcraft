// OWNER LANE: FEATURE-MECH. Scheduled block ticks (SPEC §8.6 "Infrastructure"): a min-heap keyed by game tick,
// deduplicated per (cell, kind), each entry carrying the `action` id of the change that caused it (undo
// grouping, SPEC §8.5.2). Pure: no game/world access, safe in Node unit tests.

/** Update kinds. One pending entry per (cell, kind). */
export const TICK_KIND = Object.freeze({
  NEIGHBOR: 0,   // 1 tick after a neighbour changed: support, falling, fluids, connections, snowy grass
  FLUID: 1,      // fluid flow (water every 5 ticks, lava every 30)
  FALL: 2,       // gravity block lost its support (2 ticks)
  FIRE: 3,       // fire burns out
});

function keyOf(x, y, z, kind) { return x + ',' + y + ',' + z + ',' + kind; }

export class TickScheduler {
  constructor() {
    /** @type {Array<object>} binary min-heap of entries {t, seq, x, y, z, kind, action, key, dead} */
    this.heap = [];
    /** @type {Map<string, object>} live entry per key */
    this.byKey = new Map();
    this.seq = 0;
  }

  /** Number of live entries. */
  get size() { return this.byKey.size; }

  /**
   * Schedule (x,y,z,kind) at now + delay (delay >= 1). If the same cell/kind is already scheduled no later,
   * the existing entry wins but takes the newer non-zero `action` (the latest change is the cause). Returns true
   * if a new entry was queued.
   */
  schedule(now, x, y, z, delay, kind = 0, action = 0) {
    const key = keyOf(x, y, z, kind);
    const t = now + Math.max(1, delay | 0);
    const ex = this.byKey.get(key);
    if (ex) {
      if (ex.t <= t) { if (action) ex.action = action; return false; }
      ex.dead = true;
      if (!action) action = ex.action;
    }
    const e = { t, seq: this.seq++, x, y, z, kind, action: action | 0, key, dead: false };
    this.byKey.set(key, e);
    this._push(e);
    return true;
  }

  /** True if (x,y,z,kind) is pending. */
  has(x, y, z, kind = 0) { return this.byKey.has(keyOf(x, y, z, kind)); }

  /** Next due entry (t <= now) or null. Removes it. */
  popDue(now) {
    const h = this.heap;
    while (h.length) {
      const top = h[0];
      if (top.dead) { this._pop(); continue; }
      if (top.t > now) return null;
      this._pop();
      if (this.byKey.get(top.key) === top) this.byKey.delete(top.key);
      return top;
    }
    return null;
  }

  /** Drop every entry matching fn(entry) (e.g. a column that unloaded). Returns the removed entries. */
  removeWhere(fn) {
    const out = [];
    for (const e of this.byKey.values()) if (fn(e)) { e.dead = true; out.push(e); }
    for (const e of out) this.byKey.delete(e.key);
    return out;
  }

  clear() { this.heap.length = 0; this.byKey.clear(); }

  /** JSON-safe list of pending entries as [x, y, z, kind, delay, action] (delay relative to now). */
  toJSON(now, limit = 4096) {
    const out = [];
    for (const e of this.byKey.values()) {
      if (out.length >= limit) break;
      out.push([e.x, e.y, e.z, e.kind, Math.max(1, e.t - now), e.action]);
    }
    return out;
  }

  fromJSON(now, list) {
    if (!Array.isArray(list)) return;
    for (const r of list) {
      if (!Array.isArray(r) || r.length < 5) continue;
      const [x, y, z, kind, delay, action] = r;
      if ([x, y, z, kind, delay].every(Number.isFinite)) this.schedule(now, x, y, z, delay, kind, action || 0);
    }
  }

  _less(a, b) { return a.t < b.t || (a.t === b.t && a.seq < b.seq); }
  _push(e) {
    const h = this.heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this._less(h[i], h[p])) break;
      const tmp = h[i]; h[i] = h[p]; h[p] = tmp; i = p;
    }
  }
  _pop() {
    const h = this.heap;
    const last = h.pop();
    if (!h.length) return;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && this._less(h[l], h[m])) m = l;
      if (r < h.length && this._less(h[r], h[m])) m = r;
      if (m === i) break;
      const tmp = h[i]; h[i] = h[m]; h[m] = tmp; i = m;
    }
  }
}
