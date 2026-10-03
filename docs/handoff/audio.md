# Handoff - audio

Branch `lane/audio` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-audio`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · PHASE 2 - merged real core, verified in real gameplay

Merge: `git merge main` into `lane/audio` = `5047df5` (clean, no conflicts; no LEAD file touched by this lane).
No temporary stub fallbacks existed in this lane, so nothing to remove. MOBS is still a stub on main, so
`audio-mob-voices` stays PENDING (mob voices were verified with real `mob:sound` events at real positions instead).

### Fixes made in phase 2 (all inside src/audio/* and lane tools)

| What a player would notice | Fix |
|---|---|
| First mining "tock" came 3 ticks after the first, then every 4 | `wiring.js` counts from the game tick of the `block:mining` event (interaction emits it earlier in the same tick) - now exactly every 4 ticks |
| Third-person FRONT view: a sound on the screen's left was heard on the right | `audio.js frame()` takes the listener yaw from the camera pose (`renderer.camera.rotation.y`), not the player's facing |
| Grass footsteps (the sound a child hears most) were a thin "tsss" (83 % of energy above 5 kHz) | grass + plant recipes rebuilt as a soft leafy crunch with body; hisses (spider, creeper, TNT fuse, fire, shears) go through a gentle 6-7.5 kHz low-pass (`soft()` in `sounds.js`). Grass step: centroid 11.0 kHz -> 1.7 kHz, >5 kHz share 83 % -> 6.5 %. Trims re-measured (30 entries in `levels.js`); all 150 sounds still within 4 dB of their family target |
| Weak-laptop safety | per-frame voice budget: max 6 new voices per 16 ms window (prio > 0 such as explosions exempt); muted / effects volume 0 builds no voices at all |
| `audio-catalog` took 38-60 s (hit the 60 s scenario timeout once main merged) | sounds render in parallel batches, offline SFX renders skip the music convolver, and audio comes back from the page as base64 PCM instead of a JSON number array: now 2.4-2.8 s |

Diagnostics added (additive API): `audio.recent(clear)` = ring of the last 256 plays `{name, t, tick, gain, pan}`;
`stats()` also returns `muffleHz`, `duck`, `listener {x,y,z,yaw}`, `budgetDropped`.

New tools: `tools/audio-inworld.mjs` (real-gameplay verification, below) and `tools/audio-spectrum.mjs` (brightness
scan of the rendered WAVs). New smoke scenarios: `audio-mining-rhythm`, `audio-listener-views`. New unit tests: voice
budget + muted skip, listener follows the camera pose.

### Verified in-world (real generated world, real Chrome, real keyboard / mouse / touch)

`node build.mjs --dev --out .tmp/build-audio && node tools/audio-inworld.mjs` -> `[audio-inworld] {"PASS":46,"FAIL":0}`;
screenshots `.tmp/audio-inworld/NN-*.png`, report `.tmp/audio-inworld/report.json`. The screenshots were looked at
(road, mining, underwater, wading, third-person views, touch place): each scene is what the step claims.

```
PASS  title: audio locked before any gesture; one real mouse click unlocks audio              (01-title-locked.png)
PASS  music: world start requests music; first piece 20-40 s away (25.8 s); piano ready; no notes before it (02-world-start.png)
PASS  steps: every road material heard underfoot (grass dirt stone wood sand gravel snow cloth glass metal) (03/04/05-road-*.png)
PASS  steps: walking cadence 0.40 s (1.7 blocks at 4.3 m/s); own footsteps centred (pan 0)
PASS  steps: sprinting (classic R + W) is faster: 0.30 s vs 0.40 s
PASS  jump: small hop on planks -> block.land.wood, no big-fall; 8-block drop -> player.bigfall + block.land.wood
PASS  mine: real mouse hold on dirt (survival): 4 hits at ticks 462/466/470/474, one block.break.dirt, nothing after (06/07-mine-*.png)
PASS  mine: stone by hand: stone hits only; releasing the mouse stops the hits at once (08-mine-stone-cracking.png)
PASS  creative: one hold = one break sound, zero mining hits; a tap places with one place sound (09/10-creative-*.png)
PASS  water: falling 6 blocks into a pool = player.splash (no swim, no ground thud); head under -> muffle 867 Hz (11-water-underwater.png)
PASS  water: muffle lifts on leaving the water (20 kHz); wading in = player.swim, not a splash (12-water-wading.png)
PASS  pan: cow east of the player: right (+0.85) facing north; left (-0.75) after turning with the arrow key (13-pan-turned-around.png)
PASS  pan: third-person back view right (+0.67); front view left (-0.67), like the screen (14/15-pan-third-person-*.png)
PASS  music: night mood on at night; piano plays in-world; ducks to 0.30 under a 5-TNT chain, back to 0.99 (16-explosions.png)
PASS  explosion chain is voice-limited (4 at once)
PASS  perf: quiet 0.02 ms/frame of audio work; storm (5 sound events EVERY frame, ~10x real play) 0.2 ms/frame; fps 144 -> 144; 19 voices <= 32; draw calls identical with audio muted (177 = 177)
PASS  tab hidden -> context suspended; visible -> running
PASS  no page/console errors; exit to title stops the music
PASS  touch (hasTouch context): the first finger tap unlocks audio; a finger tap in the world places with block.place.grass (18/19-touch-*.png)
```

Weak-laptop proxy `node tools/audio-inworld.mjs --swiftshader --only perf` -> `{"PASS":12,"FAIL":0}`: quiet 40 fps,
storm 38 fps, muted 50 fps (noisy: the machine was shared with other lanes' browsers); audio work 0.02 ms/frame quiet;
storm main-thread audio cost 0.79 ms/frame (3-4.5 ms/frame before the voice budget).

### Commands run and results (phase 2, final)

`node build.mjs --dev --out .tmp/build-audio` -> `[build] 0.1.0-055ad045-dev ... (1644 KB, dev)`

`npm run test:unit` -> `tests 108 / pass 108 / fail 0`

`node tools/smoke.mjs --tag audio`
```
PASS     audio-locked / audio-unlock / audio-events / audio-explosion-peak (kid-default -14.3 live, -15.5 offline)
PASS     audio-catalog   2771 ms {"offTarget":0}
PASS     audio-music / audio-volume (muted -120) / audio-positional
PASS     audio-break-place      (was PENDING)
PASS     audio-footsteps        (was PENDING) {"steps":3}
PASS     audio-mining-rhythm    {"gaps":[4,4,4],"breaks":["block.break.dirt"]}
PASS     audio-listener-views   {"pan":{"0":0.85,"1":0.67,"2":-0.67}}
PENDING  audio-mob-voices       - stub lanes: mobs
PENDING  mobs / survival-fall / save-load (other lanes' stubs)
FAIL     cored-daynight         - CORE-D scenario, flaky; see Cross-lane defects (not caused by audio)
PASS     page-errors
[smoke] {"PASS":67,"PENDING":4,"SKIP":2,"FAIL":1}
```
`node tools/smoke.mjs --tag audio --touch --scenario audio-unlock,audio-locked,touch-controls,coree-touch` -> audio
PASS, coree-touch PASS, touch-controls PENDING (touch stub).

### Remaining gaps

1. Mob voices in real gameplay (animals wandering past, hurt/death on real hits) need the MOBS lane. The wiring was
   exercised with real `mob:sound` events at real world positions, but `audio-mob-voices` is PENDING.
2. Nobody has listened with ears yet. `.tmp/audio-wav/*.wav` (all 150 sounds) and `music-day.wav` are ready; the parent
   should listen once, especially footsteps on grass, the pickup pop and the piano.
3. Title Play button: the (stub) menus do not emit `ui:click`, so pressing Play gives only the soft `ui.close`. The
   MENUS lane should emit `ui:click` on its buttons (SPEC §6) - no audio change needed.
4. The mining crack overlay was not visible in the stone-mining screenshot (FX lane is a stub) - not audio.
5. P2 still open: cave reverb for SFX underground, per-biome ambient beds, distinct door/gate timbres.

### Cross-lane defects

1. **CORE-D `tools/scenarios/cored.mjs` `cored-daynight` is flaky** ("setTime never remeshes"). Repro: run
   `node tools/smoke.mjs --scenario cored-daynight` three times on a busy machine -> FAIL, FAIL, PASS (`merges` 415 -> 432
   and 591 -> 692 while `sets` stays the same). It passed in the first full run of this phase. `before` is sampled right
   after `startWorld`, while the world is still streaming and merging sections, so streaming merges are counted as
   remeshes. Audio is not involved (it fails in isolated runs where audio was never unlocked). Suggested fix (CORE-D
   owner): wait until streaming is idle (world backlog 0 / no pending meshes for ~10 frames) before sampling `before`,
   or assert on `sets` only, or count setTime-caused remeshes with a dedicated counter.
2. **MENUS (stub): the title Play button emits no `ui:click`** - see gap 3 (matters once MENUS lands; SPEC §6 lists `ui:click`).

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
