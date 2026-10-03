// OWNER LANE: FEATURE-TOUCH (touch + kid controls). STUB written by LEAD - API FROZEN (SPEC §8.5.2).
// Kid helpers: Home (H key / 'home' action / 80 px button top-left): whoosh + fade, teleport to home (or spawn)
// facing the build; home arrow when > 48 blocks away; soft world border push-back (renderer.setFogOverride
// for the thickening fog); void rescue while rules.voidRescue (feet below KID.VOID_RESCUE_Y = 0, or 10 below
// terrain -> surface, no damage - survival never sees 'void'); stuck detection (3 s pushing without moving
// while enclosed -> pulse Up button; holding Jump 1 s pops to free space); Undo (U / button): entries are
// recorded from 'block:changed' (it carries oldId/oldState) grouped by its `action` id - an action counts when
// any change in it has cause 'player' or 'explosion', and its 'cascade'/'support' changes join the same entry
// (door halves, torches); never record cause 'undo'; restore only cells whose current value still equals
// the recorded new value; last KID.UNDO_ENTRIES actions; onboarding hints after 6-8 s idle (animated
// pictograms, optional speech); accidental-exit guards (fullscreen + keyboard lock on Play, beforeunload after
// first interaction, block F5/Ctrl+R/zoom keys, overscroll none, history.pushState({bc:1}, '', location.href)).
//
// Stub behaviour: goHome() teleports to the spawn point; the rest is inert.

import { registerStub } from '../core/stubs.js';

registerStub('kid');

/** @returns {object} Kid system (game.kid) */
export function createKidSystem(game) {
  const kid = {
    name: 'kid',
    stub: true,
    init() {
      game.events.on('input:action', (e) => { if (e.down && e.action === 'home' && game.state === 'playing') kid.goHome(); });
    },
    /** Teleport to home (meta.home) or world spawn. Emits 'kid:home'. */
    goHome() {
      const h = (game.meta && (game.meta.home || game.meta.spawn)) || { x: 0.5, y: 64, z: 0.5 };
      game.player.teleport(h.x, h.y, h.z, 'home');
      game.events.emit('kid:home', { x: h.x, y: h.y, z: h.z });
    },
    /** Set home to the player's position (parent area / home flag). */
    setHome() {
      if (!game.meta) return;
      game.meta.home = { x: game.player.x, y: game.player.y, z: game.player.z, yaw: game.player.yaw };
    },
    /** Undo the last player block action. Returns true if something was undone. */
    undo() { return false; },
    /** Request fullscreen + keyboard lock. MUST be called inside a user-gesture handler (Play button). */
    enterFullscreen() { return Promise.resolve(false); },
    tick() {},
    frame() {},
    serialize() { return {}; },
    deserialize() {},
  };
  return kid;
}
