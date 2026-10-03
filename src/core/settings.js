// OWNER: LEAD (shared, frozen shape). Global (per-device) settings persisted in localStorage.
// FEATURE-MENUS builds the settings UI; every lane READS game.settings and listens for 'settings:changed'.
// Change a setting ONLY through setSetting(game, key, value) so it is saved and broadcast.

export const SETTINGS_KEY = 'blockcraft:settings:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  // controls
  controls: 'kid',            // 'kid' (free cursor, tap/hold/drag, arrows turn) | 'classic' (pointer-lock mouse look, WASD strafe)
  touchControls: 'auto',      // 'auto' (show when a touch pointer is used) | 'on' | 'off'
  lookSensitivity: 0.5,       // 0..1 (mouse/drag look)
  turnSpeed: 0.5,             // 0..1 (kid keyboard turning: 0.5 => ~100 deg/s held)
  invertY: false,
  autoJump: true,
  autoPitch: true,            // kid scheme: ease the view toward -12 deg after 1.5 s of walking (SPEC §7.1)
  buttonSize: 'M',            // touch buttons 'S' 80px | 'M' 96px | 'L' 112px
  touchOpacity: 0.85,
  leftHanded: false,
  // video
  renderDistance: 0,          // 0 = auto (device preset + dynamic scaling); otherwise 3..12 chunks
  dynamicQuality: true,
  pixelRatioCap: 0,           // 0 = auto (RENDER.DPR_CAP); otherwise 0.5..2
  fancyLeaves: true,
  waving: true,               // leaves/plants/water vertex animation
  clouds: true,
  smoothLighting: true,
  viewBobbing: false,         // kid default off
  fov: 70,
  brightness: 0.7,            // 0..1 -> classic brightness lift (uGamma) + cave floor light (SPEC §5.5.3)
  guiScale: 0,                // 0 = auto
  showFps: false,
  // audio
  masterVolume: 0.65,
  musicVolume: 0.35,
  sfxVolume: 1.0,
  muted: false,
  // kid helpers
  hints: true,
  speakNames: false,          // text-to-speech block names (local voices only)
  // misc
  lastWorldId: null,
  skin: { hair: '#5a3a1e', shirt: '#2f8fd8', pants: '#3a3a8a', skin: '#e8b48a' },
});

/** Load settings (merged over defaults). Never throws. */
export function loadSettings() {
  let saved = null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (raw) saved = JSON.parse(raw);
  } catch { saved = null; }
  const s = structuredCloneSafe(DEFAULT_SETTINGS);
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(s)) if (k in saved && typeof saved[k] === typeof s[k]) s[k] = saved[k];
    if (saved.lastWorldId !== undefined) s.lastWorldId = saved.lastWorldId;
  }
  return s;
}

/** Persist settings. Never throws. */
export function saveSettings(settings) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

/** Change one setting, persist it and emit 'settings:changed' {key, value, settings}. */
export function setSetting(game, key, value) {
  if (!(key in game.settings)) throw new Error(`unknown setting ${key}`);
  game.settings[key] = value;
  saveSettings(game.settings);
  game.events.emit('settings:changed', { key, value, settings: game.settings });
}

function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }
