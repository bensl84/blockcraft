// OWNER: LEAD (shared). Day/night clock system. 24000 ticks per day, dayTime 0 = 06:00 (sunrise).
// Sky colours / daylight curves are CORE-D's (src/render/sky.js); this file only keeps the clock.

import { DAY_TICKS, KID_LOCKED_TIME, TIME_EVENTS } from './constants.js';

/**
 * @returns {import('./types.js').System & {dayTime:number,totalTicks:number,day:number,setTime(t:number):void,
 *   advance(n:number):void, isNight():boolean, serialize():object, deserialize(game:object, o:object):void}}
 */
export function createTimeSystem(game) {
  const sys = {
    name: 'time',
    dayTime: KID_LOCKED_TIME, // 0..23999
    totalTicks: 0,            // ticks since world creation (never wraps)
    day: 0,                   // completed days

    init() {},

    tick() {
      sys.totalTicks++;
      const rules = game.meta ? game.meta.rules : null;
      if (rules && rules.daylightCycle) sys.advance(1);
    },

    /** Advance the clock by n ticks, emitting time events crossed. */
    advance(n) {
      const before = sys.dayTime;
      let t = before + n;
      while (t >= DAY_TICKS) { t -= DAY_TICKS; sys.day++; }
      sys.dayTime = t;
      for (const [name, at] of Object.entries(TIME_EVENTS)) {
        if (crossed(before, n, at)) game.events.emit('time:' + name, { dayTime: sys.dayTime, day: sys.day });
      }
    },

    /** Set absolute dayTime (0..23999; values outside wrap). Emits 'time:set'. */
    setTime(t) {
      sys.dayTime = ((Math.round(t) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
      game.events.emit('time:set', { dayTime: sys.dayTime, day: sys.day });
    },

    isNight() { return sys.dayTime >= 12542 && sys.dayTime <= 23459; },
    serialize() { return { dayTime: sys.dayTime, totalTicks: sys.totalTicks, day: sys.day }; },
    deserialize(g, o) {
      sys.dayTime = o && Number.isFinite(o.dayTime) ? o.dayTime : KID_LOCKED_TIME;
      sys.totalTicks = o && Number.isFinite(o.totalTicks) ? o.totalTicks : 0;
      sys.day = o && Number.isFinite(o.day) ? o.day : 0;
    },
  };
  return sys;
}

function crossed(before, n, at) {
  if (n <= 0) return false;
  if (n >= DAY_TICKS) return true;
  const end = before + n;
  return (before < at && end >= at) || (end >= DAY_TICKS && end - DAY_TICKS >= at);
}
