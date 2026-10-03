// OWNER: FEATURE-INV (foundation written by LEAD; the public API below is FROZEN - extend, don't break).
// The player's inventory MODEL (no DOM). UI lives in src/ui/*. SPEC §8.2.
//
// Slots 0-8 = hotbar, 9-35 = main. Empty slot = null. ItemStack = {item, count, damage?, data?}.
// Every mutation bumps `version` and emits 'inventory:changed' {slot} (slot -1 = many / unknown).

import { HOTBAR_SIZE, INVENTORY_SIZE } from '../core/constants.js';
import { getItem, maxStack } from '../data/items.js';

/** Default creative hotbar for a new kid world (bright, house-building friendly). */
export const KID_CREATIVE_HOTBAR = Object.freeze(['grass_block', 'oak_planks', 'cobblestone', 'glass', 'red_wool',
  'torch', 'oak_door', 'glowstone', 'pig_spawn_egg']);

export class Inventory {
  /** @param {import('../core/events.js').EventBus|null} events */
  constructor(events = null) {
    this.events = events;
    /** @type {Array<import('../core/types.js').ItemStack|null>} */
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    /** armor: [head, chest, legs, feet] (P1) */
    this.armor = [null, null, null, null];
    this.offhand = null;
    /** Stack held on the mouse cursor while a container UI is open (FEATURE-INV). */
    this.cursor = null;
    this.selected = 0;
    this.version = 0;
  }

  _changed(slot = -1) {
    this.version++;
    if (this.events) this.events.emit('inventory:changed', { slot });
  }

  get(i) { return this.slots[i] || null; }

  /** Replace a slot (null/0-count clears it). */
  set(i, stack) {
    this.slots[i] = stack && stack.count > 0 ? stack : null;
    this._changed(i);
  }

  getSelected() { return this.slots[this.selected] || null; }

  /** Select hotbar slot 0..8. Emits 'player:hotbar' {slot, item}. */
  selectSlot(i) {
    const s = ((Math.floor(i) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (s === this.selected) return;
    this.selected = s;
    this.version++;
    if (this.events) {
      const st = this.slots[s];
      this.events.emit('player:hotbar', { slot: s, item: st ? st.item : null });
    }
  }

  /**
   * Add a stack. Fills matching stacks (hotbar first, then main), then empty slots (hotbar first).
   * Mutates nothing in `stack`. Returns the count that did NOT fit (0 = all added).
   */
  add(stack) {
    if (!stack || stack.count <= 0) return 0;
    const def = getItem(stack.item);
    if (!def) return stack.count;
    let left = stack.count;
    const max = def.stack;
    if (max > 1 && !stack.damage) {
      for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.item === stack.item && !s.damage && !s.data && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n; left -= n;
        }
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { ...stack, count: n };
        left -= n;
      }
    }
    if (left !== stack.count) this._changed(-1);
    return left;
  }

  /** Total count of an item key across all slots. */
  count(itemKey) {
    let n = 0;
    for (const s of this.slots) if (s && s.item === itemKey) n += s.count;
    return n;
  }

  /** Remove up to `count` of itemKey (main inventory scan from the end). Returns how many were removed. */
  removeItem(itemKey, count) {
    let left = count;
    for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.item === itemKey) {
        const n = Math.min(left, s.count);
        s.count -= n; left -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    if (left !== count) this._changed(-1);
    return count - left;
  }

  /** Remove n from the selected stack (survival use/placement). Returns false if not enough. */
  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this._changed(this.selected);
    return true;
  }

  /** Replace the selected stack (e.g. bucket -> water_bucket). */
  replaceSelected(stack) { this.set(this.selected, stack); }

  /**
   * Apply durability damage to the selected tool. Returns true if it broke (slot cleared,
   * 'item:broken' {item} emitted).
   */
  damageSelected(amount = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    const def = getItem(s.item);
    const max = def && (def.tool ? def.tool.durability : def.armor ? def.armor.durability : 0);
    if (!max) return false;
    s.damage = (s.damage || 0) + amount;
    if (s.damage >= max) {
      this.slots[this.selected] = null;
      this._changed(this.selected);
      if (this.events) this.events.emit('item:broken', { item: s.item });
      return true;
    }
    this._changed(this.selected);
    return false;
  }

  /** First slot index holding itemKey, or -1. */
  find(itemKey) { return this.slots.findIndex((s) => s && s.item === itemKey); }

  /** Clear everything (slots, armor, offhand, cursor). */
  clear() {
    this.slots.fill(null);
    this.armor = [null, null, null, null];
    this.offhand = null;
    this.cursor = null;
    this._changed(-1);
  }

  /** Fill the hotbar with item keys (count = max stack). Used for new creative worlds. */
  fillHotbar(keys) {
    keys.slice(0, HOTBAR_SIZE).forEach((k, i) => { if (getItem(k)) this.slots[i] = { item: k, count: Math.min(64, maxStack(k)) }; });
    this._changed(-1);
  }

  toJSON() {
    return { v: 1, slots: this.slots, armor: this.armor, offhand: this.offhand, selected: this.selected };
  }

  fromJSON(o) {
    this.clear();
    if (!o || !Array.isArray(o.slots)) return;
    o.slots.slice(0, INVENTORY_SIZE).forEach((s, i) => { this.slots[i] = s && getItem(s.item) && s.count > 0 ? { ...s } : null; });
    if (Array.isArray(o.armor)) this.armor = o.armor.slice(0, 4).map((s) => (s && getItem(s.item) ? { ...s } : null));
    this.offhand = o.offhand && getItem(o.offhand.item) ? { ...o.offhand } : null;
    this.selected = Number.isInteger(o.selected) ? Math.max(0, Math.min(8, o.selected)) : 0;
    this._changed(-1);
  }
}
