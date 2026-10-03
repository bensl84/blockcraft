// OWNER LANE: CORE-E (player/physics/input/raycast/interaction). STUB written by LEAD - fields and methods
// are FROZEN (SPEC §7.5); replace the internals: Java-accurate movement per tick (walk/sprint/sneak/
// jump/fly/swim/ladder/step/auto-jump/edge protection), camera (interpolation, FOV ease, bobbing,
// hurt tilt, third person), footsteps + fall events.
//
// Stub behaviour: the player stands where spawned; look deltas from input rotate the camera.

import { registerStub } from '../core/stubs.js';
import { PHYS, SURVIVAL } from '../core/constants.js';
import { lerp, lookDir } from '../core/math.js';

registerStub('player');

/** @returns {object} Player system (game.player) */
export function createPlayerSystem(game) {
  const p = {
    name: 'player',
    stub: true,
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
    /** arm swing progress 0..1 (FEATURE-FX view model reads it); set by interaction via swing() */
    swingTicks: 0,

    init() {},

    /** Place the player at a spawn point (new world / respawn): resets velocity, fall distance. */
    spawn(x, y, z, yaw = 0, pitch = 0) {
      p.x = p.prevX = p.renderX = x; p.y = p.prevY = p.renderY = y; p.z = p.prevZ = p.renderZ = z;
      p.vx = p.vy = p.vz = 0; p.fallDistance = 0; p.yaw = yaw; p.pitch = pitch;
      p.dead = false;
    },

    /** Move instantly (Home button, unstuck, void rescue, tests). Emits 'player:teleport' {x,y,z,reason}. */
    teleport(x, y, z, reason = 'teleport') {
      p.x = p.prevX = x; p.y = p.prevY = y; p.z = p.prevZ = z;
      p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
      game.events.emit('player:teleport', { x, y, z, reason });
    },

    /** Eye position (interpolated when `render` is true). */
    getEyePos(out = { x: 0, y: 0, z: 0 }, render = false) {
      out.x = render ? p.renderX : p.x; out.y = (render ? p.renderY : p.y) + p.eyeHeight; out.z = render ? p.renderZ : p.z;
      return out;
    },
    /** Unit look vector. */
    getLookDir(out) { return lookDir(p.yaw, p.pitch, out); },

    /** Creative flight on/off. Emits 'player:fly' {flying}. */
    setFlying(f) {
      f = !!f && p.canFly();
      if (f === p.flying) return;
      p.flying = f;
      game.events.emit('player:fly', { flying: f });
    },
    canFly() { return game.isCreative(); },

    /** Start an arm swing (break/place/attack). */
    swing() { p.swingTicks = 6; game.events.emit('player:swing', {}); },

    tick() {
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
      if (p.swingTicks > 0) p.swingTicks--;
    },

    frame(g, dt, alpha) {
      const ld = game.input.lookDelta;
      p.yaw += ld.yaw; p.pitch = Math.max(-PHYS.PITCH_LIMIT, Math.min(PHYS.PITCH_LIMIT, p.pitch + ld.pitch));
      ld.yaw = 0; ld.pitch = 0;
      p.renderX = lerp(p.prevX, p.x, alpha); p.renderY = lerp(p.prevY, p.y, alpha); p.renderZ = lerp(p.prevZ, p.z, alpha);
      const cam = game.renderer && game.renderer.camera;
      if (cam) {
        cam.position.set(p.renderX, p.renderY + p.eyeHeight, p.renderZ);
        cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
        if (cam.fov !== game.settings.fov) { cam.fov = game.settings.fov; cam.updateProjectionMatrix(); }
      }
    },

    serialize() {
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying, view: p.view, spawnPoint: p.spawnPoint };
    },
    deserialize(g, d) {
      if (!d) return;
      p.spawn(d.x, d.y, d.z, d.yaw || 0, d.pitch || 0);
      p.flying = !!d.flying; p.view = d.view || 0;
      if (d.spawnPoint) p.spawnPoint = d.spawnPoint;
    },
  };
  return p;
}
