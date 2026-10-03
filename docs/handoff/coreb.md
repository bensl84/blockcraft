# Handoff - coreb

Branch `lane/coreb` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-coreb`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · CORE-B worldgen complete (P0 + P1 + P2 islands)

### What changed

- `src/world/noise.js` — real seeded 2D/3D simplex (Gustavson) with a Fisher-Yates permutation from `mulberry32(seed)`; `fbm2` adds per-octave offsets so the origin is not a fixed point. `registerStub('noise')` deleted.
- `src/world/gen_terrain.js` (new) — pure per-point terrain: continentalness / erosion / peaks-valleys splines, ridged mountains, rivers with sandy banks, climate, biome choice. Low-frequency fields live on a 4-block lattice (bilinear, cached), so point queries and column generation read identical values.
- `src/world/gen_trees.js` (new) — tree shapes shared by worldgen and `placeTree`: oak (4-6), birch (5-7), spruce cone (6-9), plus a worldgen-only branching `fancy_oak`. Max horizontal radius 3.
- `src/world/worldgen.js` — the real generator. `registerStub('worldgen')` deleted. Pipeline: samples on a padded 20×20 grid → bedrock (y0 + random y1-3) / stone / filler / surface per biome, depth and slope → stone variants, dirt/gravel pockets and the 7 ores (pull model, spec table depths) → spaghetti caves + rare caverns (4×4×4 lattice, trilinear, provably-empty lattice cells skipped) with lava at y ≤ 6 and rare surface openings, never within 2 blocks of water or 3 of a sea floor → sea water below y 48, ice on snowy water → trees (pull model, radius 3) → boulders (pull model, radius 2) → flowers in patches, short grass, ferns, mushrooms, dead bushes, cactus (never touching sideways), sugar cane by water, pumpkin and melon patches → snow layers on every exposed top in snowy places and above y 102 (grass gets the snowy state bit).
- Presets: `default` (Hills & trees), `flat` (exact layout; P1 trees ≈ 1 per 5 columns and flowers, nothing within 24 blocks of the origin), `snowy` (P1, every cell snowy biome, frozen sea), `islands` (P2, archipelago with a guaranteed home island at the origin).
- `findSpawn`: square spiral from (0,0) to radius 256, hard checks (grass, dry within 3, flat within 2, no tree within 6, not mountains/desert/snow/river/cave opening), then a view score (trees around but not in front of the face — the player starts looking north — water / hills / several biomes in view), verified against the real generated column (grass under the feet, air above all the way up). 180 seeds × 3 presets checked: all valid, 8-25 ms each.
- `test/coreb.test.mjs` (15 tests), `tools/scenarios/coreb.mjs` (4 scenarios: `coreb-default-world`, `coreb-presets`, `coreb-streaming-gen`, `coreb-terrain-view`). The first two draw an in-page top-down map of the live world and screenshot it (`.tmp/smoke-coreb-coreb-map-*.png`).

### Commands and results (in the worktree)

`node build.mjs --dev --out .tmp/build-coreb` → `[build] 0.1.0-eaeba70b-dev -> ...\.tmp\build-coreb\index.html (1125 KB, 164 ms, dev)`

`npm run test:unit`

```
# coreb gen 0.433 ms/column
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

`node tools/smoke.mjs --tag coreb`

```
PASS     boot                 62 ms
PASS     world               292 ms {"worldReadyMs":156}
PENDING  terrain-render        0 ms  - stub lanes: textures, world, lighting, mesher, renderer
PENDING  move-jump             0 ms  - stub lanes: input, player, physics, world
PENDING  break-place           0 ms  - stub lanes: input, player, physics, raycast, interaction, world
PASS     hotbar               54 ms
PASS     inventory-ui        117 ms
PASS     time               1073 ms
PASS     kid-home            289 ms
PENDING  mobs                  0 ms  - stub lanes: mobs, physics, world
PENDING  survival-fall         0 ms  - stub lanes: survival, player, physics
PENDING  save-load             0 ms  - stub lanes: save, world
SKIP     touch-controls        0 ms  - needs --touch
PENDING  context-loss          0 ms  - stub lanes: renderer
PASS     perf               3222 ms
PASS     coreb-default-world    315 ms {"worldReadyMs":72,"defaultSpawn":{"x":-18.5,"y":52,"z":35.5,"below":"grass_block","feet":"air","head":"air"},"genAvgMs":0.432,"chunksLoaded":70,"underground":{"bedrock":2401,"cells":2401,"ore":750,"cave":9514},"biomesAroundSpawn":5}
PASS     coreb-presets       598 ms {"snowySpawn":{"x":15.5,"y":66,"z":-19.5,"below":"grass_block","feet":"snow","head":"air"},"islandsSpawn":{"x":1.5,"y":54,"z":-44.5,"below":"grass_block","feet":"air","head":"air"},"islandsWaterCells":3544}
PASS     coreb-streaming-gen    124 ms {"ensureColumnMs":0.555,"worldGenAvgMs":0.458}
PENDING  coreb-terrain-view      0 ms  - stub lanes: textures, world, lighting, mesher, renderer
PASS     lead-events-roundtrip     50 ms
PASS     lead-unload-persist    335 ms
PASS     lead-break-contract     55 ms
PASS     lead-batch           42 ms
PASS     lead-entity-streaming    118 ms
PASS     lead-testapi        534 ms
PASS     page-errors           0 ms
[smoke] {"PASS":17,"PENDING":8,"SKIP":1} in 7.8 s
```

§13.2 CORE-B checks: foundation worldgen contract PASS · determinism over 100 columns (all 4 presets, order/cache independent) PASS · spawn on dry grass (8 seeds in the unit test, 180 in a scratch sweep) PASS · biome variety: seed 12345 has ≥ 4 biomes within 512 blocks, every biome appears across seeds PASS · gen bench 0.41-0.45 ms/column steady state on the dev machine (budget 1 ms) PASS.

Visual review: done with a scratch voxel raycaster and top-down maps in Node (not committed, `.tmp/` only) because the renderer lane is still a stub; plus the in-browser map screenshots above. Real-renderer screenshots come from `coreb-terrain-view` once A/C/D land.

### Remaining

- P0: none known.
- Review `coreb-terrain-view` screenshots (`.tmp/smoke-coreb-coreb-view-*.png`) after CORE-A/C/D merge; tune flower density and colours against the real textures if they look busy.
- Weak-laptop timing not measured: generation is CPU-only, ~0.4 ms here; expect ~1-1.5 ms on the mid laptop (budget 3 ms). The first ~200 columns after page load run at ~1 ms (JIT warm-up).
- P2 not done: villages (non-goal), waterfalls, river biome id.

### Interface assumptions other lanes must honour

- **CORE-C:** `generateColumn(seed, cx, cz, preset, col)` writes `col.blocks` (Uint16 `id | state<<8`) and `col.biomes`; it zero-fills `blocks` itself, so pooled worker buffers are safe. It uses module-level scratch arrays (not re-entrant; fine in one thread or one worker). Imports are DOM-free: `core/constants`, `core/registry`, `core/math`, `./noise`, `./gen_terrain`, `./gen_trees`. Cave air below y 48 is dry by design (caves never touch water).
- **MECH (saplings, bone meal):** `placeTree(set, get, x, y, z, kind, rand)` — `get` returns a block **id**; `set(x, y, z, id, state)`. Needs grass, dirt or farmland at y-1 (turned into dirt). Trunk cells above the sapling must be air, plants, snow or leaves, otherwise it returns false and writes nothing. Leaves only replace air, short grass, fern or snow. Wrap the call in `world.beginBatch()/endBatch()` and pass a `game.rand`-based `rand`. `kind` may also be `'fancy_oak'`.
- **States written:** worldgen leaves have state 0 (decaying); branch logs of fancy oaks carry the log axis (1 X, 2 Z); grass under a snow layer has the snowy bit (1); water/lava are sources (0); snow layers are state 0.
- **MOBS:** use `column.biomes[lx + lz*16]`; every biome name in `data/mobs.js` exists. Rivers and lakes get the `beach`/`ocean`/`snowy`/`desert` ids (no river id).
- `getTerrainHeight`/`getBiomeAt` are pure point queries (~0.5-3 µs); `getTerrainHeight` is the pre-decoration top (at rare cave openings the real top is lower).
- `findSpawn` returns feet at `surface + 1` on block centre; in the snowy preset that is the snow-layer cell (main.js snaps to `getSurfaceY` afterwards, which is correct).

### Spec conflicts / additions (for the integrator — nothing quietly changed in LEAD files)

1. **Lava pools in deep caves** (carved cells at y ≤ 6) are not in §5.2. Minecraft-like, very deep, emit light. If the parent wants none, set `LAVA_LEVEL = 0` in `worldgen.js`. Decision for the parent / LEAD.
2. **Extra decoration not listed in §5.2:** mossy-cobblestone boulders (taiga, some forests and mountains), branching "fancy" oaks (plains and forests), mushrooms on cave floors and rarely in forests.
3. **BIOMES table values tuned** (fields only; ids and names unchanged): plains trees `['oak','birch']` at 0.25 per column; snowy `grassDensity` 0 (snow covers every exposed top, as §5.2 requires).
4. **Flat preset decoration** stays out of a 24-block radius around the origin so flat-world tests and the spawn stay clear.
5. §5.2 "water fills air below y 48" is implemented as "sea water above the terrain top"; cave air below 48 stays dry (consistent with "never carve within 2 blocks of water").

### New events / API members

- None. Optional extra exports: `gen_trees.js` (`buildTree`, `TREE_MAX_RADIUS`) and `gen_terrain.js` (`getTerrain`, `B`).

### LEAD requests

- None blocking. Optional: document the additions above in SPEC §5.2.
