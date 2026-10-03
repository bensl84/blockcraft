# Handoff - cored

Branch `lane/cored` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-cored`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · CORE-D renderer and sky: P0 complete, most P1/P2 done

### What changed

Stubs deleted: `registerStub('renderer')` and `registerStub('sky')` (both modules are real now).

| File | What it is |
|---|---|
| `src/render/renderer.js` | `game.renderer` (frozen API §5.5.2 kept). WebGL2 + gamma pipeline; `DataArrayTexture` (nearest mag, NearestMipmapLinear min, mipmaps, NoColorSpace, flipY false); 3 chunk `ShaderMaterial`s sharing ONE uniforms object; section meshes; sky dome; fog (render distance / override / underwater / lava); outline; entity materials; block models; view-model pass (depth clear, `autoClear` handled); presets + dynamic quality; context loss (pause, auto-recover, 5 s "reload" button); F3 debug overlay; stats. |
| `src/render/sky.js` | `computeSky(dayTime, rain, day)` - Java celestial angle + daylight formula, tuned day/night palette (smoothstep blend), Java sunset glow, stars, moon phase, `sunDir` (sunrise +X east, noon up, sunset -X west). Pure. |
| `src/render/shaders.js` | GLSL ES 3.00: chunk (§5.5.3 lighting curve, AO table, face shade, warm block light, min-light floor, animated layers, waving, cutout LOD-aware alpha test), entity (MAP / ATLAS / PARTS), sky gradient + sunset glow, kid outline ribbons. |
| `src/render/chunkmerge.js` | Pure: shared quad index buffers (Uint16 view up to 16384 quads, shared Uint32 grown by doubling), column merge, in-place degenerate, translucent back-to-front quad sort. |
| `src/render/quality.js` | Pure: GPU preset detection (§5.5.6 table) and the `DynamicScaler` state machine. |
| `src/render/outline.js` | Classic thin lines (black, α 0.4, box grown 0.002) and kid ribbons (white 0.03 over black 0.056, widened with distance to stay ≥ ~2 px). |
| `src/render/entitymat.js` | `createEntityMaterial` implementation with a `clone()` that shares global uniforms and the map texture (three's default clone would re-upload textures per entity and freeze day/night). |
| `test/cored.test.mjs` | 12 unit tests (sky, presets, dynamic scaling, index buffers, merge, translucent sort, shader contract, outline geometry, entity material cloning). |
| `tools/scenarios/cored.mjs` | 11 smoke scenarios `cored-*` (require only `renderer`, `sky`). |

Design notes:

- **Draw calls (§5.5.6, P0 path taken up front):** opaque and cutout geometry is merged **per column per pass** (one draw each). An edit to an already merged column draws the edited section as its own small "hot" mesh the same frame; its old quads in the column buffer collapse to degenerate triangles with a partial upload (`addUpdateRange`), and the column is re-merged 3 s after the last edit (one column per frame). Streaming / `remeshAll` (≥ 4 sections at once) re-merge directly. Translucent geometry stays **per section** (sorted back to front by three) and its quads are re-sorted back to front when the eye moves > 0.5 blocks (sections within 48 blocks, ≤ 12 per frame).
- **Day/night:** only uniforms change (`uDaylight`, sky/fog colours); `setTime` never remeshes (asserted by `cored-daynight`).
- **Fog:** colour = horizon colour (tinted toward the sunset glow when facing the sun); the sky dome's horizon and everything below it are exactly the fog colour, so terrain edges never show a seam (`cored-fog` horizon band deviation 1.5/255).
- **Underwater:** decided from the camera cell (works for third person too): fog `#1e4cc0` × (0.15 + 0.85·daylight), near 0, far 20, spherical; whole sky = fog colour. Lava: orange, far 2.5.
- **Presets:** SwiftShader/llvmpipe → low R4 DPR1 (+ fast-leaf textures for the session), Intel HD/UHD → low R5 DPR1 (+ fast leaves), Iris/Radeon integrated/unknown → medium R6 DPR1.25, discrete → high R8 DPR1.5, touch-primary → R≤5 DPR1. `renderDistance` setting 0 = preset; manual R is never changed by scaling.
- **Dynamic scaling:** ignores 5 s after `world:ready`/tab switch; p90 > 22 ms for 2 s → DPR −0.25 (min 0.75) then R −1 (min 3); p90 < 12 ms for 8 s → R +1 up to preset max (then DPR back up); 5 s cooldown; no scale-down at ~33 ms frames with `workMs < 8`.
- **halfAnim:** if `MAX_ARRAY_TEXTURE_LAYERS < textures.count` the renderer rebuilds with `{halfAnim: true}` and takes frame counts from `textures.animated` (uniforms `uAnimFrames`/`uAnimFps`).

### Commands run and results (2026-10-03, in this worktree)

`npm run test:unit`

```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```

`node tools/smoke.mjs --tag cored` (RTX 3080 Ti, file://)

```
PASS     boot                 52 ms
PASS     world               263 ms
PENDING  terrain-render        0 ms  - stub lanes: textures, worldgen, world, lighting, mesher
PENDING  move-jump             0 ms  - stub lanes: input, player, physics, world, worldgen
PENDING  break-place           0 ms  - stub lanes: input, player, physics, raycast, interaction, world
PASS     hotbar               62 ms
PASS     inventory-ui        140 ms
PASS     time               1071 ms
PASS     kid-home            290 ms
PENDING  mobs                  0 ms  - stub lanes: mobs, physics, world
PENDING  survival-fall         0 ms  - stub lanes: survival, player, physics
PENDING  save-load             0 ms  - stub lanes: save, world
SKIP     touch-controls        0 ms  - needs --touch
PASS     context-loss        584 ms
PASS     perf               3082 ms {"drawCalls":86, "renderDistance":8, "sectionMeshes":394, "fps":143.9}
PASS     cored-render        989 ms {"drawCalls":87,"triangles":95347,"R":8}
PASS     cored-daynight     1904 ms {"luma":{"morning":101,"noon":157,"sunset":118,"night":18},"remesh": none}
PASS     cored-fog          1152 ms {"worst fog at the nearest missing column, R3..12": 0.75..0.98,"horizonDev":1.5}
PASS     cored-outline       246 ms {"classic":{"changed":44,"dark":44},"kid":{"changed":245,"white":168}}
PASS     cored-edit         4022 ms {"changed":327,"hot":1,"hotUploads":1,"afterCompaction":0}
PASS     cored-underwater    898 ms {"medium":"water","far":20,"rgb":[29,58,129]}
PASS     cored-translucent    841 ms {"trans":1,"sorts":1,"firstY":20,"lastY":22}
PASS     cored-context       638 ms
PASS     cored-perf         2905 ms {"R6":{"drawCalls":54},"back":{"geometries":54 (was 54)}}
PASS     cored-entity        237 ms {"4-part mob":"1 draw","block model":"1 draw"}
PASS     cored-settings      244 ms
PASS     lead-events-roundtrip / lead-unload-persist / lead-break-contract / lead-batch / lead-entity-streaming / lead-testapi
PASS     page-errors           0 ms
[smoke] {"PASS":26,"PENDING":6,"SKIP":1} in 21.3 s
```

`node tools/smoke.mjs --tag cored-sw --swiftshader` → `{"PASS":26,"PENDING":6,"SKIP":1}` (preset low, R4; cored-perf R6 54 draws, 86 fps headless).
`node build.mjs --out .tmp/build-cored-min` (minified, 602 KB) + `--file` run of cored-render/outline/entity → PASS.

Screenshots reviewed (`.tmp/smoke-cored-cored-*.png`): noon, morning (dawn 23500), sunset, sunset-west (glow, no horizon seam), night, horizon, fog-ground, underwater, water, translucent, outline-classic, outline-kid, edit, entity, context. With the stub textures/worldgen/mesher (flat-colour tiles, ring hills, no AO, no water meshing) they read as the classic look: blue gradient sky into a pale horizon, crisp nearest-filtered pixels, face shading, fog melting distant terrain into the sky.

### §13.2 CORE-D acceptance

| Item | State |
|---|---|
| stub lines deleted | done (`renderer`, `sky`) |
| `terrain-render` | PENDING only because textures/worldgen/world/lighting/mesher are stubs; `cored-render` runs the same asserts (draws > 0, tris > 1000, not blank, night darker) and passes |
| `context-loss` | PASS |
| `perf` draw-call bound | PASS (86 at R8 stub terrain; `cored-perf` 54 at R6, budget 300) |
| day vs night luma | PASS (`cored-daynight`) |
| fog hides pop-in | PASS (`cored-fog`, every R 3..12, plus horizon band) |
| outline visible | PASS (`cored-outline`, classic + kid) |
| no remesh on `setTime` | PASS (`cored-daynight`) |
| foundation tests / dev build | PASS |

### Remaining

- P1: verify on real content once CORE-A/B/C land: leaf alpha at distance (LOD-aware cutout threshold is in), water look (alpha ~0.69 texture, bob ±0.03), torch-lit caves, AO, draw calls with caves + water (re-run `cored-perf`, `cored-render`, `terrain-render`). Expect ~2–3 draws per visible column.
- P2: per-face sort is distance-to-quad-centre only (good for water/glass; intersecting translucent quads can still mis-order). Weather (rain) only greys the sky; no rain particles (FX). Debug overlay text is English (parents only).
- Not measured: a real Intel Iris / UHD laptop (dynamic scaling is unit-tested; headless SwiftShader is too fast here to trigger it).

### Blockers

None for this lane.

### Spec conflicts (please resolve in the SPEC)

1. **Fog curve (§5.5.3 "linear").** The circular mesh radius (CORE-C, §5.3.3) leaves diagonal holes that start before `fogFar = (R − 0.5)·16`: worst case at R 4 the nearest missing column is only ~52% into the linear fog ramp. The shader eases the ramp, `1 − (1 − f)²`, which makes it ≥ 75% at every R 3..12 (`cored-fog`). Uniform values (`uFogNear`, `uFogFar`, `setRenderDistance` formula) are exactly as specified.
2. **Fog distance (§5.5.3 "view distance").** Horizontal (cylindrical) distance on land, spherical underwater/lava. Pop-in is horizontal, and spherical fog washed out the ground when flying high.
3. **Anisotropy 4 (§5.5.1).** Set on the texture, but three r170 skips it for nearest magnification, and forcing it through GL made ANGLE/D3D11 (every Windows laptop) switch magnification to linear, which blurred the pixel art. Left off on purpose.
4. **Index buffers (§5.4).** Opaque/cutout/hot sections use views of the shared index arrays as specified. Translucent sections get their own copy of the index array, because they re-order quads back to front.
5. **Geometry granularity (§5.4 "one BufferGeometry per section per pass").** Opaque/cutout are merged per column (§5.5.6 allows this as P0). `getStats().sectionMeshes` still counts non-empty sections.

### New API members / events (CORE-D, additive)

- `renderer.uniforms`: `uFogSphere`, `uAnimFrames`, `uAnimFps` added. All other names frozen.
- `renderer.capturePixels(w, h) → {w, h, data[]}` exact RGBA of a fresh render (tests).
- `renderer.toggleDebug(on?)` (F3 overlay `#bc-debug`), `renderer.debugVisible`.
- `renderer.eyeMedium` (`'air' | 'water' | 'lava'`), `renderer.contextLost`, `renderer.counters`, `renderer.renderFar`.
- `getStats()` extras: `columnMeshes, hotSections, translucentMeshes, preset, renderFar, eyeMedium, contextLost, sectionSets, merges, hotUploads, compactions, textureUploads, contextLosses, contextRestores, qualityChanges, quadSorts`.
- `createEntityMaterial` extra options: `side`, `opacity`, `fog` (false for the view model), `depthWrite`; extra uniforms `uColor`, `uOpacity`, `uAlphaTest`, `uFogOn`.
- No new events. Listens to: `world:renderDistance`, `settings:changed` (brightness, waving, fov, pixelRatioCap, renderDistance, dynamicQuality, controls, fancyLeaves), `world:ready`, `world:exit`, `input:action` (`debug`).
- The renderer object no longer has `stub: true`.

### Interface assumptions other lanes must honour

- **CORE-C (world/mesher):** `setSectionMesh` may be called at any time (also from worker results); changes are applied in `renderer.frame`, which runs after `world.frame`, so edits show the same frame. **Do not mutate a `MeshBuffers` after handing it over** (hot and translucent meshes use the arrays directly; context restore re-uploads them). `tex` must be `Uint16Array`, `light` `Uint8Array`, `position` `Float32Array`, exactly `quads·12/16/16` long. `world.setRenderDistance(n)` must clamp and emit `world:renderDistance {distance}`. The renderer calls it in `init` (auto preset) and for dynamic scaling. With the low preset the textures are fast leaves while `settings.fancyLeaves` stays true; the mesher may also cull leaves when `game.renderer.quality.preset === 'low'` (optional).
- **CORE-E (player):** sets `renderer.camera` position/rotation (`YXZ`) and `fov` in `player.frame` (before the renderer). Eye-in-water fog is computed by the renderer from the camera cell, so `player.eyeInWater` is not needed for fog.
- **CORE-E (interaction):** `setHighlight({x, y, z, boxes})` every tick is cheap: geometry is rebuilt only when the cell, the `boxes` array identity, or `settings.controls` changes (pass the shared frozen arrays from `getSelectionBoxes`).
- **FX:** the sky dome is a full-screen pass with `renderOrder −1000`, `depthTest false`. Sun, moon, stars and clouds go in via `addObject` with renderOrder > −1000 and read `renderer.sky` (`sunDir`, `starBrightness` 0..1, `moonPhase`, `sunsetColor`). `game.fx.weather.rain` (0..1) is read every frame. View-model objects use `createEntityMaterial({..., fog: false})`.
- **MOBS:** one draw per mob means one geometry with `aPart` (Uint8, 1 component) + `createEntityMaterial({map, parts: N ≤ 8})`. Then `material.clone()` per entity (shares map + global uniforms), with `uParts.value[i]` matrices, `uLightSky`/`uLightBlock` (0..15) and `uTint` set each frame. A `normal` attribute gives block-like face shading; without one the shade is 1.
- **FX/INV `createBlockModel`:** returns a Mesh with its own cloned material; the caller disposes the geometry and should also `material.dispose()` when finished.
- **KID:** `setFogOverride(near, far)` / `setFogOverride(null)`. Underwater fog still wins.

### LEAD requests

- Please record spec conflicts 1–5 in the SPEC.
- Optional: extend `lead-testapi`/`terrain-render` to use `renderer.capturePixels` (exact PNG-free pixels) instead of the JPEG thumbnail when precision matters.
- Optional (CORE-C/LEAD decision): mesh columns whose nearest edge is within `fogFar` (not just centre distance ≤ R) to remove the diagonal gap entirely; the eased fog already hides it.
