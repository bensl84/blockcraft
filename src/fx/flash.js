// OWNER LANE: FEATURE-FX. Flash safety (SPEC §8.7, WCAG 2.3.1): never more than 3 flashes in any 1-second
// window. Pure (the clock is passed in) so it is unit tested.

export class FlashLimiter {
  constructor(maxPerSecond = 3) { this.max = maxPerSecond; this.times = []; }
  /** True (and recorded) when a flash may start at nowMs. */
  allow(nowMs) {
    while (this.times.length && nowMs - this.times[0] >= 1000) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(nowMs);
    return true;
  }
}
