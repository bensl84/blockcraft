// OWNER LANE: FEATURE-AUDIO. STUB written by LEAD - API FROZEN (SPEC §8.3). Everything is synthesised with
// WebAudio at runtime (original sounds; no samples, no network). Event-driven: subscribe to game events
// (block:broken/placed, player:step/land/hurt/jump, item:pickup, mob:sound, explosion, tnt:primed, ui:click,
// ui:open, door:toggle, player:eat, sound ...) - other lanes should rarely call audio directly.
// Kid-safe levels: master limiter, explosion peak <= -6 dBFS, no startle sounds.
//
// Stub behaviour: silent.

import { registerStub } from '../core/stubs.js';

registerStub('audio');
registerStub('music');

/** @returns {object} Audio system (game.audio) */
export function createAudioSystem(game) {
  return {
    name: 'audio',
    stub: true,
    /** true once the AudioContext is running (after a user gesture) */
    unlocked: false,
    init() {},
    /** Create/resume the AudioContext. Call from a user gesture (Play button, first click/key). */
    unlock() { return Promise.resolve(false); },
    /**
     * Play a named sound (catalog in SPEC §8.3.2). opts: {x,y,z (positional), volume 0..1, pitch multiplier}.
     */
    play(name, opts = {}) {},
    /**
     * Block material sound. kind: 'break'|'place'|'step'|'hit'|'land'; soundType from blocks.js `sound`.
     */
    playBlock(kind, soundType, x, y, z, opts = {}) {},
    /** Start/stop the generative piano music. */
    startMusic() {},
    stopMusic() {},
    /** Live voice counts for tests ('audio-events'): {voices, byName: {name: count}}. */
    stats() { return { voices: 0, byName: {} }; },
    frame() {},
  };
}
