// OWNER LANE: CORE-D (renderer/sky). Pure (no three.js, no DOM): runs in Node unit tests. Spec: docs/SPEC.md §5.5.4.
//
// computeSky(dayTime, rain, day) -> the colours and angles the renderer (sky dome, fog, chunk daylight) and
// FX (sun, moon, stars, clouds via renderer.sky) need for one moment of the day. Changing the time only
// changes these numbers (uniforms) - never a remesh.

import { DAY_TICKS } from '../core/constants.js';

/** Clear-weather palette (gamma space 0..1). Day colours follow the classic plains sky; night is a friendly deep blue. */
export const SKY_PALETTE = Object.freeze({
  DAY_SKY: Object.freeze([0.47, 0.65, 1.0]),     // zenith at noon (#78a7ff)
  DAY_FOG: Object.freeze([0.75, 0.85, 1.0]),     // horizon / fog at noon (#c0d8ff)
  NIGHT_SKY: Object.freeze([0.02, 0.03, 0.09]),  // zenith at midnight
  NIGHT_FOG: Object.freeze([0.04, 0.05, 0.12]),  // horizon / fog at midnight
  UNDERWATER: Object.freeze([0x1e / 255, 0x4c / 255, 0xc0 / 255]), // #1e4cc0 (SPEC §5.5.3)
  LAVA: Object.freeze([0.8, 0.25, 0.04]),
});

/**
 * Celestial angle (Java formula): 0 = noon, 0.25 = sunset, 0.5 = midnight, 0.75 = sunrise.
 * @param {number} dayTime ticks (any value; wraps)
 */
export function celestialAngle(dayTime) {
  const f = ((dayTime / DAY_TICKS - 0.25) % 1 + 1) % 1;
  return f + ((1 - (Math.cos(f * Math.PI) + 1) / 2) - f) / 3;
}

/** Daylight 0..1 for a celestial angle: clamp(cos(a*2pi)*2 + 0.5, 0, 1) x (1 - 0.25*rain). */
export function daylightFor(angle, rain = 0) {
  const c = Math.cos(angle * Math.PI * 2);
  return Math.min(1, Math.max(0, c * 2 + 0.5)) * (1 - 0.25 * clamp01(rain));
}

/**
 * Sky state for a time of day.
 * @param {number} dayTime 0..23999 (0 = sunrise, 6000 noon, 12000 sunset, 18000 midnight)
 * @param {number} [rain] 0..1 (greys and darkens the sky, daylight max x0.75)
 * @param {number} [day]  completed days (moon phase = day % 8)
 * @returns {{celestialAngle:number, daylight:number, skyColor:number[], fogColor:number[],
 *            sunsetColor:number[]|null, starBrightness:number, moonPhase:number, sunDir:number[]}}
 *   colours are [r,g,b] in 0..1 (gamma space); daylight 0..1 drives the chunk shader's sky dimming;
 *   sunsetColor is [r,g,b,a] near sunrise/sunset (a = glow strength) else null; starBrightness 0..1;
 *   sunDir is a unit vector toward the sun (sunrise = east +X, noon = up, sunset = west -X; the moon is opposite).
 */
export function computeSky(dayTime, rain = 0, day = 0) {
  rain = clamp01(Number.isFinite(rain) ? rain : 0);
  const angle = celestialAngle(Number.isFinite(dayTime) ? dayTime : 6000);
  const c = Math.cos(angle * Math.PI * 2);
  const daylight = daylightFor(angle, rain);
  // Colour blend factor: like daylight but without the rain factor (rain greys colours separately).
  const k = Math.min(1, Math.max(0, c * 2 + 0.5));
  const t = k * k * (3 - 2 * k); // smoothstep: longer blue twilight, quicker deep night
  const P = SKY_PALETTE;
  let skyColor = mix3(P.NIGHT_SKY, P.DAY_SKY, t);
  let fogColor = mix3(P.NIGHT_FOG, P.DAY_FOG, t);
  if (rain > 0) {
    skyColor = rainGrey(skyColor, rain);
    fogColor = rainGrey(fogColor, rain);
  }
  // Sunrise / sunset glow (Java formula): only while the sun is near the horizon.
  let sunsetColor = null;
  if (c > -0.4 && c < 0.4) {
    const s = (c / 0.4) * 0.5 + 0.5;
    let a = 1 - (1 - Math.sin(s * Math.PI)) * 0.99;
    a *= a;
    sunsetColor = [s * 0.3 + 0.7, s * s * 0.7 + 0.2, 0.2, a * (1 - rain * 0.8)];
  }
  // Stars fade in after sunset and out before sunrise.
  const st = Math.min(1, Math.max(0, 1 - (c * 2 + 0.25)));
  const ang = angle * Math.PI * 2;
  return {
    celestialAngle: angle,
    daylight,
    skyColor,
    fogColor,
    sunsetColor,
    starBrightness: st * st * (1 - rain),
    moonPhase: ((Math.floor(day) % 8) + 8) % 8,
    sunDir: [-Math.sin(ang), Math.cos(ang), 0],
  };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rainGrey(col, rain) {
  const l = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) * 0.6;
  const f = rain * 0.75;
  return [col[0] + (l - col[0]) * f, col[1] + (l - col[1]) * f, col[2] + (l - col[2]) * f];
}
