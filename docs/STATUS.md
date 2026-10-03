# Blockcraft — Status and completion record

This is the compact progress record. **Only the integrator (LEAD) edits this file.** Lanes write their handoffs to `docs/handoff/<lane>.md` in their own worktree (SPEC §0.1); the integrator merges the lane branch, re-runs the commands, and copies the verified results here.

- **Evidence must be reproducible:** a command plus its result, a screenshot path under `.tmp/`, or a report JSON.
- **Never tick a box from a handoff claim alone.** Re-run the command.

**Build under test:** `0.1.0-cb122748` (root `index.html`, 567 KB) · **Updated:** 2026-10-03 (foundation v1.1, review applied)

## Before dispatching lanes

- [ ] **Commit the foundation on `main`** (integrator). Everything except the initial setup commit is still untracked; `tools/lane-worktree.mjs` refuses to run until `src/main.js`, `docs/SPEC.md` and `build.mjs` are committed. Not done in this pass: the instruction for this pass was "do not commit".
- [ ] Then, per lane: `node tools/lane-worktree.mjs <lane>` → branch `lane/<lane>` in `../bc-<lane>` with a `node_modules` junction (verified on a throwaway copy: branch created, junction ignored by git, dev build and 13/13 unit tests pass inside the worktree).

## Lanes

| Lane | Owner files (SPEC §3.1) | Stubs to delete | Worktree / handoff | State | Evidence |
|---|---|---|---|---|---|
| LEAD foundation | build, tools, `src/main.js`, `src/core/*`, `src/data/*`, `src/ui/screens.js`, `styles.css`, docs | — | `main` | **done** (v1.1) | See the foundation evidence below |
| CORE-A textures | `src/textures/*` | `textures`, `icons` | `bc-corea` · `docs/handoff/corea.md` | stub | |
| CORE-B worldgen | `src/world/worldgen.js`, `noise.js` | `worldgen`, `noise` | `bc-coreb` · `coreb.md` | stub | |
| CORE-C world / light / mesh | `src/world/column.js`, `world.js`, `lighting.js`, `mesher.js`, `src/worker/*` | `world`, `lighting`, `mesher` | `bc-corec` · `corec.md` | stub (functional skeleton: persistence invariant, batches, `remeshAll`, `unmeshedWithin` done) | |
| CORE-D renderer / sky | `src/render/*` | `renderer`, `sky` | `bc-cored` · `cored.md` | stub (sky-coloured canvas; `setFogOverride` done) | |
| CORE-E player / input / physics | `src/player/*` | `input`, `physics`, `raycast`, `player`, `interaction` | `bc-coree` · `coree.md` | stub (`breakBlock`/`placeBlock` final payloads, `newAction`) | |
| MOBS | `src/entities/*`, `src/survival/*` | `mobs`, `items`, `survival` | `bc-mobs` · `mobs.md` | stub (entity base with streaming park/restore done) | |
| INV | `src/inventory/*`, `src/ui/hud*`, `src/ui/inventory_ui.js` | `invui`, `hud`, `crafting`, `furnace` | `bc-inv` · `inv.md` | stub (inventory model done; picker tabs in data) | |
| AUDIO | `src/audio/*` | `audio`, `music` | `bc-audio` · `audio.md` | stub | |
| MENUS | `src/ui/menus.js`, `pixelfont.js`, `parentgate.js`, `src/save/*` | `menus`, `save`, `font`, `gate` | `bc-menus` · `menus.md` | stub (placeholder title/pause; codec done) | |
| KID | `src/ui/touch*`, `src/kid/*` | `touch`, `kid` | `bc-kid` · `kid.md` | stub (Home works) | |
| MECH | `src/mechanics/*` | `mechanics` | `bc-mech` · `mech.md` | stub | |
| FX | `src/fx/*`, `src/render/celestial*` | `fx` | `bc-fx` · `fx.md` | stub | |

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

| Scenario | Requires | Last result | Evidence |
|---|---|---|---|
| boot | — | PASS | `.tmp/smoke-title.png` |
| world | — | PASS | `.tmp/smoke-world.png` |
| terrain-render | textures, worldgen, world, lighting, mesher, renderer | PENDING | |
| move-jump | input, player, physics, world, worldgen | PENDING | |
| break-place | input, player, physics, raycast, interaction, world | PENDING | |
| hotbar | — | PASS | |
| inventory-ui | — | PASS (placeholder screens) | `.tmp/smoke-inventory.png` |
| time | — | PASS | `.tmp/smoke-night.png` |
| kid-home | — | PASS | |
| mobs | mobs, physics, world | PENDING | |
| survival-fall | survival, player, physics | PENDING | |
| save-load | save, world | PENDING | |
| touch-controls | touch, input (`--touch`) | PENDING / SKIP | |
| context-loss | renderer | PENDING | |
| perf | — | PASS (stub numbers) | `.tmp/smoke-report.json` |
| lead-events-roundtrip | — | PASS | |
| lead-unload-persist | — | PASS | edit survives save + unload + reload, twice; unsaved path stays dirty |
| lead-break-contract | — | PASS | chest contents in `block:broken`, shared action id, bedrock rule |
| lead-batch | — | PASS | 9 cells, 9 events, one relight |
| lead-entity-streaming | — | PASS | parked on unload, restored with reason `load` |
| lead-testapi | — | PASS | `runTicks`, `setRandomSeed`, `lookAt`, `worldToNdc`, `recordTicks`, `waitFor`, `audioStats`, `tapAt` |

## Open decisions (SPEC §14)

- **D1 TNT on by default:** the parent decides. It is currently on, kid-safe and undoable.
- **D4 baked biome colours:** P2 revisit.
- **D5 texture layer budget:** 238 of 256, now enforced by the unit test.
- **D11 no Shift in the kid scheme:** fly down is C / Z / ▼; parent tip covers the Sticky Keys shortcut.
- **D12 survival item sources:** gravel 5% bone and leaves 2% string are original twists; TNT stays creative-only until creepers (P1).
- **D13 recipe book:** P0 for survival worlds.

## Handoff log

<!-- newest first: date · lane · what changed · commands run + results · remaining · blockers -->
- 2026-10-03 · LEAD · v1.1: applied the independent review (lane worktrees + handoff files, persistence invariant, block entity in `block:broken`, single drop owner, undo from `block:changed` with action ids, `voidRescue`, entity streaming, batch edits, test API additions, 8 picker tabs, survival item sources, mob movement rules, one draw per mob, workers P0 + kid flight cap, no Shift, kid outline, fences/gates/panes, boats owner, bedrock rule, minor data and spec fixes) · build 567 KB, unit 13/13, smoke 14 PASS / 7 PENDING / 1 SKIP, http, swiftshader+touch and production-file runs clean · next: integrator commits the foundation, then dispatches CORE lanes A–E in worktrees · blockers: foundation commit (not done in this pass by instruction)
- 2026-10-03 · LEAD · foundation, SPEC v1, stubs, harness · build, unit (10/10) and smoke (green with pending) · next: dispatch the CORE lanes A–E in parallel · blockers: none
