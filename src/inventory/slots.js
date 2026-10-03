// OWNER LANE: FEATURE-INV. Pure slot-interaction rules for the container screens (Java semantics, SPEC §8.2.4).
// No DOM: unit-tested in test/inv.test.mjs. The screens build Slot adapters over the inventory model, the
// crafting grid and block entities, then call these functions.
//
// Slot adapter: { get() -> ItemStack|null, set(stack|null), accept?(stack) -> bool, limit?: number,
//                 output?: boolean (take only: crafting/furnace result) }
//
// Left click   : empty cursor picks the whole stack; a held stack is placed (merging, or swapping when different).
// Right click  : empty cursor takes half (rounded up); a held stack places one.
// Drag         : left-drag splits the held stack evenly over the visited slots, right-drag places one in each.
// Shift-click  : quick-move into another section (merge into matching stacks first, then empty slots).
// Double click : gather matching items from every slot onto the cursor (up to a full stack).

import { getItem } from '../data/items.js';

/** Two stacks can merge: same item, no durability damage, same extra data. */
export function stackable(a, b) {
  if (!a || !b || a.item !== b.item) return false;
  if (a.damage || b.damage) return false;
  if (a.data || b.data) return JSON.stringify(a.data || null) === JSON.stringify(b.data || null);
  return true;
}

/** Max items of `stack` this slot holds (item stack size, capped by slot.limit). */
export function slotLimit(slot, stack) {
  const d = stack && getItem(stack.item);
  const max = d ? d.stack : 64;
  return Math.max(1, Math.min(max, slot && slot.limit ? slot.limit : max));
}

const accepts = (slot, stack) => !slot.output && (!slot.accept || slot.accept(stack));
const copy = (s, count) => (s && count > 0 ? { ...s, count } : null);

/**
 * Click a slot. Mutates the slot through slot.set and returns the new cursor stack.
 * @param {object} slot adapter @param {object|null} cursor held stack @param {'left'|'right'} button
 * @returns {{cursor: object|null, changed: boolean}}
 */
export function clickSlot(slot, cursor, button = 'left') {
  const cur = slot.get();
  if (slot.output) {
    if (!cur) return { cursor, changed: false };
    if (!cursor) { slot.set(null); return { cursor: { ...cur }, changed: true }; }
    if (stackable(cursor, cur) && cursor.count + cur.count <= slotLimit(null, cur)) {
      slot.set(null);
      return { cursor: copy(cursor, cursor.count + cur.count), changed: true };
    }
    return { cursor, changed: false };
  }
  if (!cursor) {
    if (!cur) return { cursor: null, changed: false };
    if (button === 'right') {
      const take = Math.ceil(cur.count / 2);
      slot.set(copy(cur, cur.count - take));
      return { cursor: copy(cur, take), changed: true };
    }
    slot.set(null);
    return { cursor: { ...cur }, changed: true };
  }
  // holding something
  if (!accepts(slot, cursor)) return { cursor, changed: false };
  const limit = slotLimit(slot, cursor);
  if (!cur) {
    const n = button === 'right' ? 1 : Math.min(cursor.count, limit);
    slot.set(copy(cursor, n));
    return { cursor: copy(cursor, cursor.count - n), changed: true };
  }
  if (stackable(cur, cursor)) {
    const room = limit - cur.count;
    if (room <= 0) return { cursor, changed: false };
    const n = button === 'right' ? 1 : Math.min(room, cursor.count);
    slot.set(copy(cur, cur.count + n));
    return { cursor: copy(cursor, cursor.count - n), changed: true };
  }
  // different items: swap (only when the whole held stack fits)
  if (cursor.count > limit) return { cursor, changed: false };
  slot.set({ ...cursor });
  return { cursor: { ...cur }, changed: true };
}

/**
 * Drag the held stack across several slots (Java "quick craft"). left: split evenly, right: one each.
 * Slots that cannot take the stack are skipped. Returns the new cursor.
 */
export function dragDistribute(slots, cursor, button = 'left') {
  if (!cursor) return { cursor, changed: false };
  const ok = slots.filter((s) => accepts(s, cursor) && (!s.get() || stackable(s.get(), cursor)));
  if (!ok.length) return { cursor, changed: false };
  let left = cursor.count;
  const per = button === 'right' ? 1 : Math.max(1, Math.floor(cursor.count / ok.length));
  let changed = false;
  for (const s of ok) {
    if (left <= 0) break;
    const cur = s.get();
    const room = slotLimit(s, cursor) - (cur ? cur.count : 0);
    const n = Math.min(per, room, left);
    if (n <= 0) continue;
    s.set(copy(cursor, (cur ? cur.count : 0) + n));
    left -= n;
    changed = true;
  }
  return { cursor: copy(cursor, left), changed };
}

/**
 * Move a stack into a list of target slots: merge into matching stacks first, then fill empty slots.
 * Returns the leftover stack (null when everything moved).
 */
export function moveInto(stack, targets) {
  if (!stack) return null;
  let left = stack.count;
  for (const t of targets) {
    if (left <= 0) break;
    const cur = t.get();
    if (!cur || !stackable(cur, stack) || !accepts(t, stack)) continue;
    const n = Math.min(left, slotLimit(t, stack) - cur.count);
    if (n > 0) { t.set(copy(cur, cur.count + n)); left -= n; }
  }
  for (const t of targets) {
    if (left <= 0) break;
    if (t.get() || !accepts(t, stack)) continue;
    const n = Math.min(left, slotLimit(t, stack));
    t.set(copy(stack, n));
    left -= n;
  }
  return copy(stack, left);
}

/**
 * Shift-click: move the whole stack in `slot` into `targets`. Returns true if anything moved.
 * (Output slots are handled by the screen because taking a crafting result consumes the grid.)
 */
export function quickMove(slot, targets) {
  const cur = slot.get();
  if (!cur) return false;
  const left = moveInto(cur, targets);
  if (left && left.count === cur.count) return false;
  slot.set(left);
  return true;
}

/** Double click: pull matching stacks from `slots` onto the cursor, up to its max stack. */
export function gatherToCursor(slots, cursor) {
  if (!cursor) return { cursor, changed: false };
  const max = slotLimit(null, cursor);
  let count = cursor.count, changed = false;
  // Java takes partial stacks first, then full ones
  for (const pass of [0, 1]) {
    for (const s of slots) {
      if (count >= max) break;
      const cur = s.get();
      if (!cur || s.output || !stackable(cur, cursor)) continue;
      const full = cur.count >= slotLimit(s, cur);
      if ((pass === 0) === full) continue;
      const n = Math.min(cur.count, max - count);
      s.set(copy(cur, cur.count - n));
      count += n;
      changed = true;
    }
  }
  return { cursor: copy(cursor, count), changed };
}

/** Slot adapter over an array element (block entities, crafting grids, tests). */
export function arraySlot(arr, i, opts = {}) {
  return { get: () => arr[i] || null, set: (s) => { arr[i] = s && s.count > 0 ? s : null; }, ...opts };
}

/** Slot adapter over an object field (furnace input/fuel/output). */
export function fieldSlot(obj, key, opts = {}) {
  return { get: () => obj[key] || null, set: (s) => { obj[key] = s && s.count > 0 ? s : null; }, ...opts };
}
