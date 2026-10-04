# Handoff - fx

Branch `lane/fx` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-fx`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-04 · Fixer round 1: judge findings FID-2, FID-13, POL-4, POL-9, POL-15

`git merge main` fast-forwarded. All changes are inside FX files (src/fx/*, test/fx.test.mjs, tools/scenarios/fx.mjs);
nothing outside the lane was touched. Before/after shots in `.tmp/fix/` (scripts `.tmp/fxv/fire.mjs`, `misc.mjs`;
"before" = a build of the merged main in `.tmp/build-before`).

| Finding | Fix | Verified |
|---|---|---|
| FID-2 / POL-9 burning shows no flames | new `src/fx/burning.js`: `EntityFire` draws two camera-facing animated fire quads (the block texture's own 8 fire frames, full bright, one instanced draw) over every entity with `fireTicks > 0` and over the third-person player model; smoke puffs rise off burning things every 3 ticks; `overlays.js` + `fx.css`: first-person fire (two mirrored sheets of the fire strip rising from the bottom corners, 12 fps) while `player.fireTicks > 0`, not in creative, not dead | real lava under the feet then out: overlay on (`after-01-player-burning.png`), V key third person (`after-02-...-3p.png`), zombie + skeleton in the 06:00 sun burn with flames (`after-03-monsters-burning.png`, `smoke-fx-fx-burning-mobs.png`); new scenario `fx-burning` PASS; unit test `burning entities` |
| FID-13 sleeping cuts to black | new `src/fx/sleepview.js`: on `sleep:start` the camera glides (0.7 s) to the pillow (bed top + 0.22, on the head half) looking along the bed toward the foot, 14 degrees up; screen fades to black over 2 s (kid nap: to 0.45 over 1.5 s so the stars show); on `sleep:end` it dips to black, stands back up under the black, fades in over 0.7 s. FX frame runs after the player lane's and before the renderer, so only `renderer.camera` is overridden while asleep (player yaw/pitch/position untouched). Hand and third-person body hidden while asleep | tap on a bed at night (kid tap): `after-31-sleep-0.5s.png` shows the blanket and the night sky from the pillow, then darkening, black, morning; scenario `fx-sleep-view` PASS (camera at the pillow, fade > 0.9, then standing + fade 0); unit test `sleeping camera` |
| POL-4 big grey bubble squares | bubbles every 10-20 ticks, 1.2 blocks ahead along the full look ray and 0.3 below the eye; size 0.05; new particle flag `F_NOFOG` + `F_FULLBRIGHT` (shader skips light and fog); bubble sprite rim light blue | ocean at y 39: `before-20-underwater.png` (dark 40-70 px rings) vs `after-20-underwater.png` (small pale ring); unit test `breathing bubbles` |
| POL-15 murky ghost | `fxmat.js` new atlas mode `'ghost'`: texture lifted 40 % toward white, no world light, "lighten" blend (src ONE, dst 1-a), alpha 0.42 +- 0.04 slow pulse | seed 12345, setTime(12000), setLook(90,5), kid cursor on the spruce: `z-ghost-cmp.png` (left before: dark brown glass, right after: pale block) |

Commands: `node build.mjs --dev --out .tmp/build-fx` ok; `npm run test:unit` 234/234 pass; `node tools/smoke.mjs --tag fx`:
159 PASS, 5 SKIP, 3 FAIL (audio-catalog, audio-music, mobs-gallery: all `ENOSPC: no space left on device` writing
screenshots - drive C: was at 0 bytes free, filled by something outside this worktree). Re-run once space came back:
`--scenario audio-catalog,audio-music,mobs-gallery,fx-burning,fx-sleep-view,fx-overlays,fx-crack-ghost,fx-inworld-break,fx-particles-kinds`
-> `{"PASS":10}`, page-errors PASS.

Remaining: no touchscreen-hardware check; nap (kid default) path fades to 0.45 instead of black - covered by code
reading and the mech-sleep scenario, not separately screenshotted.

## 2026-10-03 · Phase 2: merged the real core, verified in-world, fixed what looked wrong

`git merge main` into `lane/fx` (merge commits `ea295cf` and `2f79d28` for main's later "classic brightness curve"
commit; no conflicts; LEAD files untouched). FX's shader light/fog copy (`fxmat.js GLSL_LIGHT`) was updated to the
new core curve (warm fading block light, `uGamma` = settings.brightness, `uMinLight` 0.05..0.20, eased fog) so
particles, the hand and dropped items stay exactly as bright as the terrain around them (`grid-w1.png`). Everything below was
driven in real headless Chrome (RTX 3080 Ti / ANGLE D3D11, plus SwiftShader for the weak-laptop path) with real
`page.mouse` / `page.keyboard` input plus the test API, and every screenshot was looked at.

### Stub-era code removed

- `avatar.js`: the view-model `autoClear` workaround (CORE-D's view-model pass clears depth only, autoClear off).
- `fxmat.js`: the `ArrayTextureRef` fallback texture built from `game.textures` (CORE-D's `uTex` is always there now).
- `tools/scenarios/fx.mjs`: the stub-only "scenery" platform; `fx-player-model` now uses the player lane's real
  V / F5 camera instead of patching `player.frame`.
- No mobs-collision fallback existed in FX (particles already used `getCollisionBoxes`).

### Defects found in-world and fixed (FX files only)

| What a player would have seen | Fix |
|---|---|
| Black squares in the mining dust: dust is spawned on the face of the block being mined and lit by that (solid, light 0) cell | `particles.js lightAround()`: a particle in an opaque cell takes the brightest open neighbour (unit test added) |
| Clouds cut off by a hard straight line across the sky (the camera far plane, 120-152 blocks, is closer than the clouds) | `celestial.js`: far cloud vertices are squeezed along the view ray into [0.6, 0.97] x far (same pixel, order kept, near clouds keep true depth); fade range now 150-190 blocks, so clouds stretch to the horizon |
| Huge translucent green box filling the screen at dusk / in tall grass: the kid ghost block in the cell right in front of the eye | `blockfx.js`: ghost hidden within 1.3 blocks of the eye and faded in over the next block |
| Ghost could promise a block that will not go in (flower on stone, torch without a wall) and used its own copy of the state rules | `ghostPlacement()` now imports CORE-E's `placementState` and mirrors `tryPlace` (same cell, "replace acts as top face", placeOn / floor / wall support) |
| Hand and held item off-screen in a 375 px-wide portrait window | `avatar.js`: hand x offset scales with aspect (unchanged at 4:3 and 16:9) |
| Full moon at dusk was a 20-degree white blob on the bright horizon (additive) | moon quad 20 -> 14 (disc ~12 degrees), moon fades in with darkness |
| Sun a white blob at sunset | sun tinted warm orange near the horizon |
| Stars clearly visible in a blue sunset sky | star alpha = starBrightness^2 (classic curve), stars a little smaller |
| Pink/maroon clouds in the dark after sunset | sunset tint on clouds fades with daylight |
| Snow fell as long white streaks (per-vertex `fract` collapsed each quad onto one texel row) | wrap moved to the fragment shader; snow uses square texels (small flakes) |
| Underwater tint could lag the fog by a tick and fail `fx-overlays` | tint follows `renderer.eyeMedium` (the same answer as CORE-D's fog, per frame) |
| Clouds cost ~4 ms/frame on SwiftShader | low preset (SwiftShader, Intel HD) draws flat single-pass clouds (`buildFlatCloudGeometry`, 330 quads vs 4400 x 2 passes; SPEC §8.7 "flat clouds"); cost now within noise |
| Scenario bugs: `fx-itemmesh` measured world streaming, `fx-inworld-break` had an empty survival hotbar, `fx-sky` looked east at sunset (yaw 90 = west) | fixed; `fx-sky` now asserts the morning sun is on screen looking east, the setting sun looking west and the moon overhead at midnight |

### Verified in-world (PASS/FAIL)

Screenshots: `.tmp/fxv/*.png` (my scripts in `.tmp/fxv/*.mjs`, git-ignored) and `.tmp/smoke-fx-fx-*.png`.

```
PASS view model over real terrain: block / tool / food / torch / empty hand, 16:9 + 4:3 + 375x667   grid-wide.png grid-43.png grid-phone.png
PASS hand lit by eye light: dark in a closed stone room, warm next to a torch                        grid-w1.png
PASS swing on real mining (mouse held), equip swap (lower / swap / raise) on hotbar change           hand-wide-mine*.png hand-wide-swap-mid.png
PASS crack overlay on real survival mining: cube, slab, fence post (shape-fitted), darkens            hand-wide-mine3.png grid-crack.png
PASS block particles with real textures + light: dark in caves, warm by torches, settle on ground    grid-w1.png smoke-fx-fx-inworld-break.png
PASS cutout break particles (torch, poppy) use opaque patches                                       grid-crack.png
PASS ghost: kid cursor cell, torch on wall (state 1), ladder on wall, none for apple / pickaxe       grid-w2.png (+ fx-inworld-break assert)
PASS ghost on water: none (raycast ignores fluids, same as placing)
PASS sky vs CORE-D dome: sun / moon / stars drawn over the dome; sunrise east, sunset west (asserted) grid-skyscen.png
PASS stars rotate with the celestial angle; 8 moon phases; clouds toggle with settings.clouds        fx-sky
PASS clouds at R3 and R12, fade into the horizon, no far-plane cut; flat clouds on SwiftShader      grid-clouds.png grid-flat.png
PASS third person with the real V key: body visible / hand hidden, walk cycle with W held,
     body-yaw lag on turn, front view with face + held sword, back to first person                 grid-tp.png
PASS rain: sky greys (renderer reads fx.weather.rain), stops under a roof, splashes                 grid-rain.png
PASS snow in the snowy preset (small flakes), weather eases back to clear                           grid-rain.png
PASS underwater: CORE-D fog + FX tint, breathing bubbles; splash particles on entering water        grid-w2.png
PASS kid hold ring on real pointerdown (mouse), fills, hides on release                             hand-wide-mine1.png
PASS torch flame + smoke display ticks at night                                                     torch-night.png
PENDING dropped items (fx-inworld-drops): items + mobs lanes are still stubs
PENDING real MOBS / MECH / KID / SURVIVAL events (love hearts, death poof, TNT, bone meal, home and
     bed fades, hurt flash from real damage, eat crumbs): those lanes are stubs; the FX side is covered
     by fx-events / fx-overlays / fx-particles-kinds with emitted events
NOT RUN touch tap/hold on a real touchscreen (touch lane is a stub; the ring listens to pointer events)
```

### Performance (FX share, real world)

- RTX, R6, settled world, A/B toggling FX sky + hand: draws 162 -> 156 (day) / 169 -> 162 (night, stars + moon);
  frame time identical (vsync-bound 6.9 ms). FX adds 5-7 draw calls in normal play (stars, sun, moon, clouds x2,
  hand, held item) + particles 1, crack 1, ghost 1, weather 1 when active.
- SwiftShader, low preset R4: per-component A/B (median of 4): clouds 41.6 vs 41.0 ms, hand 45.3 vs 45.4,
  sun/moon/stars 44.3 vs 43.3 - all within SwiftShader noise after the flat-cloud change (was ~+4 ms).
- 2000 particles (cap): 1 draw call, frame time unchanged on RTX.

### Commands run and results (final)

```
node build.mjs --dev --out .tmp/build-fx      -> 1675 KB dev build
npm run test:unit                             -> tests 104, pass 104, fail 0
node tools/smoke.mjs --tag fx                 -> {"PASS":66,"PENDING":4,"SKIP":2,"FAIL":1}
   all 11 runnable fx-* PASS; fx-inworld-break PASS (was PENDING); fx-inworld-drops PENDING (items, mobs)
   FAIL coree-classic-lock in 3 of 4 full runs (timing-dependent CORE-E scenario, see Cross-lane defects): 6/6 PASS
   alone and 2/2 PASS running every scenario up to it, on both this build and main
node tools/smoke.mjs --tag fxss --swiftshader --scenario boot,world,perf,fx-*  -> {"PASS":15,"PENDING":1}
```

### Cross-lane defects (not edited; for the owners via LEAD)

1. **CORE-D test `cored-daynight` is flaky** (`tools/scenarios/cored.mjs`, "setTime never remeshes"). It compares
   `getStats().merges` before/after `setTime`, but deferred column re-merges from the initial load are still draining
   (sets stay equal, merges grow, e.g. 401 -> 416). Fails ~1 in 3 runs on a plain `main` build too. Suggested fix:
   wait until merges are stable for ~30 frames (or `world.unmeshedWithin(R) === 0` and no pending merge queue) before
   the `before` snapshot, or assert only `sectionSets`.
2. **CORE-D test `cored-entity` leaks its test objects**: the 4-part red mob and the oak-log block model are added
   with `renderer.addObject` and never removed, and `renderer.dynamicGroup` survives `exitToTitle`, so they float in
   every later scenario's screenshots (`smoke-fx-fx-particles.png`, `-hurt`, `-ring`, `-inworld-ghost` in a full run).
   Suggested fix: `R.removeObject(mob); R.removeObject(block);` + dispose at the end of the scenario (and/or LEAD:
   clear non-system dynamic objects on `world:exit`).
3. **CORE-E test `coree-classic-lock` is timing dependent**: in full runs it failed with "walked to the edge" once
   and "middle click picks the block into the hotbar" twice (selected slot stayed 0 / 4); `mouseLookDeg` varies
   5..96 between runs. 6/6 PASS alone and 2/2 PASS when every scenario up to it runs first, on both this build and
   `main`, so it is not caused by FX (FX scenarios run after it). Suggested fix: reset hotbar/selection
   and wait for pointer-lock + a settled frame before the mouse-look and pick-block steps.
4. **Hotbar number keys do nothing yet**: `hotbar1..9` actions are handled by the HUD (INV lane, still a stub), so
   `Digit1..9` do not change the selected slot in play. FX's equip-swap animation was verified with
   `inventory.selectSlot`. Nothing to fix in core; the INV lane needs it.

### Remaining gaps (FX)

- Dropped-item look (spin/bob, sizes) and real mob/mech/kid event effects: wait for items, mobs, mechanics, kid,
  survival lanes.
- Touchscreen hold ring on a real touch device (touch lane stub).
- Arm swing: works and reads as a punch, but the mid-swing pose shows the whole forearm sideways; could be closer to
  the classic chop arc (cosmetic).
- Fancy clouds can show faint lines where faces overlap near the fade edge (cosmetic).
- Merge commit `ea295cf` was created by `git merge --no-edit` without the Co-Authored-By trailer (left as is; no
  history rewriting). `2f79d28` has it.

## 2026-10-03 · FX lane implemented (P0 + P1 + P2 weather)

`registerStub('fx')` is deleted: `src/fx/fx.js` is real. Built against the frozen interfaces while every CORE lane was
still a stub; everything that could be checked without the real core was checked in real headless Chrome (RTX and
SwiftShader), and the rest is listed under "Needs in-world verification".

### What is done (files)

| File | What |
|---|---|
| `src/fx/fx.js` | System wiring, frozen API (§8.7) + `stats()`, `setWeather()`, `debug`; event listeners; ambient "display ticks" (torch flames + smoke, fire smoke, lava pops, lit furnace); breathing bubbles; mining dust; TNT fuse smoke; love hearts |
| `src/fx/fxmat.js` | FX shaders that share CORE-D's uniform objects (`uDaylight uMinLight uFogColor uFogNear uFogFar`) so the lighting curve + fog match chunks exactly; `ArrayTextureRef` (CORE-D's `uTex`, or a fallback DataArrayTexture from `game.textures` while the renderer is a stub); per-object light via `onBeforeRender` + `uniformsNeedUpdate` (shared material, per-draw light) |
| `src/fx/particles.js` | `ParticleSim` (pure, typed arrays, max 2000, simulated per tick, interpolated per frame) + `ParticleMesh` (ONE instanced draw call; samples the block array texture for block patches or the FX sprite atlas). Kinds: `block smoke explosion heart sparkle splash bubble crit angry poof flame` + `item` (crumbs coloured from the item sprite), `drip`, `note`. Block break = 27 particles (3x3x3) of 4x4-pixel face patches, opaque-patch picker for cutout textures, gravity + collision with real collision boxes, world light |
| `src/fx/sprites.js` | Pure, deterministic, original pixel art: particle atlas (puffs x8, heart, sparkle x2, crit, angry, drop, bubble, flame x2, square, note, star), square sun with stepped glow, 8 moon phases, cloud map + blocky cloud geometry, rain/snow streaks |
| `src/fx/itemmesh.js` | `makeItemMesh` backend: `iso:` icons -> CORE-C `meshBlockModel` geometry (atlas shader), `tex:`/`sprite:` -> extruded 16x16 voxel slab (vertex colours, 1/16 thick). Geometry cached per item key and shared; `disposeItemMesh` only detaches |
| `src/fx/avatar.js` | First-person view model (arm + held item in `renderer.viewModelScene`): swing (from `player:swing` and `player.swingTicks` rising), equip-swap (lower/swap/raise on hotbar change), place push, walk bob (bigger with `settings.viewBobbing`), idle breathing, look-lag sway, eye light. Third-person character (view 1/2), walk cycle, head look, body-yaw lag, swing, held item in the right hand |
| `src/fx/playermodel.js` | Original kid explorer: box-UV skin painted from `settings.skin` (hair with side fringe, big eyes, rosy cheeks, star badge, rolled sleeves, belt, sneakers); merged 6-part geometry, one draw call (`uParts`) |
| `src/fx/blockfx.js` | Crack overlay (selection boxes x1.002, `crack_<stage>` layers, multiply blend, depthWrite off, polygonOffset -1, driven by `interaction.mining` or the `block:mining`/`block:miningStop` events). Kid ghost block (`ghostPlacement` mirrors §7.4: replaceable target cell, torch/ladder/facing/axis/slab state, never inside the player) |
| `src/fx/overlays.js`, `fx.css`, `flash.js` | DOM layer `#fx-layer` at `Z.FX_OVERLAY`: underwater tint (0.25), eye-in-lava tint, red hurt vignette (flash limiter: max 3 per second), black fades, subtle camera vignette, kid hold ring (fills over 350 ms from pointerdown, cancels on drag > 12 px / release) |
| `src/fx/weather.js` | P2 rain + snow: one GPU-animated mesh of world-anchored streaks around the camera, hidden under roofs/trees by a 32x32 heightmap texture (`world.getHeight`), snow in the snowy biome/preset, ground splashes, optional cycle when `rules.weatherCycle` (seeded from the world seed, never touches `game.rand`) |
| `src/render/celestial.js` | Sun (additive, square), moon with 8 phases (`sky.moonPhase`), ~1200 rotating stars (`sky.starBrightness`), blocky 3D clouds at y 108 drifting +X at 0.03 b/t (depth pre-pass + blended pass), `settings.clouds` toggle, sunset tint, rain hides sun/moon/stars |
| `test/fx.test.mjs` | 18 unit tests (pure modules) |
| `tools/scenarios/fx.mjs` | 12 smoke scenarios (`fx-*`) |

### Commands run and results

```
node build.mjs --dev --out .tmp/build-fx
[build] 0.1.0-7d0403ff-dev -> ...\bc-fx\.tmp\build-fx\index.html (1207 KB, 165 ms, dev)

npm run test:unit
ℹ tests 31
ℹ pass 31
ℹ fail 0

node tools/smoke.mjs --tag fx
PASS     boot                 71 ms
PASS     world               267 ms
PENDING  terrain-render        0 ms  - stub lanes: textures, worldgen, world, lighting, mesher, renderer
PENDING  move-jump             0 ms  - stub lanes: input, player, physics, world, worldgen
PENDING  break-place           0 ms  - stub lanes: input, player, physics, raycast, interaction, world
PASS     hotbar               53 ms
PASS     inventory-ui        128 ms
PASS     time               1067 ms
PASS     kid-home            289 ms
PENDING  mobs                  0 ms  - stub lanes: mobs, physics, world
PENDING  survival-fall         0 ms  - stub lanes: survival, player, physics
PENDING  save-load             0 ms  - stub lanes: save, world
SKIP     touch-controls        0 ms  - needs --touch
PENDING  context-loss          0 ms  - stub lanes: renderer
PASS     perf               3103 ms
PASS     fx-break-particles    121 ms {"afterBreak":27,"capped":2000}
PASS     fx-itemmesh         797 ms {"geometries":{"g0":12,"g1":12,"shared":true,"live":1}}
PASS     fx-sky              522 ms {"phases":[0,1,2,3,4,5,6,7]}
PASS     fx-viewmodel       1155 ms
PASS     fx-crack-ghost      204 ms
PASS     fx-player-model     492 ms
PASS     fx-overlays         661 ms
PASS     fx-particles-kinds    268 ms {"particles":125}
PASS     fx-weather         2614 ms
PASS     fx-events            41 ms {"events":{"sparkles":14,"hearts":5,"loadPoof":0,"spawnPoof":8}}
PENDING  fx-inworld-break      0 ms  - stub lanes: renderer, world, mesher, textures, input, player, raycast, interaction
PENDING  fx-inworld-drops      0 ms  - stub lanes: renderer, world, interaction, items, mobs
PASS     lead-events-roundtrip     55 ms
PASS     lead-unload-persist    278 ms
PASS     lead-break-contract     72 ms
PASS     lead-batch           42 ms
PASS     lead-entity-streaming    137 ms
PASS     lead-testapi        552 ms
PASS     page-errors           0 ms
[smoke] {"PASS":24,"PENDING":9,"SKIP":1} in 13.5 s

node tools/smoke.mjs --tag fxss --swiftshader --scenario boot,world,perf,fx-break-particles,fx-itemmesh,fx-sky,fx-viewmodel,fx-crack-ghost,fx-player-model,fx-overlays,fx-particles-kinds,fx-weather,fx-events
[smoke] {"PASS":14} in 11.8 s (swiftshader)
```

Screenshots reviewed (`.tmp/smoke-fx-fx-*.png`): hand with block / tool / empty / mid-swing, crack + ghost, particle
kinds (block patches, hearts, sparkles, smoke, flame, crits, explosion puffs, splash, crumbs), third person back and
front, sky morning / noon (sun + clouds) / sunset (moon rising, tinted clouds) / midnight (stars), rain, underwater
tint, hurt vignette, kid ring. While CORE-D is a stub the visual scenarios build a small "scenery" platform out of FX
block meshes so the shots show something (only when the renderer is a stub).

### Needs in-world verification (after the core merges)

Run `node tools/smoke.mjs --tag fx` (the two `fx-inworld-*` scenarios turn from PENDING into real checks) and look at
the shots:

1. **View-model pass**: hand + item drawn over real terrain; arm/item pose (`ViewModel.cfg`) at 16:9 and 4:3 and in a
   375 px-wide window; hand lighting in caves/at night (eye light); swing on real break/place; equip swap via 1-9 keys.
2. **Crack overlay** on real survival mining (`interaction.mining`), on non-cube blocks (slabs, fences, torches), with
   the real `crack_0..9` textures (multiply blend should darken, not whiten); no z-fighting at distance.
3. **Block particles** with the real textures and real light (dark in caves, warm near torches), collision on slabs
   and stairs, cutout plants (patch picker), particle count during TNT chains (cap 2000, frame time).
4. **Ghost block** with the real kid cursor (`fx-inworld-break` asserts the cell), on water/grass (replaceable), on
   walls with torches/ladders, and that it never appears for food/tools.
5. **Sky objects vs CORE-D's sky dome**: the sun/moon/stars must not be hidden by the dome (see interface
   assumption 3); sun/moon rise in the east (+X) and set in the west; stars rotate; clouds fade into CORE-D's fog and
   look right at R 3 and R 12; sunset tint; clouds toggle in settings.
6. **Third-person** with the player lane's real camera (V / F5): body yaw lag, walk cycle at real speed, held item in
   the hand, model hidden in first person.
7. **Dropped items** from MOBS (`fx-inworld-drops`): spin/bob looks right with the bottom-centre origin and the 0.25 /
   0.5 sizes, lit by world light, geometry count flat after many drops.
8. **Weather** (P2): renderer darkens the sky with `fx.weather.rain`; rain stops under roofs/leaves (heightmap);
   snow in snowy biomes.
9. **Underwater**: CORE-D's underwater fog + FX tint together; bubbles; splash when jumping into water
   (`player:water`).
10. **Real MOBS/MECH/KID events**: hearts on love/breed/tame (and every 10 ticks while in love - see assumption 7),
    death poof after the tip-over, TNT fuse smoke, explosion puffs + debris, bone-meal sparkles, home/respawn fades,
    bed nap fade with the starry sky, eat crumbs.
11. Performance at R 6 on the mid laptop: FX adds ~12 draw calls max (particles 1, stars 1, sun 1, moon 1, clouds 2,
    crack 1, ghost 1, player 1 + item 1, hand 1 + item 1, weather 1); clouds are ~6k quads.

### Interface assumptions (documented in code)

1. `renderer.uniforms` holds `{value}` objects that CORE-D updates in place every frame (FX shares the objects).
   `renderer.uniforms.uTex.value` becomes the block `DataArrayTexture` (same layer order as `game.textures`).
2. `renderer.viewModelScene` is rendered with `viewModelCamera` (fov 70, at the origin, looking -Z) after a depth
   clear. FX switches `renderer.autoClear` off for that one scene (scene `onBeforeRender`/`onAfterRender`, restored
   afterwards) because the stub's second `render()` cleared the world's colour buffer.
3. CORE-D's sky dome / background does not write depth (or lies beyond `camera.far * 0.8`): sun, moon and stars sit
   on a sphere of radius `0.8 * camera.far` around the camera, depth-tested, `renderOrder` -12/-11; clouds -10.
4. `renderer.sky` = `computeSky()` result (`sunDir`, `starBrightness`, `moonPhase`, `daylight`, `sunsetColor`,
   `fogColor`); FX calls the same pure `computeSky` while it is null. The sun angle is derived from `sunDir`.
5. Player fields read: `renderX/Y/Z, x/y/z, yaw, pitch, eyeHeight, view, swingTicks, onGround, flying, dead,
   sleeping, eyeInWater, width, height`, methods `getEyePos`, `getLookDir`, `swing`. Interaction: `target`
   (RayHit with `px/py/pz`), `targetEntity`, `mining {x,y,z,id,progress,stage}`, `breakBlock`. Input: `aim`,
   `aimActive`, `isCaptured()`.
6. Item meshes: origin = bottom centre, block items 0.25 blocks, flat items 0.5 blocks wide; callers may set the
   returned Group's position/rotation freely (bob, spin) - do not scale the inner mesh.
7. Love hearts: FX spawns hearts on `mob:love`/`mob:bred`/`mob:tamed` and every 10 ticks while a mob's
   `entity.data.love`, `data.loveTicks` or `data.inLove` is > 0. MOBS: keep the love counter under one of those names
   (or call `game.fx.spawnParticles('heart', x, y, z)` yourself).
8. Fades: KID may call `fx.fade()` for Home; if it does not, FX pulses a short fade on `kid:home` (skipped when a
   caller used `fx.fade()` in the last second). Same for `player:respawn`.

### New events / API members (for the SPEC)

- `fx:weather {rain, snow}` - emitted by FX when the target rain strength changes.
- `game.fx.stats()` -> `{particles, maxParticles, spawned, itemMeshesLive, itemGeometries, crack, ghost, viewModel,
  heldItem, playerModel, underwater, flashes, fade, sky {angle, phase, stars, sunVisible, cloudsVisible}, clouds,
  cloudQuads, stars, weather, ring}` (tests, debug overlay).
- `game.fx.setWeather(rain 0..1)`; `game.fx.weather` = `{rain, target, snow}` (the renderer reads `rain`).
- `game.fx.spawnParticles` also accepts kinds `item` (opts.item or opts.colors), `drip`, `note`; returns the count.
- `game.fx.debug` (internals for tests; not a stable API).

### Spec conflicts / notes

- §8.7 says "flat clouds"; the task brief asked for blocky moving clouds, so clouds are 3D blocks 4 high (the classic
  "fancy" look, 2 draw calls). A flat fallback for the low preset is easy if the integrator wants it.
- §8.7 says block items use `renderer.createBlockModel`; FX uses the same CORE-C `meshBlockModel` geometry with its
  own atlas shader so one cached geometry + one shared material serve every dropped/held item (per-draw light).
- §8.7 says the view model shows "arm plus held item": FX shows both (Bedrock style); the arm sits under the item.

### LEAD requests

1. **CORE-D (via LEAD)**: render `viewModelScene` with `autoClear = false` (the stub's second `render()` wipes the
   world colour; FX works around it, see assumption 2), and use `renderer.info.autoReset = false` with one reset per
   frame as §5.5.6 says - with the stub, `stats().drawCalls` only counts the last pass (shows 2).
2. **CORE-D**: confirm the sky dome does not write depth (assumption 3) and read `game.fx.weather.rain` in
   `computeSky(dayTime, rain)`.
3. **Test API (additive)**: `__game.fxStats()` -> `game.fx.stats()` would let scenarios avoid `t.eval`.
4. **SPEC**: document `fx:weather`, `fx.stats()`, `fx.setWeather()` and the extra particle kinds (above).

### Remaining

- P2 polish: flat-cloud fallback for the low preset; footstep dust when sprinting; lava drip particles under lava
  ceilings; third-person sneaking pose; "dropped item" sizes may need a tweak once MOBS bobs them.
- Everything in "Needs in-world verification".

### Blockers

None for FX. In-world verification waits on the CORE lanes (renderer, world, mesher, textures, player, input,
raycast, interaction) and MOBS (dropped items).
