// OWNER LANE: CORE-D (renderer/sky). STUB-QUALITY implementation by LEAD - CORE-D tunes colours/curves but
// keeps the signature. Pure (no three.js). Spec: docs/SPEC.md §5.5.4.

import { registerStub } from '../core/stubs.js';
import { DAY_TICKS } from '../core/constants.js';

registerStub('sky');

const DAY_SKY = [0.47, 0.65, 1.0];
const NIGHT_SKY = [0.02, 0.03, 0.08];
const DAY_FOG = [0.72, 0.83, 1.0];
const NIGHT_FOG = [0.03, 0.04, 0.09];

/**
 * Sky state for a time of day.
 * @param {number} dayTime 0..23999 (0 = sunrise, 6000 noon, 18000 midnight)
 * @param {number} [rain] 0..1 (darkens sky, daylight max 12/15)
 * @returns {{celestialAngle:number, daylight:number, skyColor:number[], fogColor:number[],
 *            sunsetColor:number[]|null, starBrightness:number, moonPhase:number, sunDir:number[]}}
 *   colours are [r,g,b] in 0..1 (gamma space); daylight 0..1 drives the chunk shader's sky dimming;
 *   sunDir is a unit vector toward the sun (moon is opposite).
 */
export function computeSky(dayTime, rain = 0, day = 0) {
  const f0 = ((dayTime / DAY_TICKS - 0.25) % 1 + 1) % 1;
  const celestialAngle = f0 + ((1 - (Math.cos(f0 * Math.PI) + 1) / 2) - f0) / 3;
  const c = Math.cos(celestialAngle * Math.PI * 2);
  let daylight = Math.min(1, Math.max(0, c * 2 + 0.5));
  daylight *= 1 - rain * 0.25;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const skyColor = mix(NIGHT_SKY, DAY_SKY, daylight);
  const fogColor = mix(NIGHT_FOG, DAY_FOG, daylight);
  // sunrise/sunset glow when the sun is near the horizon
  const s = Math.cos(celestialAngle * Math.PI * 2);
  let sunsetColor = null;
  if (s > -0.4 && s < 0.4) {
    const t = (s / 0.4) * 0.5 + 0.5;
    const a = Math.pow(1 - (1 - Math.sin(t * Math.PI)) * 0.99, 2);
    sunsetColor = [t * 0.3 + 0.7, t * t * 0.7 + 0.2, 0.2, a];
  }
  const ang = celestialAngle * Math.PI * 2;
  return {
    celestialAngle,
    daylight,
    skyColor,
    fogColor,
    sunsetColor,
    starBrightness: Math.max(0, 1 - daylight * 1.6) * 0.8,
    moonPhase: ((day % 8) + 8) % 8,
    sunDir: [-Math.sin(ang), Math.cos(ang), 0],
  };
}
