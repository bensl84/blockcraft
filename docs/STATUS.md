# Blockcraft — Status and completion record

This is the compact progress record. **Only the integrator (LEAD) edits this file.** Lanes write their handoffs to `docs/handoff/<lane>.md` in their own worktree (SPEC §0.1); the integrator merges the lane branch, re-runs the commands, and copies the verified results here.

- **Evidence must be reproducible:** a command plus its result, a screenshot path under `.tmp/`, or a report JSON.
- **Never tick a box from a handoff claim alone.** Re-run the command.

**Build under test:** `0.1.0-346d90c8` (root `index.html`, 804 KB minified, three.js + inlined worker) · **Updated:** 2026-10-03 (CORE integration: lanes A–E merged on `main`, SPEC v1.2)

## Before dispatching lanes

- [x] **Foundation committed on `main`** (`0eee714`, line endings normalised in `0ff6b18`).
- [x] Lane worktrees created (`../bc-<lane>` on `lane/<lane>`). CORE lanes A–E are finished and merged (below). FEATURE lanes have branches; MOBS, MENUS and AUDIO had no commits beyond the foundation when CORE was merged.

## Lanes

| Lane | Owner files (SPEC §3.1) | Stubs to delete | Worktree / handoff | State | Evidence |
|---|---|---|---|---|---|
| LEAD foundation | build, tools, `src/main.js`, `src/core/*`, `src/data/*`, `src/ui/screens.js`, `styles.css`, docs | — | `main` | **done** (v1.1) | See the foundation evidence below |
| CORE-A textures | `src/textures/*` | `textures`, `icons` | `bc-corea` · `docs/handoff/corea.md` | **merged** `88bf5aa` (lane `dc1b1fb`) | 238 layers, 276 icons; `corea-*` PASS on GPU, SwiftShader, http, minified |
| CORE-B worldgen | `src/world/worldgen.js`, `noise.js`, `gen_*.js` | `worldgen`, `noise` | `bc-coreb` · `coreb.md` | **merged** `97a5a86` (lane `4092801`) | `coreb-*` PASS; generation about 1.0–1.2 ms per column in Chrome workers |
| CORE-C world / light / mesh | `src/world/*`, `src/worker/*` | `world`, `lighting`, `mesher` | `bc-corec` · `corec.md` | **merged** `5a0e790` (lane `e9c98b5`) + LEAD test fix `d0fe68f` | `corec-*` PASS; 3 blob workers from file:// and http |
| CORE-D renderer / sky | `src/render/*` | `renderer`, `sky` | `bc-cored` · `cored.md` | **merged** `e600531` (lane `484ad1c`) + integration fixes `12b3389`, `e262d21`, `1efeeb3`, `b0f4bd8` | `cored-*`, `terrain-render`, `context-loss` PASS |
| CORE-E player / input / physics | `src/player/*` | `input`, `physics`, `raycast`, `player`, `interaction` | `bc-coree` · `coree.md` | **merged** `b2b7348` (lane `7c2be68`) | `move-jump`, `break-place`, `coree-*` PASS (touch run included) |
| MOBS | `src/entities/*`, `src/survival/*` | `mobs`, `items`, `survival` | `bc-mobs` · `mobs.md` | stub (entity base with streaming park/restore done) | |
| INV | `src/inventory/*`, `src/ui/hud*`, `src/ui/inventory_ui.js` | `invui`, `hud`, `crafting`, `furnace` | `bc-inv` · `inv.md` | stub (inventory model done; picker tabs in data) | |
| AUDIO | `src/audio/*` | `audio`, `music` | `bc-audio` · `audio.md` | stub | |
| MENUS | `src/ui/menus.js`, `pixelfont.js`, `parentgate.js`, `src/save/*` | `menus`, `save`, `font`, `gate` | `bc-menus` · `menus.md` | stub (placeholder title/pause; codec done) | |
| KID | `src/ui/touch*`, `src/kid/*` | `touch`, `kid` | `bc-kid` · `kid.md` | stub (Home works) | |
| MECH | `src/mechanics/*` | `mechanics` | `bc-mech` · `mech.md` | stub | |
| FX | `src/fx/*`, `src/render/celestial*` | `fx` | `bc-fx` · `fx.md` | stub | |

## CORE integration evidence (LEAD, 2026-10-03)

Merged one lane at a time with `git merge --no-ff lane/<lane>` in the order corea, coreb, corec, cored, coree. After each merge `npm run build`, `npm run test:unit` and `npm test` were run, and any mismatch was fixed on `main` before the next merge.

**Integration fixes made on `main`** (each is its own commit):

- `d0fe68f` LEAD light checks: the foundation batch test and `lead-batch` asserted the stub's sky light 0 under a roof. Real lighting gives 14 one step from open sky and 13 under the 3×3 roof centre (SPEC §5.3.4); the checks now assert the spec values.
- `12b3389` `corec-shapes` and `corec-debug-view` built a debug view from three.js classes reached through the stub renderer. With the real renderer they count quads and screenshot the real shader.
- `e262d21` **Light curve.** Torches visibly lit only about 3 blocks, and every cell at light 8 or less sat on one flat floor with a purple fringe. Added the classic brightness lift (`mix(l, 1-(1-l)^4, brightness)`) and the classic warm block-light tint; cave floor `uMinLight = 0.05 + 0.15·brightness`. A torch now warmly lights a 13×13 room (`.tmp/integ-13-cave-torches.png`, `.tmp/integ-23-border-light-room.png`). Daylight scenes are unchanged.
- `1efeeb3` SwiftShader: `corea-determinism` compared against the wrong leaf set (the low preset binds fast leaves without changing the setting; the renderer now exposes `quality.fastLeaves`). The `cored` `settle()` helper now waits for column re-merges and hot-section folds, which looked like `setTime` remeshes on a slow renderer.
- `b0f4bd8` **New worlds start on hotbar slot 1.** `startWorld` kept the previous world's selected slot (`inventory.clear()` does not reset it). After ending a world on the spawn egg, a child could not place blocks in the next one; the full `--touch` run caught it. `cored-outline` now captures at canvas size (a 1 px line was skipped by a 320×180 downscale), and `cored-entity` removes its test mob and log model afterwards.
- `e239e15` SPEC v1.2 records the accepted lane conflicts, streaming radii, the light curve, `input:gesture`, the 100 px wheel notch and decisions D14–D15.
- `f50e9b5`, `474e798` scripted playtest `tools/playtest.mjs` (below).

**Commands and results** (2026-10-03, `main` at `474e798`, RTX 3080 Ti headless Chrome unless noted):

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-346d90c8`, root `index.html` 804 KB (budget 2.5 MB) |
| `npm run test:unit` | **85 / 85 pass** (foundation 13, corea 11, coreb 15, corec 16, cored 12, coree 18) |
| `npm test` | **56 PASS, 3 PENDING** (`mobs`, `survival-fall`, `save-load`: MOBS and MENUS are still stubs), 2 SKIP (touch only), page-errors PASS |
| `npm test -- --http --tag http` | 56 PASS, 3 PENDING, 2 SKIP; the service worker registers; 3 workers over http |
| `npm test -- --swiftshader --tag ss` | 56 PASS, 3 PENDING, 2 SKIP (low preset, R 4, fast leaves) |
| `node tools/smoke.mjs --touch --tag touch` | 57 PASS, 4 PENDING (`touch-controls` waits on KID); `coree-touch` PASS |
| `node tools/smoke.mjs --file index.html --tag prod` | 56 PASS, 3 PENDING, 2 SKIP against the minified root file with its strict CSP |
| `node tools/playtest.mjs --file index.html` | **39 / 39 checks, 0 errors**, 123 s session (`.tmp/integ-report.json`) |
| `node tools/playtest.mjs --file index.html --swiftshader` | **39 / 39 checks, 0 errors**, 122 s session (`.tmp/integ-ss-report.json`) |

`--strict` was not run: it fails by design while the FEATURE lanes are stubs.

**Scripted playtest** (real input: Play click, arrow keys, Space, F and C flight, H home, kid taps and holds on the canvas, drag look, classic pointer lock, Esc pause and resume; seed 12345):

- Play click to playable in **0.32–0.42 s**; the whole visible spawn area (R − 1) meshed in **0.59–0.71 s** on the GPU. SwiftShader: 0.31–0.53 s.
- Walk 3.96 blocks/s on uneven grass with auto-jump (4.18 in 1 s on flat ground in `move-jump`, 4.317 steady in `coree-move-jump`), jump apex 1.25, fly up 25.8 blocks in 3.5 s, swim up.
- Flying 60 blocks forward at R 8: **no unmeshed column within R − 2 at any 200 ms sample** (GPU and SwiftShader).
- Dug a 34-block shaft into a cave with one kid hold; 3 torches placed with kid taps (every hovered tap placed one), each cell at block light 14.
- 5×5 planks house with 3 glass windows, a lintel, a full roof, a door and an inside torch: **73 / 73 blocks placed by kid taps**, each hover-verified first.
- Torch at a column corner: the light profile 9…14…9 is identical along x, z and both diagonals (no seam); screenshot reviewed.
- Day, sunset, night, sunrise: night luma 21 against day 121; changing the time never remeshes; the daylight-cycle rule advances time.
- Water animates (5181 changed pixels in 400 ms); underwater fog works. The classic scheme locks the pointer, the mouse turns, left breaks, right places, Esc releases and opens pause, and Resume returns.
- No page, console, network or game errors.

**Performance** (SPEC §12):

| Metric | RTX 3080 Ti (preset high, R 8) | SwiftShader proxy (preset low) |
|---|---|---|
| Frame rate over the 2-minute playtest | median **144.9 fps** (display-capped), p90 7.0 ms, p99 7.2 ms, max 27.7 ms, no frame over 33 ms | median **36–72 fps** across runs (p90 21–35 ms); dynamic quality lowered DPR to 0.75 and R to 3 during the longest run |
| Main-thread work per frame | `workMs` 0.5–1.3 (budget p90 6) | 0.6–1.3 |
| Draw calls | 226–300 at R 8; **156 at R 6** (`cored-perf`, budget 300) | 62–124 at R 3–4; 156 at R 6 |
| Chunk work | generation 1.0–1.2 ms per column and meshing 0.3 ms per section in 3 workers; lighting 0.12–0.17 ms per column on the main thread; streaming 0.1 ms per frame | lighting 0.45 ms, meshing 0.69 ms per section |
| Boot to title | 0.20–0.29 s | 0.33–0.50 s |
| Textures / icons build | 22–25 ms / 65–74 ms (budget 60 / 150) | — |

**Screenshots reviewed** (`.tmp/integ-NN-*.png`; SwiftShader copies `.tmp/integ-ss-NN-*.png`): title, spawn, walk, drag-look, fly views N/W/S/E, fly look-down, after flight, shaft, dark cave, torch-lit cave, home, house layer 1, house inside and outside ×2, sunset, night, sunrise, day, column-corner torch room ×2, underwater, swim surface, classic, pause, free play. Terrain, biomes (plains, forest, taiga, snowy, desert edge, river), trees, water, sand banks, caves, AO and face shading read as the classic game. No texture bleeding, black faces, z-fighting, holes or column seams were found.

**Remaining defects and gaps**

- FEATURE lanes are not merged: no HUD or hotbar on screen, no crosshair in the classic scheme, hotbar keys 1–9 do nothing (the HUD owns them), placeholder title and pause screens, no sounds, no mobs, no save or load, no sun, moon or clouds, no upper door half (MECH placer), no touch overlay. The playtest picks hotbar slots through the test API for that reason.
- Smooth lighting shows the usual diagonal crease across a face when its corners differ (the triangle split; the original has it too). Fixing it needs per-corner light in the vertex format, a mesher and renderer contract change.
- Fog is hazier than the original at a given render distance: it eases in from 60 % of the radius so the diagonal gaps of the circular mesh radius stay hidden. A crisper view needs meshing slightly beyond R, which costs draw calls.
- On a very slow frame (a main-thread stall over about 300 ms) a quick kid tap can be read as a 350 ms hold and break a block. Seen once in 80 SwiftShader taps, never on the GPU.
- Main-thread fallback streaming (workers unavailable) measured 4.2–5.6 ms per frame against the 4 ms budget (`corec-fallback`). Workers are used on file://, http and the minified build.
- Not yet measured on the real laptop (Intel Iris Xe class); SwiftShader is only a relative proxy. The 100 px wheel notch rule needs a check on the real touchpad.
- Decisions for the parent: D1 TNT on, **D14 lava pools in deep caves** (on), D15 kid flight hop (on).

## Foundation evidence (LEAD, 2026-10-03, v1.1)

- [x] `npm run build`: root `index.html` 567 KB minified, single file, plus `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
- [x] `npm run test:unit`: **13/13 pass** (adds the review checks: P0 item sources, slab/stair roofs, 8 picker tabs with every item reachable, bedrock hidden, cake stack, biome lists, `voidRescue`, `VEL_EPS`, no Shift in the kid keys, fence/pane/gate boxes and connections, texture layers ≤ 256, and the `CONTRACT world` persistence + batch test).
  - The `CONTRACT world` test fails against the v1 world code ("a saved, modified column stays in savedColumns after unload") and passes with v1.1: the reported data loss is reproduced and fixed.
- [x] `npm test`: **14 PASS, 7 PENDING (stub lanes), 1 SKIP (touch), page-errors PASS.** New LEAD contract scenarios all pass: `lead-unload-persist`, `lead-break-contract`, `lead-batch`, `lead-entity-streaming`, `lead-testapi`.
- [x] `node tools/smoke.mjs --http --tag http`: 14 PASS, 7 PENDING, 1 SKIP; service worker registers.
- [x] `node tools/smoke.mjs --swiftshader --touch --tag ss`: 14 PASS, 8 PENDING, 0 errors.
- [x] `node tools/smoke.mjs --file index.html --tag prod --scenario boot,world,lead-unload-persist,lead-testapi`: 5 PASS against the minified production file with its strict CSP (string `waitFor` predicates are polled from the harness).
- [x] `node tools/lane-worktree.mjs corec --dry-run` refuses while the foundation is uncommitted; happy path verified on a throwaway committed copy under `.tmp/` (removed afterwards; the shared `node_modules` was untouched).

## Whole-game acceptance (SPEC §13.1). Unchecked until verified in integration with `--strict`.

CORE scope (2026-10-03, see the CORE integration evidence): the CORE parts of items 1 (file:// and http, zero errors, no network), 3 (walk, jump, break and place in both schemes), 4 (terrain, caves, ores, trees, torches with no column seams, day/night without remeshing) and 9 (performance, SwiftShader interactive) hold. The boxes stay unchecked until the FEATURE lanes are in and `--strict` passes.

- [ ] 1. Builds; runs from `file://` and over http with the service worker; zero console errors; no third-party network.
- [ ] 2. Kid default path with no reading: Play → creative world in under 4 s → arrows walk and turn, tap places, hold breaks, F flies, H goes home, E opens the picker and red wool goes into the hotbar.
- [ ] 3. Block-loop fidelity: walk about 4.3 b/s, jump apex about 1.25, survival break times, tool wear, drops with magnet and pop.
- [ ] 4. World: biomes, sea, caves, ores, trees; smooth torch light with no seams at column borders; the day/night cycle never forces a remesh.
- [ ] 5. Animals: natural spawns that never pile up; breeding with hearts and babies; shear and dye sheep; tame a wolf (sit, follow); animals can't die in kid mode; pens hold animals (P1).
- [ ] 6. Survival: 2×2 and 3×3 crafting with the recipe book, furnace, chest; health and hunger; fall damage; death → respawn with keep-inventory.
- [ ] 7. Mechanics: TNT chain, falling sand, doors, bed sets spawn (nap in kid worlds), water flow, farming with bone meal.
- [ ] 8. Persistence: autosave and reload restore blocks (including columns that were unloaded), inventory, chest contents, animals, time and position.
- [ ] 9. Performance within SPEC §12; SwiftShader at R 4 stays at 10 fps or more; no streaming holes while flying.
- [ ] 10. Kid accessibility: target sizes, no stuck keys, no Shift binding, no trackpad hotbar spin, no page zoom, exit guards.

## Smoke scenarios

| Scenario | Requires | Last result (2026-10-03, `474e798`) | Evidence |
|---|---|---|---|
| boot | — | PASS (file://, http with service worker, SwiftShader, minified) | `.tmp/smoke-title.png` |
| world | — | PASS (`worldReadyMs` about 300) | `.tmp/smoke-world.png` |
| terrain-render | textures, worldgen, world, lighting, mesher, renderer | **PASS** (198 draws, 354 k triangles at R 8; night darker) | `.tmp/smoke-terrain.png`, `.tmp/smoke-terrain-night.png` |
| move-jump | input, player, physics, world, worldgen | **PASS** (4.18 blocks in 1 s, apex 1.252) | |
| break-place | input, player, physics, raycast, interaction, world | **PASS** | `.tmp/smoke-break-place.png` |
| hotbar | — | PASS | |
| inventory-ui | — | PASS (placeholder screens) | `.tmp/smoke-inventory.png` |
| time | — | PASS | `.tmp/smoke-night.png` |
| kid-home | — | PASS | |
| mobs | mobs, physics, world | PENDING (MOBS stub) | |
| survival-fall | survival, player, physics | PENDING (MOBS stub) | |
| save-load | save, world | PENDING (MENUS stub) | |
| touch-controls | touch, input (`--touch`) | PENDING (KID stub) | |
| context-loss | renderer | **PASS** | |
| perf | — | PASS (254 draws at R 8, 144 fps; SwiftShader 85 draws at R 4, 45 fps) | `.tmp/smoke-report.json` |
| lead-events-roundtrip | — | PASS | |
| lead-unload-persist | — | PASS (real world) | |
| lead-break-contract | — | PASS (real interaction) | |
| lead-batch | — | PASS (sky 13 under the 3×3 roof) | |
| lead-entity-streaming | — | PASS | |
| lead-testapi | — | PASS | |
| corea-* (3), coreb-* (4), corec-* (8), cored-* (11), coree-* (13, one of them touch-only) | lane | all PASS (GPU, http, SwiftShader, touch, minified) | `.tmp/smoke-*.png` |

## Open decisions (SPEC §14)

- **D1 TNT on by default:** the parent decides. It is currently on, kid-safe and undoable.
- **D14 lava pools in deep caves (y 6 and below):** on, from CORE-B. The parent decides; `LAVA_LEVEL = 0` in `src/world/worldgen.js` removes them.
- **D15 kid flight take-off hop:** on, from CORE-E (`KID_FLY_LIFT`).
- **D4 baked biome colours:** P2 revisit.
- **D5 texture layer budget:** 238 of 256, now enforced by the unit test.
- **D11 no Shift in the kid scheme:** fly down is C / Z / ▼; parent tip covers the Sticky Keys shortcut.
- **D12 survival item sources:** gravel 5% bone and leaves 2% string are original twists; TNT stays creative-only until creepers (P1).
- **D13 recipe book:** P0 for survival worlds.

## Handoff log

<!-- newest first: date · lane · what changed · commands run + results · remaining · blockers -->
- 2026-10-03 · LEAD · CORE integration: merged lane/corea, coreb, corec, cored, coree into `main` one at a time (build, unit and smoke after each); fixed the LEAD light checks, the CORE-C debug view, the light curve, SwiftShader determinism and settle, the new-world hotbar slot, the outline capture and the entity test cleanup; SPEC v1.2; added `tools/playtest.mjs` · unit 85/85; smoke 56 PASS / 3 PENDING / 2 SKIP on file://, http, SwiftShader and the minified file; touch 57 PASS / 4 PENDING; playtest 39/39 on GPU and SwiftShader · next: merge the FEATURE lanes (INV, KID, MECH, FX first: HUD, touch, doors, sky objects), then `--strict` · blockers: none for CORE; the MOBS, MENUS and AUDIO branches had no commits yet when CORE was merged
- 2026-10-03 · LEAD · v1.1: applied the independent review (lane worktrees + handoff files, persistence invariant, block entity in `block:broken`, single drop owner, undo from `block:changed` with action ids, `voidRescue`, entity streaming, batch edits, test API additions, 8 picker tabs, survival item sources, mob movement rules, one draw per mob, workers P0 + kid flight cap, no Shift, kid outline, fences/gates/panes, boats owner, bedrock rule, minor data and spec fixes) · build 567 KB, unit 13/13, smoke 14 PASS / 7 PENDING / 1 SKIP, http, swiftshader+touch and production-file runs clean · next: integrator commits the foundation, then dispatches CORE lanes A–E in worktrees · blockers: foundation commit (not done in this pass by instruction)
- 2026-10-03 · LEAD · foundation, SPEC v1, stubs, harness · build, unit (10/10) and smoke (green with pending) · next: dispatch the CORE lanes A–E in parallel · blockers: none
