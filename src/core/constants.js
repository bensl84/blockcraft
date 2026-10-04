// OWNER: LEAD (shared, frozen). Every number here is referenced by docs/SPEC.md.
// Lanes import from here; never re-declare these values locally. Change only via the integrator.

/* ---------------- build-time constants (injected by build.mjs; safe in Node tests) -------------- */
/* global __DEV__, __WORKER_SRC__, __BUILD_VERSION__ */
export const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : true;
export const WORKER_SRC = typeof __WORKER_SRC__ !== 'undefined' ? __WORKER_SRC__ : '';
export const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'node';

/* ---------------- world layout ---------------- */
export const CHUNK_SIZE = 16;          // columns are 16 x 16 blocks (X, Z)
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 128;       // y in [0, 127]
export const SECTION_SIZE = 16;        // a section is 16^3
export const SECTIONS_PER_COLUMN = 8;  // 128 / 16
export const SECTION_VOLUME = 4096;
export const COLUMN_VOLUME = 32768;    // 16 * 16 * 128
export const SEA_LEVEL = 48;           // worldgen fills air cells with y < SEA_LEVEL (0..47) with water source
export const CLOUD_HEIGHT = 108;
export const FLAT_SURFACE_Y = 4;       // flat preset: bedrock y0, dirt y1-2, grass y3, player stands at y=4
export const PADDED = 18;              // padded section edge for the mesher (16 + 1 border each side)

/** Column-local block index. x,z in [0,15], y in [0,127]. Section s occupies [s*4096, (s+1)*4096). */
export function colIndex(x, y, z) { return x | (z << 4) | (y << 8); }
/** Padded (18^3) index for x,y,z in [-1, 16] relative to the section origin. */
export function padIndex(x, y, z) { return (x + 1) + (z + 1) * 18 + (y + 1) * 324; }
/** Key for a column (cx, cz) in Maps. */
export function colKey(cx, cz) { return cx + ',' + cz; }

/* ---------------- block values (Uint16: id | state << 8) ---------------- */
export const ID_MASK = 0xff;
export const STATE_SHIFT = 8;
export function packBlock(id, state = 0) { return (id & 0xff) | ((state & 0xff) << 8); }
export function blockIdOf(v) { return v & 0xff; }
export function blockStateOf(v) { return v >>> 8; }

/* ---------------- faces & facings ---------------- */
// Face index order == three.js BoxGeometry group order (+x, -x, +y, -y, +z, -z).
export const FACE = Object.freeze({ EAST: 0, WEST: 1, UP: 2, DOWN: 3, SOUTH: 4, NORTH: 5 });
export const FACE_NAMES = Object.freeze(['east', 'west', 'up', 'down', 'south', 'north']);
export const FACE_DIRS = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
export const FACE_OPPOSITE = Object.freeze([1, 0, 3, 2, 5, 4]);
/** Fixed directional face shade (Minecraft-like): up 1.0, N/S 0.8, E/W 0.6, down 0.5. */
export const FACE_SHADE = Object.freeze([0.6, 0.6, 1.0, 0.5, 0.8, 0.8]);
/** Horizontal facing stored in block state bits 0-1: the direction the block's FRONT points. */
export const FACING = Object.freeze({ NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3 });
export const FACING_DIRS = Object.freeze([[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]]);
export const FACING_TO_FACE = Object.freeze([FACE.NORTH, FACE.EAST, FACE.SOUTH, FACE.WEST]);
/** Log/hay axis in state bits 0-1. */
export const AXIS = Object.freeze({ Y: 0, X: 1, Z: 2 });

/* ---------------- time ---------------- */
export const TPS = 20;
export const TICK_MS = 50;
export const TICK_DT = 0.05;
export const MAX_TICKS_PER_FRAME = 5;   // if the frame took longer, the game slows down instead of spiralling
export const MAX_FRAME_DT = 0.1;        // seconds; clamp after tab switches
export const DAY_TICKS = 24000;         // 20 minutes. dayTime 0 = 06:00 sunrise, 6000 noon, 12000 sunset, 18000 midnight
export const KID_LOCKED_TIME = 3000;    // 09:00 - the default when daylightCycle is off
export const TIME_EVENTS = Object.freeze({ dawn: 23000, day: 0, noon: 6000, dusk: 12000, night: 13000, midnight: 18000 });

/* ---------------- player physics (Java Edition per-tick values, 20 TPS) ---------------- */
export const PHYS = Object.freeze({
  WIDTH: 0.6, HEIGHT: 1.8, EYE: 1.62,
  SNEAK_HEIGHT: 1.5, SNEAK_EYE: 1.27,
  STEP_HEIGHT: 0.6,
  GRAVITY: 0.08, VDRAG: 0.98, TERMINAL: 3.92, VEL_EPS: 0.003,   // VEL_EPS: modern Java cut-off (SPEC §2.1 step 8)
  JUMP_VELOCITY: 0.42, SPRINT_JUMP_BOOST: 0.2,
  WALK_SPEED: 0.1, SPRINT_MULT: 1.3, SNEAK_MULT: 0.3, INPUT_SCALE: 0.98,
  GROUND_SLIP: 0.6, AIR_DRAG: 0.91,             // horizontal: v = v * slip * 0.91 + accel
  AIR_ACCEL: 0.02, AIR_ACCEL_SPRINT: 0.026,
  FLY_ACCEL: 0.05, FLY_SPRINT_MULT: 2.0, FLY_VERTICAL: 0.15, FLY_VDRAG: 0.6, // fly: vy = (vy +- 0.15) * 0.6 => 0.375 b/t = 7.5 m/s
  WATER_ACCEL: 0.02, WATER_DRAG: 0.8, WATER_SINK: 0.005, WATER_SWIM_UP: 0.04,
  LAVA_DRAG: 0.5, LAVA_GRAVITY: 0.02,
  LADDER_MAX_H: 0.15, LADDER_MAX_DOWN: 0.15, LADDER_CLIMB: 0.2,
  DOUBLE_TAP_TICKS: 7,                          // double-tap window for fly toggle / sprint
  FOV: 70, FOV_SPRINT: 1.15, FOV_FLY: 1.1,
  PITCH_LIMIT: 89.9 * Math.PI / 180,
});
/** Entities that are not living (items, falling blocks, primed TNT). */
export const ENTITY_PHYS = Object.freeze({ GRAVITY: 0.04, DRAG: 0.98, GROUND_DRAG: 0.98 * 0.6 });

/* ---------------- interaction ---------------- */
export const REACH = Object.freeze({ SURVIVAL: 4.5, CREATIVE: 5.0, KID: 8.0, ENTITY_SURVIVAL: 3.0, ENTITY_CREATIVE: 5.0 });
export const BREAK = Object.freeze({
  HARVEST_DIV: 30, NO_HARVEST_DIV: 100,   // progress per tick = speed / hardness / DIV
  DELAY_TICKS: 6,                          // pause before the next block starts (survival)
  CREATIVE_REPEAT_TICKS: 5,                // held break in creative: one block every 5 ticks (250 ms)
  PLACE_REPEAT_TICKS: 4,                   // held place repeats every 4 ticks
  SWING_TICKS: 6,
  STAGES: 10,                              // crack overlay stages 0..9
});
export const KID_GESTURE = Object.freeze({ TAP_MAX_MS: 350, HOLD_MS: 350, DRAG_PX: 12, HOLD_REPEAT_MS: 250 });

/* ---------------- survival ---------------- */
export const SURVIVAL = Object.freeze({
  MAX_HEALTH: 20, MAX_FOOD: 20, START_SATURATION: 5, EXHAUSTION_MAX: 4,
  INVULN_TICKS: 10, MAX_AIR: 300, AIR_REFILL: 4, DROWN_DAMAGE: 2,
  EAT_TICKS: 32, REGEN_FAST_TICKS: 10, REGEN_TICKS: 80, STARVE_TICKS: 80,
  EXHAUST: Object.freeze({ SPRINT_PER_M: 0.1, SWIM_PER_M: 0.01, JUMP: 0.05, SPRINT_JUMP: 0.2, ATTACK: 0.1, DAMAGE: 0.1, BREAK: 0.005, HEAL: 6.0 }),
  FALL_SAFE: 3, LAVA_DAMAGE: 4, FIRE_DAMAGE: 1, FIRE_TICKS_LAVA: 300, SUFFOCATE_DAMAGE: 1, CACTUS_DAMAGE: 1,
  VOID_Y: -16,            // 'void' damage below this y - only when rules.voidRescue is false (SPEC §2.3)
});

/* ---------------- kid helpers (SPEC §2.7, §8.5) ---------------- */
export const KID = Object.freeze({
  VOID_RESCUE_Y: 0,             // feet below y 0 -> silent rescue to the surface (while rules.voidRescue)
  UNDO_ENTRIES: 50,             // undo ring buffer size (one entry = one action id, SPEC §8.5.2)
  HOME_ARROW_DIST: 48,          // show the home arrow beyond this distance
  STREAM_FLY_CAP: 0.35,         // b/t (7 m/s): kid-scheme flight speed cap while streaming lags behind...
  STREAM_BACKLOG_COLUMNS: 2,    // ...i.e. while more than this many columns within R-1 are not meshed yet
  AUTO_PITCH_DELAY_TICKS: 30,   // 1.5 s of walking without manual pitch input before auto-pitch eases in
  AUTO_PITCH_DEG: -12,
  NAP_TICKS: 60,                // bed "nap" when daylightCycle is off (fade + starry sky, then back to 09:00)
});

/* ---------------- lighting ---------------- */
export const LIGHT_MAX = 15;
export const NIGHT_SKY_DROP = 11;       // effective sky = sky - (1 - daylight) * 11  (15 -> 4 at night)

/* ---------------- rendering & streaming ---------------- */
export const RENDER = Object.freeze({
  DEFAULT_DISTANCE: 6, MIN_DISTANCE: 3, MAX_DISTANCE: 12, TOUCH_DISTANCE: 5, LOW_DISTANCE: 4,
  MESH_MARGIN: 1,       // mesh one ring beyond the fog radius: the circular radius's diagonal gaps then sit past fogFar
  DATA_MARGIN: 2,       // generate/light columns out to the mesh radius + 3 / + 2.5 (mesher needs neighbours)
  UNLOAD_MARGIN: 5,     // unload beyond renderDistance + 5 (data reaches R + MESH_MARGIN + DATA_MARGIN + 1 = R + 4)
  FOG_START: 0.8,       // linear land fog from FOG_START * fogFar to fogFar = (R - 0.5) * 16
  SPAWN_RADIUS: 3,      // columns meshed before the world is shown
  CHUNK_BUDGET_MS: 4,   // per-frame gen/light/mesh budget while playing (scaled down when frames are late)
  LIGHT_COLUMN_BUDGET_MS: 2, // initial lighting of ONE column on the weak proxy (SPEC §5.3.4, §12)
  LOADING_BUDGET_MS: 14,
  NEAR: 0.05, FAR_PAD: 32,
  DPR_CAP: 1.5,
});
/** Animated textures: frames are consecutive array layers starting at the base layer. */
export const ANIM = Object.freeze({
  NONE: 0, WATER: 1, LAVA: 2, FIRE: 3,
  FRAMES: Object.freeze([0, 16, 16, 8]),
  FPS: Object.freeze([0, 8, 4, 12]),
});
/** Vertex wave modes (flags bits 5-6). */
export const WAVE = Object.freeze({ NONE: 0, LEAVES: 1, PLANT: 2, WATER: 3 });

/* ---------------- colours (16 dye colours, Minecraft order) ---------------- */
export const COLORS = Object.freeze(['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']);
/** Original Blockcraft wool/dye palette (used for wool, beds, sheep, dyes, stained glass). */
export const COLOR_HEX = Object.freeze({
  white: '#ecedeb', orange: '#f07a1c', magenta: '#c64fbd', light_blue: '#4ab8e6', yellow: '#f7cc2f', lime: '#7cc624',
  pink: '#f2a2be', gray: '#4a4f52', light_gray: '#a0a09a', cyan: '#1a9aa2', purple: '#8a39b8', blue: '#3c44aa',
  brown: '#7a4f2c', green: '#4e6b1e', red: '#b3312c', black: '#1c1d21',
});

/* ---------------- game defaults ---------------- */
export const MODES = Object.freeze(['creative', 'survival']);
export const DIFFICULTIES = Object.freeze(['peaceful', 'easy', 'normal']);
export const PRESETS = Object.freeze(['default', 'flat', 'islands', 'snowy']);

/** Per-world rules. The kid-first default world is Creative + Peaceful with these values. */
export const DEFAULT_RULES = Object.freeze({
  daylightCycle: false,      // time locked at KID_LOCKED_TIME
  weatherCycle: false,
  fallDamage: false,
  drowningDamage: false,
  fireDamage: false,
  fireSpread: false,         // fire never spreads
  tntExplodes: true,         // TNT is the classic fun; blasts are kid-safe sounding and undoable
  mobGriefing: false,        // creepers do not break blocks
  keepInventory: true,
  immediateRespawn: true,
  hostileMobs: false,        // no effect while difficulty === 'peaceful' (core/worldrules.js); kept as set
  passiveMobs: true,
  animalsCanDie: false,      // kid default: hit animals hop away with a squeak
  hunger: false,             // on in survival worlds; no effect while difficulty === 'peaceful'
  worldBorder: 512,          // soft border radius from spawn (blocks)
  dropItemsOnBreak: false,   // creative never drops; survival presets turn this on
  voidRescue: true,          // falling out of the world = silent teleport to the surface (kid lane), never 'void' damage
});
/** Rules applied on top of DEFAULT_RULES when a survival world is created. */
export const SURVIVAL_RULES = Object.freeze({
  daylightCycle: true, weatherCycle: true, fallDamage: true, drowningDamage: true, fireDamage: true, animalsCanDie: true,
  hunger: true, dropItemsOnBreak: true, hostileMobs: true, mobGriefing: false,
});

/* ---------------- UI ---------------- */
export const GUI = Object.freeze({ MIN_W: 320, MIN_H: 240, MIN_SCALE: 2, MAX_SCALE: 6, KID_HOTBAR_SLOT: 24, HOTBAR_SLOT: 20, CONTAINER_SLOT: 18 });
/** z-index layers for elements inside #ui-root (each lane creates its own root div). */
export const Z = Object.freeze({ FX_OVERLAY: 10, HUD: 20, KID: 30, TOUCH: 40, CONTAINER: 50, SCREENS: 60, TOAST: 70, GATE: 80, LOADING: 90, DEBUG: 100 });
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;       // 0-8 hotbar, 9-35 main
