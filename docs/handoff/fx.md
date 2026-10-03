# Handoff - fx

Branch `lane/fx` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-fx`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

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
