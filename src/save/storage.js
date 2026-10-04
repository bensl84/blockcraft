// OWNER LANE: FEATURE-MENUS (menus + title + save/load + settings). API FROZEN (SPEC §8.4.3); members marked
// "(MENUS addition)" are optional extras documented in docs/handoff/menus.md.
//
// IndexedDB persistence (backends.js): db 'blockcraft' v1, stores 'worlds' (keyPath 'id') and 'columns' (keyPath
// 'key' = `${worldId}:${cx}:${cz}`, index 'worldId'), RLE-compressed column bytes (codec.js).
// Autosave (autosave.js): 2.5 s after the last block change, at least every 30 s while there are changes,
// immediately on visibilitychange(hidden) / pagehide / beforeunload / the pause screen / Home / fullscreen exit.
// navigator.storage.persist() on http(s). Never blocks the game loop: every save does its synchronous part
// (serialize systems, export dirty columns + markColumnSaved in the same task, issue the IndexedDB puts) and
// returns; completion is reported with 'save:done'. A failed transaction keeps its column records and writes
// them first on the next attempt. Backups (P1): 3 rolling meta copies (<= one per 10 min) + a daily snapshot.
// Without IndexedDB the in-memory backend keeps worlds for this page only (available = false).

import { encodeColumn } from './codec.js';
import { AutosaveScheduler } from './autosave.js';

/** block:changed causes that are the world changing by itself (not an edit the child waits to see saved). */
const NATURAL_CAUSES = new Set(['growth', 'melt', 'decay']);
import { createIdbBackend, createMemoryBackend } from './backends.js';
import { decodeWorldFile, encodeWorldFile, worldFileName } from './worldfile.js';
import { cleanWorldName } from '../ui/menu_logic.js';

export const THUMB_W = 240;
export const THUMB_H = 150;
/** Minimum time between thumbnail captures. */
export const THUMB_EVERY_MS = 60000;
/** Rolling meta backups kept per world, and the minimum time between two of them. */
export const META_BACKUPS = 3;
export const META_BACKUP_EVERY_MS = 10 * 60 * 1000;
/** Reasons that run immediately even while another save is in flight (the page may be going away). */
const URGENT = new Set(['hidden', 'pagehide', 'unload']);

const isBackupId = (id) => /~(b\d|d)$/.test(String(id));
const today = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {object} game
 * @param {{backend?: object}} [opts] backend: a storage backend (tests pass createMemoryBackend()); default IndexedDB
 * @returns {object} Save system (game.save)
 */
export function createSaveSystem(game, opts = {}) {
  const sched = new AutosaveScheduler();
  /** column records whose transaction failed: key -> record (written first next time) */
  const retry = new Map();
  let backend = opts.backend || null;
  let ready = false;              // a world is open and playable (world:ready .. world:exit)
  let inflight = null;            // Promise of the running (non-urgent) save
  let queuedReason = null, queuedPromise = null;
  let lastThumbAt = -Infinity;
  let running = 0;
  let seq = 0;
  /** column key -> sequence number of its newest export (a failed older save never overwrites a newer one) */
  const latestSeq = new Map();

  const save = {
    name: 'save',
    /** IndexedDB usable on this origin */
    available: false,
    saving: false,
    lastSaveAt: 0,
    /** (MENUS addition) active backend ('idb' | 'memory') */
    backend: null,
    /** (MENUS addition) number of column records waiting for a retry */
    get retryCount() { return retry.size; },
    /** (MENUS addition) Promise of the latest backup write (tests wait on it). */
    backupsIdle: Promise.resolve(),

    async init() {
      if (!backend) {
        const idb = createIdbBackend();
        if (await idb.open()) { backend = idb; save.available = true; }
        else { backend = createMemoryBackend(); save.available = false; console.warn('[blockcraft] IndexedDB unavailable: worlds are kept for this page only'); }
      } else {
        await backend.open();
        save.available = backend.kind === 'idb';
      }
      save.backend = backend.kind;
      const ev = game.events;
      ev.on('world:starting', () => { ready = false; sched.reset(); });
      ev.on('world:ready', (e) => {
        ready = true;
        sched.reset();
        if (e && e.isNew) save.saveNow('new');
        else if (game.meta && game.settings.lastWorldId !== game.meta.id) game.setSetting('lastWorldId', game.meta.id);
      });
      ev.on('world:exit', () => { ready = false; sched.reset(); });
      // Natural background changes (MECH random ticks: growth, melting, leaf decay) happen every few seconds in any
      // world; if they reset the 2.5 s debounce, the child's own edits would only be saved by the 30 s interval.
      // They count as soft changes (saved within 30 s); everything else is an edit (LEAD integration).
      ev.on('block:changed', (e) => {
        if (!ready) return;
        if (e && NATURAL_CAUSES.has(e.cause)) sched.noteSoftChange(nowMs());
        else sched.noteBlockChange(nowMs());
      });
      for (const name of ['inventory:changed', 'rules:changed', 'mode:changed', 'difficulty:changed', 'player:teleport', 'player:respawn', 'entity:spawn', 'entity:remove']) {
        ev.on(name, () => { if (ready) sched.noteSoftChange(nowMs()); });
      }
      ev.on('ui:open', (e) => { if (ready && e && e.screen === 'pause') save.saveNow('pause'); });
      ev.on('kid:home', () => { if (ready) save.saveNow('home'); });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ready) save.saveNow('hidden'); });
        document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && ready) save.saveNow('fullscreen'); });
      }
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', () => { if (ready) save.saveNow('pagehide'); });
        window.addEventListener('beforeunload', () => { if (ready) save.saveNow('unload'); });
      }
      try {
        if (typeof location !== 'undefined' && location.protocol.startsWith('http') && navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
      } catch { /* ignore */ }
    },

    tick() {},

    frame() {
      if (!ready || !game.meta) return;
      const now = nowMs();
      if (game.state === 'playing') sched.noteSoftChange(now);
      if (sched.due(now)) save.saveNow('auto');
    },

    /** @returns {Promise<import('../core/types.js').WorldMeta[]>} newest first (backups excluded) */
    async listWorlds() {
      if (!backend) return [];
      const all = await backend.getAllMetas();
      return all.filter((m) => m && !m.backupOf && !isBackupId(m.id)).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    },

    /**
     * @returns {Promise<{meta: import('../core/types.js').WorldMeta, columns: Map<string, {data: Uint8Array, blockEntities: Array}>}|null>}
     * Columns stay ENCODED (codec bytes); the world decodes them lazily.
     */
    async loadWorld(id) {
      if (!backend || !id) return null;
      const meta = await backend.getMeta(id);
      if (!meta || meta.backupOf) return null;
      const recs = await backend.getColumns(id);
      const columns = new Map();
      for (const r of recs) columns.set(`${r.cx},${r.cz}`, { data: r.data, blockEntities: r.blockEntities || [] });
      // pending retries for this world are newer than what the database has
      for (const r of retry.values()) if (r.worldId === id) columns.set(`${r.cx},${r.cz}`, { data: r.data, blockEntities: r.blockEntities || [] });
      return { meta, columns };
    },

    /** Save meta (+ every system.serialize()) and dirty columns of the open world. reason for logs. */
    saveNow(reason = 'manual') {
      if (!backend || !game.meta || !ready) return Promise.resolve(false);
      if (URGENT.has(reason)) return doSave(reason);
      if (inflight) {
        queuedReason = reason;
        if (!queuedPromise) {
          queuedPromise = inflight.then(() => {
            const r = queuedReason;
            queuedReason = null; queuedPromise = null;
            return save.saveNow(r);
          });
        }
        return queuedPromise;
      }
      const p = doSave(reason);
      inflight = p;
      p.then(() => { if (inflight === p) inflight = null; });
      return p;
    },

    async deleteWorld(id) {
      if (!backend || !id) return false;
      if (game.meta && game.meta.id === id) return false;
      const metas = await backend.getAllMetas();
      const metaIds = metas.filter((m) => m.id === id || m.backupOf === id).map((m) => m.id);
      const keys = [...(await backend.getColumnKeys(id)), ...(await backend.getColumnKeys(`${id}~d`))];
      for (const k of [...retry.keys()]) if (retry.get(k).worldId === id) retry.delete(k);
      await backend.write({ deleteMetaIds: metaIds, deleteColumnKeys: keys });
      if (game.settings.lastWorldId === id) game.setSetting('lastWorldId', null);
      return true;
    },

    /** (MENUS addition) Rename a world (parent area). Returns the cleaned name or null. */
    async renameWorld(id, name) {
      const clean = cleanWorldName(name);
      if (!backend || !clean) return null;
      if (game.meta && game.meta.id === id) game.meta.name = clean;
      const meta = await backend.getMeta(id);
      if (!meta) return null;
      meta.name = clean;
      await backend.write({ metas: [meta] });
      return clean;
    },

    /** (MENUS addition) Backups of a world, newest first: [{id, kind: 'meta'|'daily', at, day, playTicks}] */
    async listBackups(worldId) {
      if (!backend) return [];
      const all = await backend.getAllMetas();
      return all.filter((m) => m.backupOf === worldId)
        .map((m) => ({ id: m.id, kind: m.backupKind, at: m.backupAt, day: m.day || null, playTicks: m.playTicks || 0 }))
        .sort((a, b) => b.at - a.at);
    },

    /**
     * (MENUS addition) Restore a backup. A daily snapshot restores blocks + meta; a meta backup restores
     * inventory, position, time and rules. If the world is open it is saved, closed, restored and reopened.
     */
    async restoreBackup(worldId, backupId) {
      if (!backend) return false;
      const b = await backend.getMeta(backupId);
      if (!b || b.backupOf !== worldId) return false;
      const wasOpen = !!(game.meta && game.meta.id === worldId);
      if (wasOpen) await game.exitToTitle();
      const current = await backend.getMeta(worldId);
      const restored = { ...b, id: worldId, name: current ? current.name : b.name, thumbnail: current ? current.thumbnail : null, lastPlayed: Date.now() };
      delete restored.backupOf; delete restored.backupKind; delete restored.backupAt; delete restored.day;
      if (b.backupKind === 'daily') {
        const cols = await backend.getColumns(backupId);
        const newKeys = new Set(cols.map((c) => `${worldId}:${c.cx}:${c.cz}`));
        const oldKeys = (await backend.getColumnKeys(worldId)).filter((k) => !newKeys.has(k));
        for (const k of [...retry.keys()]) if (retry.get(k).worldId === worldId) retry.delete(k);
        await backend.write({
          metas: [restored],
          columns: cols.map((c) => ({ ...c, key: `${worldId}:${c.cx}:${c.cz}`, worldId })),
          deleteColumnKeys: oldKeys,
        });
      } else {
        await backend.write({ metas: [restored] });
      }
      if (wasOpen) {
        const d = await save.loadWorld(worldId);
        if (d) await game.startWorld(d);
      }
      return true;
    },

    /** P2: export a world as a JSON Blob (has .filename). The open world is saved first. */
    async exportWorld(id) {
      if (!backend) return null;
      if (game.meta && game.meta.id === id) await save.saveNow('export');
      const data = await save.loadWorld(id);
      if (!data) return null;
      const cols = [...data.columns].map(([k, v]) => { const [cx, cz] = k.split(',').map(Number); return { cx, cz, data: v.data, blockEntities: v.blockEntities }; });
      const text = encodeWorldFile(data.meta, cols);
      const blob = new Blob([text], { type: 'application/json' });
      blob.filename = worldFileName(data.meta);
      return blob;
    },

    /** P2: import a world file (File/Blob/string). Resolves the new WorldMeta, or null (bad file). */
    async importWorld(file) {
      if (!backend || !file) return null;
      let parsed;
      try {
        const text = typeof file === 'string' ? file : await file.text();
        parsed = decodeWorldFile(text);
      } catch (err) {
        console.warn('[blockcraft] import failed:', err && err.message);
        return null;
      }
      const existing = await save.listWorlds();
      const id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
      const meta = { ...parsed.meta, id, lastPlayed: Date.now() };
      delete meta.backupOf; delete meta.backupKind; delete meta.backupAt; delete meta.day;
      let name = cleanWorldName(meta.name) || 'Imported World';
      if (existing.some((w) => w.name === name)) name = cleanWorldName(name + ' copy');
      meta.name = name;
      const savedAt = Date.now();
      await backend.write({
        metas: [meta],
        columns: parsed.columns.map((c) => ({ key: `${id}:${c.cx}:${c.cz}`, worldId: id, cx: c.cx, cz: c.cz, v: 1, data: c.data, blockEntities: c.blockEntities, savedAt })),
      });
      return meta;
    },
  };

  /** One save: synchronous part now, completion later. Resolves true when the transaction committed. */
  function doSave(reason) {
    const t0 = nowMs();
    const meta = game.meta;
    const world = game.world;
    running++;
    save.saving = true;
    sched.saved();
    game.events.emit('save:start', { reason });
    // 1) every system's per-world data
    if (!meta.systems) meta.systems = {};
    for (const s of game.systems || []) {
      if (!s.serialize || s === save) continue;
      try { meta.systems[s.name] = s.serialize(game); } catch (err) { game.reportError(err, `${s.name}.serialize`); }
    }
    // 2) lastPlayed + thumbnail (exit / pause, at most every 60 s; or the first one after 5 s of play)
    meta.lastPlayed = Date.now();
    const wantThumb = reason === 'exit' || reason === 'pause' || (!meta.thumbnail && (meta.playTicks || 0) > 100);
    if (wantThumb && (t0 - lastThumbAt >= THUMB_EVERY_MS || !meta.thumbnail) && game.renderer && game.renderer.captureThumbnail) {
      try {
        // no block selection outline in the world picture (restored right after the synchronous capture)
        const r = game.renderer, hl = r.highlight;
        if (hl && r.setHighlight) r.setHighlight(null);
        let url;
        try { url = r.captureThumbnail(THUMB_W, THUMB_H); } finally { if (hl && r.setHighlight) r.setHighlight(hl); }
        if (typeof url === 'string' && url.startsWith('data:image') && url.length > 200) { meta.thumbnail = url; lastThumbAt = t0; }
      } catch (err) { console.warn('[blockcraft] thumbnail failed:', err && err.message); }
    }
    // 3) column records: earlier failures first, then every dirty column (export + markColumnSaved together)
    const records = new Map(retry);
    retry.clear();
    if (world && world.isOpen !== false) {
      const list = (world.getDirtyColumns ? world.getDirtyColumns() : []).slice();
      if (world.pendingSave) for (const key of [...world.pendingSave.keys()]) list.push(key.split(',').map(Number));
      const savedAt = Date.now();
      for (const [cx, cz] of list) {
        const rec = world.exportColumn(cx, cz);
        world.markColumnSaved(cx, cz);
        if (!rec) continue;
        const key = `${meta.id}:${cx}:${cz}`;
        const data = rec.data || encodeColumn(rec.blocks);
        const n = ++seq;
        latestSeq.set(key, n);
        records.set(key, { key, worldId: meta.id, cx, cz, v: 1, data, blockEntities: rec.blockEntities || [], savedAt, seq: n });
      }
    }
    // 4) remember the world for Play
    if (game.settings && game.settings.lastWorldId !== meta.id) game.setSetting('lastWorldId', meta.id);
    // 5) one transaction (requests issued now, synchronously)
    let p;
    try { p = backend.write({ metas: [meta], columns: [...records.values()] }); } catch (err) { p = Promise.reject(err); }
    return p.then(() => true, (err) => {
      for (const [k, r] of records) if (!retry.has(k) && (!r.seq || latestSeq.get(k) === r.seq)) retry.set(k, r);
      console.warn('[blockcraft] save failed (will retry):', err && err.message);
      return false;
    }).then((ok) => {
      running--;
      save.saving = running > 0;
      if (ok) save.lastSaveAt = Date.now();
      game.events.emit('save:done', { ok, reason, ms: Math.round(nowMs() - t0) });
      if (ok && (reason === 'exit' || reason === 'pause')) {
        save.backupsIdle = save.backupsIdle.then(() => writeBackups(meta)).catch((err) => console.warn('[blockcraft] backup failed:', err && err.message));
      }
      return ok;
    });
  }

  /** P1 backups: rolling meta copies (<= 1 per 10 min) and one snapshot (meta + columns) per day. */
  async function writeBackups(meta) {
    const id = meta.id;
    const all = await backend.getAllMetas();
    const mine = all.filter((m) => m.backupOf === id);
    const now = Date.now();
    const metaBackups = mine.filter((m) => m.backupKind === 'meta');
    const newest = metaBackups.reduce((a, m) => Math.max(a, m.backupAt || 0), 0);
    const copy = JSON.parse(JSON.stringify(meta));
    copy.thumbnail = null;
    if (!metaBackups.length || now - newest >= META_BACKUP_EVERY_MS) {
      let slot = 0;
      if (metaBackups.length >= META_BACKUPS) {
        const oldest = metaBackups.reduce((a, m) => ((m.backupAt || 0) < (a.backupAt || 0) ? m : a));
        slot = Number(oldest.id.slice(-1));
      } else {
        const used = new Set(metaBackups.map((m) => m.id));
        while (used.has(`${id}~b${slot}`)) slot++;
      }
      await backend.write({ metas: [{ ...copy, id: `${id}~b${slot}`, backupOf: id, backupKind: 'meta', backupAt: now }] });
    }
    const daily = mine.find((m) => m.backupKind === 'daily');
    const day = today(now);
    if (!daily || daily.day !== day) {
      const cols = await backend.getColumns(id);
      const dailyId = `${id}~d`;
      const newKeys = new Set(cols.map((c) => `${dailyId}:${c.cx}:${c.cz}`));
      const oldKeys = (await backend.getColumnKeys(dailyId)).filter((k) => !newKeys.has(k));
      await backend.write({
        metas: [{ ...copy, id: dailyId, backupOf: id, backupKind: 'daily', backupAt: now, day }],
        columns: cols.map((c) => ({ ...c, key: `${dailyId}:${c.cx}:${c.cz}`, worldId: dailyId })),
        deleteColumnKeys: oldKeys,
      });
    }
  }

  return save;
}
