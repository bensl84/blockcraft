// OWNER LANE: KID. Undo log (SPEC §2.7, §8.5.2). Pure module (no DOM) so it is unit-tested in Node.
//
// Data model (v1.1): entries are recorded from 'block:changed' {x, y, z, oldId, oldState, id, state, cause,
// action}, grouped by the non-zero `action` id. One entry = every change sharing one action:
//   {action, tick, cells: [{x, y, z, before: raw, after: raw}]}   (first `before` per cell kept, latest `after`)
// An action becomes an undo entry once any of its changes has cause 'player' or 'explosion'; changes with
// other causes ('cascade', 'support', fluids, fence connection updates...) that carry the same action join it
// (MECH passes the causing change's action along). Causes 'undo', 'worldgen' and 'test' are never recorded.
// Undo restores each cell's `before`, newest cell first, in one world batch with cause 'undo', and only where
// the current value still equals the recorded `after`.
// Redo (KID-8): an undone entry goes on a redo stack (newest last). Redo puts each cell's `after` back (oldest
// cell first, cause 'undo' so it is not recorded again) where the current value still equals `before`, and the
// entry returns to the undo list. The next new qualifying action (the child builds or breaks again, or a blast)
// clears the redo stack.

import { KID } from '../core/constants.js';

const QUALIFYING = new Set(['player', 'explosion']);
const IGNORED = new Set(['undo', 'worldgen', 'test']);
/** Non-qualifying action groups kept around in case a qualifying change for them arrives later. */
const MAX_CANDIDATES = 64;
/** Upper bound of cells in one entry (a huge fluid spread or explosion keeps its first cells). */
export const MAX_CELLS_PER_ENTRY = 8192;

export class UndoLog {
  /** @param {number} [max] ring size (KID.UNDO_ENTRIES = 50) */
  constructor(max = KID.UNDO_ENTRIES) {
    this.max = max;
    /** qualifying entries, oldest first */
    this.entries = [];
    /** action id -> entry (qualifying or candidate) */
    this.byAction = new Map();
    /** candidate (not yet qualifying) action ids, oldest first */
    this.candidates = [];
    /** undone entries that can be redone, oldest first (newest undo last) */
    this.redoStack = [];
  }

  get size() { return this.entries.length; }
  /** Entries that can be redone. */
  get redoSize() { return this.redoStack.length; }

  clear() { this.entries.length = 0; this.byAction.clear(); this.candidates.length = 0; this.redoStack.length = 0; }

  /**
   * Record one 'block:changed' payload. Returns true if it was stored.
   * @param {{x:number,y:number,z:number,oldId:number,oldState:number,id:number,state:number,cause:string,action:number}} e
   * @param {number} tick
   */
  record(e, tick = 0) {
    if (!e) return false;
    const action = e.action | 0;
    const cause = e.cause || 'unknown';
    if (!action || IGNORED.has(cause)) return false;
    let entry = this.byAction.get(action);
    if (!entry) {
      entry = { action, tick, cells: [], index: new Map(), qualifies: false };
      this.byAction.set(action, entry);
      this.candidates.push(action);
      if (this.candidates.length > MAX_CANDIDATES) {
        const old = this.candidates.shift();
        const oe = this.byAction.get(old);
        if (oe && !oe.qualifies) this.byAction.delete(old);
      }
    }
    const before = ((e.oldId & 0xff) | ((e.oldState & 0xff) << 8)) >>> 0;
    const after = ((e.id & 0xff) | ((e.state & 0xff) << 8)) >>> 0;
    const key = `${e.x},${e.y},${e.z}`;
    const cell = entry.index.get(key);
    if (cell) cell.after = after;
    else if (entry.cells.length < MAX_CELLS_PER_ENTRY) {
      const c = { x: e.x, y: e.y, z: e.z, before, after };
      entry.cells.push(c);
      entry.index.set(key, c);
    }
    if (!entry.qualifies && QUALIFYING.has(cause)) {
      entry.qualifies = true;
      entry.tick = tick;
      const ci = this.candidates.indexOf(action);
      if (ci >= 0) this.candidates.splice(ci, 1);
      this.entries.push(entry);
      this.redoStack.length = 0;    // a new action starts a new history branch
      while (this.entries.length > this.max) {
        const gone = this.entries.shift();
        this.byAction.delete(gone.action);
      }
    }
    return true;
  }

  /** Newest qualifying entry (not removed) or null. */
  peek() { return this.entries.length ? this.entries[this.entries.length - 1] : null; }

  /** Remove and return the newest qualifying entry. */
  pop() {
    const e = this.entries.pop() || null;
    if (e) this.byAction.delete(e.action);
    return e;
  }

  /**
   * Undo the newest entry that still has something to restore. Entries whose cells were all changed since
   * are dropped on the way. Returns {count, entry} (count = cells restored; 0 when nothing was undone).
   * @param {{getRaw:Function, setBlock:Function, beginBatch?:Function, endBatch?:Function}} world
   */
  undo(world) {
    while (this.entries.length) {
      const entry = this.pop();
      const count = applyEntry(world, entry);
      if (count > 0) {
        this.redoStack.push(entry);
        while (this.redoStack.length > this.max) this.redoStack.shift();
        return { count, entry };
      }
    }
    return { count: 0, entry: null };
  }

  /**
   * Redo the newest undone entry that can still be put back (entries whose cells were all changed since are
   * dropped). The entry returns to the undo list. Returns {count, entry} (count 0 when nothing was redone).
   * @param {{getRaw:Function, setBlock:Function, beginBatch?:Function, endBatch?:Function}} world
   */
  redo(world) {
    while (this.redoStack.length) {
      const entry = this.redoStack.pop();
      const count = applyEntry(world, entry, true);
      if (count > 0) {
        this.entries.push(entry);
        this.byAction.set(entry.action, entry);
        while (this.entries.length > this.max) { const gone = this.entries.shift(); this.byAction.delete(gone.action); }
        return { count, entry };
      }
    }
    return { count: 0, entry: null };
  }

  /** Cells (x, y, z) of the newest `n` entries (home "facing the build"). */
  recentCells(n = 5, out = []) {
    out.length = 0;
    for (let i = this.entries.length - 1, k = 0; i >= 0 && k < n; i--, k++) for (const c of this.entries[i].cells) out.push(c);
    return out;
  }
}

/**
 * Restore an entry's cells (undo: `before`, newest cell first; redo: `after`, oldest cell first) inside one
 * batch, only where the current value is still the other side. Returns the number of cells changed.
 */
export function applyEntry(world, entry, forward = false) {
  if (!entry) return 0;
  let n = 0;
  const len = entry.cells.length;
  if (world.beginBatch) world.beginBatch();
  try {
    for (let k = 0; k < len; k++) {
      const c = entry.cells[forward ? k : len - 1 - k];
      if (c.before === c.after) continue;
      const from = forward ? c.before : c.after, to = forward ? c.after : c.before;
      if ((world.getRaw(c.x, c.y, c.z) >>> 0) !== from) continue;
      if (world.setBlock(c.x, c.y, c.z, to & 0xff, to >> 8, { cause: 'undo' })) n++;
    }
  } finally {
    if (world.endBatch) world.endBatch();
  }
  return n;
}
