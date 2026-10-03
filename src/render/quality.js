// OWNER LANE: CORE-D. Device quality presets and dynamic quality scaling (SPEC §5.5.6). Pure: unit-tested.

/**
 * Initial preset from the unmasked GPU renderer string.
 * @param {string} gpu  WEBGL_debug_renderer_info renderer (or gl.RENDERER)
 * @param {{touchPrimary?: boolean}} [opts]
 * @returns {{preset:'low'|'medium'|'high', renderDistance:number, dprCap:number, fastLeaves:boolean, kind:string}}
 */
export function detectPreset(gpu, opts = {}) {
  const s = String(gpu || '').toLowerCase();
  let p;
  if (/swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/.test(s)) {
    p = { preset: 'low', renderDistance: 4, dprCap: 1.0, fastLeaves: true, kind: 'software' };
  } else if (/intel/.test(s) && /\b(hd|uhd)\b/.test(s) && !/iris|arc/.test(s)) {
    p = { preset: 'low', renderDistance: 5, dprCap: 1.0, fastLeaves: true, kind: 'intel-hd' };
  } else if (/nvidia|geforce|rtx|gtx|quadro|radeon\s*(rx|pro|r9|vii)|\brx\s*\d{3,4}|arc\s*a\d|apple m\d\s*(pro|max|ultra)/.test(s)) {
    p = { preset: 'high', renderDistance: 8, dprCap: 1.5, fastLeaves: false, kind: 'discrete' };
  } else {
    // Iris, Radeon (integrated "Radeon Graphics"/Vega), Apple M-series base, Mali/Adreno, unknown
    p = { preset: 'medium', renderDistance: 6, dprCap: 1.25, fastLeaves: false, kind: 'integrated' };
  }
  if (opts.touchPrimary && p.preset !== 'low') {
    p = { ...p, preset: 'medium', renderDistance: Math.min(p.renderDistance, 5), dprCap: 1.0, kind: p.kind + '+touch' };
  } else if (opts.touchPrimary) {
    p = { ...p, renderDistance: Math.min(p.renderDistance, 5), dprCap: 1.0 };
  }
  return p;
}

/** Tunables (SPEC §5.5.6). */
export const SCALE = Object.freeze({
  WARMUP_MS: 5000, SLOW_MS: 22, SLOW_HOLD_MS: 2000, FAST_MS: 12, FAST_HOLD_MS: 8000, COOLDOWN_MS: 5000,
  DPR_STEP: 0.25, DPR_MIN: 0.75, R_MIN: 3, VSYNC30_LO: 29, VSYNC30_HI: 38, VSYNC30_WORK_MS: 8, WINDOW: 60,
});

/**
 * Dynamic quality state machine. Feed it one sample per rendered frame; it answers with an action.
 *   const sc = new DynamicScaler({dpr, dprMax, r, rMax, manualR});
 *   const act = sc.sample(nowMs, frameIntervalMs, workMs); // null | {type:'dpr'|'r', value}
 * Lowers DPR first (by 0.25, min 0.75), then R - 1 (min 3) when p90 > 22 ms for 2 s; raises R (then DPR) when
 * p90 < 12 ms for 8 s; 5 s cooldown between changes; ignores the first 5 s; never scales down when frames sit
 * near 33 ms while work is light (30 Hz display / energy saver). manualR: R is never changed.
 */
export class DynamicScaler {
  constructor({ dpr = 1, dprMax = 1, r = 6, rMax = 6, manualR = false } = {}) {
    this.dpr = dpr; this.dprMax = dprMax; this.r = r; this.rMax = rMax; this.manualR = manualR;
    this.samples = new Float32Array(SCALE.WINDOW);
    this.sorted = new Float32Array(SCALE.WINDOW);
    this.n = 0; this.i = 0;
    this.start = -1; this.lastChange = -Infinity; this.slowSince = -1; this.fastSince = -1;
    this.lastP90 = 0;
  }
  /** Restart the warm-up (new world, tab shown again, settings changed). */
  reset(now) { this.start = now; this.n = 0; this.i = 0; this.slowSince = -1; this.fastSince = -1; }
  p90() {
    const n = this.n;
    if (!n) return 0;
    const s = this.sorted;
    for (let k = 0; k < n; k++) s[k] = this.samples[k];
    const view = s.subarray(0, n);
    view.sort();
    return view[Math.min(n - 1, Math.floor(n * 0.9))];
  }
  sample(now, frameMs, workMs = 0) {
    if (this.start < 0) this.start = now;
    if (!(frameMs > 0) || frameMs > 250) return null; // tab switch / breakpoint: not a quality signal
    this.samples[this.i] = frameMs; this.i = (this.i + 1) % SCALE.WINDOW; if (this.n < SCALE.WINDOW) this.n++;
    if (now - this.start < SCALE.WARMUP_MS || this.n < 20) return null;
    const p = this.p90();
    this.lastP90 = p;
    const vsync30 = p >= SCALE.VSYNC30_LO && p <= SCALE.VSYNC30_HI && workMs < SCALE.VSYNC30_WORK_MS;
    if (p > SCALE.SLOW_MS && !vsync30) { if (this.slowSince < 0) this.slowSince = now; } else this.slowSince = -1;
    if (p < SCALE.FAST_MS) { if (this.fastSince < 0) this.fastSince = now; } else this.fastSince = -1;
    if (now - this.lastChange < SCALE.COOLDOWN_MS) return null;
    if (this.slowSince >= 0 && now - this.slowSince >= SCALE.SLOW_HOLD_MS) {
      let act = null;
      if (this.dpr - SCALE.DPR_STEP >= SCALE.DPR_MIN - 1e-6) { this.dpr = round2(this.dpr - SCALE.DPR_STEP); act = { type: 'dpr', value: this.dpr }; }
      else if (!this.manualR && this.r > SCALE.R_MIN) { this.r--; act = { type: 'r', value: this.r }; }
      if (act) this.changed(now);
      return act;
    }
    if (this.fastSince >= 0 && now - this.fastSince >= SCALE.FAST_HOLD_MS) {
      let act = null;
      if (!this.manualR && this.r < this.rMax) { this.r++; act = { type: 'r', value: this.r }; }
      else if (this.dpr < this.dprMax - 1e-6) { this.dpr = round2(Math.min(this.dprMax, this.dpr + SCALE.DPR_STEP)); act = { type: 'dpr', value: this.dpr }; }
      if (act) this.changed(now);
      return act;
    }
    return null;
  }
  changed(now) { this.lastChange = now; this.slowSince = -1; this.fastSince = -1; this.n = 0; this.i = 0; }
}

function round2(v) { return Math.round(v * 100) / 100; }
