// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). STUB written by LEAD - keep signature.
// Registers container screens with game.ui (src/ui/screens.js): 'inventory' (2x2 craft + armor + 27+9),
// 'creative' (kid picture picker with tabs; replaces 'inventory' in creative), 'crafting' (3x3, opened by
// hooks.registerBlockUse('crafting_table')), 'furnace' + 'chest' (hooks.registerBlockUse('furnace'),
// ('furnace_lit'), ('chest')). Creative picker = 8 picture tabs from data/items.js PICKER_TABS /
// creativePickerItems(). Also owns: furnace ticking, dropping chest/furnace contents from the 'block:broken'
// payload's blockEntity (items / input, fuel, output) with dropItem, Q-drop (classic only), recipe book
// (P0 in survival worlds: picture list of craftable items, tap to craft). SPEC §8.2.
//
// Stub behaviour: placeholder screens so E / openInventory() open and close something visible.

import { registerStub } from '../core/stubs.js';
import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';

registerStub('invui');

/** @returns {object} Inventory UI system (game.invui) */
export function createInventoryUISystem(game) {
  let root = null, panel = null;
  const placeholder = (name) => ({
    owner: 'invui',
    open() {
      panel = el('div', { class: 'bc-panel bc-center', style: { padding: '24px' }, 'data-screen': name }, [
        el('div', { class: 'bc-title', text: name }),
      ]);
      root.appendChild(panel);
    },
    close() { if (panel) panel.remove(); panel = null; },
  });
  return {
    name: 'invui',
    stub: true,
    init() {
      root = uiLayer(game, 'containers', Z.CONTAINER);
      for (const s of ['inventory', 'creative', 'crafting', 'furnace', 'chest']) game.ui.register(s, placeholder(s));
    },
    tick() {},
    frame() {},
    serialize() { return game.inventory.toJSON(); },
    deserialize(g, d) { if (d) game.inventory.fromJSON(d); },
  };
}
