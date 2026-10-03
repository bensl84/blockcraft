// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). STUB written by LEAD - keep signatures.
// Block-entity data for containers (stored with world.setBlockEntity, saved with the column). SPEC §8.2.3.

import { registerStub } from '../core/stubs.js';

registerStub('furnace');

/** New chest block entity. */
export function createChest() { return { type: 'chest', items: new Array(27).fill(null) }; }

/** New furnace block entity. */
export function createFurnace() {
  return { type: 'furnace', input: null, fuel: null, output: null, burnTicks: 0, burnTotal: 0, cookTicks: 0, xp: 0 };
}

/**
 * Advance one furnace by one tick (200 ticks per item; fuel burn per fuelTicks()). Swaps the block between
 * 'furnace' and 'furnace_lit' (keeping facing state, keepBlockEntity: true) when burning starts/stops.
 * @param {object} game @param {object} be furnace data @param {number} x @param {number} y @param {number} z
 */
export function tickFurnace(game, be, x, y, z) {}
