// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). STUB written by LEAD - keep signature.
// HUD (SPEC §9.2): hotbar (tappable, big in kid scheme, selected slot = yellow border + scale + lift),
// item-name popup (2 s), hearts/hunger/armor/air/XP in survival only, crosshair in classic scheme,
// riding/jump bar (P1). Lives in uiLayer(game, 'hud', Z.HUD). Re-render only when inventory.version or
// player stats change (no per-frame DOM churn). Hotbar keys (hotbar1..9, next/prev) select a slot only while
// no container screen is open (game.ui.current not inventory/creative/crafting/furnace/chest): inside a
// container the same keys swap the hovered slot (FEATURE-INV).
//
// Stub behaviour: nothing drawn.

import { registerStub } from '../core/stubs.js';

registerStub('hud');

/** @returns {object} HUD system (game.hud) */
export function createHudSystem(game) {
  return {
    name: 'hud',
    stub: true,
    /** false hides the HUD (F1 / screenshots) */
    visible: true,
    init() {},
    frame() {},
    /** Show a short message/icon toast above the hotbar (e.g. "Respawn point set" with a bed icon). */
    toast(text, iconItem = null) {},
  };
}
