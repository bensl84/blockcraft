# Handoff - corec

Branch `lane/corec` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-corec`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · CORE-C world, lighting, mesher, workers (P0 + P1 shapes/liquids)

### What changed

Stubs deleted: `world`, `lighting`, `mesher` (`registerStub` lines removed). Files (all CORE-C owned):

- `src/world/column.js` - frozen layout kept; added optional constructor args `(cx, cz, blocks?, biomes?)` (adopts a worker's transferred arrays), internal fields `urgentMask`, `meshedMask`, `pendingMask`, `secVersion`, `pendingVer`, `meshStarted`, `heightReady`, methods `markUrgent(sy)`, `computeNonEmpty()`. `markDirty(sy)` now also bumps the section version.
- `src/world/lighting.js` - real two-channel BFS in world coordinates (growable `Int32Array` queues of packed positions, 16-slot column cache). Removal queue `(pos, oldLevel)` then re-propagation; sky-15 travels down through filter-0 cells without loss; block light loses `1 + filter`. `lightColumn` = fill above heightmap + emitters, sky seeds only where a horizontal neighbour is darker (+ the top lit cell per x/z), border reconciliation with LIT neighbours (pruned to cells that can brighten the other side). `relightBatch` = ONE removal + ONE propagation pass per channel for a whole batch (light-neutral swaps skipped). Every changed cell marks the sections that can see it (own section, ±1 section on section borders, neighbour columns incl. diagonals). Edits mark **urgent**, initial lighting marks **background**. New export `updateHeightAt(col, lx, y, lz)` (setBlock step 4).
- `src/world/mesher.js` - cubes with face culling, per-vertex AO (0fps), smooth light (opaque cells and the AO-blocked corner excluded), quad flip per spec (`a00 + a11 > a01 + a10` on AO x light → start corner rotated by one). Log/hay UV rotation by axis. All shapes: slab, stairs, door, bed (top rotated by facing), layer, carpet, farmland, chest, cake, pane (via `getSelectionBoxes`, uv-lock), fence (post + 2 rails per connection), gate (closed / swung open), cactus (sides inset 1/16), ladder (single quad 1/16 off the wall), cross (2 diagonal quads 0.9 wide, ±0.15 x/z hash jitter from the world position), crop (`#` planes at 4/16, 12/16, sunk 1/16), torch (2x10x2 px, wall torches tilted 22.5° away from the wall), fire (4 inward-leaning planes), liquids (14/16 × (8-level)/8, **P1 corner averaging**, full height under same liquid, faces only toward non-opaque non-same-liquid cells). Slabs/stairs (filter 15, not opaque) use the max light of their neighbours so faces next to them are not black. `buildPadded` reads the 3x3 columns once. Scratch buffers grow and `slice()` exact copies. `meshBlockModel` merges passes, centred x/z.
- `src/world/world.js` - full streaming pipeline (EMPTY → GENERATED → LIT → MESHED with 3x3 gating), look-biased order (`d² − 2·dot(look, offset)`, rebuilt on border crossing / >34° turn / R change), 4 ms budget (2 ms when `perf.frameMs > 20`), 14 ms while loading. **Edits: urgent sections are remeshed synchronously at the start of the next `world.frame()`** (outside the budget). Worker meshing for initial/background work; stale results (older section version, unloaded column, other world) dropped. Meshes dropped beyond R+1 (column back to LIT) to bound draw calls/geometries; unload beyond R+4 with the persistence invariant (lead-unload-persist fix kept unchanged). Numeric-key column map + 1-entry cache for `getRaw/getLight`. `pregenerate` parallel through workers with a 4 s stall watchdog (falls back to the main thread). Added members: `disableWorkers(reason)`, `enableWorkers()`, extra `stats()` fields (`columnsLit, sectionMeshes, lightAvgMs, workers, workerReason, inFlight, genInFlight, workerMeshes, workerGens, syncMeshes, urgentMeshes, droppedResults, streamMs`).
- `src/world/workers.js` (new) - pool of up to 3 classic Blob-URL workers from `WORKER_SRC` (try/catch; Node / no `WORKER_SRC` / error / `ok:false` on init → main-thread fallback). Per-worker in-flight limits (gen 2, mesh 8).
- `src/worker/worker.js` - protocol `init` (texture layer table → `bindTextures`), `generate` (CORE-B `generateColumn`), `mesh` (`meshSection`), transferables both ways.
- `test/corec.test.mjs`, `tools/scenarios/corec.mjs` (new).

### Commands and results

`npm run test:unit` (worktree): **28 pass, 1 fail** - the 1 fail is the LEAD foundation test asserting stub lighting (see LEAD requests #1).

```
✔ lighting: torch next to a column border lights both sides symmetrically; removal returns all to 0
✔ lighting: sky under a 1-block roof is 14 at the edge and decays inward; open sky stays 15
✔ lighting: water and leaves filter sky light; opaque emitters light their neighbours
✔ lighting: incremental relight matches a from-scratch light of the same blocks (random edits)
✔ lighting bench: initial column light and a 600-cell batch relight
✔ mesher: AO darkens corners next to walls; flat light with smoothLighting off
✔ mesher: quad flip rotates the start corner when a00 + a11 > a01 + a10
✔ mesher: culling rules (glass, leaves fancy/fast, water) and passes
✔ mesher: shapes (slab, stairs, cross, crop, torch, ladder, fence, door, pane, bed, cactus, fire)
✔ mesher: every block and state meshes inside its cell with valid attributes
✔ mesher bench: typical surface sections
✔ world: edits remesh in the very next frame, outside the budget
✔ world: no section-mesh leak after streaming 20 columns away and back; drops meshes beyond R+1
✔ world: streaming order, gating and events
✔ world: ensureColumn and pregenerate (sync fallback) produce lit/meshed columns
✔ world: batches relight once with correct light; setBlock rules
✖ CONTRACT world: ... batches relight once   (foundation line 305: expects stub sky 0, real light is 14 - LEAD request #1)
ℹ tests 29  ℹ pass 28  ℹ fail 1
```

Benches (Node, dev machine, stub worldgen): lightColumn 0.29-0.53 ms/column; 600-cell batch relight 0.9-2.3 ms (fill) / 1.2-2.5 ms (remove); torch place/remove 0.14 ms/edit; meshSection 0.13-0.22 ms + buildPadded 0.05-0.13 ms per surface section (175 quads). Synthetic cave/tree terrain (`.tmp` bench, not committed): lightColumn 0.39 ms, mesh 0.28 ms/section at ~960 quads. In Chrome: `lightAvgMs` 0.10-0.18.

`node build.mjs --dev --out .tmp/build-corec` builds (1208 KB dev, 635 KB minified incl. worker).

`node tools/smoke.mjs --tag corec` (file://, RTX):

```
PASS     boot / world (worldReadyMs 124) / hotbar / inventory-ui / time / kid-home / perf
PASS     corec-workers        workers 3 (blob worker from file://), generation + meshing in workers, 0 sync meshes
PASS     corec-light-border   14/14 13/13 12/12 ... symmetric; removal -> all 0; re-add identical; 3x3 roof edge 14 centre 13
PASS     corec-edit-same-frame  gold/torch/glass: meshFrame === editFrame + 1
PASS     corec-stream-leak    home 226 sections / away 226 / back 226; world == renderer counts; columns 253 (bounded)
PASS     corec-flight-stream  10.9 m/s for 8 s at R 6: worst backlog run 0 ms (needs re-check with real CORE-B/D)
PASS     corec-shapes / corec-debug-view   (screenshots .tmp/smoke-corec-corec-*.png reviewed)
PASS     corec-fallback       workers disabled: 424 sync meshes, streamMs 3.6 (inside the 4 ms budget)
PASS     lead-events-roundtrip / lead-unload-persist / lead-break-contract / lead-entity-streaming / lead-testapi
FAIL     lead-batch           sky 13 under a 3x3 roof is the correct value; the LEAD scenario expects stub 0 (LEAD request #1)
PENDING  terrain-render, move-jump, break-place, mobs, survival-fall, save-load, context-loss (other lanes still stubs)
PASS     page-errors
[smoke] {"PASS":21,"PENDING":7,"SKIP":1,"FAIL":1}
```

Also passing: `--http` (boot, corec-workers, corec-edit-same-frame: workers 3 over http), the minified build (`--file .tmp/build-corec-min/index.html`: world, corec-workers, corec-light-border, corec-edit-same-frame, lead-unload-persist), and `--swiftshader` (world, perf, corec-workers, corec-edit-same-frame, corec-stream-leak, corec-flight-stream, lead-unload-persist).

Screenshots: `corec-debug-view` / `corec-shapes` draw my section meshes through a scenario-only debug view (vertex colours = average texel colour × shade × AO × light, built from three.js classes reached via the stub renderer) because CORE-D is still a stub. Reviewed: AO at step edges, soft sky shadow under a floating hut, warm torch gradient inside a closed hut at night, liquids/slabs/stairs/fences/doors/torches/plants geometry, no seams at column borders.

### Remaining (by priority)

- **P0 (integration):** re-run `terrain-render`, `break-place`, `save-load`, `perf` draw calls and `corec-flight-stream` once CORE-B (real worldgen: caves/trees, heavier generation), CORE-D (real section geometry) and CORE-E/MENUS land. The flight result above uses the stub worldgen and stub renderer.
- P1: door texture mirroring for right hinges; stairs inner/outer corner shapes (straight stairs only). (Water side/bottom vertices at the cell floor carry no WAVE bits, so only the surface bobs.)
- P2: recycle padded input buffers returned by workers (currently 17.5 KB allocated per worker mesh job); `renderDistance` change back to 0 (auto) does not re-apply CORE-D's preset (no API for the preset distance).

### Interface assumptions other lanes must honour

- **CORE-B:** `generateColumn` stays pure and worker-safe (bundled into `src/worker/worker.js`; no DOM, no `Math.random`, no three). CORE-C computes heightmaps; worldgen only fills `out.blocks` / `out.biomes`.
- **CORE-D:** `setSectionMesh(cx, sy, cz, mesh|null)` replaces + disposes, `null` removes; I only send `null` for sections that had a mesh. Meshes are also removed with `removeColumnMeshes` when a column leaves R+1 (not only on unload). Vertices may sit slightly outside 0..16 (crops at −1/16, fire 1.1 high, wall torches) - the fixed bounding sphere (8,8,8, r 13.86) still covers them. Cutout pass must be `DoubleSide` (crosses, crops, fire, ladders are single quads). When rebuilding textures (fancyLeaves / low preset), assign `game.textures` **before** calling `world.remeshAll()` - that re-sends the layer table to the workers. I read `renderer.quality.preset === 'low'` to mesh with fast-leaf culling.
- **CORE-A:** cross plants and crops use the face-UP texture of the block; the torch model samples the stick at texture columns 7-8, rows 6-15 (flame top rows 6-7, bottom rows 14-15).
- **CORE-E / KID / MECH:** edits made during `tick()` (or between frames) are on screen in the next rendered frame. Edits made inside a system `frame()` that runs after `world` in registration order (player, interaction, kid, touch, fx...) appear one frame later (≤ 16 ms) - do player edits in `tick()` or call them before `world.frame`. Bulk edits: `beginBatch/endBatch` (or `setBlocks`). `unmeshedWithin(r)` counts columns within r of `world.center` (updated each `world.frame`).
- **MOBS:** `world:columnLoaded` now fires out to about R + 1.5 (light radius); `getLight` returns 0xF0 for generated-but-unlit columns.
- **MENUS:** persistence contract unchanged (`getDirtyColumns`, `exportColumn`, `markColumnSaved`, `pendingSave`, `savedColumns` with encoded `data`).

### LEAD requests

1. **Two LEAD assertions encode the stub's heightmap-only sky light and contradict SPEC §5.3.4 / §2.4** ("sky light under a 1-block roof equals 14 at the edge"). With real lighting they fail although the light is correct:
   - `test/foundation.test.mjs` line 305: `assert.equal(w.getSkyLight(5, 6, 5), 0, 'relit at endBatch')` - the L-shaped 3-block roof at y 10 leaves (5,6,5) one step from open sky, so the correct value is **14**. Suggested: `assert.equal(w.getSkyLight(5, 6, 5), 14, 'relit at endBatch (1 step from open sky under the roof)')`.
   - `tools/scenarios/lead.mjs` `lead-batch`: `t.assert(r.sky === 0, ...)` under a 3x3 roof at y 12 - the centre cell is 2 steps from open sky, correct value **13**. Suggested: `t.assert(r.sky === 13, 'light is correct after endBatch (3x3 roof: centre 15 - 2)')`.
   I did not weaken lighting to satisfy them.
2. SPEC §5.3.3 text: data radius is effectively `R + DATA_MARGIN + 1` (R + 3) so the diagonal neighbours of every lit column (light radius R + 1.5) are generated; meshes are dropped beyond R + 1 (column back to LIT) to bound draw calls/geometries. Either document this or set `RENDER.DATA_MARGIN = 3` (then I would drop the `+ 1`).
3. Document the added members/events-free API: `world.disableWorkers(reason)`, `world.enableWorkers()`, extra `world.stats()` fields, `meshSection` option `origin: [wx, wy, wz]` (plant jitter), `Column` additions, new file `src/world/workers.js`. Optionally surface `world.stats().workers` / `workerReason` in `__game.stats()`.

### Blockers

None for CORE-C itself. Visual verification with real textures/shaders waits for CORE-A/CORE-D; realistic generation cost waits for CORE-B.

### Spec conflicts

- LEAD tests vs §5.3.4 roof light (LEAD request #1).
- §5.3.3 radii (LEAD request #2).
- §5.3.5 sky light entering filtered cells: implemented literally from §2.4 - every step into a filter-F cell costs `1 + F` (sky 15 → first water cell 13, then −2 per cell); only sky 15 moving down into filter-0 cells is lossless.
