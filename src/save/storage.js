// OWNER LANE: FEATURE-MENUS (menus + title + save/load + settings). STUB written by LEAD - API FROZEN (SPEC §8.4.3).
// IndexedDB persistence: db 'blockcraft' v1, stores 'worlds' (keyPath 'id') and 'columns' (keyPath 'key' =
// `${worldId}:${cx}:${cz}`, index 'worldId'), RLE-compressed Uint16 column data. Autosave: 2.5 s after the
// last block change, at least every 30 s while dirty, immediately on visibilitychange(hidden)/pagehide/
// pause/home/fullscreen exit. navigator.storage.persist() on http(s). Never blocks the game loop.
//
// Stub behaviour: nothing persists (listWorlds -> []), all promises resolve.

import { registerStub } from '../core/stubs.js';

registerStub('save');

/** @returns {object} Save system (game.save) */
export function createSaveSystem(game) {
  return {
    name: 'save',
    stub: true,
    /** IndexedDB usable on this origin */
    available: false,
    saving: false,
    lastSaveAt: 0,
    init() {},
    tick() {},
    /** @returns {Promise<import('../core/types.js').WorldMeta[]>} newest first */
    listWorlds() { return Promise.resolve([]); },
    /**
     * @returns {Promise<{meta: import('../core/types.js').WorldMeta, columns: Map<string, {blocks: Uint16Array, blockEntities: Array}>}|null>}
     */
    loadWorld(id) { return Promise.resolve(null); },
    /** Save meta (+ every system.serialize()) and dirty columns of the open world. reason for logs. */
    saveNow(reason = 'manual') { return Promise.resolve(false); },
    deleteWorld(id) { return Promise.resolve(); },
    /** P2: export/import behind the parent gate. */
    exportWorld(id) { return Promise.resolve(null); },
    importWorld(file) { return Promise.resolve(null); },
  };
}
