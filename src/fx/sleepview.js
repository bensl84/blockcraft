// OWNER LANE: FEATURE-FX. The lying-down view while sleeping (judge finding FID-13): on 'sleep:start' the camera
// glides down to the bed's pillow, looking up and along the bed toward its foot, while FX fades the screen; on
// 'sleep:end' (under the black of the wake-up fade) the camera returns to the player's eye.
//
// FX's frame() runs after the player lane's (which writes the standing eye to renderer.camera) and before the
// renderer draws, so this only overrides the camera for the frames it is active; the player's own yaw / pitch /
// position are never touched. bedCameraPose() is pure and unit tested.

import { FACING_DIRS } from '../core/constants.js';
import { ID } from '../core/registry.js';

const BED_HEAD_BIT = 4;          // bed state bit 2 = head part (data/blocks.js)
const PILLOW_EYE = 0.5625 + 0.22; // bed top (9/16) + a head lying on the pillow
const LOOK_UP = 14 * Math.PI / 180;   // up a little: the blanket and the bed foot stay at the bottom of the view
const GLIDE_S = 0.7;

/**
 * Camera pose for sleeping in the bed whose part is at (x, y, z): {x, y, z, yaw, pitch} in radians (yaw 0 = north,
 * + turns left; pitch + = up), or null when there is no bed there.
 * @param {(x:number,y:number,z:number)=>number} getRaw
 */
export function bedCameraPose(getRaw, x, y, z) {
  const raw = getRaw(x, y, z);
  if ((raw & 0xff) !== ID.bed) return null;
  const st = raw >>> 8;
  const d = FACING_DIRS[st & 3];          // facing points toward the head end
  const hx = (st & BED_HEAD_BIT) ? x : x + d[0], hz = (st & BED_HEAD_BIT) ? z : z + d[2];
  // the pillow sits near the head end; look toward the foot (-d) and up
  return {
    x: hx + 0.5 + d[0] * 0.18, y: y + PILLOW_EYE, z: hz + 0.5 + d[2] * 0.18,
    yaw: Math.atan2(d[0], d[2]),          // look direction (-sin yaw, -cos yaw) = (-d.x, -d.z)
    pitch: LOOK_UP,
  };
}

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class SleepView {
  constructor(game) {
    this.game = game;
    this.pose = null;
    this.t = 0;
    this.waking = false;
  }

  get active() { return !!this.pose; }

  start() {
    const g = this.game, s = g.mechanics && g.mechanics.sleeping ? g.mechanics.sleeping() : null;
    const w = g.world;
    this.pose = null; this.t = 0; this.waking = false;
    if (!s || !w || !w.getRaw) return false;
    this.pose = bedCameraPose((a, b, c) => w.getRaw(a, b, c), s.x, s.y, s.z);
    return !!this.pose;
  }

  /** Wake up: keep lying until stop() (called once the wake-up fade is black). */
  wake() { this.waking = true; }
  stop() { this.pose = null; this.t = 0; this.waking = false; }

  /** Per frame, after the player lane placed the camera at the standing eye. */
  apply(dt) {
    const g = this.game, p = g.player;
    if (!this.pose) return;
    if (!p || p.dead || g.state === 'title' || (!p.sleeping && !this.waking)) { this.stop(); return; }
    const cam = g.renderer && g.renderer.camera;
    if (!cam) return;
    this.t = Math.min(1, this.t + Math.max(0, dt) / GLIDE_S);
    const k = this.t * this.t * (3 - 2 * this.t);
    const q = this.pose;
    cam.position.set(cam.position.x + (q.x - cam.position.x) * k, cam.position.y + (q.y - cam.position.y) * k, cam.position.z + (q.z - cam.position.z) * k);
    const yaw = angleLerp(cam.rotation.y, q.yaw, k), pitch = cam.rotation.x + (q.pitch - cam.rotation.x) * k;
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
  }
}
