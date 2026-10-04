// OWNER LANE: FEATURE-FX. DOM overlays in the FX layer (Z.FX_OVERLAY): underwater / lava tint, red hurt
// vignette (flash-safe), screen fades, a subtle camera vignette and the kid "hold ring" that appears the moment a
// finger or button goes down on the world (SPEC §7.1: FX shows a ring immediately on pointerdown).

import './fx.css';
import { Z, KID_GESTURE } from '../core/constants.js';
import { el, uiLayer } from '../core/dom.js';
import { FlashLimiter } from './flash.js';

export { FlashLimiter };

export class Overlays {
  constructor(game) {
    this.game = game;
    this.root = uiLayer(game, 'fx-layer', Z.FX_OVERLAY);
    this.vignette = el('div', { class: 'fx-vignette' });
    this.water = el('div', { class: 'fx-water' });
    this.lava = el('div', { class: 'fx-lava' });
    this.hurt = el('div', { class: 'fx-hurt' });
    this.fadeEl = el('div', { class: 'fx-fade' });
    this.ring = el('div', { class: 'fx-ring' });
    this.root.append(this.vignette, this.water, this.lava, this.hurt, this.fadeEl, this.ring);
    this.limiter = new FlashLimiter(3);
    this.fadeLevel = 0;
    this.fadeTimer = 0;
    this.flashes = 0;
    this.underwater = false;
    this.inLava = false;
    this.ringState = null;   // {id, x, y, t0, done}
  }

  setUnderwater(on) { if (on !== this.underwater) { this.underwater = on; this.water.classList.toggle('on', on); } }
  setInLava(on) { if (on !== this.inLava) { this.inLava = on; this.lava.classList.toggle('on', on); } }
  setVignette(on) { this.vignette.classList.toggle('on', !!on); }

  /** Red vignette pulse. Returns false when suppressed by the flash limiter. */
  hurtFlash(nowMs = performance.now()) {
    if (!this.limiter.allow(nowMs)) return false;
    this.flashes++;
    try {
      if (this.hurtAnim) this.hurtAnim.cancel();
      this.hurtAnim = this.hurt.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
    } catch { /* no WAAPI: skip */ }
    return true;
  }

  /** Fade the black overlay to opacity `to` over ms. Resolves when done (also when the tab is hidden). */
  fade(to, ms = 500) {
    to = Math.max(0, Math.min(1, Number(to) || 0));
    ms = Math.max(0, Number(ms) || 0);
    this.fadeLevel = to;
    this.fadeEl.style.transition = ms ? `opacity ${ms}ms linear` : 'none';
    this.fadeEl.style.opacity = String(to);
    clearTimeout(this.fadeTimer);
    return new Promise((resolve) => { this.fadeTimer = setTimeout(resolve, ms + 16); });
  }

  /** Quick dip to dark and back (home whoosh, respawn). */
  async pulse(inMs = 180, holdMs = 60, outMs = 320, level = 1) {
    await this.fade(level, inMs);
    await new Promise((r) => setTimeout(r, holdMs));
    await this.fade(0, outMs);
  }

  /* ---------------- kid hold ring ---------------- */
  ringDown(id, x, y) {
    this.ringState = { id, x, y, t0: performance.now(), done: false };
    this.ring.classList.remove('done');
    this.ring.style.left = x + 'px';
    this.ring.style.top = y + 'px';
    this.ring.style.setProperty('--p', '0deg');
    this.ring.classList.add('on');
  }
  ringMove(id, x, y) {
    const r = this.ringState;
    if (!r || r.id !== id || r.done) return;
    if (Math.hypot(x - r.x, y - r.y) > KID_GESTURE.DRAG_PX && performance.now() - r.t0 < KID_GESTURE.HOLD_MS) this.ringCancel();
  }
  ringUp(id) { if (this.ringState && this.ringState.id === id) this.ringCancel(); }
  ringCancel() { this.ringState = null; this.ring.classList.remove('on', 'done'); }
  /** Per frame: fill the ring over the hold time; pop when complete. */
  updateRing() {
    const r = this.ringState;
    if (!r || r.done) return;
    const p = Math.min(1, (performance.now() - r.t0) / KID_GESTURE.HOLD_MS);
    this.ring.style.setProperty('--p', Math.round(p * 360) + 'deg');
    if (p >= 1) {
      r.done = true;
      this.ring.classList.add('done');
      setTimeout(() => { if (this.ringState === r) this.ringCancel(); }, 200);
    }
  }

  clearAll() {
    this.setUnderwater(false); this.setInLava(false); this.ringCancel();
    try { if (this.hurtAnim) this.hurtAnim.cancel(); } catch { /* ignore */ }
  }
}
