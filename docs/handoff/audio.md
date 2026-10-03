# Handoff - audio

Branch `lane/audio` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-audio`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · AUDIO P0 + P1 complete, P2 positional polish in · work commit `df65b0c`

### What changed

Stubs deleted: `registerStub('audio')` and `registerStub('music')` (both lived in `src/audio/audio.js`).

| File | Purpose |
|---|---|
| `src/audio/audio.js` | System `audio` (frozen API kept: `unlocked`, `unlock`, `play`, `playBlock`, `startMusic`, `stopMusic`, `stats`, `frame`), mixing graph, unlock/visibility handling, diagnostics |
| `src/audio/sounds.js` | The catalogue: 150 original synthesized recipes (SPEC §8.3.2 names + aliases) |
| `src/audio/dsp.js` | Synthesis toolkit: enveloped tones, filtered noise, granular crackle (one source per train), formant "voiced" source for animals, bells |
| `src/audio/wiring.js` | Event bus → sound mapping (SPEC §6 / §8.3 table); mining-hit and eating loops on `tick()` |
| `src/audio/mixer.js` | Pure: voice limits (32 total, 4 per name, 12 starts/s per name, per-name min gap, steal-oldest), spatial gain/pan, settings → bus gains |
| `src/audio/levels.js` | Loudness plan: per-family RMS targets + per-sound trims measured through the real graph |
| `src/audio/music.js` | Generative piano: pure composer, felt-piano samples rendered once in an `OfflineAudioContext`, look-ahead scheduler |
| `src/audio/reverb.js` | Procedural 3.5 s stereo impulse response (darkening tail, early reflections) |
| `test/audio.test.mjs` | 21 unit tests on a strict mock AudioContext (throws on exp-ramp to 0, NaN, bad start/stop) |
| `tools/scenarios/audio.mjs` | 11 smoke scenarios (`audio-*`) |

**Graph:** voice → [StereoPanner] → sfxIn → muffle (low-pass under water) → sfxComp (−18 dB, 4:1, 3 ms, 0.25 s) → sfxVol → master → limiter (−6 dB, 20:1, 3 ms) → soft-clip ceiling (−1 dBFS) → destination (analyser tap). Music: piano → musicVol → duck → dry + convolver send → master.

**Levels (default settings, measured offline through the full chain, `.tmp/audio-levels.json`):** all 150 sounds within 4 dB of their family target (breaks −27 dB RMS, places −29, steps −35, mining ticks −37, pickup pop −29, UI −28 to −37, voices −28). Explosion peak: **−15.5 dBFS** default kid, **≈ −11 to −12** at max volume, **−9.3 worst live** (survival, max volume) - SPEC limit −6. Music day piece peak −17 dBFS.

**Kid-safety choices:** hurt is a soft "oof"; zombie is a silly "uuuh"; spider and creeper are quiet hisses; the explosion is a round low "whump" with a 30 ms attack (12 ms in survival worlds), low-passed, no crack; glass shatter is low-passed at 9 kHz. Mute/volume ramps are exact (mute = true silence, −120 dB measured).

### Commands run and results

`node build.mjs --dev --out .tmp/build-audio` → `[build] 0.1.0-8f643e1b-dev ... (1177 KB, dev)`

`npm run test:unit`
```
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

`node tools/smoke.mjs --tag audio`
```
PASS     boot / world / hotbar / inventory-ui / time / kid-home / perf
PENDING  terrain-render, move-jump, break-place, mobs, survival-fall, save-load, context-loss  (core stubs)
SKIP     touch-controls        - needs --touch
PASS     audio-locked          3 ms
PASS     audio-unlock        401 ms {"ctx":{"state":"running","sampleRate":48000}}
PASS     audio-events         95 ms {"after50":{"ui.close":1,"block.break.stone":4}}
PASS     audio-explosion-peak   7156 ms {"kid-default":{"live":-14.1,"offline":-15.5},"kid-max":{"live":-12,"offline":-11.8},"survival-max":{"live":-10,...}}
PASS     audio-catalog     38652 ms {"offTarget":0,"loudest":["fire.ignite -8.5","block.break.plant -9.4",...]}
PASS     audio-music       15576 ms {"day":{"mode":"ionian","bpm":72,"notes":25,"peakDb":-17,"pieceSeconds":92},"night":{"mode":"dorian",...},"live":{"ready":true,"playing":true,...}}
PASS     audio-volume       8386 ms {"baseline":{"peakDb":-120},"peaks":{"normal":-16.1,"muted":-120,"noSfx":-120,"back":-15.9}}
PASS     audio-positional     92 ms
PENDING  audio-break-place      - stub lanes: input, player, physics, raycast, interaction, world
PENDING  audio-footsteps        - stub lanes: input, player, physics, world
PENDING  audio-mob-voices       - stub lanes: mobs, physics, world
PASS     lead-events-roundtrip / lead-unload-persist / lead-break-contract / lead-batch / lead-entity-streaming / lead-testapi
PASS     page-errors
[smoke] {"PASS":22,"PENDING":10,"SKIP":1} in 76.8 s
```

SPEC §8.3 acceptance: no console errors while locked (`audio-locked`), `unlocked` true after a click (`audio-unlock`), 50 `block:broken` in one tick → 4 voices (`audio-events`), explosion analyser peak ≤ −6 dBFS (`audio-explosion-peak`) - all PASS.

**For human listening:** `audio-catalog` writes every sound to `.tmp/audio-wav/<name>.wav` (44.1 kHz) and `audio-music` writes `.tmp/audio-wav/music-day.wav` (40 s). `.tmp/smoke-audio-audio-waveforms.png` is a contact sheet of all 150 waveforms with peak levels. Nobody has listened to them yet - the levels and shapes were judged from measurements and waveform/piano-roll images only.

### Still needs in-world verification (after the core merge)

1. `audio-break-place`, `audio-footsteps`, `audio-mob-voices` turn from PENDING to PASS (they need CORE-E and MOBS).
2. Listener follows the camera: walk past a mob and hear the pan sweep; `frame()` reads `renderer.camera.position` (falls back to `player.getEyePos`) and `player.yaw`. Third-person front view will pan mirrored (uses player yaw) - acceptable, but check.
3. Footstep cadence and loudness while walking/sprinting on every material (CORE-E emits `player:step` every 1.7 blocks).
4. Mining hit rhythm (every 4 ticks) stops exactly on `block:miningStop` / `block:broken`; creative instant break should give one break sound and no stray hits.
5. Splash on falling into water: `player:water` has no velocity, so I read `game.player.vy < -0.15`; check jumping in vs wading in.
6. Underwater muffle on `eyeInWater`.
7. Music: first piece 20–40 s after `world:ready`, then 40–150 s gaps; night mood switches with `time:*` events when the day cycle is on; ducking during TNT chains.
8. Real touchscreen: audio unlocks on the first tap (listeners on `pointerup`/`touchend`/`click` as well as `pointerdown`).
9. A parent should listen to `.tmp/audio-wav/*.wav` once and flag anything grating (the piano, the pickup pop and the footsteps matter most).
10. CPU on the weak-laptop proxy with many mobs + TNT chain (`--swiftshader`): voice cap is 32, each voice is 3–30 nodes.

### Interface assumptions (please keep or tell me)

- `blockDef(id).sound` gives the material for `block:broken/placed/mining` and `player:land` (`blockId`); `player:step` uses its `sound` field first.
- `mob:sound` may carry extra kinds `whine` and `bark` (wolf) besides the SPEC list; unknown kinds play `<voice>.<kind>` if catalogued, otherwise nothing.
- `mob:hurt` + `mob:sound {kind:'hurt'}` for the same hit play once (250 ms dedupe per entity id).
- `tnt:primed {id, fuse}`: the fuse hiss lasts `fuse/20` s and is stopped by `entity:remove` with that id (e.g. kid undo).
- `entity:spawn` pop / `entity:remove` poof only for mob types in `data/mobs.js`, never for items/TNT, never for `load`/`unload`.
- `block:broken` with `by: 'explosion'` is silent (the explosion sound covers up to 600 blocks).
- `ui:open {screen:'chest', opts:{x,y,z}}` plays the chest creak at that position; other screens play the UI chime.
- `player:teleport` reasons `void|respawn|stuck|home` whoosh; `test` and `load` are silent.

### New API members (additive, documented for the integrator)

`audio.stop(voice, fade)`, `audio.soundNames()`, `audio.context`, `audio.music` (player object), `audio.renderOffline(name, opts)`, `audio.measurePeak(name, opts)`, `audio.listenPeak(ms)`, `audio.renderMusicOffline(opts)`. `stats()` also returns `unlocked, state, started, dropped, stolen, unknown, music{...}, night, sampleRate`. `play()` returns the voice record (or null). No new events.

### Spec conflicts / deviations (integrator decision)

1. **Pitch jitter:** SPEC says ±5%. Most sounds use ±5%, but `item.pop` uses ±35% (the classic random-pitch pickup), `player.eat` ±12%, `item.drop` ±15%, `explosion` ±8%, and chimes/music-like sounds 0%.
2. **Graph:** `sfxVolume` is applied after the SFX compressor (so the slider is linear), and a soft-clip ceiling at −1 dBFS sits after the limiter as a hard safety net. Limiter ratio 20 (SPEC: "12+").
3. **Music start:** `startMusic()` with no argument starts a piece after 1 s (the world-start path uses the SPEC 20–40 s gap internally).
4. Browser `DynamicsCompressorNode` adds automatic makeup gain; all levels were therefore calibrated through the real graph rather than by recipe gains.

### LEAD requests

None blocking. Nice-to-have: add the optional `vy` (or `fallSpeed`) field to `player:water` so the splash decision does not need to read `game.player`.

### Remaining (by priority)

- P0/P1: none open beyond the in-world checks above.
- P2: cave reverb send for SFX underground; per-biome ambient beds (`water.ambient` exists but nothing triggers it yet - MECH/world could emit `sound {name:'water.ambient'}` near water); door/gate distinct timbres.
