// OWNER LANE: FEATURE-MENUS. STUB written by LEAD - keep the signature. SPEC §8.4.4.
// Parent gate: press-and-hold 3 s, then answer a random two-digit sum on an on-screen number pad.
// Used before: settings, world delete/rename, export/import, controls scheme change, any link out.

import { registerStub } from '../core/stubs.js';

registerStub('gate');

/**
 * Show the gate over everything (Z.GATE). Resolves true if passed, false if cancelled.
 * @param {object} game @returns {Promise<boolean>}
 */
export function openParentGate(game) { return Promise.resolve(true); }
