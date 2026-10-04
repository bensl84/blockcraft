// OWNER LANE: FEATURE-INV (inventory + crafting + furnace + chest UI). Signature FROZEN: createInventoryUISystem(game).
// Registers container screens with game.ui (src/ui/screens.js): 'inventory' (2x2 craft + armour + 27+9 + recipe
// book), 'creative' (kid picture picker with 8 tabs; replaces 'inventory' in creative), 'crafting' (3x3 + recipe
// book, opened by hooks.registerBlockUse('crafting_table')), 'furnace' + 'chest' (registerBlockUse('furnace'),
// ('furnace_lit'), ('chest')). Also owns: furnace ticking (every loaded furnace block entity, 20 TPS), dropping
// chest/furnace contents from the 'block:broken' payload's blockEntity with dropItem (both modes), Q-drop
// (classic scheme only), keys 1-9 over a hovered slot. SPEC §8.2.
//
// Additive API (tests / other lanes): game.invui.screen (open screen object or null), openContainer(kind,x,y,z),
// clickSlot(sid, button, shift), slotRect(sid), pick(itemKey), recipeTap(itemKey), hotbarKey(i),
// dropContents(be, x, y, z), lastDropped.

import './inv.css';
import { uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';
import { ID } from '../core/registry.js';
import { registerBlockUse } from '../core/hooks.js';
import { getItem } from '../data/items.js';
import { dropItem } from '../entities/item_entity.js';
import { CONTAINER_BLOCKS, containerStacks, normalizeContainer, tickFurnace } from '../inventory/containers.js';
import { buildContainerScreen } from './inv_screens.js';
import { buildPicker } from './inv_picker.js';

const KINDS = ['inventory', 'creative', 'crafting', 'furnace', 'chest'];

/** @returns {object} Inventory UI system (game.invui) */
export function createInventoryUISystem(game) {
  let layer = null;
  let ctrlDown = false;

  const invui = {
    name: 'invui',
    /** the open container screen object (or null) */
    screen: null,
    /** last container contents dropped from a broken block (debug/tests): [{item, count}] */
    lastDropped: [],

    init() {
      layer = uiLayer(game, 'containers', Z.CONTAINER);
      for (const kind of KINDS) {
        game.ui.register(kind, {
          owner: 'invui', pausesGame: false,
          open: (opts) => openScreen(kind, opts || {}),
          close: () => closeScreen(),
        });
      }
      const useHook = (kind) => (ctx) => {
        const h = ctx && ctx.hit;
        if (!h) return false;
        return game.ui.open(kind, { x: h.x, y: h.y, z: h.z });
      };
      registerBlockUse('crafting_table', useHook('crafting'));
      registerBlockUse('furnace', useHook('furnace'));
      registerBlockUse('furnace_lit', useHook('furnace'));
      registerBlockUse('chest', useHook('chest'));

      game.events.on('block:broken', onBroken);
      game.events.on('input:action', onAction);
      game.events.on('world:exit', () => { invui.lastDropped = []; game.inventory.cursor = null; });
      game.events.on('mode:changed', () => { if (game.ui.current === 'creative' && !game.isCreative()) game.ui.close(); });
      window.addEventListener('keydown', (e) => { if (e.key === 'Control') ctrlDown = true; });
      window.addEventListener('keyup', (e) => { if (e.key === 'Control') ctrlDown = false; });
      window.addEventListener('blur', () => { ctrlDown = false; });
      window.addEventListener('resize', () => {
        // rebuild the open screen at the new GUI size
        if (invui.screen && game.ui.current) { const name = game.ui.current, opts = game.ui.currentOpts; game.ui.close(); game.ui.open(name, opts); }
      });
    },

    /** Furnaces cook in every loaded column (20 TPS), whether or not their screen is open. */
    tick() {
      const w = game.world;
      if (!w || !w.forEachBlockEntity) return;
      w.forEachBlockEntity((be, x, y, z) => {
        if (!be || be.type !== 'furnace') return;
        if (!(be.burnTicks > 0 || be.cookTicks > 0 || (be.fuel && be.input))) return;
        const id = w.getBlock(x, y, z);
        if (id !== ID.furnace && id !== ID.furnace_lit) return;
        if (tickFurnace(game, be, x, y, z)) w.setBlockEntity(x, y, z, be); // marks the column for saving
      });
      // a detached furnace (screen opened without a block, tests) still cooks while open
      const s = invui.screen;
      if (s && s.kind === 'furnace' && s.detached) tickFurnace(game, s.be, 0, -1, 0);
    },

    frame() { if (invui.screen && invui.screen.frame) invui.screen.frame(); },

    serialize() {
      const j = game.inventory.toJSON();
      // items sitting in an open crafting grid or on the cursor are saved as "pending" and returned on load
      const pending = [];
      const s = invui.screen;
      if (s && s.craft) for (const st of s.craft.grid) if (st) pending.push({ ...st });
      if (game.inventory.cursor) pending.push({ ...game.inventory.cursor });
      if (pending.length) j.pending = pending;
      return j;
    },
    deserialize(g, d) {
      if (!d) { game.inventory.selected = 0; game.inventory.notify(-1); return; } // new world: first slot
      game.inventory.fromJSON(d);
      if (Array.isArray(d.pending)) for (const st of d.pending) if (st && getItem(st.item) && st.count > 0) game.inventory.add(st);
    },

    /** Open a container screen for the block at x,y,z (creates its block entity on first open). */
    openContainer(kind, x, y, z) { return game.ui.open(kind, { x, y, z }); },
    /** Click a slot of the open screen (sid like 'p0', 'c4', 'out', 'k3', 'fi', 'ff', 'fo', 'a1'). */
    clickSlot(sid, button = 'left', shift = false) { const s = invui.screen; return s && s.clickSlot ? s.clickSlot(sid, button, shift) : false; },
    slotRect(sid) { const s = invui.screen; return s && s.slotRect ? s.slotRect(sid) : null; },
    /** Creative picker: put an item into the selected hotbar slot. */
    pick(itemKey) { const s = invui.screen; return !!(s && s.pick && s.pick(itemKey)); },
    /** Recipe book: tap the picture of `itemKey`. */
    recipeTap(itemKey) {
      const s = invui.screen;
      if (!s || !s.book) return false;
      const e = s.book.entries.find((x) => x.recipe.result.item === itemKey);
      return e ? s.book.tap(e, null) : false;
    },
    /** Keys 1-9 inside a container: swap the hovered slot with hotbar slot i. */
    hotbarKey(i) {
      const s = invui.screen;
      if (s && s.kind === 'creative') { game.inventory.selectSlot(i); return true; } // picker: choose the slot to fill
      return !!(s && s.ctl && s.ctl.swapHovered(i));
    },
    /** Drop every stack of a container block entity at a cell (block broken). Returns the dropped stacks. */
    dropContents(be, x, y, z) {
      const stacks = containerStacks(be).map((s) => ({ ...s }));
      for (const s of stacks) dropItem(game, s, x + 0.5, y + 0.5, z + 0.5);
      return stacks;
    },
  };

  /* ------------------------------------------------------------------ screens */
  function openScreen(kind, opts) {
    closeScreen();
    const close = () => game.ui.close(kind);
    let screen;
    if (kind === 'creative') {
      screen = buildPicker({ game, close, openInventory: () => game.ui.open('inventory') });
    } else {
      let be = null, detached = false, pos = null;
      if (kind === 'chest' || kind === 'furnace') {
        const r = containerAt(kind, opts);
        be = r.be; detached = r.detached; pos = r.pos;
      }
      screen = buildContainerScreen({
        game, kind, be,
        book: kind === 'inventory' || kind === 'crafting' ? !game.isCreative() : false,
        close,
        onDirty: () => { if (pos && game.world) game.world.setBlockEntity(pos.x, pos.y, pos.z, be); },
        dropStack: (stack, thrown) => dropFromPlayer(stack, thrown),
      });
      screen.detached = detached;
      screen.pos = pos;
    }
    invui.screen = screen;
    layer.appendChild(screen.root);
  }

  function closeScreen() {
    const s = invui.screen;
    if (!s) return;
    invui.screen = null;
    try { s.returnAll(); } finally {
      if (s.ctl) s.ctl.dispose();
      s.root.remove();
      if (s.pos && s.be && game.world) game.world.setBlockEntity(s.pos.x, s.pos.y, s.pos.z, s.be);
    }
    relockSoon();
  }

  /**
   * Classic scheme: closing a container screen (E, the close button) grabs the mouse again, like Java, instead of
   * needing one more click on the world. Only with a fresh user gesture (the browser requires one) and only when
   * no other screen took over.
   */
  function relockSoon() {
    if (!game.input || game.input.scheme !== 'classic' || !game.input.requestPointerLock) return;
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    if (ua && !ua.isActive) return;
    setTimeout(() => {
      if (game.ui.current || game.state !== 'playing' || game.input.pointerLocked) return;
      game.input.requestPointerLock();
    }, 0);
  }

  /** Block entity for a chest/furnace screen: existing one at the cell, else a new one stored there. */
  function containerAt(kind, opts) {
    const w = game.world;
    const has = Number.isFinite(opts.x) && Number.isFinite(opts.y) && Number.isFinite(opts.z);
    if (has && w) {
      const x = Math.floor(opts.x), y = Math.floor(opts.y), z = Math.floor(opts.z);
      const name = blockNameAt(x, y, z);
      if (CONTAINER_BLOCKS[name] === kind) {
        const old = w.getBlockEntity(x, y, z);
        const be = normalizeContainer(old, kind);
        if (be !== old) w.setBlockEntity(x, y, z, be);
        return { be, detached: false, pos: { x, y, z } };
      }
    }
    return { be: normalizeContainer(null, kind), detached: true, pos: null };
  }

  function blockNameAt(x, y, z) {
    const id = game.world.getBlock(x, y, z);
    if (id === ID.chest) return 'chest';
    if (id === ID.furnace) return 'furnace';
    if (id === ID.furnace_lit) return 'furnace_lit';
    return '';
  }

  /* ------------------------------------------------------------------ events */
  function onBroken(e) {
    if (!e) return;
    const s = invui.screen;
    if (s && s.pos && s.pos.x === e.x && s.pos.y === e.y && s.pos.z === e.z) {
      // the container under an open screen was broken: close without writing the block entity back
      s.pos = null;
      game.ui.close();
    }
    if (!e.blockEntity) return;
    const be = e.blockEntity;
    if (be.type !== 'chest' && be.type !== 'furnace') return;
    invui.lastDropped = invui.dropContents(be, e.x, e.y, e.z);
  }

  function onAction(e) {
    if (!e.down || e.action !== 'drop') return;
    if (game.settings.controls !== 'classic' || game.state !== 'playing' || !game.meta) return;
    const inv = game.inventory;
    if (game.ui.current && invui.screen && invui.screen.ctl) {
      // Q over a slot inside a container drops from that slot
      const ctl = invui.screen.ctl, sid = ctl.hovered;
      const entry = sid && ctl.slots.get(sid);
      if (!entry || entry.slot.output || entry.slot.craftOutput) return;
      const st = entry.slot.get();
      if (!st) return;
      const n = ctrlDown ? st.count : 1;
      entry.slot.set(st.count > n ? { ...st, count: st.count - n } : null);
      dropFromPlayer({ ...st, count: n }, true);
      ctl.changed();
      return;
    }
    if (game.ui.current) return;
    const st = inv.getSelected();
    if (!st) return;
    const n = ctrlDown ? st.count : 1;
    inv.set(inv.selected, st.count > n ? { ...st, count: st.count - n } : null);
    dropFromPlayer({ ...st, count: n }, true);
  }

  /** Toss a stack from the player's eyes along the look direction (Q-drop, full inventory overflow). */
  function dropFromPlayer(stack, thrown = false) {
    const p = game.player;
    if (!p || !stack) return null;
    const eye = p.getEyePos ? p.getEyePos({}, false) : { x: p.x, y: p.y + 1.62, z: p.z };
    const d = p.getLookDir ? p.getLookDir({}) : { x: 0, y: 0, z: -1 };
    const ent = dropItem(game, { ...stack }, eye.x, eye.y - 0.3, eye.z, {
      vx: d.x * 0.3, vy: d.y * 0.3 + 0.1, vz: d.z * 0.3, pickupDelay: thrown ? 40 : 10, thrower: 'player',
    });
    game.events.emit('item:drop', { item: stack.item, count: stack.count, x: eye.x, y: eye.y - 0.3, z: eye.z });
    return ent;
  }

  return invui;
}
