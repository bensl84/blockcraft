// OWNER LANE: FEATURE-AUDIO. The sound catalogue (SPEC §8.3.2): every sound is an ORIGINAL recipe synthesised
// at play time from oscillators, filtered noise and envelopes (dsp.js). No samples, no network.
//
// Entry: { r(v) recipe, vol (relative loudness 0..1), range (blocks; 0 = not positional/UI), gap (min seconds
// between two starts of this name, optional), pj (pitch jitter fraction, default 0.05 = SPEC ±5%) }.
// Block sounds are named 'block.<kind>.<soundType>' (kind ∈ break|place|step|hit|land).
// Kid-safety: nothing here is a startle sound. Hurt is a soft "oof", hostile voices are silly rather than
// scary, and the explosion is a round "whump" (softer still when v.q.kid is set; peak verified ≤ −6 dBFS).

import { bell, crackle, lowpass, noise, rr, tone, voiced } from './dsp.js';
import { TRIM_DB } from './levels.js';

export const BLOCK_KINDS = Object.freeze(['break', 'place', 'step', 'hit', 'land']);
export const BLOCK_SOUND_TYPES = Object.freeze(['stone', 'wood', 'grass', 'dirt', 'gravel', 'sand', 'cloth', 'glass', 'snow', 'metal', 'plant', 'liquid']);
export const MOB_VOICES = Object.freeze(['pig', 'cow', 'sheep', 'chicken', 'wolf', 'cat', 'horse', 'zombie', 'skeleton', 'creeper', 'spider']);
export const MOB_KINDS = Object.freeze(['idle', 'hurt', 'death', 'step']);

/* ------------------------------------------------------------------ materials */
// Each material: {hit, step, place, break} recipes. 'land' = a heavier step plus a body thump.
const knock = (v, t, f, g, d = 0.08) => {
  tone(v, { t, type: 'triangle', f, f2: f * 0.92, dur: d, a: 0.002, g });
  tone(v, { t, f: f * 2.71, dur: d * 0.5, a: 0.001, g: g * 0.35 });
};

const MATERIALS = {
  stone: {
    hit: (v) => { crackle(v, { dur: 0.045, n: 2, f: 2300, q: 1.4, g: 0.55, len: 0.01 }); tone(v, { f: rr(v, 170, 210), dur: 0.04, g: 0.18 }); },
    step: (v) => { crackle(v, { dur: 0.07, n: 3, f: rr(v, 1400, 1900), q: 1.2, g: 0.55, len: 0.012 }); noise(v, { color: 'pink', dur: 0.06, type: 'lowpass', f: 700, g: 0.25 }); },
    place: (v) => { noise(v, { color: 'pink', dur: 0.09, f: 900, q: 1.4, g: 0.6 }); tone(v, { f: 120, f2: 70, dur: 0.1, g: 0.45 }); crackle(v, { dur: 0.08, n: 3, f: 2600, g: 0.3 }); },
    break: (v) => {
      crackle(v, { dur: 0.26, n: 10, f: 1800, fJit: 0.5, q: 1.3, g: 0.6, len: 0.018, decay: 0.6 });
      noise(v, { color: 'pink', dur: 0.22, f: 700, f2: 320, q: 0.8, g: 0.45 });
      tone(v, { f: 95, f2: 55, dur: 0.18, g: 0.45 });
    },
  },
  wood: {
    hit: (v) => knock(v, 0, rr(v, 240, 300), 0.35, 0.05),
    step: (v) => { noise(v, { color: 'pink', dur: 0.07, f: rr(v, 420, 560), q: 2.5, g: 0.55 }); tone(v, { type: 'triangle', f: 150, f2: 120, dur: 0.05, g: 0.2 }); },
    place: (v) => { knock(v, 0, rr(v, 200, 240), 0.55, 0.1); noise(v, { color: 'pink', dur: 0.08, f: 600, q: 2, g: 0.4 }); },
    break: (v) => {
      knock(v, 0, rr(v, 190, 230), 0.5, 0.12);
      knock(v, 0.06, rr(v, 260, 320), 0.3, 0.08);
      crackle(v, { t: 0.01, dur: 0.24, n: 8, f: 2400, fJit: 0.4, q: 2.5, g: 0.35, len: 0.01, decay: 0.5 });
      noise(v, { color: 'pink', dur: 0.2, f: 520, f2: 300, q: 1.8, g: 0.35 });
    },
  },
  grass: {
    hit: (v) => crackle(v, { dur: 0.05, n: 3, type: 'highpass', f: 3000, q: 0.7, g: 0.35, len: 0.008 }),
    step: (v) => { crackle(v, { dur: 0.1, n: 6, type: 'highpass', f: 3200, q: 0.7, g: 0.4, len: 0.01 }); noise(v, { dur: 0.09, f: 2200, q: 0.8, g: 0.18 }); },
    place: (v) => { crackle(v, { dur: 0.1, n: 7, type: 'highpass', f: 2800, q: 0.7, g: 0.5, len: 0.012 }); noise(v, { color: 'pink', dur: 0.08, type: 'lowpass', f: 900, g: 0.4 }); },
    break: (v) => {
      crackle(v, { dur: 0.22, n: 14, type: 'highpass', f: 2600, q: 0.7, g: 0.55, len: 0.012, decay: 0.5 });
      noise(v, { color: 'pink', dur: 0.2, f: 1600, f2: 700, q: 0.7, g: 0.3 });
      noise(v, { color: 'brown', dur: 0.12, type: 'lowpass', f: 500, g: 0.4 });
    },
  },
  dirt: {
    hit: (v) => crackle(v, { color: 'pink', dur: 0.05, n: 2, f: 1200, q: 1, g: 0.45, len: 0.012 }),
    step: (v) => { crackle(v, { color: 'pink', dur: 0.08, n: 4, f: rr(v, 900, 1300), q: 0.9, g: 0.5, len: 0.014 }); noise(v, { color: 'brown', dur: 0.07, type: 'lowpass', f: 500, g: 0.3 }); },
    place: (v) => { noise(v, { color: 'brown', dur: 0.1, type: 'lowpass', f: 700, g: 0.6 }); crackle(v, { color: 'pink', dur: 0.08, n: 4, f: 1400, g: 0.35 }); },
    break: (v) => {
      crackle(v, { color: 'pink', dur: 0.22, n: 10, f: 1100, fJit: 0.5, q: 0.9, g: 0.55, len: 0.018, decay: 0.5 });
      noise(v, { color: 'brown', dur: 0.2, type: 'lowpass', f: 800, f2: 300, g: 0.55 });
    },
  },
  gravel: {
    hit: (v) => crackle(v, { dur: 0.05, n: 3, f: 2200, fJit: 0.6, q: 1, g: 0.45, len: 0.007 }),
    step: (v) => { crackle(v, { dur: 0.11, n: 8, f: 2000, fJit: 0.6, q: 1, g: 0.5, len: 0.007 }); noise(v, { color: 'pink', dur: 0.09, f: 1100, q: 0.8, g: 0.15 }); },
    place: (v) => { crackle(v, { dur: 0.12, n: 9, f: 1900, fJit: 0.6, q: 1, g: 0.55, len: 0.008 }); noise(v, { color: 'brown', dur: 0.08, type: 'lowpass', f: 600, g: 0.4 }); },
    break: (v) => {
      crackle(v, { dur: 0.26, n: 16, f: 1900, fJit: 0.6, q: 1, g: 0.55, len: 0.008, decay: 0.5 });
      noise(v, { color: 'pink', dur: 0.24, f: 1000, f2: 500, q: 0.7, g: 0.3 });
    },
  },
  sand: {
    hit: (v) => noise(v, { dur: 0.05, f: 2600, q: 0.6, g: 0.3 }),
    step: (v) => { noise(v, { dur: 0.1, f: rr(v, 2200, 2800), q: 0.6, g: 0.35, a: 0.01 }); crackle(v, { dur: 0.08, n: 3, f: 3000, g: 0.15, len: 0.006 }); },
    place: (v) => { noise(v, { dur: 0.12, f: 2000, f2: 1200, q: 0.6, g: 0.45, a: 0.006 }); noise(v, { color: 'brown', dur: 0.08, type: 'lowpass', f: 500, g: 0.3 }); },
    break: (v) => {
      noise(v, { dur: 0.3, f: 2400, f2: 900, q: 0.5, g: 0.45, a: 0.01 });
      crackle(v, { dur: 0.25, n: 8, f: 2600, g: 0.2, len: 0.006, decay: 0.6 });
      noise(v, { color: 'brown', dur: 0.12, type: 'lowpass', f: 500, g: 0.35 });
    },
  },
  cloth: {
    hit: (v) => noise(v, { color: 'pink', dur: 0.05, type: 'lowpass', f: 600, g: 0.35, a: 0.008 }),
    step: (v) => noise(v, { color: 'pink', dur: 0.09, type: 'lowpass', f: rr(v, 450, 600), g: 0.5, a: 0.012 }),
    place: (v) => { noise(v, { color: 'pink', dur: 0.12, type: 'lowpass', f: 650, g: 0.6, a: 0.01 }); tone(v, { f: 95, f2: 70, dur: 0.08, g: 0.25 }); },
    break: (v) => { noise(v, { color: 'pink', dur: 0.22, type: 'lowpass', f: 800, f2: 400, g: 0.6, a: 0.015 }); tone(v, { f: 90, f2: 60, dur: 0.12, g: 0.3 }); },
  },
  glass: {
    hit: (v) => tone(v, { f: rr(v, 2800, 3400), dur: 0.04, g: 0.2, a: 0.001 }),
    step: (v) => { tone(v, { f: rr(v, 2600, 3200), dur: 0.05, g: 0.18, a: 0.001 }); crackle(v, { dur: 0.05, n: 2, type: 'highpass', f: 4000, g: 0.25, len: 0.006 }); },
    place: (v) => { bell(v, { f: rr(v, 1900, 2300), dur: 0.25, g: 0.25, partials: [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.3]] }); noise(v, { color: 'pink', dur: 0.06, f: 900, q: 1.5, g: 0.3 }); },
    break: (v) => {
      // shatter: a bright crunch plus a shower of little tinkles (kept below 9 kHz so it never stings)
      const lp = lowpass(v, 9000);
      crackle(v, { dur: 0.22, n: 12, type: 'highpass', f: 3800, q: 0.7, g: 0.5, len: 0.008, decay: 0.6, to: lp });
      noise(v, { dur: 0.12, type: 'highpass', f: 3000, g: 0.25, to: lp });
      for (let i = 0; i < 6; i++) tone(v, { t: rr(v, 0.01, 0.32), f: rr(v, 2400, 5600), dur: rr(v, 0.12, 0.35), g: rr(v, 0.08, 0.16), a: 0.001, to: lp });
    },
  },
  snow: {
    hit: (v) => crackle(v, { dur: 0.05, n: 2, f: 1300, q: 0.8, g: 0.35, len: 0.016 }),
    step: (v) => { crackle(v, { dur: 0.1, n: 5, f: rr(v, 1100, 1500), q: 0.8, g: 0.45, len: 0.018 }); noise(v, { color: 'pink', dur: 0.09, type: 'lowpass', f: 1600, g: 0.2 }); },
    place: (v) => { crackle(v, { dur: 0.11, n: 6, f: 1300, q: 0.8, g: 0.5, len: 0.02 }); noise(v, { color: 'pink', dur: 0.1, type: 'lowpass', f: 1200, g: 0.3 }); },
    break: (v) => { crackle(v, { dur: 0.22, n: 10, f: 1200, q: 0.8, g: 0.5, len: 0.022, decay: 0.5 }); noise(v, { color: 'pink', dur: 0.2, type: 'lowpass', f: 1800, f2: 700, g: 0.35 }); },
  },
  metal: {
    hit: (v) => { tone(v, { f: rr(v, 900, 1100), dur: 0.06, g: 0.2, a: 0.001 }); crackle(v, { dur: 0.03, n: 1, type: 'highpass', f: 4000, g: 0.3 }); },
    step: (v) => { bell(v, { f: rr(v, 700, 900), dur: 0.12, g: 0.15, partials: [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.4]] }); noise(v, { color: 'pink', dur: 0.05, f: 1200, q: 1.5, g: 0.3 }); },
    place: (v) => { bell(v, { f: rr(v, 380, 440), dur: 0.35, g: 0.3, partials: [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.3, 0.4], [8.9, 0.1, 0.25]] }); noise(v, { color: 'pink', dur: 0.06, f: 1500, q: 1.5, g: 0.4 }); },
    break: (v) => {
      bell(v, { f: rr(v, 330, 380), dur: 0.5, g: 0.35, partials: [[1, 1, 1], [2.76, 0.6, 0.6], [5.4, 0.35, 0.4], [8.9, 0.15, 0.25]] });
      crackle(v, { dur: 0.2, n: 6, f: 3000, q: 1.5, g: 0.3, len: 0.01, decay: 0.6 });
    },
  },
  plant: {
    hit: (v) => crackle(v, { dur: 0.04, n: 2, type: 'highpass', f: 4000, g: 0.25, len: 0.008 }),
    step: (v) => { crackle(v, { dur: 0.08, n: 4, type: 'highpass', f: 4000, g: 0.3, len: 0.01 }); noise(v, { dur: 0.08, type: 'highpass', f: 3000, g: 0.1 }); },
    place: (v) => { crackle(v, { dur: 0.1, n: 5, type: 'highpass', f: 3500, g: 0.4, len: 0.012 }); noise(v, { dur: 0.09, f: 2400, q: 0.8, g: 0.2 }); },
    break: (v) => {
      crackle(v, { dur: 0.16, n: 8, type: 'highpass', f: 3200, g: 0.45, len: 0.012, decay: 0.5 });
      noise(v, { dur: 0.14, f: 2600, f2: 1400, q: 0.8, g: 0.2 });
      tone(v, { t: 0.01, f: rr(v, 1500, 1900), dur: 0.03, g: 0.12, a: 0.001 }); // the little stem snap
    },
  },
  liquid: {
    hit: (v) => noise(v, { dur: 0.06, f: 1200, q: 1, g: 0.3 }),
    step: (v) => { noise(v, { dur: 0.14, f: 1400, f2: 700, q: 0.8, g: 0.4, a: 0.01 }); bubbles(v, 0.02, 2, 0.12); },
    place: (v) => { noise(v, { dur: 0.25, f: 1800, f2: 500, q: 0.7, g: 0.5, a: 0.008 }); bubbles(v, 0.05, 3, 0.15); },
    break: (v) => { noise(v, { dur: 0.3, f: 2000, f2: 500, q: 0.7, g: 0.5, a: 0.008 }); bubbles(v, 0.05, 4, 0.15); },
  },
};

/** Little rising sine "bloops". */
function bubbles(v, t, n, g, spread = 0.3) {
  for (let i = 0; i < n; i++) {
    const f = rr(v, 380, 900);
    tone(v, { t: t + rr(v, 0, spread), f, f2: f * rr(v, 1.6, 2.2), dur: rr(v, 0.04, 0.07), g: g * rr(v, 0.6, 1), a: 0.002 });
  }
}

function landRecipe(mat, heavy) {
  return (v) => {
    mat.step(v);
    tone(v, { f: heavy ? 75 : 90, f2: heavy ? 42 : 55, dur: heavy ? 0.16 : 0.09, g: heavy ? 0.6 : 0.4 });
    noise(v, { color: 'brown', dur: heavy ? 0.14 : 0.07, type: 'lowpass', f: 400, g: heavy ? 0.4 : 0.25 });
  };
}

/* ------------------------------------------------------------------ mob voices */
// Formant sets (Hz, Q, gain) for the vowel-ish colours used below.
const F_OO = [[350, 5, 1], [800, 6, 0.45], [2400, 8, 0.08]];
const F_AH = [[750, 5, 1], [1200, 6, 0.6], [2600, 8, 0.15]];
const F_NASAL = [[500, 3, 1], [1100, 4, 0.6], [2300, 6, 0.2]];

const VOICES = {
  pig: {
    idle: (v) => {
      voiced(v, { dur: 0.15, f0: [[0, 150], [0.06, 178], [0.15, 118]], formants: F_NASAL, fcurve: [[0, 0.8], [0.07, 1.2], [0.15, 0.9]], a: 0.01, g: 0.55, breath: 0.25 });
      if (v.r() < 0.6) voiced(v, { t: rr(v, 0.18, 0.24), dur: 0.12, f0: [[0, 140], [0.05, 165], [0.12, 110]], formants: F_NASAL, a: 0.01, g: 0.45, breath: 0.25 });
    },
    hurt: (v) => voiced(v, { dur: 0.28, f0: [[0, 520], [0.08, 720], [0.28, 460]], formants: [[1000, 4, 1], [2200, 5, 0.5]], vib: { rate: 18, depth: 25 }, a: 0.01, g: 0.45 }),
    death: (v) => voiced(v, { dur: 0.55, f0: [[0, 620], [0.1, 700], [0.55, 240]], formants: [[1000, 4, 1], [2200, 5, 0.4]], vib: { rate: 14, depth: 20 }, a: 0.02, g: 0.45 }),
  },
  cow: {
    idle: (v) => voiced(v, { dur: 1.1, f0: [[0, 95], [0.2, 122], [0.8, 112], [1.1, 84]], formants: F_OO, fcurve: [[0, 0.7], [0.3, 1.5], [0.85, 1.1], [1.1, 0.6]], a: 0.12, vib: { rate: 5, depth: 2 }, g: 0.6, breath: 0.12 }),
    hurt: (v) => voiced(v, { dur: 0.42, f0: [[0, 150], [0.1, 165], [0.42, 112]], formants: F_OO, fcurve: [[0, 0.9], [0.1, 1.5], [0.42, 0.8]], a: 0.03, g: 0.55, breath: 0.15 }),
    death: (v) => voiced(v, { dur: 0.95, f0: [[0, 130], [0.2, 140], [0.95, 70]], formants: F_OO, fcurve: [[0, 0.9], [0.25, 1.4], [0.95, 0.6]], a: 0.04, g: 0.55, breath: 0.15 }),
  },
  sheep: {
    idle: (v) => voiced(v, { dur: 0.65, f0: [[0, 330], [0.1, 365], [0.65, 300]], am: { rate: 27, depth: 0.85 }, formants: F_AH, fcurve: [[0, 0.7], [0.12, 1.1], [0.65, 0.9]], a: 0.04, g: 0.55, breath: 0.1 }),
    hurt: (v) => voiced(v, { dur: 0.32, f0: [[0, 420], [0.08, 470], [0.32, 380]], am: { rate: 30, depth: 0.8 }, formants: F_AH, a: 0.02, g: 0.5 }),
    death: (v) => voiced(v, { dur: 0.6, f0: [[0, 400], [0.1, 430], [0.6, 240]], am: { rate: 24, depth: 0.8 }, formants: F_AH, a: 0.03, g: 0.5 }),
  },
  chicken: {
    idle: (v) => {
      const n = 2 + Math.floor(v.r() * 3);
      let t = 0;
      for (let i = 0; i < n; i++) {
        const f = rr(v, 560, 720);
        voiced(v, { t, dur: 0.07, f0: [[0, f], [0.07, f * 0.72]], formants: [[1100, 5, 1], [2400, 6, 0.4]], a: 0.004, g: 0.45 });
        t += rr(v, 0.1, 0.16);
      }
    },
    hurt: (v) => voiced(v, { dur: 0.2, f0: [[0, 900], [0.06, 1300], [0.2, 700]], formants: [[1300, 4, 1], [2600, 5, 0.4]], a: 0.005, g: 0.45, breath: 0.2 }),
    death: (v) => voiced(v, { dur: 0.35, f0: [[0, 1000], [0.08, 1250], [0.35, 500]], formants: [[1300, 4, 1], [2600, 5, 0.4]], a: 0.005, g: 0.45, breath: 0.2 }),
  },
  wolf: {
    idle: (v) => { // gentle panting
      for (let i = 0; i < 4; i++) noise(v, { t: i * 0.17, dur: 0.09, f: i % 2 ? 1500 : 1100, q: 1.5, g: 0.35, a: 0.02 });
    },
    bark: (v) => {
      const n = v.r() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) voiced(v, { t: i * 0.24, dur: 0.13, f0: [[0, 420], [0.03, 490], [0.13, 260]], formants: [[900, 4, 1], [1800, 5, 0.5]], a: 0.005, g: 0.55, breath: 0.45 });
    },
    whine: (v) => voiced(v, { type: 'triangle', dur: 0.7, f0: [[0, 700], [0.25, 950], [0.7, 640]], formants: [[1000, 2, 1], [2000, 3, 0.4]], vib: { rate: 6, depth: 15 }, a: 0.05, g: 0.5 }),
    hurt: (v) => voiced(v, { dur: 0.18, f0: [[0, 900], [0.05, 1200], [0.18, 700]], formants: [[1100, 3, 1], [2200, 4, 0.4]], a: 0.004, g: 0.5, breath: 0.2 }),
    death: (v) => voiced(v, { type: 'triangle', dur: 0.85, f0: [[0, 900], [0.2, 800], [0.85, 300]], formants: [[1000, 2, 1], [2000, 3, 0.4]], vib: { rate: 5, depth: 12 }, a: 0.03, g: 0.5 }),
    angry: (v) => voiced(v, { dur: 0.7, f0: [[0, 88], [0.7, 80]], am: { rate: 30, depth: 0.6 }, formants: [[420, 3, 1], [900, 4, 0.4]], a: 0.08, g: 0.45, breath: 0.2 }),
  },
  cat: {
    idle: (v) => voiced(v, { dur: 0.55, f0: [[0, 480], [0.15, 700], [0.55, 420]], formants: [[900, 6, 1], [1900, 7, 0.6]], fcurve: [[0, 0.6], [0.2, 1.2], [0.55, 0.7]], a: 0.03, g: 0.45 }),
    purr: (v) => voiced(v, { dur: 1.3, f0: [[0, 26], [1.3, 24]], formants: [[180, 1.5, 1], [500, 2, 0.4]], am: { rate: 1.6, depth: 0.6 }, a: 0.15, g: 0.7, breath: 0.25 }),
    hurt: (v) => voiced(v, { dur: 0.25, f0: [[0, 750], [0.06, 950], [0.25, 600]], formants: [[1100, 5, 1], [2200, 6, 0.5]], a: 0.01, g: 0.45, breath: 0.3 }),
    death: (v) => voiced(v, { dur: 0.6, f0: [[0, 700], [0.15, 760], [0.6, 320]], formants: [[1000, 5, 1], [2000, 6, 0.5]], fcurve: [[0, 1.1], [0.6, 0.6]], a: 0.02, g: 0.45 }),
  },
  horse: {
    idle: (v) => { // snort / soft blow
      crackle(v, { color: 'pink', dur: 0.28, n: 12, f: 500, fJit: 0.3, q: 1, g: 0.35, len: 0.016 });
      noise(v, { color: 'pink', dur: 0.3, f: 700, f2: 400, q: 1, g: 0.25, a: 0.02 });
    },
    neigh: (v) => voiced(v, { dur: 1.0, f0: [[0, 700], [0.1, 900], [0.6, 450], [1.0, 380]], vib: { rate: 14, depth: 55 }, formants: [[800, 4, 1], [1600, 5, 0.5]], a: 0.03, g: 0.45, breath: 0.15 }),
    hurt: (v) => voiced(v, { dur: 0.4, f0: [[0, 800], [0.1, 950], [0.4, 520]], vib: { rate: 14, depth: 40 }, formants: [[800, 4, 1], [1600, 5, 0.5]], a: 0.02, g: 0.45 }),
    death: (v) => voiced(v, { dur: 1.0, f0: [[0, 700], [0.15, 760], [1.0, 260]], vib: { rate: 10, depth: 40 }, formants: [[800, 4, 1], [1600, 5, 0.5]], a: 0.03, g: 0.45 }),
  },
  zombie: { // silly, soft "uuuh" - never scary
    idle: (v) => voiced(v, { dur: 1.1, f0: [[0, 122], [0.5, 106], [1.1, 96]], vib: { rate: 4, depth: 3 }, formants: F_OO, fcurve: [[0, 0.9], [0.4, 1.25], [1.1, 0.8]], a: 0.15, g: 0.42, breath: 0.2 }),
    hurt: (v) => voiced(v, { dur: 0.3, f0: [[0, 160], [0.3, 112]], formants: F_OO, fcurve: [[0, 1.3], [0.3, 0.9]], a: 0.02, g: 0.45, breath: 0.2 }),
    death: (v) => voiced(v, { dur: 1.2, f0: [[0, 130], [1.2, 70]], vib: { rate: 3, depth: 3 }, formants: F_OO, fcurve: [[0, 1.2], [1.2, 0.6]], a: 0.05, g: 0.42, breath: 0.2 }),
  },
  skeleton: { // wooden-sounding bone rattle
    idle: (v) => crackle(v, { dur: 0.35, n: 10, f: 2200, fJit: 0.25, q: 3, g: 0.45, len: 0.012 }),
    hurt: (v) => { crackle(v, { dur: 0.2, n: 7, f: 2000, fJit: 0.3, q: 3, g: 0.5, len: 0.012 }); knock(v, 0, 320, 0.25, 0.06); },
    death: (v) => { crackle(v, { dur: 0.7, n: 18, f: 1900, fJit: 0.35, q: 3, g: 0.5, len: 0.014, decay: 0.7 }); knock(v, 0.05, 280, 0.3, 0.08); knock(v, 0.3, 240, 0.25, 0.08); },
    step: (v) => crackle(v, { dur: 0.08, n: 3, f: 2300, q: 3, g: 0.35, len: 0.01 }),
  },
  spider: { // soft chitter + hiss
    idle: (v) => { crackle(v, { dur: 0.3, n: 9, type: 'highpass', f: 3500, q: 1, g: 0.3, len: 0.006 }); noise(v, { dur: 0.4, type: 'highpass', f: 4000, g: 0.12, a: 0.08 }); },
    hurt: (v) => { noise(v, { dur: 0.22, type: 'highpass', f: 3500, g: 0.25, a: 0.01 }); crackle(v, { dur: 0.15, n: 6, type: 'highpass', f: 3000, g: 0.3, len: 0.006 }); },
    death: (v) => noise(v, { dur: 0.8, type: 'highpass', f: 3000, f2: 1500, g: 0.25, a: 0.02 }),
    step: (v) => crackle(v, { dur: 0.08, n: 4, type: 'highpass', f: 3500, g: 0.2, len: 0.005 }),
  },
  creeper: { // creepers are almost silent; the fuse hiss is the warning
    idle: (v) => crackle(v, { dur: 0.15, n: 5, type: 'highpass', f: 3000, g: 0.15, len: 0.01 }),
    hurt: (v) => { noise(v, { color: 'pink', dur: 0.15, f: 1200, q: 1, g: 0.35, a: 0.005 }); crackle(v, { dur: 0.12, n: 5, type: 'highpass', f: 3000, g: 0.3 }); },
    death: (v) => poof(v, 0.5),
    hiss: (v) => { // fuse: a soft rising hiss, ~1.5 s
      noise(v, { dur: 1.5, type: 'highpass', f: 2500, f2: 4500, g: 0.3, a: 1.2 });
      crackle(v, { dur: 1.5, n: 26, type: 'highpass', f: 4000, g: 0.12, len: 0.005 });
    },
  },
};

function poof(v, g) {
  noise(v, { color: 'pink', dur: 0.28, type: 'lowpass', f: 1400, f2: 300, g, a: 0.01 });
  tone(v, { f: 320, f2: 150, dur: 0.15, g: g * 0.4 });
}

function genericStep(v) { MATERIALS.grass.step(v); }

/* ------------------------------------------------------------------ catalogue */
/** @type {Record<string, {r: Function, vol: number, range: number, gap?: number, pj?: number}>} */
export const SOUNDS = {};

function add(name, r, vol, range = 16, extra = {}) { SOUNDS[name] = { r, vol, range, ...extra }; }

// blocks: 12 materials x 5 kinds
const KIND_VOL = { break: 0.9, place: 0.8, step: 0.38, hit: 0.32, land: 0.6 };
for (const type of BLOCK_SOUND_TYPES) {
  const m = MATERIALS[type];
  for (const kind of BLOCK_KINDS) {
    const r = kind === 'land' ? landRecipe(m, false) : m[kind];
    add(`block.${kind}.${type}`, r, KIND_VOL[kind], kind === 'step' || kind === 'hit' ? 12 : 16);
  }
}

// UI (not positional)
add('ui.click', (v) => { tone(v, { f: 900, f2: 620, dur: 0.05, g: 0.5, a: 0.001 }); noise(v, { dur: 0.015, f: 2500, q: 1.5, g: 0.25, a: 0.001 }); }, 0.55, 0, { gap: 0.03 });
add('ui.open', (v) => { bell(v, { f: 784, dur: 0.35, g: 0.25 }); bell(v, { t: 0.07, f: 1047, dur: 0.4, g: 0.25 }); }, 0.5, 0, { gap: 0.1 });
add('ui.close', (v) => { bell(v, { f: 1047, dur: 0.3, g: 0.22 }); bell(v, { t: 0.07, f: 784, dur: 0.35, g: 0.22 }); }, 0.45, 0, { gap: 0.1 });
add('ui.tick', (v) => tone(v, { f: 1800, dur: 0.02, g: 0.3, a: 0.001 }), 0.35, 0, { gap: 0.02 });
add('ui.success', (v) => {
  [1047, 1319, 1568, 2093].forEach((f, i) => bell(v, { t: i * 0.07, f, dur: 0.5, g: 0.2 }));
  noise(v, { t: 0.2, dur: 0.3, type: 'highpass', f: 6000, g: 0.05, a: 0.05 });
}, 0.55, 0, { gap: 0.15, pj: 0 });
add('ui.whoosh', (v) => {
  noise(v, { color: 'pink', dur: 0.6, fpts: [[0, 300], [0.3, 2500], [0.6, 600]], q: 1.2, g: 0.5, a: 0.2 });
  tone(v, { t: 0.25, f: 660, f2: 1320, dur: 0.3, g: 0.1, a: 0.05 });
}, 0.55, 0, { gap: 0.3 });
add('ui.error', (v) => { // a gentle "uh-oh"
  const lp = lowpass(v, 1800);
  tone(v, { type: 'triangle', f: 440, dur: 0.12, g: 0.35, a: 0.01, to: lp });
  tone(v, { type: 'triangle', t: 0.13, f: 330, dur: 0.18, g: 0.35, a: 0.01, to: lp });
}, 0.5, 0, { gap: 0.25, pj: 0 });
add('ui.undo', (v) => {
  noise(v, { color: 'pink', dur: 0.4, fpts: [[0, 2200], [0.4, 400]], q: 1.2, g: 0.4, a: 0.05 });
  tone(v, { t: 0.3, f: 500, f2: 900, dur: 0.06, g: 0.3 });
}, 0.5, 0, { gap: 0.15 });
add('ui.hint', (v) => bell(v, { f: 1319, dur: 0.6, g: 0.25 }), 0.4, 0, { gap: 0.5, pj: 0 });
add('ui.sleep', (v) => [1319, 1047, 784].forEach((f, i) => bell(v, { t: i * 0.25, f, dur: 0.9, g: 0.18 })), 0.45, 0, { gap: 1, pj: 0 });

// player
add('player.hurt', (v) => { // soft "oof", never a scream
  voiced(v, { dur: 0.2, f0: [[0, 260], [0.05, 290], [0.2, 200]], formants: [[600, 4, 1], [1000, 5, 0.6]], a: 0.012, g: 0.5, breath: 0.15 });
  tone(v, { f: 120, f2: 80, dur: 0.08, g: 0.3 });
}, 0.6, 0, { gap: 0.15 });
add('player.land', (v) => { tone(v, { f: 85, f2: 50, dur: 0.09, g: 0.5 }); noise(v, { color: 'brown', dur: 0.06, type: 'lowpass', f: 400, g: 0.3 }); }, 0.5, 0);
add('player.bigfall', (v) => {
  tone(v, { f: 75, f2: 40, dur: 0.2, g: 0.6 });
  noise(v, { color: 'brown', dur: 0.16, type: 'lowpass', f: 320, g: 0.5 });
  noise(v, { color: 'pink', dur: 0.15, type: 'lowpass', f: 700, g: 0.3, a: 0.01 });
}, 0.65, 0);
add('player.splash', (v) => {
  noise(v, { dur: 0.45, f: 2500, f2: 600, q: 0.7, g: 0.55, a: 0.005 });
  noise(v, { color: 'pink', dur: 0.5, type: 'lowpass', f: 800, g: 0.3, a: 0.01 });
  bubbles(v, 0.08, 5, 0.18, 0.4);
}, 0.65, 16, { gap: 0.2 });
add('player.swim', (v) => { noise(v, { dur: 0.3, f: 900, f2: 1600, q: 1, g: 0.3, a: 0.08 }); bubbles(v, 0.1, 2, 0.1); }, 0.4, 0, { gap: 0.15 });
add('player.eat', (v) => {
  crackle(v, { color: 'pink', dur: 0.12, n: 5, f: 1400, q: 1, g: 0.5, len: 0.02 });
  noise(v, { color: 'pink', dur: 0.08, type: 'lowpass', f: 700, g: 0.3 });
}, 0.5, 0, { pj: 0.12 });
add('player.burp', (v) => voiced(v, { dur: 0.3, f0: [[0, 115], [0.15, 96], [0.3, 86]], am: { rate: 34, depth: 0.6 }, formants: [[500, 3, 1], [900, 4, 0.4]], a: 0.02, g: 0.35 }), 0.4, 0, { gap: 0.5 });
add('player.levelup', (v) => {
  [784, 988, 1175, 1568].forEach((f, i) => bell(v, { t: i * 0.09, f, dur: 0.8, g: 0.2 }));
  for (let i = 0; i < 5; i++) tone(v, { t: 0.35 + i * 0.05, f: rr(v, 2600, 4200), dur: 0.15, g: 0.05 });
}, 0.55, 0, { gap: 0.5, pj: 0 });
add('item.pop', (v) => {
  const f = rr(v, 520, 640);
  tone(v, { f, f2: f * 2.3, dur: 0.06, g: 0.55, a: 0.002, glideFrac: 0.6 });
  tone(v, { type: 'triangle', f: f * 0.5, f2: f * 1.1, dur: 0.05, g: 0.15, a: 0.002 });
}, 0.5, 0, { pj: 0.35, gap: 0.04 });
add('item.drop', (v) => { tone(v, { f: 380, f2: 600, dur: 0.06, g: 0.4 }); noise(v, { dur: 0.08, f: 1800, q: 1, g: 0.15, a: 0.01 }); }, 0.4, 12, { pj: 0.15 });
add('item.break', (v) => {
  crackle(v, { dur: 0.08, n: 4, f: 3000, q: 1.5, g: 0.5, len: 0.008 });
  tone(v, { f: 1200, f2: 380, dur: 0.16, g: 0.3, a: 0.002 });
  tone(v, { t: 0.05, f: 2600, dur: 0.12, g: 0.1 });
}, 0.55, 0, { gap: 0.2 });

// mobs: <voice>.idle|hurt|death|step for every voice, plus extras
for (const voice of MOB_VOICES) {
  const def = VOICES[voice];
  for (const kind of MOB_KINDS) {
    const r = def[kind] || (kind === 'step' ? genericStep : def.idle);
    const vol = kind === 'step' ? 0.25 : kind === 'idle' ? 0.6 : 0.65;
    add(`${voice}.${kind}`, r, vol, 16, { gap: kind === 'idle' ? 0.4 : 0.08 });
  }
}
add('wolf.bark', VOICES.wolf.bark, 0.6, 16, { gap: 0.3 });
add('wolf.whine', VOICES.wolf.whine, 0.55, 16, { gap: 0.5 });
add('wolf.angry', VOICES.wolf.angry, 0.5, 16, { gap: 0.5 });
add('cat.purr', VOICES.cat.purr, 0.5, 8, { gap: 1, pj: 0 });
add('horse.neigh', VOICES.horse.neigh, 0.55, 16, { gap: 0.5 });
add('creeper.hiss', VOICES.creeper.hiss, 0.55, 16, { gap: 0.3, pj: 0 });
add('mob.eat', (v) => { crackle(v, { color: 'pink', dur: 0.3, n: 8, f: 1600, q: 1, g: 0.4, len: 0.02 }); }, 0.4, 12, { gap: 0.3 });
add('mob.love', (v) => [1568, 1976, 2349].forEach((f, i) => bell(v, { t: i * 0.08, f, dur: 0.4, g: 0.16 })), 0.45, 16, { gap: 0.3 });
add('entity.pop', (v) => { const f = rr(v, 300, 380); tone(v, { f, f2: f * 2.2, dur: 0.1, g: 0.45, a: 0.003 }); noise(v, { color: 'pink', dur: 0.12, type: 'lowpass', f: 1500, g: 0.15 }); }, 0.45, 16, { pj: 0.1 });
add('entity.poof', (v) => poof(v, 0.5), 0.45, 16, { gap: 0.05 });

// world
add('tnt.fuse', (v) => { // soft fizz for the whole fuse (v.q.dur seconds, default 4)
  const d = Math.max(0.5, Math.min(6, v.q.dur || 4));
  noise(v, { dur: d, type: 'highpass', f: 3000, f2: 3800, g: 0.22, a: 0.08, hold: d - 0.3 });
  crackle(v, { dur: d, n: Math.round(d * 14), type: 'highpass', f: 4500, g: 0.16, len: 0.005 });
}, 0.5, 16, { gap: 0.05, pj: 0 });
add('explosion', (v) => {
  // Kid-safe: a round soft "whump" (no sharp crack), rumble, then a gentle patter of falling bits.
  const kid = v.q.kid !== false;
  const a = kid ? 0.03 : 0.012;
  const lp = lowpass(v, kid ? 2500 : 5000);
  tone(v, { f: 68, f2: 30, dur: 1.0, a, g: kid ? 0.5 : 0.52, to: lp });
  tone(v, { f: 110, f2: 45, dur: 0.5, a, g: 0.25, to: lp });
  noise(v, { color: 'brown', dur: 1.5, type: 'lowpass', f: kid ? 700 : 1200, f2: 140, g: kid ? 0.55 : 0.58, a: a * 1.5, to: lp });
  noise(v, { color: 'pink', dur: 0.5, f: kid ? 900 : 1500, f2: 250, q: 0.7, g: kid ? 0.25 : 0.3, a, to: lp });
  crackle(v, { t: 0.18, dur: 1.1, n: 16, color: 'pink', f: 1400, fJit: 0.5, q: 1, g: 0.22, len: 0.016, decay: 0.8, to: lp });
}, 0.55, 48, { gap: 0.08, pj: 0.08 });
const creak = (v, t, f, dur, g) => voiced(v, { t, dur, f0: [[0, f], [dur * 0.5, f * 1.3], [dur, f * 1.1]], formants: [[700, 6, 1], [1500, 7, 0.5]], am: { rate: 38, depth: 0.7 }, a: 0.02, g });
add('door.open', (v) => { knock(v, 0, 900, 0.15, 0.03); creak(v, 0.02, rr(v, 85, 100), 0.3, 0.9); }, 0.6, 16, { gap: 0.1 });
add('door.close', (v) => { knock(v, 0, rr(v, 170, 200), 0.55, 0.12); noise(v, { color: 'brown', dur: 0.1, type: 'lowpass', f: 500, g: 0.35 }); knock(v, 0.03, 1000, 0.12, 0.03); }, 0.65, 16, { gap: 0.1 });
add('chest.open', (v) => { creak(v, 0, rr(v, 70, 80), 0.42, 0.9); knock(v, 0.38, 240, 0.2, 0.06); }, 0.55, 16, { gap: 0.15 });
add('chest.close', (v) => { knock(v, 0, 170, 0.5, 0.14); noise(v, { color: 'brown', dur: 0.12, type: 'lowpass', f: 450, g: 0.4 }); }, 0.6, 16, { gap: 0.15 });
add('furnace.crackle', (v) => { crackle(v, { color: 'pink', dur: 0.6, n: 8, f: 1500, fJit: 0.5, q: 1, g: 0.35, len: 0.01 }); noise(v, { color: 'brown', dur: 0.6, type: 'lowpass', f: 300, g: 0.15, a: 0.1 }); }, 0.4, 10, { gap: 0.3 });
add('bucket.fill', (v) => {
  noise(v, { dur: 0.45, f: 700, f2: 1300, q: 1.5, g: 0.3, a: 0.03 });
  for (let i = 0; i < 5; i++) { const f = 300 + i * 90; tone(v, { t: i * 0.08, f, f2: f * 1.8, dur: 0.06, g: 0.18 }); }
}, 0.55, 16, { gap: 0.2 });
add('bucket.empty', (v) => { noise(v, { dur: 0.45, f: 1500, f2: 400, q: 0.8, g: 0.45, a: 0.01 }); bubbles(v, 0.1, 3, 0.12); }, 0.55, 16, { gap: 0.2 });
add('fire.ignite', (v) => { noise(v, { color: 'pink', dur: 0.32, f: 600, f2: 2000, q: 1, g: 0.4, a: 0.04 }); crackle(v, { t: 0.05, dur: 0.3, n: 6, type: 'highpass', f: 3000, g: 0.25 }); }, 0.5, 16, { gap: 0.15 });
add('lava.pop', (v) => { tone(v, { f: 220, f2: 90, dur: 0.08, g: 0.45 }); noise(v, { color: 'brown', dur: 0.06, type: 'lowpass', f: 500, g: 0.3 }); }, 0.45, 12, { gap: 0.1 });
add('shear', (v) => { for (const t of [0, 0.12]) { crackle(v, { t, dur: 0.03, n: 1, type: 'highpass', f: 5000, g: 0.45, len: 0.02 }); tone(v, { t, f: 3800, dur: 0.04, g: 0.12, a: 0.001 }); } }, 0.5, 16, { gap: 0.15 });
add('bonemeal', (v) => { for (let i = 0; i < 4; i++) bell(v, { t: i * 0.06, f: rr(v, 1800, 3200), dur: 0.3, g: 0.1 }); noise(v, { dur: 0.15, type: 'highpass', f: 6000, g: 0.08, a: 0.02 }); }, 0.45, 16, { gap: 0.1 });
add('egg.lay', (v) => { tone(v, { f: 600, f2: 250, dur: 0.08, g: 0.45 }); noise(v, { color: 'pink', dur: 0.05, type: 'lowpass', f: 900, g: 0.2 }); }, 0.45, 12, { gap: 0.2 });
add('water.ambient', (v) => {
  noise(v, { color: 'pink', dur: 2, f: 900, q: 0.5, g: 0.2, a: 0.5, hold: 1 });
  bubbles(v, 0.2, 6, 0.08, 1.5);
}, 0.3, 12, { gap: 1.5, pj: 0 });

/** Aliases accepted by play() / the 'sound' event. */
export const ALIASES = {
  'gate.open': 'door.open', 'gate.close': 'door.close', 'pop': 'item.pop', 'click': 'ui.click', 'whoosh': 'ui.whoosh',
  'oink': 'pig.idle', 'moo': 'cow.idle', 'baa': 'sheep.idle', 'cluck': 'chicken.idle', 'woof': 'wolf.bark',
  'meow': 'cat.idle', 'groan': 'zombie.idle', 'rattle': 'skeleton.idle', 'hiss': 'creeper.hiss', 'eat': 'player.eat',
};

/** Resolve a public name (or alias) to a catalogue key, or null. */
export function resolveSound(name) {
  if (typeof name !== 'string') return null;
  if (SOUNDS[name]) return name;
  const a = ALIASES[name];
  return a && SOUNDS[a] ? a : null;
}

/** Catalogue key for a block sound, or null for 'none'/unknown. */
export function blockSoundName(kind, soundType) {
  const k = BLOCK_KINDS.includes(kind) ? kind : 'place';
  const t = BLOCK_SOUND_TYPES.includes(soundType) ? soundType : (soundType === 'none' ? null : 'stone');
  return t ? `block.${k}.${t}` : null;
}


// Loudness trims (levels.js): every entry gets a linear `trim` measured through the real mixing chain.
for (const [name, def] of Object.entries(SOUNDS)) def.trim = Math.pow(10, (TRIM_DB[name] || 0) / 20);
