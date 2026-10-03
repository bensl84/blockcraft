// OWNER LANE: FEATURE-FX (visual polish). STUB written by LEAD - API FROZEN (SPEC §8.7).
// Implement (may split into src/fx/*.js): block-break particles (4x4 patches of the block texture), footstep/
// splash/explosion/smoke/heart/sparkle (bone meal)/angry/crit particles, held-item + arm view model (in
// renderer.viewModelScene, swing animation from player.swingTicks), third-person player model (F5/V) with
// the skin colours from settings.skin, sun/moon (8 phases)/stars/clouds (flat, drifting, at CLOUD_HEIGHT),
// crack overlay for interaction.mining (crack_0..9 layers), kid ghost-block placement preview, underwater
// tint + fog, hurt/red vignette flash, fade-to-black for sleeping/home, rain/snow weather (P1),
// makeItemMesh() for dropped items.
//
// Stub behaviour: makeItemMesh returns a small grey cube; everything else is inert.

import * as THREE from 'three';
import { registerStub } from '../core/stubs.js';

registerStub('fx');

/** @returns {object} FX system (game.fx) */
export function createFxSystem(game) {
  const fx = {
    name: 'fx',
    stub: true,
    init() {},
    tick() {},
    frame() {},
    /**
     * Spawn particles. kind: 'block'|'smoke'|'explosion'|'heart'|'sparkle'|'splash'|'bubble'|'crit'|'angry'|'poof'|'flame'.
     * opts: {count, id, state (for 'block'), spread, vx, vy, vz}.
     */
    spawnParticles(kind, x, y, z, opts = {}) {},
    /** Break burst for a block (called on 'block:broken' by fx itself; exposed for mechanics/tests). */
    blockBreakParticles(x, y, z, id, state) {},
    /**
     * A small Object3D showing an item: block items as a mini block (renderer.createBlockModel), flat items
     * as an extruded 16x16 sprite (icons.pixels16). Size ~0.25 blocks. Caller adds it via renderer.addObject
     * and must call disposeItemMesh() when done. Geometry is CACHED per item key and shared (draw-call and
     * memory budget, SPEC §12): disposeItemMesh() releases the Object3D, never the shared geometry.
     */
    makeItemMesh(itemKey) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), game.renderer.createEntityMaterial({ color: 0x999999 }));
      m.userData.itemKey = itemKey;
      return m;
    },
    disposeItemMesh(obj) { if (obj && obj.geometry) obj.geometry.dispose(); },
    /** Full-screen fade (0..1 opacity target) e.g. sleeping, home teleport. Resolves when reached. */
    fade(to, ms = 500) { return Promise.resolve(); },
    /** Brief red damage vignette (flash-safe). The hurt camera tilt belongs to the player lane, not FX. */
    hurtFlash() {},
  };
  return fx;
}
