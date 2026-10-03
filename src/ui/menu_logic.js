// OWNER LANE: FEATURE-MENUS. Pure helpers for the menus (no DOM): parent-gate state machine, world names,
// picture-card paging and the new-world choices. Unit-tested in test/menus.test.mjs.

/** How long the parent gate's button must be held (SPEC §8.4.4). */
export const GATE_HOLD_MS = 3000;
/** Wrong answers before the gate goes back to the hold step. */
export const GATE_MAX_TRIES = 3;

/** A random two-digit sum: a and b in 11..49, so the answer is two digits too. rand() -> [0,1). */
export function makeSum(rand = Math.random) {
  const a = 11 + Math.floor(rand() * 39), b = 11 + Math.floor(rand() * 39);
  return { a, b, answer: a + b };
}

/**
 * Parent gate state machine (SPEC §8.4.4): stage 'hold' -> (held GATE_HOLD_MS continuously) -> 'answer' ->
 * correct sum -> 'passed'. Digits typed during 'hold' are ignored, so random taps never pass. Wrong answers
 * pick a new sum; after GATE_MAX_TRIES wrong answers the gate returns to 'hold'. Times are passed in (ms).
 */
export class GateMachine {
  constructor(rand = Math.random, holdMs = GATE_HOLD_MS) {
    this.rand = rand;
    this.holdMs = holdMs;
    this.stage = 'hold';
    this.holdStart = -1;
    this.entry = '';
    this.tries = 0;
    this.sum = null;
  }
  /** 0..1 progress of the current hold (0 when not holding). */
  holdProgress(now) {
    if (this.stage !== 'hold' || this.holdStart < 0) return this.stage === 'hold' ? 0 : 1;
    return Math.min(1, (now - this.holdStart) / this.holdMs);
  }
  pressHold(now) { if (this.stage === 'hold') this.holdStart = now; }
  /** Release (or pointer left the button): the hold resets unless it completed. */
  releaseHold(now) {
    if (this.stage !== 'hold') return;
    if (this.holdStart >= 0 && now - this.holdStart >= this.holdMs) this.toAnswer();
    this.holdStart = -1;
  }
  /** Call every frame: completes the hold as soon as the time is reached (no need to let go). */
  update(now) {
    if (this.stage === 'hold' && this.holdStart >= 0 && now - this.holdStart >= this.holdMs) { this.toAnswer(); this.holdStart = -1; return true; }
    return false;
  }
  toAnswer() { this.stage = 'answer'; this.entry = ''; this.sum = makeSum(this.rand); }
  /** Type a digit (ignored unless answering). */
  digit(d) {
    if (this.stage !== 'answer') return;
    if (this.entry.length < 3) this.entry += String(d).replace(/[^0-9]/g, '').slice(0, 1);
  }
  backspace() { if (this.stage === 'answer') this.entry = this.entry.slice(0, -1); }
  /** Submit the typed answer -> 'passed' | 'wrong' | 'reset' | 'ignored'. */
  submit() {
    if (this.stage !== 'answer') return 'ignored';
    if (this.entry !== '' && Number(this.entry) === this.sum.answer) { this.stage = 'passed'; return 'passed'; }
    this.tries++;
    if (this.tries >= GATE_MAX_TRIES) { this.stage = 'hold'; this.tries = 0; this.entry = ''; this.sum = null; return 'reset'; }
    this.toAnswer();
    return 'wrong';
  }
  get passed() { return this.stage === 'passed'; }
}

/* ------------------------------------------------------------------ world names */
const NAME_POOLS = {
  flat: ['Builder Field', 'Flat Meadow', 'Big Green', 'Block Garden', 'Sunny Field', 'Pony Plains'],
  default: ['Sunny Meadow', 'Happy Hills', 'Cozy Forest', 'Rainbow Valley', 'Blue Lake', 'Flower Hills', 'Puppy Park'],
  snowy: ['Snowy Peak', 'Frosty Hills', 'Snowball Land', 'Ice Valley', 'Polar Woods', 'Winter Hills'],
  islands: ['Sandy Islands', 'Sunny Shore', 'Coconut Bay', 'Turtle Isle'],
};

/** A friendly world name for a preset, avoiding names already in `taken`. rand() -> [0,1). */
export function makeWorldName(preset = 'default', taken = [], rand = Math.random) {
  const pool = NAME_POOLS[preset] || NAME_POOLS.default;
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  for (let i = 0; i < 200; i++) {
    const name = `${pool[Math.floor(rand() * pool.length)]} ${1 + Math.floor(rand() * 99)}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  let n = 100;
  while (used.has(`${pool[0]} ${n}`.toLowerCase())) n++;
  return `${pool[0]} ${n}`;
}

/** Clean a parent-typed world name (trim, collapse spaces, max 32 chars); '' when nothing usable. */
export function cleanWorldName(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/* ------------------------------------------------------------------ new-world choices */
/** Picture presets in kid order: Flat first (SPEC §1.3), Hills & trees is the default selection. */
export const PRESET_CHOICES = Object.freeze([
  { key: 'flat', label: 'Flat' },
  { key: 'default', label: 'Hills & trees' },
  { key: 'snowy', label: 'Snowy' },
]);
/** Mode cards -> startWorld options. */
export const MODE_CHOICES = Object.freeze([
  { key: 'creative', label: 'Creative', mode: 'creative', difficulty: 'peaceful' },
  { key: 'easy', label: 'Survival Easy', mode: 'survival', difficulty: 'easy' },
  { key: 'normal', label: 'Survival Normal', mode: 'survival', difficulty: 'normal' },
]);
export const DEFAULT_PRESET = 'default';
export const DEFAULT_MODE = 'creative';

/** startWorld options for a preset + mode card. */
export function newWorldOptions(presetKey, modeKey, taken = [], rand = Math.random) {
  const preset = PRESET_CHOICES.some((p) => p.key === presetKey) ? presetKey : DEFAULT_PRESET;
  const m = MODE_CHOICES.find((x) => x.key === modeKey) || MODE_CHOICES[0];
  return { preset, mode: m.mode, difficulty: m.difficulty, name: makeWorldName(preset, taken, rand) };
}

/** Which mode card a meta corresponds to. */
export function modeKeyOf(meta) {
  if (!meta || meta.mode !== 'survival') return 'creative';
  return meta.difficulty === 'normal' ? 'normal' : 'easy';
}

/* ------------------------------------------------------------------ paging */
/**
 * Grid for the world picker: cards of cardW x cardH with `gap` in a viewport w x h, leaving room for a top bar
 * and paging arrows. Arrows go on the sides when they fit, else in a bottom row. Never scrolls.
 * @returns {{cols, rows, perPage, arrowsBelow}}
 */
export function pickerGrid(w, h, cardW = 256, cardH = 212, gap = 16, opts = {}) {
  const edge = opts.edge ?? 24, arrow = opts.arrow ?? 88, top = opts.top ?? 120;
  let arrowsBelow = false;
  let cols = Math.floor((w - 2 * (edge + arrow + gap) + gap) / (cardW + gap));
  if (cols < 1) { arrowsBelow = true; cols = Math.max(1, Math.floor((w - 2 * edge + gap) / (cardW + gap))); }
  const dots = 28; // page dots under the cards
  const below = (arrowsBelow ? arrow + gap : 0) + dots;
  let rows = Math.floor((h - top - edge - below + gap) / (cardH + gap));
  rows = Math.max(1, Math.min(2, rows));
  cols = Math.max(1, Math.min(4, cols));
  return { cols, rows, perPage: cols * rows, arrowsBelow };
}

/** Number of pages for n items at perPage (at least 1). */
export function pageCount(n, perPage) { return Math.max(1, Math.ceil(n / Math.max(1, perPage))); }

/** Items on page p (clamped). */
export function pageSlice(items, perPage, p) {
  const pages = pageCount(items.length, perPage);
  const page = Math.max(0, Math.min(pages - 1, p | 0));
  return { page, pages, items: items.slice(page * perPage, page * perPage + perPage) };
}

/** "3 minutes ago"-style label for the parent area (world cards show it small). */
export function agoLabel(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
