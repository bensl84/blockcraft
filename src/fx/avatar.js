// OWNER LANE: FEATURE-FX. The player's body on screen: the first-person view model (arm + held item in
// renderer.viewModelScene, swing / equip / place / bob animations) and the third-person character (view 1/2,
// toggled by the player lane on V / F5). Both use the procedural skin from settings.skin (playermodel.js).

import * as THREE from 'three';
import { BREAK } from '../core/constants.js';
import { angleDiff, clamp } from '../core/math.js';
import { createPartsMaterial, pixelTexture } from './fxmat.js';
import { MODEL_SCALE, PART, PARTS, buildPartsGeometry, buildPlayerGeometry, paintSkin, posePlayer } from './playermodel.js';

const SWING_SECONDS = BREAK.SWING_TICKS / 20;   // 6 ticks
const EQUIP_SPEED = 7;                           // equip progress per second

/** Skin texture shared by the arm and the third-person model; rebuilt when settings.skin changes. */
export class SkinTexture {
  constructor(game) {
    this.game = game;
    this.key = '';
    this.texture = null;
    this.refresh();
  }
  refresh() {
    const skin = (this.game.settings && this.game.settings.skin) || {};
    const key = JSON.stringify(skin);
    if (key === this.key && this.texture) return false;
    this.key = key;
    const img = paintSkin(skin);
    if (this.texture) { this.texture.image.data.set(img.data); this.texture.needsUpdate = true; } else this.texture = pixelTexture(img.data, img.w, img.h);
    return true;
  }
  dispose() { if (this.texture) this.texture.dispose(); }
}

/* ------------------------------------------------------------------ first person */

export class ViewModel {
  /**
   * @param {object} game
   * @param {object} shared shared light/fog uniforms
   * @param {import('./itemmesh.js').ItemMeshFactory} items
   * @param {{atlas: THREE.ShaderMaterial, color: THREE.ShaderMaterial}} vmMaterials (no-fog item materials)
   * @param {SkinTexture} skin
   */
  constructor(game, shared, items, vmMaterials, skin) {
    this.game = game;
    this.items = items;
    this.vmMaterials = vmMaterials;
    this.light = { sky: 15, block: 0 };
    this.root = new THREE.Group();
    this.root.name = 'fx-viewmodel';
    this.hand = new THREE.Group();
    this.root.add(this.hand);
    // arm: one box (the skin's right arm). armFrame's origin is the fist; the arm runs along its +Y axis.
    const armGeo = buildPartsGeometry([{ box: PARTS[PART.RIGHT_ARM].box, uv: PARTS[PART.RIGHT_ARM].uv, part: 0 }]);
    this.armMaterial = createPartsMaterial(shared, skin.texture, 1, { fog: false });
    this.arm = new THREE.Mesh(armGeo, this.armMaterial);
    this.arm.scale.setScalar(1 / 16);
    this.arm.position.set(0, 10 / 16, 0);
    this.arm.frustumCulled = false;
    this.arm.userData.fxLight = this.light;
    this.arm.onBeforeRender = items.materials.hook;
    this.armFrame = new THREE.Group();
    this.armFrame.add(this.arm);
    this.hand.add(this.armFrame);
    /** Pose tuning (view space of viewModelCamera: x right, y up, -z forward). */
    this.cfg = {
      fist: [0.38, -0.31, -0.72],         // fist position (empty hand)
      fistHolding: [0.44, -0.42, -0.78],
      armDir: [0.7, -0.5, 0.5],           // from the fist toward the shoulder (off-screen bottom right)
      armRoll: 0.5,
      block: { pos: [-0.04, 0.08, -0.06], rot: [0.1, 0.79, 0], scale: 0.3 },
      flat: { pos: [-0.04, 0.0, -0.06], rot: [0.0, -1.62, 0.66], scale: 0.62 },
    };
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this.itemHolder = new THREE.Group();
    this.hand.add(this.itemHolder);
    this.itemObj = null;
    this.itemKey = null;
    this.firstItem = true;
    this.equip = 1;
    this.swingT = -1;          // seconds since swing start (-1 = idle)
    this.lastSwingTicks = 0;
    this.pushT = -1;           // place "push"
    this.bobDist = 0;
    this.bobAmt = 0;
    this.lagYaw = 0; this.lagPitch = 0; this.lagInit = false;
    this.lastX = 0; this.lastZ = 0;
    this.time = 0;
    this.attached = false;
    this.cfgVersion = 0; this.placedVersion = 0;
  }

  attach(renderer) {
    if (this.attached || !renderer || !renderer.viewModelScene) return;
    const scene = renderer.viewModelScene;
    // CORE-D renders this scene after the world with autoClear off and only the depth buffer cleared.
    scene.add(this.root);
    this.attached = true;
  }

  /** Start an arm swing (player:swing, or player.swingTicks rising). */
  swing() { this.swingT = 0; }
  /** Small forward push when a block is placed. */
  push() { this.pushT = 0; }

  heldKey() {
    const inv = this.game.inventory;
    const s = inv && inv.getSelected ? inv.getSelected() : null;
    return s ? s.item : null;
  }

  setItem(key) {
    if (this.itemObj) { this.items.dispose(this.itemObj); this.itemObj = null; }
    this.itemKey = key;
    if (!key) return;
    const e = this.items.entry(key);
    const mat = e.kind === 'block' ? this.vmMaterials.atlas : this.vmMaterials.color;
    const obj = this.items.make(key, { material: mat, scale: 1 });
    const mesh = obj.userData.fxMesh;
    mesh.userData.fxLight = this.light;
    mesh.frustumCulled = false;
    this.placeItem(obj, e.kind);
    this.itemHolder.add(obj);
    this.itemObj = obj;
  }

  /** Pose the held item at the fist (cfg.block / cfg.flat). */
  placeItem(obj, kind) {
    const c = kind === 'block' ? this.cfg.block : this.cfg.flat;
    const mesh = obj.userData.fxMesh;
    mesh.scale.setScalar(c.scale);
    // centre the item on its own origin so rotations spin about its middle
    mesh.position.set(0, -c.scale / 2, 0);
    obj.position.set(c.pos[0], c.pos[1], c.pos[2]);
    obj.rotation.set(c.rot[0], c.rot[1], c.rot[2], 'YXZ');
  }

  update(dt, alpha) {
    const g = this.game, p = g.player;
    const show = !!(g.meta && p && (g.state === 'playing' || g.state === 'paused') && !p.view && !p.dead && !p.sleeping);
    this.root.visible = show;
    if (!show) { this.lagInit = false; return; }
    this.time += dt;
    // light at the eye
    if (g.world && g.world.getLight) {
      const l = g.world.getLight(Math.floor(p.renderX ?? p.x), Math.floor((p.renderY ?? p.y) + (p.eyeHeight || 1.62)), Math.floor(p.renderZ ?? p.z));
      this.light.sky = l >> 4; this.light.block = l & 15;
    }
    // swing detection from the frozen player field as well as events
    const st = p.swingTicks | 0;
    if (st > this.lastSwingTicks) this.swing();
    this.lastSwingTicks = st;
    // held item / equip animation
    const key = this.heldKey();
    if (key !== this.itemKey) {
      // lower the old item, swap at the bottom, raise the new one (equip-swap animation on player:hotbar)
      this.equip = this.firstItem ? 0 : Math.max(0, this.equip - dt * EQUIP_SPEED * 1.5);
      if (this.equip === 0) this.setItem(key);
    } else this.equip = Math.min(1, this.equip + dt * EQUIP_SPEED);
    this.firstItem = false;
    // bob from horizontal movement
    const rx = p.renderX ?? p.x, rz = p.renderZ ?? p.z;
    const moved = Math.min(1, Math.hypot(rx - this.lastX, rz - this.lastZ));
    this.lastX = rx; this.lastZ = rz;
    const walking = p.onGround && !p.flying && moved > 0.001;
    this.bobDist += moved * 0.6;
    this.bobAmt += ((walking ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 8);
    // look lag sway
    if (!this.lagInit) { this.lagYaw = p.yaw; this.lagPitch = p.pitch; this.lagInit = true; }
    const k = 1 - Math.pow(0.001, dt);
    this.lagYaw += angleDiff(this.lagYaw, p.yaw) * k;
    this.lagPitch += (p.pitch - this.lagPitch) * k;
    const swayYaw = clamp(angleDiff(this.lagYaw, p.yaw), -0.6, 0.6);
    const swayPitch = clamp(p.pitch - this.lagPitch, -0.6, 0.6);

    const bobK = g.settings && g.settings.viewBobbing ? 1 : 0.45;
    const ph = this.bobDist * Math.PI;
    const bx = Math.sin(ph) * 0.03 * this.bobAmt * bobK;
    const by = -Math.abs(Math.cos(ph)) * 0.045 * this.bobAmt * bobK + Math.sin(this.time * 1.7) * 0.006;

    let sx = 0, sy = 0, sz = 0, rx2 = 0, ry2 = 0, rz2 = 0;
    if (this.swingT >= 0) {
      this.swingT += dt;
      const t = Math.min(1, this.swingT / SWING_SECONDS);
      const s1 = Math.sin(Math.sqrt(t) * Math.PI), s2 = Math.sin(t * Math.PI), s3 = Math.sin(Math.sqrt(t) * Math.PI * 2);
      sx = -0.3 * s1; sy = 0.12 * s3; sz = -0.22 * s2;
      rx2 = -0.7 * s2; ry2 = 0.5 * s1; rz2 = 0.25 * s2;
      if (t >= 1) this.swingT = -1;
    }
    if (this.pushT >= 0) {
      this.pushT += dt;
      const t = Math.min(1, this.pushT / 0.2);
      sz -= Math.sin(t * Math.PI) * 0.08;
      if (t >= 1) this.pushT = -1;
    }
    const drop = (1 - this.equip) * 0.55;
    const holding = !!this.itemObj;
    const f = holding ? this.cfg.fistHolding : this.cfg.fist;
    // narrow (portrait phone) windows have a tiny horizontal field of view: pull the hand in toward the middle
    const vc = g.renderer && g.renderer.viewModelCamera;
    const ax = clamp((vc && vc.aspect ? vc.aspect : 16 / 9) / 1.2, 0.4, 1);
    this.hand.position.set(f[0] * ax + bx + sx * ax, f[1] + by + sy - drop, f[2] + sz);
    this.hand.rotation.set(rx2 + swayPitch * 0.25, ry2 + swayYaw * 0.25, rz2 + bx * 2, 'YXZ');
    // arm: +Y of armFrame points from the fist toward the shoulder, rolled so the sleeve/back of the hand shows
    const d = this.cfg.armDir;
    this._v.set(d[0], d[1], d[2]).normalize();
    this._q.setFromUnitVectors(this._up, this._v);
    this._q2.setFromAxisAngle(this._up, this.cfg.armRoll);
    this.armFrame.quaternion.copy(this._q).multiply(this._q2);
    if (this.itemObj && this.cfgVersion !== this.placedVersion) { this.placeItem(this.itemObj, this.itemObj.userData.fxKind); this.placedVersion = this.cfgVersion; }
  }

  dispose() {
    if (this.itemObj) this.items.dispose(this.itemObj);
    this.arm.geometry.dispose();
    this.armMaterial.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

/* ------------------------------------------------------------------ third person */

export class PlayerAvatar {
  constructor(game, shared, items, skin) {
    this.game = game;
    this.items = items;
    this.geometry = buildPlayerGeometry();
    this.material = createPartsMaterial(shared, skin.texture, 6);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'fx-player';
    this.mesh.scale.setScalar(MODEL_SCALE);
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = items.materials.hook;
    this.mesh.visible = false;
    this.mats = this.material.uniforms.uParts.value;
    this.bodyYaw = 0;
    this.limbSwing = 0;
    this.limbAmount = 0;
    this.lastX = 0; this.lastZ = 0;
    this.swingT = -1;
    this.lastSwingTicks = 0;
    // held item in the right hand
    this.holder = new THREE.Group();
    this.holder.matrixAutoUpdate = false;
    this.mesh.add(this.holder);
    this.itemObj = null; this.itemKey = null;
    this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4();
    this.attached = false;
  }

  attach(renderer) {
    if (this.attached || !renderer || !renderer.addObject || !renderer.dynamicGroup) return;
    renderer.addObject(this.mesh);
    this.attached = true;
  }

  swing() { this.swingT = 0; }

  update(dt) {
    const g = this.game, p = g.player;
    const show = !!(g.meta && p && p.view && !p.dead && (g.state === 'playing' || g.state === 'paused'));
    this.mesh.visible = show;
    if (!show) return;
    const x = p.renderX ?? p.x, y = p.renderY ?? p.y, z = p.renderZ ?? p.z;
    this.mesh.position.set(x, y, z);
    const moved = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x; this.lastZ = z;
    const speed = dt > 0 ? Math.min(1.5, moved / dt / 4.3) : 0;
    const target = p.flying ? speed * 0.2 : Math.min(1, speed) * 0.62;
    this.limbAmount += (target - this.limbAmount) * Math.min(1, dt * 10);
    this.limbSwing += Math.min(moved, 1) * 4;
    // body yaw follows the head; turns fully while walking, otherwise stays within 50 degrees
    const d = angleDiff(this.bodyYaw, p.yaw);
    if (speed > 0.05) this.bodyYaw += d * Math.min(1, dt * 8);
    else if (Math.abs(d) > 0.87) this.bodyYaw += (d - Math.sign(d) * 0.87);
    this.mesh.rotation.set(0, this.bodyYaw, 0);
    const st = p.swingTicks | 0;
    if (st > this.lastSwingTicks) this.swing();
    this.lastSwingTicks = st;
    let swing = 0;
    if (this.swingT >= 0) { this.swingT += dt; swing = Math.min(1, this.swingT / SWING_SECONDS); if (swing >= 1) { this.swingT = -1; swing = 0; } }
    const inv = g.inventory, s = inv && inv.getSelected ? inv.getSelected() : null;
    const key = s ? s.item : null;
    posePlayer(this.mats, {
      headYaw: angleDiff(this.bodyYaw, p.yaw), headPitch: p.pitch, limbSwing: this.limbSwing, limbAmount: Math.min(1, this.limbAmount),
      swing, holding: !!key, flying: !!p.flying,
    });
    this.material.uniformsNeedUpdate = true;
    // held item follows the right arm: arm matrix * hand offset * back to block units
    if (key !== this.itemKey) {
      if (this.itemObj) { this.items.dispose(this.itemObj); this.itemObj = null; }
      this.itemKey = key;
      if (key) { this.itemObj = this.items.make(key); this.holder.add(this.itemObj); }
    }
    if (this.itemObj) {
      const flat = this.itemObj.userData.fxKind === 'flat';
      this._t.makeTranslation(0, -10, -2);
      this._m.copy(this.mats[PART.RIGHT_ARM]).multiply(this._t);
      this._t.makeScale(16, 16, 16); this._m.multiply(this._t);
      this._t.makeRotationX(flat ? -Math.PI / 2 : -0.2); this._m.multiply(this._t);
      if (flat) { this._t.makeRotationY(Math.PI / 2); this._m.multiply(this._t); }
      this._t.makeTranslation(0, flat ? -0.12 : -0.12, flat ? 0 : -0.1); this._m.multiply(this._t);
      this.holder.matrix.copy(this._m);
      this.holder.matrixWorldNeedsUpdate = true;
    }
  }

  dispose() {
    if (this.itemObj) this.items.dispose(this.itemObj);
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose(); this.material.dispose();
  }
}
