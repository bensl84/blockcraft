// OWNER LANE: KID. Pure helpers for the kid system (no DOM, no CSS) - unit-tested in test/kid.test.mjs.
// Angles follow SPEC §3.7: yaw 0 looks north (-Z), +yaw turns left; look = (-sin yaw, ., -cos yaw).

import { KID } from '../core/constants.js';

/** Void rescue also triggers this many blocks below the lowest terrain of the column (SPEC §2.7). */
export const VOID_BELOW_TERRAIN = 10;

const TAU = Math.PI * 2;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Yaw (radians) that looks from (x, z) toward (tx, tz). */
export function yawToward(x, z, tx, tz) { return Math.atan2(-(tx - x), -(tz - z)); }

/**
 * Home arrow: angle of the home direction relative to the view, radians. 0 = straight ahead, + = to the left
 * (same sense as yaw). CSS rotation for an arrow drawn pointing up is `-rel` (clockwise positive).
 */
export function homeArrowAngle(px, pz, yaw, hx, hz) { return wrapAngle(yawToward(px, pz, hx, hz) - yaw); }

/** Horizontal distance. */
export function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

/** Distance over which the border fog thickens before the soft border (blocks). */
export const BORDER_FOG_RAMP = 32;
/** Push-back speed outside the border (blocks per tick, SPEC §2.7). */
export const BORDER_PUSH = 0.1;

/**
 * Soft world border (circle of `radius` around the spawn). Returns {dist, over, nx, nz, fogT}:
 * nx/nz = unit vector from the player toward the spawn, over = how far outside (blocks), fogT 0..1.
 */
export function borderState(px, pz, sx, sz, radius, out = {}) {
  const dx = px - sx, dz = pz - sz;
  const d = Math.hypot(dx, dz);
  out.dist = d;
  out.over = radius > 0 ? Math.max(0, d - radius) : 0;
  out.nx = d > 1e-6 ? -dx / d : 0;
  out.nz = d > 1e-6 ? -dz / d : 0;
  out.fogT = radius > 0 ? Math.max(0, Math.min(1, (d - (radius - BORDER_FOG_RAMP)) / BORDER_FOG_RAMP)) : 0;
  return out;
}

/** Thickening fog for the border: interpolate from the normal fog to a close fog wall. */
export function borderFog(t, renderFar, out = {}) {
  const far = renderFar + (18 - renderFar) * t;
  const near = Math.max(1, far * (0.6 - 0.5 * t));
  out.near = near; out.far = far;
  return out;
}

/**
 * Void rescue rule: feet below KID.VOID_RESCUE_Y, or 10 blocks below the lowest terrain of the column
 * (lowestSolid = lowest y with a solid block, -1 if unknown/none).
 */
export function needsVoidRescue(y, lowestSolid = -1) {
  if (y < KID.VOID_RESCUE_Y) return true;
  return lowestSolid >= 0 && y < lowestSolid - VOID_BELOW_TERRAIN;
}

/**
 * Stuck detector (SPEC §2.7): pressing move for 3 s without moving while enclosed at head height -> stuck
 * (pulse the Up button). Head inside an opaque block -> stuck after 0.5 s and auto-pop after 2 s.
 * While stuck, holding Jump for 1 s pops. Pure: call update() once per tick with the sampled state.
 */
export const STUCK = Object.freeze({ PUSH_TICKS: 60, MOVE_EPS: 0.5, HEAD_TICKS: 10, HEAD_AUTO_POP_TICKS: 40, JUMP_HOLD_TICKS: 20 });

export class StuckDetector {
  constructor() { this.reset(); }
  reset() {
    this.stuck = false; this.reason = null;
    this.pushTicks = 0; this.anchorX = 0; this.anchorZ = 0; this.headTicks = 0; this.jumpTicks = 0;
  }
  /**
   * @param {{x:number, z:number, pushing:boolean, enclosed:boolean, headInBlock:boolean, jumpDown:boolean}} s
   * @returns {null|'stuck'|'free'|'pop'} what changed this tick
   */
  update(s) {
    // head inside a block (suffocation): independent of input
    this.headTicks = s.headInBlock ? this.headTicks + 1 : 0;
    // pushing against walls while enclosed
    if (s.pushing && s.enclosed) {
      if (this.pushTicks === 0) { this.anchorX = s.x; this.anchorZ = s.z; }
      if (Math.hypot(s.x - this.anchorX, s.z - this.anchorZ) > STUCK.MOVE_EPS) { this.pushTicks = 1; this.anchorX = s.x; this.anchorZ = s.z; }
      else this.pushTicks++;
    } else if (!s.enclosed) this.pushTicks = 0;
    // (not pushing but still enclosed: keep the count, a child often lets go and tries again)

    const wasStuck = this.stuck;
    if (!this.stuck) {
      if (this.headTicks >= STUCK.HEAD_TICKS) { this.stuck = true; this.reason = 'suffocate'; }
      else if (this.pushTicks >= STUCK.PUSH_TICKS) { this.stuck = true; this.reason = 'enclosed'; }
    } else if (!s.headInBlock && !s.enclosed) {
      this.reset();
      return 'free';
    }
    if (this.stuck) {
      this.jumpTicks = s.jumpDown ? this.jumpTicks + 1 : 0;
      if (this.jumpTicks >= STUCK.JUMP_HOLD_TICKS || this.headTicks >= STUCK.HEAD_AUTO_POP_TICKS) return 'pop';
    }
    return !wasStuck && this.stuck ? 'stuck' : null;
  }
}

/**
 * Pick a speech voice: local voices only (SPEC §8.5.2 - never a network voice). Prefers the page language,
 * then any English voice, then the default local voice. Returns null when there is no local voice.
 */
export function pickVoice(voices, lang = 'en-US') {
  const local = (voices || []).filter((v) => v && v.localService);
  if (!local.length) return null;
  const l = String(lang || 'en').toLowerCase();
  const base = l.split('-')[0];
  return local.find((v) => String(v.lang).toLowerCase() === l)
    || local.find((v) => String(v.lang).toLowerCase().startsWith(base))
    || local.find((v) => String(v.lang).toLowerCase().startsWith('en'))
    || local.find((v) => v.default)
    || local[0];
}

/** Onboarding hints in order (SPEC §2.7). */
export const HINT_ORDER = Object.freeze(['walk', 'turn', 'place', 'break', 'pick', 'fly']);
export const HINT = Object.freeze({
  IDLE_TICKS: 140,        // 7 s without progress (SPEC: 6-8 s)
  LOOP_TICKS: 48,         // one animation loop (2.4 s, matches kid.css)
  MAX_LOOPS: 3,           // per hint per session
});

/**
 * Hint scheduler (pure). tick() returns the name of a hint to show, or null. The caller reports progress
 * (done(name), activity()) and calls loopDone() each time a visible hint finished one animation loop.
 */
export class HintPlan {
  constructor() {
    this.done = new Set();
    this.loops = new Map();     // name -> loops used (session)
    this.shown = new Set();     // ever shown (success sparkle + chime only for these)
    this.idle = 0;
    this.current = null;
    this.currentTicks = 0;
  }
  /** Next hint that is not done and still has loops left; canFly=false skips 'fly'. */
  next(canFly = true) {
    for (const n of HINT_ORDER) {
      if (this.done.has(n) || (n === 'fly' && !canFly)) continue;
      if ((this.loops.get(n) || 0) >= HINT.MAX_LOOPS) continue;
      return n;
    }
    return null;
  }
  /**
   * One tick. `allowed` = hints may show now (setting on, playing, no screen). Returns
   * {show: name|null, hide: bool} for the caller's DOM.
   */
  tick(allowed, canFly = true) {
    const r = { show: null, hide: false };
    if (!allowed) {
      if (this.current) { this.current = null; r.hide = true; }
      this.idle = 0;
      return r;
    }
    if (this.current) {
      this.currentTicks++;
      if (this.currentTicks % HINT.LOOP_TICKS === 0) {
        const used = (this.loops.get(this.current) || 0) + 1;
        this.loops.set(this.current, used);
        if (used >= HINT.MAX_LOOPS) { this.current = null; this.idle = 0; r.hide = true; }
      }
      return r;
    }
    this.idle++;
    if (this.idle >= HINT.IDLE_TICKS) {
      const n = this.next(canFly);
      this.idle = 0;
      if (n) { this.current = n; this.currentTicks = 0; this.shown.add(n); r.show = n; }
    }
    return r;
  }
  /** The child did `name`. Returns {first, wasShown, hide}. */
  complete(name) {
    const first = !this.done.has(name);
    this.done.add(name);
    const hide = this.current === name;
    if (first) this.idle = 0;
    if (hide) this.current = null;
    return { first, wasShown: this.shown.has(name), hide };
  }
  /** Building counts as progress (resets the idle timer without completing a hint). */
  activity() { this.idle = 0; }
}
