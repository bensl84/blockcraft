// OWNER LANE: KID. Onboarding hint pictograms (SPEC §2.7 "Hints", P1): animated pictures, no reading needed.
// Two variants per hint: 'keys' (keyboard + trackpad) and 'touch' (on-screen buttons + finger). Every
// animation is one CSS loop of 2.4 s (kid.css, HINT.LOOP_TICKS = 48 ticks).

import { ICONS, blockSvg } from './pixelicons.js';

const key = (inner, extra = '') => `<div class="kid-key ${extra}">${inner}</div>`;
const plate = (inner, extra = '') => `<div class="kid-mini-plate ${extra}">${inner}</div>`;
const hand = (extra = '') => `<div class="kid-hand ${extra}">${ICONS.hand()}</div>`;
const figure = (extra = '') => `<div class="kid-figure ${extra}">${ICONS.kid()}</div>`;
const chevrons = () => `<div class="kid-chevrons"><i>${ICONS.up()}</i><i>${ICONS.up()}</i><i>${ICONS.up()}</i></div>`;
const slots = () => `<div class="kid-slots">${['#6cbf3b', '#b5834a', '#9a9a9a', '#d8432f', '#ffd400'].map((c, i) => `<div class="kid-slot kid-slot${i}"><i style="background:${c}"></i></div>`).join('')}<div class="kid-slot-sel"></div></div>`;

/** Spoken lines (only with settings.speakNames, local voices only). */
export const HINT_LINES = Object.freeze({
  walk: { keys: 'Press the up arrow to walk!', touch: 'Press the up arrow to walk!' },
  turn: { keys: 'Use the side arrows to turn around!', touch: 'Use the side arrows to turn around!' },
  place: { keys: 'Tap to put a block down!', touch: 'Tap to put a block down!' },
  break: { keys: 'Hold your finger down to break a block!', touch: 'Hold your finger down to break a block!' },
  pick: { keys: 'Tap a box at the bottom to pick a block!', touch: 'Tap a box at the bottom to pick a block!' },
  fly: { keys: 'Press F to fly!', touch: 'Press the wings to fly!' },
  unstuck: { keys: 'Hold the space bar to jump out!', touch: 'Hold the up button to jump out!' },
});

/** HTML of a hint pictogram. name: walk|turn|place|break|pick|fly|unstuck, variant: 'keys'|'touch'. */
export function hintHtml(name, variant = 'keys') {
  const touch = variant === 'touch';
  switch (name) {
    case 'walk':
      return `<div class="kid-pic kid-pic-walk">${touch
        ? `<div class="kid-press-wrap">${plate(ICONS.forward(), 'kid-anim-press')}${hand('kid-anim-handpress')}</div>`
        : key(ICONS.forward(), 'kid-anim-press')}<div class="kid-walk-stage">${chevrons()}${figure('kid-anim-walk')}</div></div>`;
    case 'turn':
      return `<div class="kid-pic kid-pic-turn">${touch ? plate(ICONS.turnLeft(), 'kid-anim-pressA') : key(ICONS.arrowLeft(), 'kid-anim-pressA')}`
        + '<div class="kid-view"><div class="kid-view-cone kid-anim-look"></div><div class="kid-view-head"></div></div>'
        + `${touch ? plate(ICONS.turnRight(), 'kid-anim-pressB') : key(ICONS.arrowRight(), 'kid-anim-pressB')}</div>`;
    case 'place':
      return `<div class="kid-pic kid-pic-place"><div class="kid-target"></div><div class="kid-place-block kid-anim-pop">${blockSvg()}</div>${hand('kid-anim-tap')}</div>`;
    case 'break':
      return `<div class="kid-pic kid-pic-break"><div class="kid-break-block kid-anim-break">${blockSvg('kid-anim-cracks')}</div>${hand('kid-anim-hold')}<div class="kid-hold-ring kid-anim-ring"></div></div>`;
    case 'pick':
      return `<div class="kid-pic kid-pic-pick">${slots()}${hand('kid-anim-pickhand')}</div>`;
    case 'fly':
      return `<div class="kid-pic kid-pic-fly">${touch
        ? `<div class="kid-press-wrap">${plate(ICONS.fly(), 'kid-anim-press')}${hand('kid-anim-handpress')}</div>`
        : key('<span class="kid-key-letter">F</span>', 'kid-anim-press')}<div class="kid-fly-stage"><div class="kid-fly-wings kid-anim-rise">${ICONS.fly()}${ICONS.kid()}</div><div class="kid-ground"></div></div></div>`;
    case 'unstuck':
      return `<div class="kid-pic kid-pic-unstuck">${touch
        ? `<div class="kid-press-wrap">${plate(ICONS.jump(), 'kid-anim-holdkey')}${hand('kid-anim-handhold')}</div>`
        : key('<div class="kid-space-bar"></div>', 'kid-key-wide kid-anim-holdkey')}<div class="kid-hold-bar"><i class="kid-anim-fill"></i></div><div class="kid-unstuck-stage"><div class="kid-anim-popup">${ICONS.kid()}</div><div class="kid-pit"></div></div></div>`;
    default:
      return '';
  }
}

export const ALL_HINTS = Object.freeze(['walk', 'turn', 'place', 'break', 'pick', 'fly', 'unstuck']);
