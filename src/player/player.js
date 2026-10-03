// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). Fields and methods are FROZEN (SPEC §7.5).
//
// Java-accurate movement per tick (SPEC §2.1, LivingEntity.travel at 20 TPS): walk / sprint / sneak (classic) /
// jump (+ sprint-jump boost, 10-tick re-jump delay) / creative flight (double-tap jump in classic, toggleFly in
// both) / swim (+ climb-out-of-water boost) / lava / ladders / step-up / auto-jump / sneak edge protection, fall
// distance + 'player:land', footsteps, water events, the kid streaming flight cap, kid auto-pitch. The camera
// (per frame): interpolated eye, eased FOV (sprint x1.15, fly x1.1), optional view bobbing, hurt tilt, third
// person (behind / front) clipped by a raycast.

import { B_SLIP, B_SOLID, blockDef, getCollisionBoxes as getBoxes } from '../core/registry.js';
import { KID, PHYS, SURVIVAL, TICK_DT } from '../core/constants.js';
import { DEG, clamp, forwardXZ, lerp, lookDir, rightXZ } from '../core/math.js';
import { boxCollides, fluidState, moveAndCollide, onClimbable } from './physics.js';
import { raycast } from './raycast.js';

const STEP_DISTANCE = 1.7;          // blocks walked per footstep event
const AUTO_PITCH_EASE = 0.08;       // per tick, toward KID.AUTO_PITCH_DEG
const JUMP_DELAY_TICKS = 10;        // Java noJumpDelay
const HURT_TILT_TICKS = 10;
const HURT_TILT_DEG = 2;
const THIRD_PERSON_DIST = 4;
const KID_FLY_LIFT = 0.25;
const AUTO_JUMP_PROBES = [0.1, 0.55]; // blocks ahead of the hitbox front edge          // kid scheme: a little hop when flight is switched on while standing

/** @returns {object} Player system (game.player) */
export function createPlayerSystem(game) {
  const fwd = { x: 0, z: 0 }, right = { x: 0, z: 0 };
  const look = { x: 0, y: 0, z: 0 };
  let jumpDelay = 0;
  let lastJumpPressTick = -100, lastForwardPressTick = -100;
  let stepAcc = 0;
  let hurtTilt = 0;                 // ticks remaining
  let renderEye = PHYS.EYE;
  let bob = 0, prevBob = 0, walkDist = 0, prevWalkDist = 0;
  let wasOnGround = false;
  const waterSent = { inWater: false, eyeInWater: false };

  const p = {
    name: 'player',
    // --- body (feet centre, blocks; velocity blocks/tick) ---
    x: 0.5, y: 64, z: 0.5, prevX: 0.5, prevY: 64, prevZ: 0.5,
    vx: 0, vy: 0, vz: 0,
    width: PHYS.WIDTH, height: PHYS.HEIGHT, eyeHeight: PHYS.EYE, stepHeight: PHYS.STEP_HEIGHT,
    onGround: false, collidedH: false, collidedV: false,
    // --- look (radians). yaw 0 = north (-Z), +yaw turns left; pitch + = up ---
    yaw: 0, pitch: 0,
    // --- movement state ---
    flying: false, sneaking: false, sprinting: false,
    inWater: false, eyeInWater: false, inLava: false, onLadder: false,
    fallDistance: 0,
    /** 0 first person, 1 third person behind, 2 third person front */
    view: 0,
    // --- survival state (mutated by FEATURE-MOBS survival.js; read by HUD) ---
    health: SURVIVAL.MAX_HEALTH, maxHealth: SURVIVAL.MAX_HEALTH,
    food: SURVIVAL.MAX_FOOD, saturation: SURVIVAL.START_SATURATION, exhaustion: 0,
    air: SURVIVAL.MAX_AIR, xp: 0, xpLevel: 0, xpProgress: 0,
    dead: false, hurtTime: 0, fireTicks: 0,
    /** active effects: name -> {level, ticks} */
    effects: {},
    /** entity id being ridden (pig/horse/boat) or null (P1, FEATURE-MOBS drives the mount) */
    riding: null,
    /** true while lying in a bed (FEATURE-MECH) - movement disabled */
    sleeping: false,
    spawnPoint: { x: 0.5, y: 64, z: 0.5 },
    // --- render-time (interpolated) values written each frame ---
    renderX: 0.5, renderY: 64, renderZ: 0.5,
    /** arm swing ticks remaining (6 -> 0); FEATURE-FX view model reads it; set by interaction via swing() */
    swingTicks: 0,
    /** current eased camera FOV (degrees) */
    fov: PHYS.FOV,

    init() {
      game.events.on('player:hurt', (e) => { if (e && e.amount > 0) hurtTilt = HURT_TILT_TICKS; });
      // UI-style one-shot actions react immediately (every press counts, even two in one tick)
      game.events.on('input:action', (e) => {
        if (!e || !e.down || game.state !== 'playing' || !game.world || !game.world.isOpen) return;
        if (game.input && game.input.isCaptured && game.input.isCaptured()) return;
        if (e.action === 'toggleView') { p.view = (p.view + 1) % 3; game.events.emit('player:view', { view: p.view }); }
        else if (e.action === 'toggleFly' && !p.dead && !p.sleeping && p.riding == null) p.setFlying(!p.flying);
      });
      game.events.on('world:exit', () => { p.riding = null; p.sleeping = false; p.flying = false; });
    },

    /** Place the player at a spawn point (new world / respawn): resets velocity, fall distance. */
    spawn(x, y, z, yaw = 0, pitch = 0) {
      p.x = p.prevX = p.renderX = x; p.y = p.prevY = p.renderY = y; p.z = p.prevZ = p.renderZ = z;
      p.vx = p.vy = p.vz = 0; p.fallDistance = 0; p.yaw = yaw; p.pitch = pitch;
      p.dead = false; p.onGround = false; p.collidedH = false; p.collidedV = false;
      p.sprinting = false; p.sneaking = false; p.height = PHYS.HEIGHT; p.eyeHeight = PHYS.EYE; renderEye = PHYS.EYE;
      jumpDelay = 0; stepAcc = 0;
    },

    /** Move instantly (Home button, unstuck, void rescue, tests). Emits 'player:teleport' {x,y,z,reason}. */
    teleport(x, y, z, reason = 'teleport') {
      p.x = p.prevX = p.renderX = x; p.y = p.prevY = p.renderY = y; p.z = p.prevZ = p.renderZ = z;
      p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
      game.events.emit('player:teleport', { x, y, z, reason });
    },

    /** Eye position (interpolated when `render` is true). */
    getEyePos(out = { x: 0, y: 0, z: 0 }, render = false) {
      out.x = render ? p.renderX : p.x; out.y = (render ? p.renderY + renderEye : p.y + p.eyeHeight); out.z = render ? p.renderZ : p.z;
      return out;
    },
    /** Unit look vector. */
    getLookDir(out) { return lookDir(p.yaw, p.pitch, out); },

    /** Creative flight on/off. Emits 'player:fly' {flying}. */
    setFlying(f) {
      f = !!f && p.canFly();
      if (f === p.flying) return;
      p.flying = f;
      if (f) {
        p.sprinting = false; setSneaking(false);
        // kid feedback: a small lift so "flying" is visible at once (Java gives none)
        if (p.onGround && game.input && game.input.scheme === 'kid') p.vy = Math.max(p.vy, KID_FLY_LIFT);
        p.fallDistance = 0;
      }
      game.events.emit('player:fly', { flying: f });
    },
    canFly() { return game.isCreative(); },

    /** Start an arm swing (break/place/attack). */
    swing() { p.swingTicks = 6; game.events.emit('player:swing', {}); },

    tick() {
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
      prevBob = bob; prevWalkDist = walkDist;
      if (p.swingTicks > 0) p.swingTicks--;
      if (hurtTilt > 0) hurtTilt--;
      if (jumpDelay > 0) jumpDelay--;
      const world = game.world;
      if (!world || !world.isOpen) return;
      const input = game.input;
      const kid = input.scheme !== 'classic';
      const tick = game.tickCount;

      // ---- one-shot actions (toggleView / toggleFly arrive through 'input:action', see init)
      if (p.dead || p.sleeping) { p.vx = p.vz = 0; p.vy = 0; setSprinting(false); return; }
      if (p.riding !== null && p.riding !== undefined) { tickRiding(kid); return; }
      // the column under the player is not loaded yet (teleport / Home far away): wait in place, like Java
      if (world.isColumnLoaded && !world.isColumnLoaded(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4)) {
        p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
        return;
      }
      if (!kid && input.wasPressed('jump')) {
        if (tick - lastJumpPressTick <= PHYS.DOUBLE_TAP_TICKS && p.canFly()) { p.setFlying(!p.flying); lastJumpPressTick = -100; }
        else lastJumpPressTick = tick;
      }
      if (p.flying && !p.canFly()) p.setFlying(false);

      // ---- sneaking (classic only; kid scheme never slows the child down) and pose
      setSneaking(!kid && !p.flying && input.isDown('sneak'));

      // ---- fluids / ladder state (before the move, like Java's baseTick)
      updateFluids(world);
      p.onLadder = !p.flying && onClimbable(world, p);
      if (p.inWater || p.onLadder || p.flying) p.fallDistance = 0;

      // ---- sprint (classic only)
      updateSprint(kid, tick);

      // ---- 1. input
      let f = input.move.forward, s = kid ? 0 : input.move.strafe;
      f *= PHYS.INPUT_SCALE; s *= PHYS.INPUT_SCALE;
      if (p.sneaking && p.onGround) { f *= PHYS.SNEAK_MULT; s *= PHYS.SNEAK_MULT; }
      const m2 = f * f + s * s;
      if (m2 > 1) { const n = Math.sqrt(m2); f /= n; s /= n; }

      // ---- 2. acceleration (friction from the block under the feet, chosen before the move like Java)
      const slip = groundSlip(world);
      const onGround0 = p.onGround;
      let a;
      if (p.flying) a = PHYS.FLY_ACCEL * (p.sprinting ? PHYS.FLY_SPRINT_MULT : 1);
      else if (p.inWater) a = PHYS.WATER_ACCEL;
      else if (p.inLava) a = PHYS.WATER_ACCEL;
      else if (onGround0) a = PHYS.WALK_SPEED * (p.sprinting ? PHYS.SPRINT_MULT : 1) * (0.216 / (slip * slip * slip));
      else a = p.sprinting ? PHYS.AIR_ACCEL_SPRINT : PHYS.AIR_ACCEL;

      // ---- 3. apply acceleration
      forwardXZ(p.yaw, fwd); rightXZ(p.yaw, right);
      p.vx += (s * right.x + f * fwd.x) * a;
      p.vz += (s * right.z + f * fwd.z) * a;

      // ---- 4. vertical intent
      const jumpHeld = input.isDown('jump');
      if (!jumpHeld) jumpDelay = 0;
      let vyMove = p.vy;
      if (p.flying) {
        if (jumpHeld) vyMove += PHYS.FLY_VERTICAL;
        if (input.isDown('descend') || (!kid && input.isDown('sneak'))) vyMove -= PHYS.FLY_VERTICAL;
      } else if ((p.inWater || p.inLava) && jumpHeld) {
        p.vy += PHYS.WATER_SWIM_UP; vyMove = p.vy;
      } else if (onGround0 && jumpHeld && jumpDelay === 0) {
        doJump();
        vyMove = p.vy;
      } else if (onGround0 && !p.inWater && !p.inLava && f > 0 && game.settings.autoJump && !p.sneaking && shouldAutoJump(world, f, s)) {
        doJump();
        vyMove = p.vy;
      }

      // ---- 5. ladder
      if (p.onLadder) {
        p.vx = clamp(p.vx, -PHYS.LADDER_MAX_H, PHYS.LADDER_MAX_H);
        p.vz = clamp(p.vz, -PHYS.LADDER_MAX_H, PHYS.LADDER_MAX_H);
        p.vy = Math.max(p.vy, -PHYS.LADDER_MAX_DOWN);
        if (p.sneaking) p.vy = Math.max(p.vy, 0);
        vyMove = p.vy;
      }

      // ---- 11a. kid streaming guard: never outrun terrain streaming while flying
      if (kid && p.flying && world.unmeshedWithin) {
        let backlog = 0;
        try { backlog = world.unmeshedWithin(Math.max(1, (world.renderDistance || 6) - 1)); } catch { backlog = 0; }
        if (backlog > KID.STREAM_BACKLOG_COLUMNS) {
          const hs = Math.hypot(p.vx, p.vz);
          if (hs > KID.STREAM_FLY_CAP) { const k = KID.STREAM_FLY_CAP / hs; p.vx *= k; p.vz *= k; }
        }
      }

      // ---- 6. move
      const y0 = p.y;
      const sneakEdge = !kid && p.sneaking && onGround0 && !p.flying;
      const ox = p.x, oz = p.z;
      const res = moveAndCollide(world, p, p.vx, vyMove, p.vz, { sneakEdge });
      const mdx = res.dx, mdy = res.dy, mdz = res.dz;
      const blockedX = Math.abs(mdx - p.vx) > 1e-9, blockedZ = Math.abs(mdz - p.vz) > 1e-9;

      // ---- 9. collision response: a blocked axis loses its velocity
      if (blockedX) p.vx = 0;
      if (blockedZ) p.vz = 0;
      if (p.collidedV && !p.flying) p.vy = 0;

      // ---- 7. ladder climb (Java: horizontal collision OR jumping while on a ladder)
      if (p.onLadder && (p.collidedH || jumpHeld) && !p.flying) p.vy = PHYS.LADDER_CLIMB;
      // climb out of water / lava onto a ledge (Java travel: horizontal collision + free space 0.6 higher)
      if ((p.inWater || p.inLava) && p.collidedH && !p.flying) {
        const hw = p.width / 2, dy = p.vy + 0.6 - (p.y - y0);
        if (!boxCollides(world, p.x - hw + p.vx, p.y + dy, p.z - hw + p.vz, p.x + hw + p.vx, p.y + dy + p.height, p.z + hw + p.vz) && !fluidAt(world, p.x + p.vx, p.y + dy, p.z + p.vz)) p.vy = 0.3;
      }

      // ---- 8. drag and gravity
      if (p.flying) {
        p.vy = vyMove * PHYS.FLY_VDRAG;
        p.vx *= PHYS.AIR_DRAG; p.vz *= PHYS.AIR_DRAG;
      } else if (p.inWater) {
        p.vx *= PHYS.WATER_DRAG; p.vy *= PHYS.WATER_DRAG; p.vz *= PHYS.WATER_DRAG;
        p.vy -= PHYS.WATER_SINK;
      } else if (p.inLava) {
        p.vx *= PHYS.LAVA_DRAG; p.vy *= PHYS.LAVA_DRAG; p.vz *= PHYS.LAVA_DRAG;
        p.vy -= PHYS.LAVA_GRAVITY;
      } else {
        p.vy = (p.vy - PHYS.GRAVITY) * PHYS.VDRAG;
        const fr = onGround0 ? slip * PHYS.AIR_DRAG : PHYS.AIR_DRAG;
        p.vx *= fr; p.vz *= fr;
      }
      if (Math.abs(p.vx) < PHYS.VEL_EPS) p.vx = 0;
      if (Math.abs(p.vy) < PHYS.VEL_EPS) p.vy = 0;
      if (Math.abs(p.vz) < PHYS.VEL_EPS) p.vz = 0;
      if (p.vy < -PHYS.TERMINAL) p.vy = -PHYS.TERMINAL;

      // ---- 10. falling + landing
      if (!p.onGround && mdy < 0 && !p.inWater && !p.onLadder && !p.flying) p.fallDistance -= mdy;
      if (p.onGround && !wasOnGround) {
        const bid = landedBlock(world);
        game.events.emit('player:land', { fallDistance: p.fallDistance, x: p.x, y: p.y, z: p.z, blockId: bid });
      }
      if (p.onGround) p.fallDistance = 0;
      // ---- 11. landing ends flight
      if (p.flying && p.onGround && vyMove < 0) p.setFlying(false);
      wasOnGround = p.onGround;
      // sprint stops on horizontal collision
      if (p.sprinting && p.collidedH) setSprinting(false);

      // ---- 13. footsteps
      const hd = Math.hypot(p.x - ox, p.z - oz);
      if (p.onGround && !p.flying && hd > 0) {
        stepAcc += hd;
        if (stepAcc >= STEP_DISTANCE) {
          stepAcc -= STEP_DISTANCE;
          const bid = landedBlock(world);
          const def = blockDef(bid);
          game.events.emit('player:step', { x: p.x, y: p.y, z: p.z, blockId: bid, sound: def ? def.sound : 'stone' });
        }
      }
      // view-bobbing bookkeeping (Java: walkDist + bob ease)
      walkDist += hd * 0.6;
      const targetBob = p.onGround && !p.flying ? Math.min(0.1, hd) : 0;
      bob += (targetBob - bob) * 0.4;

      // ---- kid auto-pitch: ease toward -12 deg while walking with no manual look for 1.5 s
      if (kid && game.settings.autoPitch && p.onGround && !p.flying && Math.abs(input.move.forward) > 0.01 &&
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - (input.lastManualLookMs || 0) > KID.AUTO_PITCH_DELAY_TICKS * TICK_DT * 1000) {
        const target = KID.AUTO_PITCH_DEG * DEG;
        p.pitch += (target - p.pitch) * AUTO_PITCH_EASE;
      }

      // ---- 14. water events (after the move; compared with what was last announced)
      updateFluids(world);
      if (waterSent.inWater !== p.inWater || waterSent.eyeInWater !== p.eyeInWater) {
        waterSent.inWater = p.inWater; waterSent.eyeInWater = p.eyeInWater;
        game.events.emit('player:water', { inWater: p.inWater, eyeInWater: p.eyeInWater });
      }
    },

    frame(g, dt, alpha) {
      const input = game.input;
      const ld = input.lookDelta;
      p.yaw += ld.yaw; p.pitch = clamp(p.pitch + ld.pitch, -PHYS.PITCH_LIMIT, PHYS.PITCH_LIMIT);
      ld.yaw = 0; ld.pitch = 0;
      if (p.yaw > Math.PI * 4 || p.yaw < -Math.PI * 4) p.yaw %= Math.PI * 2;
      p.renderX = lerp(p.prevX, p.x, alpha); p.renderY = lerp(p.prevY, p.y, alpha); p.renderZ = lerp(p.prevZ, p.z, alpha);
      renderEye += (p.eyeHeight - renderEye) * (1 - Math.pow(0.5, dt * 20));
      if (Math.abs(renderEye - p.eyeHeight) < 1e-3) renderEye = p.eyeHeight;
      // FOV ease (SPEC §2.1 camera)
      const target = (game.settings.fov || PHYS.FOV) * (p.sprinting ? PHYS.FOV_SPRINT : 1) * (p.flying ? PHYS.FOV_FLY : 1);
      p.fov += (target - p.fov) * (1 - Math.pow(0.5, dt * 20));
      if (Math.abs(target - p.fov) < 0.01) p.fov = target;
      const cam = game.renderer && game.renderer.camera;
      if (!cam) return;
      let cx = p.renderX, cy = p.renderY + renderEye, cz = p.renderZ;
      let yaw = p.yaw, pitch = p.pitch, roll = 0;
      // hurt tilt (2 deg roll decaying over 10 ticks)
      if (hurtTilt > 0) roll += HURT_TILT_DEG * DEG * (hurtTilt / HURT_TILT_TICKS);
      // view bobbing
      if (game.settings.viewBobbing && p.view === 0) {
        const wd = lerp(prevWalkDist, walkDist, alpha) * Math.PI, b = lerp(prevBob, bob, alpha);
        rightXZ(p.yaw, right);
        const side = Math.sin(wd) * b * 0.5;
        cx += right.x * side; cz += right.z * side;
        cy -= Math.abs(Math.cos(wd) * b);
        roll += Math.sin(wd) * b * 3 * DEG;
        pitch -= Math.abs(Math.cos(wd - 0.2) * b) * 5 * DEG;
      }
      // third person: 4 blocks behind (1) / in front (2) along the look ray, clipped 0.2 before solid blocks
      if (p.view !== 0) {
        lookDir(p.yaw, p.pitch, look);
        const sgn = p.view === 1 ? -1 : 1;
        let dist = THIRD_PERSON_DIST;
        const world = game.world;
        if (world && world.isOpen) {
          const hit = raycast(world, cx, cy, cz, look.x * sgn, look.y * sgn, look.z * sgn, THIRD_PERSON_DIST, { filter: (id) => B_SOLID[id] === 1 });
          if (hit) dist = Math.max(0, hit.dist - 0.2);
        }
        cx += look.x * sgn * dist; cy += look.y * sgn * dist; cz += look.z * sgn * dist;
        if (p.view === 2) { yaw += Math.PI; pitch = -pitch; }
      }
      cam.position.set(cx, cy, cz);
      cam.rotation.set(pitch, yaw, roll, 'YXZ');
      if (Math.abs(cam.fov - p.fov) > 1e-3) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
    },

    serialize() {
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying, view: p.view, spawnPoint: p.spawnPoint };
    },
    deserialize(g, d) {
      p.riding = null; p.sleeping = false; p.view = 0; p.flying = false; p.fov = game.settings.fov || PHYS.FOV;
      hurtTilt = 0; wasOnGround = false;
      if (!d) return;
      p.spawn(d.x, d.y, d.z, d.yaw || 0, d.pitch || 0);
      p.flying = !!d.flying && game.isCreative(); p.view = d.view || 0;
      if (d.spawnPoint) p.spawnPoint = d.spawnPoint;
    },
  };

  /* ------------------------------------------------------------------ helpers */
  function setSprinting(v) {
    if (v === p.sprinting) return;
    p.sprinting = v;
    game.events.emit('player:sprint', { sprinting: v });
  }

  function setSneaking(want) {
    const world = game.world;
    if (!want && p.sneaking && world && world.isOpen) {
      // stay crouched under a low ceiling (no room to stand up)
      const hw = p.width / 2;
      if (boxCollides(world, p.x - hw, p.y, p.z - hw, p.x + hw, p.y + PHYS.HEIGHT, p.z + hw)) want = true;
    }
    p.sneaking = want;
    p.height = want ? PHYS.SNEAK_HEIGHT : PHYS.HEIGHT;
    p.eyeHeight = want ? PHYS.SNEAK_EYE : PHYS.EYE;
  }

  function hungerTooLow() {
    return !game.isCreative() && game.meta && game.meta.rules && game.meta.rules.hunger && p.food <= 6;
  }

  function updateSprint(kid, tick) {
    const input = game.input;
    if (kid || p.sneaking) { setSprinting(false); return; }
    const fwdHeld = input.move.forward > 0.8;
    if (input.wasPressed('forward')) {
      if (tick - lastForwardPressTick <= PHYS.DOUBLE_TAP_TICKS && !hungerTooLow()) setSprinting(true);
      lastForwardPressTick = tick;
    }
    if (!p.sprinting && fwdHeld && input.isDown('sprint') && !hungerTooLow() && !p.collidedH) setSprinting(true);
    if (p.sprinting && (!fwdHeld || hungerTooLow())) setSprinting(false);
  }

  function doJump() {
    p.vy = PHYS.JUMP_VELOCITY;
    if (p.sprinting) { p.vx += fwd.x * PHYS.SPRINT_JUMP_BOOST; p.vz += fwd.z * PHYS.SPRINT_JUMP_BOOST; }
    jumpDelay = JUMP_DELAY_TICKS;
    game.events.emit('player:jump', { sprint: !!p.sprinting });
  }

  function updateFluids(world) {
    const fs = fluidState(world, p, p.eyeHeight);
    p.inWater = fs.inWater;
    p.eyeInWater = fs.eyeInWater;
    p.inLava = fs.lava && !fs.inWater;
  }

  function fluidAt(world, x, y, z) {
    const fs = fluidState(world, { x, y, z, width: p.width, height: p.height }, 0);
    return fs.inWater || fs.lava;
  }

  /** Slipperiness of the block that affects movement (Java: y - 0.5000001 below the feet). */
  function groundSlip(world) {
    const id = world.getRaw(Math.floor(p.x), Math.floor(p.y - 0.5000001), Math.floor(p.z)) & 0xff;
    return id ? B_SLIP[id] || PHYS.GROUND_SLIP : PHYS.GROUND_SLIP;
  }

  /** Block the feet stand on (y - 0.2, else one lower for fences / walls). */
  function landedBlock(world) {
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    let id = world.getRaw(bx, Math.floor(p.y - 0.2), bz) & 0xff;
    if (!id) id = world.getRaw(bx, Math.floor(p.y - 1.2), bz) & 0xff;
    return id;
  }

  /**
   * Auto-jump (SPEC §2.1 step 4): the next cell in the move direction at feet level has a collision top
   * above the step height but at most 1.0 above the feet, with room to stand on it and room to jump here.
   */
  function shouldAutoJump(world, f, s) {
    const dx = s * right.x + f * fwd.x, dz = s * right.z + f * fwd.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return false;
    const ux = dx / len, uz = dz / len;
    const hw = p.width / 2;
    // probe just past the front edge of the hitbox, near and a little further (a jump needs ~3 ticks to clear 1.0)
    for (const ahead of AUTO_JUMP_PROBES) {
      const px = p.x + ux * (hw + ahead), pz = p.z + uz * (hw + ahead);
      const fy = Math.floor(p.y + 1e-4);
      let top = -Infinity, firstY = -1;
      for (let y = fy; y <= fy + 1; y++) {
        const v = world.getRaw(Math.floor(px), y, Math.floor(pz)), id = v & 0xff;
        if (!B_SOLID[id]) continue;
        const boxes = getBoxes(id, v >> 8);
        for (const b of boxes) if (y + b[4] > top) { top = y + b[4]; firstY = y; }
      }
      if (firstY < 0) continue;
      if (!(top > p.y + p.stepHeight + 1e-4 && top <= p.y + 1.0 + 1e-4)) return false;
      // room to jump where we stand, and to stand on top over there
      if (boxCollides(world, p.x - hw, p.y + 0.01, p.z - hw, p.x + hw, top + p.height, p.z + hw)) return false;
      const cx = Math.floor(px) + 0.5, cz = Math.floor(pz) + 0.5;
      return !boxCollides(world, cx - hw, top + 0.01, cz - hw, cx + hw, top + p.height, cz + hw);
    }
    return false;
  }

  function tickRiding(kid) {
    const input = game.input;
    const mount = game.entities && game.entities.get ? game.entities.get(p.riding) : null;
    if (!mount || mount.removed || input.wasPressed('descend') || (!kid && input.wasPressed('sneak'))) {
      p.riding = null;
      p.vx = p.vy = p.vz = 0;
      if (mount && !mount.removed) {
        const hw = p.width / 2;
        const ny = mount.y + (mount.height || 1);
        if (!boxCollides(game.world, mount.x - hw, ny, mount.z - hw, mount.x + hw, ny + p.height, mount.z + hw)) { p.x = mount.x; p.y = ny; p.z = mount.z; }
      }
      return;
    }
    const seat = mount.getSeat ? mount.getSeat() : { x: mount.x, y: mount.y + (mount.height || 1) * 0.75, z: mount.z };
    p.x = seat.x; p.y = seat.y; p.z = seat.z;
    p.vx = p.vy = p.vz = 0; p.fallDistance = 0; p.onGround = false;
    wasOnGround = false;
  }

  return p;
}
