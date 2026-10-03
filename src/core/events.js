// OWNER: LEAD (shared, frozen). Tiny synchronous event bus. Event names + payloads: docs/SPEC.md §6.
//
//   const off = game.events.on('block:broken', (e) => { ... });   // returns an unsubscribe fn
//   game.events.emit('block:broken', { x, y, z, id, state, by: 'player', drops: [] });
//
// Handlers run synchronously in subscription order. A throwing handler is reported through
// onError (main.js routes it into window.__game.errors) and never stops other handlers.

export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._handlers = new Map();
    /** Ring buffer of recent events for tests/debugging: {name, tick, t, payload}. */
    this.log = [];
    this.logSize = 400;
    /** @type {Map<string, number>} emit counts per event name (tests use this). */
    this.counts = new Map();
    /** @type {null | ((err: unknown, name: string) => void)} */
    this.onError = null;
    /** Set by main.js so the log can record the game tick. */
    this.tickRef = { tick: 0 };
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(name, fn) {
    let list = this._handlers.get(name);
    if (!list) { list = []; this._handlers.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  /** Subscribe for one emission only. */
  once(name, fn) {
    const off = this.on(name, (p) => { off(); fn(p); });
    return off;
  }

  off(name, fn) {
    const list = this._handlers.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Emit synchronously. payload should be a plain object (documented per event in SPEC §6). */
  emit(name, payload) {
    this.counts.set(name, (this.counts.get(name) || 0) + 1);
    if (this.logSize > 0) {
      this.log.push({ name, tick: this.tickRef.tick, t: (typeof performance !== 'undefined' ? performance.now() : Date.now()), payload });
      if (this.log.length > this.logSize) this.log.splice(0, this.log.length - this.logSize);
    }
    const list = this._handlers.get(name);
    if (!list || list.length === 0) return;
    const snapshot = list.length === 1 ? list : list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        if (this.onError) this.onError(err, name);
        else console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }

  /** Number of listeners (debug). */
  listenerCount(name) { const l = this._handlers.get(name); return l ? l.length : 0; }

  /** Recent log entries with this name (newest last). */
  recent(name, limit = 50) {
    const out = [];
    for (let i = this.log.length - 1; i >= 0 && out.length < limit; i--) if (this.log[i].name === name) out.push(this.log[i]);
    return out.reverse();
  }
}
