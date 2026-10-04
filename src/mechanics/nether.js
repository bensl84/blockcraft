// OWNER: LEAD (v1.7, judge FID-8), in MECH's style. The Nether portal: light an obsidian frame with flint and
// steel, stand in the purple sheet, and you are in the Nether (a far-east strip of the same world, core/nether.js);
// a portal there brings you back. SPEC §2.8. System 'nether' (game.nether), registered after 'mechanics'.
//
//   lighting  flint and steel on (or inside) a frame whose interior is 2..21 wide and 3..21 tall, all air or fire:
//             the interior becomes nether_portal (cause 'player', the press's action: one Undo removes it)
//   breaking  MECH's support rule: a portal cell whose in-plane neighbours are not portal or obsidian goes
//             (cascade, no drops) - break the frame and the sheet disappears
//   travel    standing in the sheet for PORTAL_TICKS_* (a purple glow grows on the screen): the destination area is
//             generated now (world.ensureColumn), an existing portal within PORTAL_SEARCH is reused, otherwise a
//             4x5 frame is built on a safe obsidian platform (lava next to it turns to netherrack); the child arrives
//             in front of it, facing away, and must step out of a portal before it can take her again
// Events: 'portal:lit' {x, y, z, axis, w, h}, 'nether:travel' {to: 'nether'|'overworld', x, y, z}.

import { hooks, registerItemUse } from '../core/hooks.js';
import { B_LIQUID, B_SOLID, ID, connectionState } from '../core/registry.js';
import { STATE } from '../data/blocks.js';
import { Z } from '../core/constants.js';
import {
  PORTAL_MAX, PORTAL_MIN_H, PORTAL_MIN_W, PORTAL_SEARCH, PORTAL_TICKS_CREATIVE, PORTAL_TICKS_SURVIVAL,
  NETHER_LAVA_Y, isNetherX, toNether, toOverworld,
} from '../core/nether.js';

const AIR = 0;

/**
 * Find a lightable portal frame around interior cell (x, y, z) (pure). The interior must be air or fire, framed by
 * obsidian on all four sides (corners not needed). Returns {axisZ, x0, y0, z0, w, h} (x0/y0/z0 = the lowest,
 * west- or north-most interior cell) or null.
 * @param {(x:number,y:number,z:number)=>number} getRaw
 */
export function findPortalFrame(getRaw, x, y, z) {
  const id = (a, b, c) => getRaw(a, b, c) & 0xff;
  const open = (a, b, c) => { const i = id(a, b, c); return i === AIR || i === ID.fire; };
  const obs = (a, b, c) => id(a, b, c) === ID.obsidian;
  if (!open(x, y, z)) return null;
  for (const axisZ of [false, true]) {
    const dx = axisZ ? 0 : 1, dz = axisZ ? 1 : 0;
    // bottom
    let yb = y, n = 0;
    while (open(x, yb - 1, z) && n < PORTAL_MAX) { yb--; n++; }
    if (!obs(x, yb - 1, z)) continue;
    // left and right walls along the axis
    let l = 0;
    while (open(x - dx * (l + 1), yb, z - dz * (l + 1)) && l < PORTAL_MAX) l++;
    if (!obs(x - dx * (l + 1), yb, z - dz * (l + 1))) continue;
    let r = 0;
    while (open(x + dx * (r + 1), yb, z + dz * (r + 1)) && r < PORTAL_MAX) r++;
    if (!obs(x + dx * (r + 1), yb, z + dz * (r + 1))) continue;
    const w = l + r + 1;
    if (w < PORTAL_MIN_W || w > PORTAL_MAX) continue;
    const sx = x - dx * l, sz = z - dz * l;
    // height from the first column
    let h = 0;
    while (open(sx, yb + h, sz) && h < PORTAL_MAX) h++;
    if (h < PORTAL_MIN_H || h > PORTAL_MAX || !obs(sx, yb + h, sz)) continue;
    // every interior cell open, every frame cell obsidian
    let ok = true;
    for (let i = 0; i < w && ok; i++) {
      const cx = sx + dx * i, cz = sz + dz * i;
      if (!obs(cx, yb - 1, cz) || !obs(cx, yb + h, cz)) ok = false;
      for (let j = 0; j < h && ok; j++) if (!open(cx, yb + j, cz)) ok = false;
    }
    for (let j = 0; j < h && ok; j++) {
      if (!obs(sx - dx, yb + j, sz - dz) || !obs(sx + dx * w, yb + j, sz + dz * w)) ok = false;
    }
    if (ok) return { axisZ, x0: sx, y0: yb, z0: sz, w, h };
  }
  return null;
}

/** @returns {object} Nether system (game.nether) */
export function createNetherSystem(game) {
  const w = () => game.world;
  const getRaw = (x, y, z) => game.world.getRaw(x, y, z);
  let charge = 0;          // ticks spent in a portal
  let waitExit = false;    // just arrived: step out of the portal before it can take you again
  let overlay = null, overlayA = 0;

  const ns = {
    name: 'nether',
    /** Is the player (or a point) in the Nether? */
    inNether(x) { return isNetherX(Number.isFinite(x) ? x : (game.player ? game.player.x : 0)); },
    /** Portal charge 0..1 (debug / tests). */
    get charge() { return Math.min(1, charge / needTicks()); },
    get waitExit() { return waitExit; },
    findPortalFrame: (x, y, z) => findPortalFrame(getRaw, x, y, z),
    /** Light the frame around interior cell (x,y,z). Returns the frame or null. */
    light(x, y, z, action = 0) {
      const f = findPortalFrame(getRaw, x, y, z);
      if (!f) return null;
      const dx = f.axisZ ? 0 : 1, dz = f.axisZ ? 1 : 0;
      const st = f.axisZ ? STATE.PORTAL_AXIS_Z : 0;
      w().beginBatch();
      try {
        for (let i = 0; i < f.w; i++) for (let j = 0; j < f.h; j++) {
          w().setBlock(f.x0 + dx * i, f.y0 + j, f.z0 + dz * i, ID.nether_portal, st, { cause: 'player', action });
        }
      } finally { w().endBatch(); }
      game.events.emit('portal:lit', { x: f.x0, y: f.y0, z: f.z0, axis: f.axisZ ? 'z' : 'x', w: f.w, h: f.h });
      game.events.emit('sound', { name: 'fire.ignite', x: f.x0 + 0.5, y: f.y0 + 1, z: f.z0 + 0.5 });
      return f;
    },
    /** Travel through a portal now (tests; the tick does this after PORTAL_TICKS_*). */
    travel,

    init() {
      // flint and steel on a frame lights the portal; anything else keeps MECH's own behaviour (fire, TNT)
      const flint = hooks.itemUse.get('flint_and_steel');
      registerItemUse('flint_and_steel', (ctx) => {
        const h = ctx.hit;
        if (h && game.world) {
          const raw = getRaw(h.x, h.y, h.z);
          const cells = [[h.x + h.nx, h.y + h.ny, h.z + h.nz]];
          if ((raw & 0xff) === ID.fire) cells.unshift([h.x, h.y, h.z]);
          for (const [x, y, z] of cells) {
            if (ns.light(x, y, z, ctx.action)) {
              if (!game.isCreative() && game.inventory) game.inventory.damageSelected(1);
              if (game.player && game.player.swing) game.player.swing();
              return true;
            }
          }
        }
        return flint ? flint(ctx) : false;
      });
      game.events.on('world:exit', () => { charge = 0; waitExit = false; setOverlay(0); });
      game.events.on('world:ready', () => { charge = 0; waitExit = inPortal(); setOverlay(0); });
      game.events.on('player:teleport', (e) => { if (!e || e.reason !== 'portal') { charge = 0; waitExit = inPortal(); } });
    },

    tick() {
      const p = game.player;
      if (!game.meta || game.state !== 'playing' || !p || p.dead) return;
      if (!inPortal()) { charge = 0; waitExit = false; return; }
      if (p.riding) { charge = 0; return; }              // get off the animal first
      if (waitExit) return;
      charge++;
      if (charge === 1) game.events.emit('sound', { name: 'ui.whoosh', x: p.x, y: p.y + 1, z: p.z, volume: 0.4 });
      if (charge >= needTicks()) travel();
    },

    frame(g, dt) {
      const target = waitExit ? 0 : Math.min(1, charge / needTicks());
      overlayA += (target - overlayA) * Math.min(1, dt * (target > overlayA ? 12 : 3));
      if (overlayA < 0.003) overlayA = 0;
      setOverlay(overlayA);
    },
  };

  function needTicks() { return game.isCreative() ? PORTAL_TICKS_CREATIVE : PORTAL_TICKS_SURVIVAL; }

  /** Does the player's body touch a portal cell? */
  function inPortal() {
    const p = game.player, wd = game.world;
    if (!p || !wd || !wd.getRaw) return false;
    const r = 0.3;
    for (let x = Math.floor(p.x - r); x <= Math.floor(p.x + r); x++) {
      for (let z = Math.floor(p.z - r); z <= Math.floor(p.z + r); z++) {
        for (let y = Math.floor(p.y); y <= Math.floor(p.y + 1.7); y++) if ((wd.getRaw(x, y, z) & 0xff) === ID.nether_portal) return true;
      }
    }
    return false;
  }

  /** The screen glows purple while the portal takes hold (and fades after the jump). */
  function setOverlay(a) {
    if (a <= 0) { if (overlay) overlay.style.opacity = '0'; return; }
    if (!overlay) {
      const root = game.uiRoot || document.body;
      overlay = document.createElement('div');
      overlay.className = 'bc-portal-glow';
      Object.assign(overlay.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: String(Z.FX_OVERLAY + 1), opacity: '0',
        background: 'radial-gradient(ellipse at center, rgba(176,110,255,0.35) 0%, rgba(110,30,210,0.75) 60%, rgba(60,0,120,0.95) 100%)',
      });
      root.appendChild(overlay);
    }
    overlay.style.opacity = String(Math.min(1, a).toFixed(3));
  }

  /** Make sure the 5x5 columns around block (x, z) are generated and lit (synchronous: a short hitch behind the glow). */
  function ensureArea(x, z) {
    const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w().ensureColumn(cx + dx, cz + dz);
  }

  /** Nearest portal cell to (x, z) within PORTAL_SEARCH blocks (loaded columns only), its lowest cell. */
  function findPortalNear(x, z) {
    let best = null, bd = Infinity;
    const wd = w();
    for (let dz = -PORTAL_SEARCH; dz <= PORTAL_SEARCH; dz++) {
      for (let dx = -PORTAL_SEARCH; dx <= PORTAL_SEARCH; dx++) {
        const bx = x + dx, bz = z + dz;
        if (!wd.isColumnLoaded(bx >> 4, bz >> 4)) continue;
        for (let y = 1; y < 127; y++) {
          if ((wd.getRaw(bx, y, bz) & 0xff) !== ID.nether_portal) continue;
          if ((wd.getRaw(bx, y - 1, bz) & 0xff) === ID.nether_portal) continue;   // the lowest cell of a column
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = { x: bx, y, z: bz, axisZ: !!((wd.getRaw(bx, y, bz) >> 8) & 1) }; }
        }
      }
    }
    return best;
  }

  /** A spot to build a 4x5 frame (plus a 6x3 platform) near (x, z): the base y of the frame. */
  function chooseBase(x, z, nether) {
    const wd = w();
    if (!nether) {
      const sy = wd.getSurfaceY ? wd.getSurfaceY(x + 0.5, z + 0.5) : 64;
      return Math.max(2, Math.min(118, Number.isFinite(sy) && sy > 0 ? Math.floor(sy) : 64));
    }
    // the Nether: the lowest y above the lava sea with open space for the frame and a floor under it
    let best = -1, bestScore = Infinity;
    for (let y = NETHER_LAVA_Y + 2; y < 110; y++) {
      let blocked = 0;
      for (let dx = -1; dx <= 4; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy < 5; dy++) {
        const id = wd.getRaw(x + dx, y + dy, z + dz) & 0xff;
        if (id !== AIR) blocked++;
      }
      let floor = 0;
      for (let dx = -1; dx <= 4; dx++) for (let dz = -1; dz <= 1; dz++) if (B_SOLID[wd.getRaw(x + dx, y - 1, z + dz) & 0xff]) floor++;
      const score = blocked * 2 + (18 - floor);
      if (score < bestScore) { bestScore = score; best = y; }
      if (score === 0) break;
    }
    return best > 0 ? best : 64;
  }

  /**
   * Build a lit 4x5 portal (axis X) with its base row at y, frame from x..x+3, on a platform; returns its lowest
   * portal cell. In the Nether the platform is bigger (10 x 7) with a see-through railing (nether bricks and glass
   * panes), so a child who steps back from the portal never walks off a ledge into the lava sea (auto-jump would
   * take a 1-high rim); to explore she breaks a pane, flies, or just looks.
   */
  function buildPortal(x, y, z, nether = false) {
    const wd = w();
    const set = (a, b, c, id, st = 0) => wd.setBlock(a, b, c, id, st, { cause: 'portal' });
    const X0 = nether ? -3 : -1, X1 = nether ? 6 : 4, ZR = nether ? 3 : 1;
    wd.beginBatch();
    try {
      // no lava right next to the arrival room
      for (let dx = X0 - 1; dx <= X1 + 1; dx++) for (let dz = -ZR - 1; dz <= ZR + 1; dz++) for (let dy = -1; dy <= 5; dy++) {
        if (B_LIQUID[wd.getRaw(x + dx, y + dy, z + dz) & 0xff] === 2) set(x + dx, y + dy, z + dz, ID.netherrack);
      }
      // room and platform
      for (let dx = X0; dx <= X1; dx++) for (let dz = -ZR; dz <= ZR; dz++) {
        for (let dy = 0; dy < 5; dy++) {
          const id = wd.getRaw(x + dx, y + dy, z + dz) & 0xff;
          if (id !== AIR && id !== ID.bedrock) set(x + dx, y + dy, z + dz, AIR);
        }
        if (!B_SOLID[wd.getRaw(x + dx, y - 1, z + dz) & 0xff]) set(x + dx, y - 1, z + dz, ID.obsidian);
        const rim = dx === X0 || dx === X1 || dz === -ZR || dz === ZR;
        if (nether && rim) { set(x + dx, y, z + dz, ID.nether_bricks); set(x + dx, y + 1, z + dz, ID.glass_pane); }
      }
      if (nether) {
        for (let dx = X0; dx <= X1; dx++) for (let dz = -ZR; dz <= ZR; dz++) {
          if ((wd.getRaw(x + dx, y + 1, z + dz) & 0xff) === ID.glass_pane) set(x + dx, y + 1, z + dz, ID.glass_pane, connectionState(getRaw, x + dx, y + 1, z + dz, ID.glass_pane));
        }
      }
      // frame + sheet
      for (let dy = 0; dy < 5; dy++) { set(x, y + dy, z, ID.obsidian); set(x + 3, y + dy, z, ID.obsidian); }
      for (let dx = 1; dx <= 2; dx++) {
        set(x + dx, y, z, ID.obsidian); set(x + dx, y + 4, z, ID.obsidian);
        for (let dy = 1; dy <= 3; dy++) set(x + dx, y + dy, z, ID.nether_portal, 0);
      }
    } finally { wd.endBatch(); }
    return { x: x + 1, y: y + 1, z, axisZ: false };
  }

  /** Where the child stands after arriving at portal cell `pc`: in front of it if there is room, else inside. */
  function arrivalSpot(pc) {
    const wd = w();
    const free = (a, b, c) => { const i = wd.getRaw(a, b, c) & 0xff; return (i === AIR || i === ID.fire) && !B_LIQUID[i]; };
    // the middle of the sheet along its axis: walk to the far end of this bottom row
    const dx = pc.axisZ ? 0 : 1, dz = pc.axisZ ? 1 : 0;
    let n = 0, m = 0;
    while ((wd.getRaw(pc.x + dx * (n + 1), pc.y, pc.z + dz * (n + 1)) & 0xff) === ID.nether_portal && n < 21) n++;
    while ((wd.getRaw(pc.x - dx * (m + 1), pc.y, pc.z - dz * (m + 1)) & 0xff) === ID.nether_portal && m < 21) m++;
    const mid = (n - m + 1) / 2;   // the middle of the sheet's bottom row
    const cx = pc.x + dx * mid + (pc.axisZ ? 0.5 : 0), cz = pc.z + dz * mid + (pc.axisZ ? 0 : 0.5);
    // feet level: the portal's lowest cell, or one below it (the frame's bottom row stands on the floor)
    for (const side of [1, -1]) for (const fy of [pc.y - 1, pc.y]) {
      const fx = pc.axisZ ? pc.x + side : Math.floor(cx), fz = pc.axisZ ? Math.floor(cz) : pc.z + side;
      if (free(fx, fy, fz) && free(fx, fy + 1, fz) && B_SOLID[wd.getRaw(fx, fy - 1, fz) & 0xff]) {
        const yaw = pc.axisZ ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
        return { x: pc.axisZ ? fx + 0.5 : cx, y: fy, z: pc.axisZ ? cz : fz + 0.5, yaw, inside: false };
      }
    }
    return { x: cx, y: pc.y, z: cz, yaw: game.player ? game.player.yaw : 0, inside: true };
  }

  function travel() {
    const p = game.player;
    if (!p || !game.world || !game.meta) return null;
    const fromNether = isNetherX(p.x);
    const dest = fromNether ? toOverworld(p.x, p.z) : toNether(p.x, p.z);
    ensureArea(dest.x, dest.z);
    let pc = findPortalNear(dest.x, dest.z);
    if (!pc) {
      const y = chooseBase(dest.x, dest.z, !fromNether);
      pc = buildPortal(dest.x, y, dest.z, !fromNether);
    }
    const spot = arrivalSpot(pc);
    charge = 0;
    waitExit = true;            // until she steps out of any portal
    p.teleport(spot.x, spot.y, spot.z, 'portal');
    p.yaw = spot.yaw; p.pitch = 0;
    if (game.input && game.input.noteManualLook) game.input.noteManualLook();
    overlayA = 1;
    const to = fromNether ? 'overworld' : 'nether';
    game.events.emit('nether:travel', { to, x: spot.x, y: spot.y, z: spot.z });
    game.events.emit('sound', { name: 'ui.whoosh', x: spot.x, y: spot.y + 1, z: spot.z });
    return { to, x: spot.x, y: spot.y, z: spot.z };
  }

  return ns;
}
