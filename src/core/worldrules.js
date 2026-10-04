// OWNER: LEAD. Pure per-world rule helpers (SPEC §3.6): the rules a NEW world starts with, and which rule
// switches Peaceful overrides. main.js (createWorldMeta, setDifficulty), the settings screen and the creative
// picker use them; test/foundation.test.mjs pins them.
//
// A difficulty change never rewrites a rule switch (judge FID-3): Peaceful blocks monsters and hunger at run
// time (spawning.js hostileAllowed, survival.js hungerOn, mobs.js spawn eggs), so going back to Easy or Normal
// brings back whatever the switches say. Writing `hostileMobs = false` on Peaceful used to turn monsters off for
// good after one trip through Peaceful.

import { DEFAULT_RULES, SURVIVAL_RULES } from './constants.js';

/** Rule keys that Peaceful turns off whatever the switch says. */
export const PEACEFUL_OFF = Object.freeze(['hostileMobs', 'hunger']);

/**
 * Rules for a new world. Survival worlds get SURVIVAL_RULES (weather included, judge FID-11); Survival Normal
 * also shows the death screen with its big Respawn button instead of respawning at once (FID-11). Explicit
 * overrides win.
 * @param {'creative'|'survival'} mode @param {'peaceful'|'easy'|'normal'} difficulty @param {object} [overrides]
 */
export function newWorldRules(mode, difficulty, overrides = null) {
  const rules = { ...DEFAULT_RULES, ...(mode === 'survival' ? SURVIVAL_RULES : {}) };
  if (mode === 'survival' && difficulty === 'normal') rules.immediateRespawn = false;
  return { ...rules, ...(overrides || {}) };
}

/** Is rule `key` in effect for this world meta (its switch is on and the difficulty does not override it)? */
export function ruleInEffect(meta, key) {
  if (!meta || !meta.rules || !meta.rules[key]) return false;
  return !(meta.difficulty === 'peaceful' && PEACEFUL_OFF.includes(key));
}
