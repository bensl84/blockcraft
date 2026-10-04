// OWNER LANE: KID (touch). Pure layout and gesture math for the touch overlay (SPEC §8.5.1). No DOM, so it
// is unit-tested in Node (test/kid.test.mjs).

/** Button size per settings.buttonSize (SPEC §3.8: S 80 / M 96 / L 112). */
export const BUTTON_SIZES = Object.freeze({ S: 80, M: 96, L: 112 });
export const EDGE = 24;          // minimum distance from the screen edges (SPEC §9 kid rules)
export const GAP = 8;            // minimum gap between targets
export const SAFE_RING = 12;     // D-pad hit area extends this far past its buttons (SPEC: 8-12 px ring)
export const PALM_PX = 40;       // contacts larger than this are palms (ignored)

/**
 * Compute every control rectangle in CSS px for a W x H viewport.
 * @returns {{btn:number, dpad:{cx:number, cy:number, btn:number, offset:number, extent:number, hit:number},
 *   jump:Rect, fly:Rect, down:Rect, pause:Rect, joystick:{cx:number, cy:number, base:number, knob:number, travel:number}}}
 * Rect = {x, y, w, h} (top-left). Mirrored horizontally when leftHanded (pause stays top right).
 * hud = {left, right, top}: the HUD's bottom block (hotbar, backpack, hearts/food rows) in CSS px. When the
 * jump / down / fly column would overlap it (narrow or touch laptops), the column is lifted above it (LEAD
 * integration, KID request 2: at 1024 x 600 the backpack sat under the Jump button).
 */
export function touchLayout(W, H, buttonSize = 'M', leftHanded = false, hud = null) {
  const B = BUTTON_SIZES[buttonSize] || BUTTON_SIZES.M;
  // D-pad: 4 buttons of dbtn around a centre, 8 px apart. At M: 88 px buttons, centre (24+140, H-24-140).
  // (short screens shrink the D-pad toward 80 px so it keeps its 24 px margins)
  const dbtn = Math.max(80, Math.min(B - 8, Math.floor(((H - 2 * EDGE) / 2 - GAP) / 1.5)));
  const offset = dbtn + GAP;
  const extent = offset + dbtn / 2;
  const dpad = { cx: EDGE + extent, cy: H - EDGE - extent, btn: dbtn, offset, extent, hit: extent + SAFE_RING };
  // Jump / Up: 112 px at M, about 100 px from the right edge and 140 px from the bottom.
  const J = B + 16;
  const jump = { x: W - 44 - J, y: H - 84 - J, w: J, h: J };
  // Fly toggle above jump.
  const F = Math.max(80, B - 16);
  const fly = { x: jump.x + (J - F) / 2, y: jump.y - 12 - F, w: F, h: F };
  // Down (only while flying): left of jump, bottoms aligned.
  const D = B;
  const down = { x: jump.x - 12 - D, y: jump.y + J - D, w: D, h: D };
  // Pause: top right.
  const pause = { x: W - EDGE - 80, y: EDGE, w: 80, h: 80 };
  const joystick = { cx: dpad.cx, cy: dpad.cy, base: 160, knob: 64, travel: 48 };
  const out = { btn: B, dpad, jump, fly, down, pause, joystick };
  if (leftHanded) {
    const mx = (r) => { r.x = W - r.x - r.w; };
    mx(jump); mx(fly); mx(down);
    dpad.cx = W - dpad.cx; joystick.cx = dpad.cx;
  }
  // keep the column clear of the HUD block: lift it so its bottom sits GAP above the HUD's top
  if (hud && Number.isFinite(hud.top)) {
    const l = Math.min(jump.x, down.x), r = Math.max(jump.x + J, down.x + D);
    const lift = jump.y + J - (hud.top - GAP);
    if (l < hud.right + GAP && r > hud.left - GAP && lift > 0) {
      const y = Math.max(pause.y + pause.h + GAP, jump.y - lift);   // never under the pause button
      const dy = jump.y - y;
      jump.y -= dy; down.y -= dy; fly.y -= dy;
    }
  }
  // Short screens (landscape phones): no room above jump, so fly goes beside the Down button.
  if (fly.y < pause.y + pause.h + GAP) { fly.x = leftHanded ? down.x + D + 12 : down.x - 12 - F; fly.y = jump.y + J - F; }
  return out;
}

/** Rectangles of the visible D-pad buttons (for tests and drawing). */
export function dpadRects(d) {
  const h = d.btn / 2;
  return {
    forward: { x: d.cx - h, y: d.cy - d.offset - h, w: d.btn, h: d.btn },
    back: { x: d.cx - h, y: d.cy + d.offset - h, w: d.btn, h: d.btn },
    turnLeft: { x: d.cx - d.offset - h, y: d.cy - h, w: d.btn, h: d.btn },
    turnRight: { x: d.cx + d.offset - h, y: d.cy - h, w: d.btn, h: d.btn },
  };
}

/**
 * D-pad: 8 sectors around the centre (finger may slide between them, Bedrock style). dx, dy in px relative to
 * the centre (+y down). Inside the dead zone nothing is held.
 * @returns {{forward:boolean, back:boolean, turnLeft:boolean, turnRight:boolean}}
 */
export function dpadActions(dx, dy, dead, out = {}) {
  out.forward = out.back = out.turnLeft = out.turnRight = false;
  if (Math.hypot(dx, dy) < dead) return out;
  // angle 0 = right, counter-clockwise positive with y up
  const a = Math.atan2(-dy, dx);
  const sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8; // 0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE
  if (sector === 1 || sector === 2 || sector === 3) out.forward = true;
  if (sector === 5 || sector === 6 || sector === 7) out.back = true;
  if (sector === 3 || sector === 4 || sector === 5) out.turnLeft = true;
  if (sector === 7 || sector === 0 || sector === 1) out.turnRight = true;
  return out;
}

/** Joystick knob: clamp (dx, dy) to `travel`; returns {kx, ky (px), fx, sx (-1..1: forward, right)}. */
export function joystickVector(dx, dy, travel, out = {}) {
  const d = Math.hypot(dx, dy);
  const k = d > travel ? travel / d : 1;
  out.kx = dx * k; out.ky = dy * k;
  out.fx = -out.ky / travel; out.sx = out.kx / travel;
  const dead = 0.15;
  if (Math.abs(out.fx) < dead) out.fx = 0;
  if (Math.abs(out.sx) < dead) out.sx = 0;
  return out;
}

/** SPEC §8.5.1: shown when touchControls is 'on', or 'auto' and the last pointer was a touch (or pen). */
export function wantTouch(setting, lastPointerType) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return lastPointerType === 'touch' || lastPointerType === 'pen';
}

/** True for palm-sized contacts (ignored). */
export function isPalm(width, height) { return (width || 0) > PALM_PX || (height || 0) > PALM_PX; }

/** Rectangle overlap with a margin (tests: controls never overlap and keep GAP px apart). */
export function rectsTooClose(a, b, gap = GAP) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
