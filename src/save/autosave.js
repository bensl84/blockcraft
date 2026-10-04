// OWNER LANE: FEATURE-MENUS (save). Autosave cadence (SPEC §8.4.3), pure and clock-injected for unit tests:
//   - 2.5 s after the last block change (debounced),
//   - at least every 30 s while there are changes (block edits, inventory, playing time),
// The immediate triggers (hidden tab, pagehide, pause screen, Home, fullscreen exit) live in storage.js.

export const AUTOSAVE_DEBOUNCE_MS = 2500;
export const AUTOSAVE_MAX_MS = 30000;

export class AutosaveScheduler {
  constructor(debounceMs = AUTOSAVE_DEBOUNCE_MS, maxMs = AUTOSAVE_MAX_MS) {
    this.debounceMs = debounceMs;
    this.maxMs = maxMs;
    this.reset();
  }
  /** Forget all pending changes (world opened / saved). */
  reset() {
    this.blockDirty = false;
    this.softDirty = false;
    this.lastChange = 0;
    this.dirtySince = -1;
  }
  /** A block changed at time now (ms): debounced save. */
  noteBlockChange(now) {
    this.blockDirty = true;
    this.lastChange = now;
    if (this.dirtySince < 0) this.dirtySince = now;
  }
  /** Something else worth saving changed (inventory, rules, time played): saved within maxMs. */
  noteSoftChange(now) {
    this.softDirty = true;
    if (this.dirtySince < 0) this.dirtySince = now;
  }
  get dirty() { return this.blockDirty || this.softDirty; }
  /** Is a save due at time now? -> 'debounce' | 'interval' | null */
  due(now) {
    if (this.blockDirty && now - this.lastChange >= this.debounceMs) return 'debounce';
    if (this.dirty && this.dirtySince >= 0 && now - this.dirtySince >= this.maxMs) return 'interval';
    return null;
  }
  /** A save started at time now: everything up to now is in it; later changes mark dirty again. */
  saved() { this.reset(); }
}
