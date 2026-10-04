# Blockcraft — Status and completion record

This is the compact progress record. **Only the integrator (LEAD) edits this file.** Lanes write their handoffs to `docs/handoff/<lane>.md` in their own worktree (SPEC §0.1); the integrator merges the lane branch, re-runs the commands, and copies the verified results here.

- **Evidence must be reproducible:** a command plus its result, a screenshot path under `.tmp/`, or a report JSON.
- **Never tick a box from a handoff claim alone.** Re-run the command.

**Build under test:** `0.1.0-5578b0f5` (root `index.html`, 1398 KB minified, three.js + inlined worker, 11 of 12 lanes at judge round 1 + LEAD findings) · **Updated:** 2026-10-04 (judge round 1 integration: 11 lane fixer branches merged, LEAD findings KID-12, FID-3, FID-7, FID-8, FID-11 fixed, SPEC v1.7; FEATURE integration: lanes INV, MENUS, AUDIO, FX, MOBS, MECH, KID merged, SPEC v1.6; CORE review second recheck: CORE-R11 fixed on `main`, SPEC v1.5; CORE review recheck: CORE-R10 and CORE-R2 fixed, SPEC v1.4; CORE review findings CORE-R1…R9 fixed, SPEC v1.3; CORE integration: lanes A–E merged, SPEC v1.2)

## Before dispatching lanes

- [x] **Foundation committed on `main`** (`0eee714`, line endings normalised in `0ff6b18`).
- [x] Lane worktrees created (`../bc-<lane>` on `lane/<lane>`). All twelve lanes are finished and merged (CORE A–E on 2026-10-03, the seven FEATURE lanes on 2026-10-04).

## Lanes

| Lane | Owner files (SPEC §3.1) | Stubs to delete | Worktree / handoff | State | Evidence |
|---|---|---|---|---|---|
| LEAD foundation | build, tools, `src/main.js`, `src/core/*`, `src/data/*`, `src/ui/screens.js`, `styles.css`, docs | — | `main` | **done** (v1.1) | See the foundation evidence below |
| CORE-A textures | `src/textures/*` | `textures`, `icons` | `bc-corea` · `docs/handoff/corea.md` | **merged** `88bf5aa` (lane `dc1b1fb`) | 238 layers, 276 icons; `corea-*` PASS on GPU, SwiftShader, http, minified |
| CORE-B worldgen | `src/world/worldgen.js`, `noise.js`, `gen_*.js` | `worldgen`, `noise` | `bc-coreb` · `coreb.md` | **merged** `97a5a86` (lane `4092801`) | `coreb-*` PASS; generation about 1.0–1.2 ms per column in Chrome workers |
| CORE-C world / light / mesh | `src/world/*`, `src/worker/*` | `world`, `lighting`, `mesher` | `bc-corec` · `corec.md` | **merged** `5a0e790` (lane `e9c98b5`) + LEAD test fix `d0fe68f` | `corec-*` PASS; 3 blob workers from file:// and http |
| CORE-D renderer / sky | `src/render/*` | `renderer`, `sky` | `bc-cored` · `cored.md` | **merged** `e600531` (lane `484ad1c`) + integration fixes `12b3389`, `e262d21`, `1efeeb3`, `b0f4bd8` | `cored-*`, `terrain-render`, `context-loss` PASS |
| CORE-E player / input / physics | `src/player/*` | `input`, `physics`, `raycast`, `player`, `interaction` | `bc-coree` · `coree.md` | **merged** `b2b7348` (lane `7c2be68`) | `move-jump`, `break-place`, `coree-*` PASS (touch run included) |
| MOBS | `src/entities/*`, `src/survival/*` | `mobs`, `items`, `survival` | `bc-mobs` · `mobs.md` | **merged** `091212f` (lane `7e6b229`) + `ec50eee`, `1da649c`, `6589cc6`, `d8b4f1c` | `mobs-*` 16 PASS; `mobs-play` 68 + touch 5 PASS |
| INV | `src/inventory/*`, `src/ui/hud*`, `src/ui/inventory_ui.js` | `invui`, `hud`, `crafting`, `furnace` | `bc-inv` · `inv.md` | **merged** `0f9926c` (lane `e6ffa12`) + `1ec7714` | `inv-*` 12 PASS; `inv-play` 48 + touch 34 PASS |
| AUDIO | `src/audio/*` | `audio`, `music` | `bc-audio` · `audio.md` | **merged** `913dc10` (lane `ea39749`) | `audio-*` 13 PASS; `audio-inworld` 46 PASS |
| MENUS | `src/ui/menus.js`, `pixelfont.js`, `parentgate.js`, `src/save/*` | `menus`, `save`, `font`, `gate` | `bc-menus` · `menus.md` | **merged** `a1723bf` (lane `1a35f4b`) + `1ec7714`, `1da649c` | `menus-*` 16 PASS; `menus-inworld` 21/21 |
| KID | `src/ui/touch*`, `src/kid/*` | `touch`, `kid` | `bc-kid` · `kid.md` | **merged** `ac1a58a` (lane `dbf6efc`) + `18a6141` | `kid-*` 14 PASS (touch run); `kid-play` 41 PASS |
| MECH | `src/mechanics/*` | `mechanics` | `bc-mech` · `mech.md` | **merged** `52e8117` (lane `de166a2`) + `1da649c`, `2cd87ba` | `mech-*` 15 PASS; `mech-play` 57/57 |
| FX | `src/fx/*`, `src/render/celestial*` | `fx` | `bc-fx` · `fx.md` | **merged** `bcf0343` (lane `2a9b281`) + `2dd7115`, `ec50eee`, `ba34de9` | `fx-*` 12 PASS |

**Judge round 1 (2026-10-04):** the fixer branches of CORE-A, CORE-C, CORE-D, CORE-E, MOBS, INV, AUDIO, MENUS, KID, MECH and FX are merged (next section). CORE-B's fixer left no commit on `lane/coreb`; its work is uncommitted in `../bc-coreb`.

## Judge round 1 integration (LEAD, 2026-10-04, SPEC v1.7)

Eleven lane fixer branches merged into `main` with `git merge --no-ff`, one at a time; after each: `npm run build`, `npm run test:unit`, `npm test` (all on the RTX 3080 Ti, headless Chrome). No merge had a conflict (no file was touched by two lanes). `lane/coreb` had **no commit** (its fixer stopped with its work uncommitted in `../bc-coreb`: `gen_structures.js`, `gen_loot.js`, worldgen edits) and was not merged.

| Lane | Merge (lane head) | After the merge | Fix on `main` |
|---|---|---|---|
| CORE-C (ROB-1) | `dbaf7cf` (`37bfbec`) | unit 233/233; smoke 161 PASS, 5 SKIP | — |
| CORE-A (ROB-4, POL-10) | `0952e99` (`5fdc649`) | unit 234/234; smoke 161 PASS, 5 SKIP | — |
| CORE-D (POL-1, POL-3) | `1d08dad` (`2a1ac05`) | unit 234/234; smoke 161 PASS, 5 SKIP | — |
| CORE-E (KID-1, -2, -4, -5, -11, FID-4, ROB-9) | `0608d5c` (`8c2e3eb`) | unit 238/238; smoke 161 PASS, 5 SKIP | — |
| MECH (ROB-3, FID-9) | `0e88721` (`1b02746`) | unit 239/239; smoke 161 PASS, 5 SKIP | — |
| INV (KID-10, ROB-6, POL-13, ROB-7, …) | `43ef88b` (`1919217`) | unit 241/241; smoke 161 PASS, 5 SKIP | — |
| KID (KID-8, POL-11, POL-12) | `509c589` (`6f8581c`) | unit 242/242; smoke 161 PASS, 6 SKIP | — |
| MENUS (KID-9, ROB-2, ROB-5, …) | `b7e1df3` (`8803301`) | unit 248/248; smoke 161 PASS, 6 SKIP | — |
| FX (FID-2, POL-9, FID-13, …) | `0f4df51` (`3df0e41`) | unit 251/251; smoke 163 PASS, 6 SKIP | — |
| AUDIO (POL-5…POL-8) | `096ac45` (`77d74cb`) | unit 258/258; smoke 166 PASS, 6 SKIP | — |
| MOBS (FID-1, KID-3, KID-6, KID-7, FID-10, FID-12, ROB-8, FID-6) | `2672d7f` (`656d1f4`) | unit 263/264, smoke 170 PASS, 2 FAIL | `1eddeb3` → unit 264/264, smoke 172 PASS, 6 SKIP |

Integration fix `1eddeb3` (after MOBS): CORE-A's POL-10 test covers every spawn egg and MOBS added ten eggs that fell back to the spotted egg, so each new kind got an original egg face (cod, tropical fish, squid, rabbit, fox, bee, enderman, slime, villager, iron golem); `mobs-new-kinds` counted draw calls while the pond edit's hot sections were still folding back (13 > 12; settled 7 or fewer), and `mobs-no-pileup` counted a column first loaded in round 2 as a repopulated one (passes alone; under full-suite load streaming had not finished in 60 frames). Both now wait for the renderer / streaming to settle (render distance pinned for the pile-up check).

### LEAD findings fixed on `main`

| Finding | Fix | Proof |
|---|---|---|
| **KID-12** `__game.events()` on a payload with a live object serialized the whole game | `testapi.js` copies payloads with a bounded walk (events: depth 4; entities become `{id, type, x, y, z}`, systems `{system}`); `meta()` / `settings()` / entity `data` keep depth 16 | Reproduced: the old replacer turned ONE `player:hurt` in a small flat world into a **21.9 MB** string (559 ms) — 20 of them in a bigger world is the 4 GB OOM (`.tmp/kid12-old2.mjs`). Now **164–326 chars, 0–32 ms**. New `lead-events-live-payload` (a real zombie hit) |
| **FID-3** Peaceful → Easy left monsters off for good | new `core/worldrules.js`: `newWorldRules` / `ruleInEffect`; `setDifficulty` and `createWorldMeta` never write a rule; Peaceful blocks monsters and hunger at run time (as spawning / survival already did); settings show Monsters and Hunger off and greyed on Peaceful; the picker hides monster eggs on Peaceful | unit test (incl. "setDifficulty writes no rule"); new `lead-difficulty-roundtrip`: Survival Easy → Peaceful (0 monsters) → Easy: `hostileMobs` true, **5 monsters** at night |
| **FID-11** survival presets never rain, no death screen | `SURVIVAL_RULES.weatherCycle = true`; Survival Normal starts with `immediateRespawn: false` (the existing icon-only death screen: three hearts and one big green Respawn button); items still kept | new `lead-survival-rules`: a real 30-block fall on Survival Normal opens the death screen, no auto-respawn after 60 ticks, a **real mouse click** on Respawn brings her back at 20 HP; rain starts within 18 000 ticks; Easy keeps instant respawn; the kid world has no weather cycle. Picture `.tmp/smoke-lead-lead-survival-death.png` (looked at) |
| **FID-7** small building palette (`5a2b314`, `1f1f866`) | 41 new blocks (ids 142–182): stone, brick, sandstone, birch, spruce slabs + stairs, stone brick stairs; birch and spruce doors, fences, gates; oak/birch/spruce trapdoors; lantern (standing / hanging); flower pot (15 plants); decorative sign (standing / wall); 16 concrete colours; quartz block; prismarine. Shapes trapdoor / lantern / pot / sign; MECH uses generic per shape (every door, gate, trapdoor); supports for hanging lantern and wall sign; a double slab drops 2; recipes for all (concrete = dye + 4 sand + 4 gravel); original art (`textures/tex_palette.js`), icons and sprites. **Double chests**: two chests side by side join (state bits 2/3), one 54-slot screen, each half keeps its 27 slots in the save, breaking a half leaves a single chest with its items | unit tests (boxes, drops, recipes, picker pages, pairing); `lead-building-palette` (real taps: trapdoor opens, two-high birch door placed and opened, flower pot + poppy, lantern hangs under a block and falls when the ceiling goes) and `lead-double-chest` (real taps place and open; 54 slots; halves keep their items). Pictures `.tmp/pal-row1.png`, `pal-row2a.png`, `pal-row2b.png`, `pal-row3b.png`, `pal-night.png` (lanterns light the ground), `pal-pick-*.png` (picker icons), `.tmp/smoke-dc-lead-double-chest-*.png`, `.tmp/dc-667.png` (54 slots fit 667×375 at 26 px) — all looked at |
| **FID-8** no Nether (`0506be8`) | **Scope decision (D16): the Nether is in**; the End, enchanting, potions, redstone stay out. Flint and steel lights an obsidian frame (2×3 … 21×21); walking in (creative) / 2.5 s (survival) travels to a kid-safe Nether in a far-east strip of the same world (1:8, `core/nether.js`, `world/gen_nether.js`, system `nether`): netherrack caverns, lava sea, glowstone, soul sand, quartz ore; warm haze, no sky / rain / mobs; arrival on a railed obsidian balcony; walking back returns to the first portal; Undo removes a lit sheet; breaking the frame removes it | `test/nether.test.mjs` (frames, link, worldgen shares and determinism, support rule); `lead-nether-portal`: a **real flint tap** lights 6 cells, one Undo clears them, relit, the **real up arrow** walks in → Nether (fog 56, light floor 0.3, rain 0, obsidian floor, no lava within 2), walks back → within 4 blocks of the first portal, overworld sky back; breaking a frame block removes the sheet. Pictures `.tmp/smoke-neth-lead-nether-lit.png`, `-arrived.png`, `.tmp/nether-02-arrived.png`, `nether-03-look-*.png` (looked at) |

**Texture layers (SPEC D5):** the full set is now 272 layers. WebGL2 only guarantees 256, so the renderer keeps the full set when `MAX_ARRAY_TEXTURE_LAYERS` allows (2048 here), else half-length water and lava (exactly 256, nothing shared), else `LAYER_FALLBACK` keys share a layer; it also remembers the full count, so a later texture rebuild (leaves setting) no longer drops the fit. Unit-tested.

### Commands and results (final `main`, build `0.1.0-5578b0f5`, RTX 3080 Ti headless Chrome unless noted)

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-5578b0f5`, root `index.html` **1398 KB** minified (was 1275 KB before round 1: ten mob kinds, 46 blocks, the Nether) |
| `npm run test:unit` | **271 / 271 pass** |
| `npm test -- --strict` | **178 PASS, 6 SKIP** (touch-only), 0 FAIL, 0 PENDING, page-errors PASS; `textureLayers` 272 |
| `npm test -- --strict --http` | first run 177 PASS, **1 FAIL** `fx-sleep-view` ("no_bed": the scenario set the two bed halves in two calls and MECH's bed rule removed the lonely foot when a tick fell between them). Fixed in the scenario (both halves in one evaluation); rerun **178 PASS, 6 SKIP**, 0 FAIL; the fixed scenario also passes alone under file, SwiftShader and touch |
| `npm test -- --swiftshader` | **178 PASS, 6 SKIP** (335.7 s); SwiftShader also reports > 256 layers (272 bound); `perf` 41.4 fps at R 4, `cored-perf` R 6 199 draws, `mech-tnt-chain` worst tick 5.6 ms |
| `npm test -- --touch` | **184 PASS** (every touch-only scenario included) |
| `node tools/playtest.mjs --file index.html` | **40 / 40**, median 144.9 fps, p99 7.1 ms, max 27.8 ms, at most 315 draws, no errors |
| `node tools/lead-play.mjs` (rebuilt `.tmp/lead-dev` from `main`) | **48 / 48 PASS**, 143.9 fps, 251 draws. A first run used the stale pre-merge `.tmp/lead-dev` copy (42 PASS, 1 FAIL "no dry spot for the TNT", and creative counts on the hotbar): rebuilding that copy is required before every run |

Logs: `.tmp/final17/*.log`; per-merge logs `.tmp/merge-m1…m11b*.log`; reports `.tmp/smoke-report-*.json`.

Scenario-only fix on `main`: `tools/scenarios/fx.mjs` `fx-sleep-view` (see the http row).

### Not done / still open (honest)

- **`lane/coreb` not merged:** no commit on the branch; its uncommitted round-1 work (structures, loot) sits in `../bc-coreb`. Its `worldgen.js` edits will meet LEAD's 3-line Nether route in `generateColumn` (`isNetherColumn` → `generateNetherColumn`) when it lands.
- **Redstone, the End, enchanting, potions:** still non-goals (D16). Redstone basics (lever, lamp, dust) is the next candidate if the parent wants it.
- **Nether:** no Nether mobs; the portal sheet is a static texture (no animation); the arrival railing must be broken (or flown over) to explore; survival players can fall into the lava sea away from the balcony (Java-like; the kid creative world takes no fire or fall damage).
- **Double chests** show two latches (two half-chest fronts side by side).
- Older known issues from the FEATURE integration list below still apply unless a round-1 lane fixed them (POL-12 fixed the hearts row under the D-pad at 1024 × 600; FID-13 added the lie-down sleep view).

## FEATURE integration (LEAD, 2026-10-04, SPEC v1.6)

All seven FEATURE lanes are merged into `main` with `git merge --no-ff`, one at a time, in the order INV, MENUS, AUDIO, FX, MOBS, MECH, KID. After each merge: `npm run build`, `npm run test:unit`, `npm test`; every break was fixed on `main` before the next merge. No merge had a conflict (each lane only touched its own files). No stub is registered any more (`stub lanes: (none)`), so `--strict` now means every scenario really runs.

| Lane | Merge (lane head) | After the merge | Integration fix commit |
|---|---|---|---|
| INV | `0f9926c` (`e6ffa12`) | unit 106/106; smoke 67 PASS, 5 PENDING, 2 SKIP | none needed |
| MENUS | `a1723bf` (`1a35f4b`) | unit 121/121; smoke 82 PASS, 2 FAIL (`coree-classic-lock`, `menus-sizes`) | `1ec7714` |
| AUDIO | `913dc10` (`ea39749`) | unit 144/144; smoke 96 PASS, 4 PENDING, 3 SKIP | none needed |
| FX | `bcf0343` (`2a9b281`) | unit 163/163; smoke 106 PASS, 1 FAIL (`fx-inworld-break`) | `2dd7115` |
| MOBS | `091212f` (`7e6b229`) | unit 185/185; smoke 125 PASS, 3 FAIL (`survival-fall`, `inv-hud`, `mobs-pickup`) | `ec50eee` |
| MECH | `52e8117` (`de166a2`) | unit 215/215; smoke 143 PASS, 2 FAIL (`cored-perf`, `menus-autosave`) | `1da649c` |
| KID | `ac1a58a` (`dbf6efc`) | unit 230/230; smoke 154 PASS, 2 FAIL (`corec-light-border`, `kid-stuck`); touch 3 FAIL | `18a6141` |

Later integration commits: `6589cc6` (starter animals, lane play-throughs fitted to the merged game, SPEC v1.6), `d8b4f1c` (fixes from the end-to-end play), `ba34de9` (clouds and the fog cull, grass-tuft targeting range).

### Cross-lane defects reported by the lanes, and what was done

| Reported by | Defect | Fix on `main` | Proof |
|---|---|---|---|
| MOBS 4 | Kid world: a hold that started on an animal turned into digging after it hopped away (12 holds dug 11 holes) | `interaction.js`: in the kid scheme a hold that hit an entity stays an entity hold until released; SPEC §7.4 | new `lead-kid-hold-entity` fails on the old code (grass dug), passes now |
| KID 2, INV 4, MECH 3, INV 3 | New worlds kept the previous hotbar slot, kid cursor, health, food, air, XP; `lookAt` did not re-centre the cursor | hotbar reset was already on `main`; `input.js` re-centres the kid cursor on `world:ready`; test API `setLook` / `lookAt` re-centre it; survival values were already reset by the real SURVIVAL lane | new `lead-new-world-reset` (health 20, food 20, air 300, XP 0, slot 1, cursor centred); `fx-inworld-break` passes |
| KID 4 | Head inside a block saw through the world with a huge outline | FX overlay: inside an opaque full cube the block's side texture fills the screen at about a third of its brightness; SPEC §8.7 | new `lead-head-in-block`; picture `.tmp/smoke-m5j-lead-head-in-block.png` |
| KID 3, INV 2, FX 1, AUDIO, MECH 1 | `cored-daynight` flaky (merges from streaming and growth ticks) | every CORE-D scenario runs with MECH random ticks off (`freezeWorld` wrapper) and `settle()` | no `cored-daynight` failure in any full run since |
| MENUS 1, FX 3 | `coree-classic-lock` expected `playing` after the lost pointer lock (MENUS opens pause); order-dependent pick | accepts pause, selects slot 1, waits for the crosshair on the placed block | 3/3 isolated runs, every suite since |
| KID 1 | `coree-touch` depended on test order | selects slot 1 and resets the pointer type first | touch suites PASS |
| MOBS 3 | `lead-testapi` seed and draws in separate calls | seed + draws in one evaluation | PASS |
| MOBS 1 | `survival-fall` read health after regeneration | judges the fall by its `player:hurt` event (7 HP, health 13) | PASS |
| MOBS 2 | `eventCount` is per page session | documented in `testapi.js` (scenarios compare against a baseline) | — |
| MECH 2 | Placer return-value contract undocumented | `hooks.js` + SPEC §7.4 step 5: true = placed (interaction consumes one item), false = refused, no default placement | — |
| MECH 4 | Generated pumpkins and boulders on grass (grass turned to dirt in every new area, background remeshes) | worldgen puts dirt under pumpkins, melons and boulder stones; SPEC §2 | unit + `coreb-*` PASS |
| MECH 5 | Wall torches flat against the wall | already lean 22.5° in the mesher; the report came from a front view | side view `.tmp/torch-side.png` |
| MENUS 2 | Renderer redrew the frozen world behind pause (33 full frames/s on SwiftShader) | paused, or on the title with no world, the world is drawn twice and then skipped until something visible changes; `getStats().frozenSkips`; SPEC §5.5 | new `lead-pause-no-redraw` (≥15 of 20 frames skipped; a resize redraws) |
| MENUS 3 | `captureThumbnail` showed the outline | the renderer hides it itself; storage no longer toggles it | `menus-thumbnail` PASS |
| MENUS request 1 | `startWorld` stuck in `loading` after a failed open | back to the title state, error rethrown | — |
| AUDIO | Title Play gave no `ui:click` | the real MENUS lane emits it on every button | `audio-*` PASS |
| FX 2, INV 1 | `cored-entity` left its test objects | already fixed on `main` | — |
| FX 4 | Hotbar number keys did nothing | the real HUD handles them | `lead-play` "number key 2 selects slot 2" |
| Lane fallbacks | Creeper explosion fallback (MOBS), kid fade layer (KID), `!stub` guards, stale FX comments | removed; MECH owns explosions and scales creeper damage on easy (half + 1) like the fallback did | unit test with a mechanics stand-in |
| KID request 2 | Touch: hotbar under the Jump/Down buttons on narrow screens | the jump / down / fly column is lifted above the HUD block when they would overlap (1024 × 600, and Down while flying at 1280 × 720); SPEC §8.5.1 | new unit test; `.tmp/touch-layout-1024x600.png` |
| INV request 1 | Default skin used the famous default character's palette | original yellow shirt + teal trousers; a saved copy of the old default migrates | `.tmp/lead-play/*recipe-book.png` (doll) |

Not done (honest): KID `touchStyle` setting (stored in localStorage by the lane), smelting XP award (INV request 2), the remaining "document new events" requests for SPEC §6, MECH "lie down in bed" camera, MOBS slimes and extra animals, KID photo button (P2), KID minor 0.1-block drift right after a teleport into an unloaded area.

### Integration problems found and fixed on `main`

- **HUD at narrow widths** (MENUS × INV): at 375 px the backpack button was off screen. The hotbar slot is capped so slots + backpack fit, and the pair is centred together (`menus-sizes`).
- **Autosave never debounced in a living world** (MENUS × MECH): growth/melt/decay changes reset the 2.5 s debounce, so edits waited for the 30 s interval. Natural changes are now soft changes (`menus-autosave`).
- **Item pickup** (MOBS): a drop that rolled to the far side of the 1-deep hole just dug was out of reach (`mobs-pickup` flaked). Pickup distance now reaches 0.5 below the feet, like Java's box; the scenario checks every pop direction and fails on the old rule.
- **Kid buried by falling sand** (KID × MECH): sand that falls on the child lands in the feet cell; the stuck helper now pops a body inside a solid block too (`kid-stuck`, fails without the fix).
- **Order-dependent scenarios**: `inv-hud` (real survival regenerated air), `mobs-gallery` (streaming changed draw counts), `menus-touch` (cards loaded after the tap), `audio-locked`/`audio-unlock` (an earlier touch gesture unlocked audio), `corec-light-border` (real MECH pops an unsupported torch), `cored-perf` (settle never went quiet with growth ticks, so the quality scaler raised the render distance), `menus-autosave` (random ticks re-dirtied columns).
- **Clouds and the fog cull** (FX × CORE-D): on the low preset the flat cloud layer let far fogged water paint over it and changed about 400 pixels between cull off and on from high up (`cored-fog` under SwiftShader). Clouds past the fog at or below the camera are discarded, and the flat layer writes depth: 0 pixels on SwiftShader and GPU.

### Found by playing it (tools/lead-play.mjs) and fixed

| What a child would hit | Fix |
|---|---|
| The nearest animal was 75 blocks away, outside the kid world's 48-block border | a new world starts with one small group each of cows, sheep, pigs and chickens 10–28 blocks from the spawn (inside the border, deterministic per seed, never culled); the passive top-up stays inside the border (`lead-starter-animals`: 9–14 animals within 32 blocks on 5 presets/seeds) |
| A tap on a pig standing in tall grass hit the grass | an entity in or up to 1.5 blocks behind a grass tuft / flower wins the target (`lead-entity-through-grass`, both cases) |
| A fed cow walked into the camera and filled the screen | animals step aside from the player |
| The HUD popup said "Tnt" | display names: TNT, Flint and Steel, Carrot on a Stick, Lily of the Valley, Jack o'Lantern |
| Default skin looked like the famous default character | original palette (see above) |

### Commands and results (final `main`, build `0.1.0-84771e68`, RTX 3080 Ti headless Chrome unless noted)

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-84771e68`, root `index.html` 1275 KB minified (was 812 KB before the FEATURE lanes) |
| `npm run test:unit` | **231 / 231 pass** |
| `npm test -- --strict` | **160 PASS, 5 SKIP** (touch-only), 0 FAIL, 0 PENDING, page-errors PASS |
| `npm test -- --strict --http` | **160 PASS, 5 SKIP**, service worker registered |
| `npm test -- --swiftshader` | **160 PASS, 5 SKIP**. `cored-fog` 0 changed pixels with the cull off/on (it changed about 400 before `ba34de9`); `mech-tnt-chain` worst tick 3.9 ms (the scenario timed tick + SwiftShader frame and failed one run at 244 ms; fixed in `2cd87ba`); `perf` 43 fps at R 4 |
| `npm test -- --touch` | **165 PASS** (every touch-only scenario included: `touch-controls`, `coree-touch`, `kid-touch-overlay`, `kid-touch-world`, `menus-touch`) |
| `node tools/inv-play.mjs` / `--touch` | **48 PASS**; touch **34 PASS, 2 SKIP** (the keyboard block, and the chest hold-break: Playwright touch has no long press) |
| `node tools/kid-play.mjs` | **41 PASS, 0 FAIL** |
| `node tools/mech-play.mjs` | **57 / 57** |
| `node tools/mobs-play.mjs` / `--touch touch` | **68 PASS**; touch **5 PASS** |
| `node tools/audio-inworld.mjs` | **46 PASS, 0 FAIL** |
| `node tools/menus-inworld.mjs` | **21 / 21 PASS** |
| `node tools/lead-play.mjs` | **48 / 48 PASS** (kid 20, survival 28), 144 fps, at most 252 draws at the end |
| `node tools/playtest.mjs --file index.html` | **40 / 40**, median 144.9 fps, p99 7.1 ms, max 27.8 ms, at most 306 draws |

The whole matrix ran twice on the final code (`.tmp/verify1/`, `.tmp/verify/`): the first pass found `cored-fog` under SwiftShader and one `kid-play` tap-build miss (fixed in `ba34de9`), the second a SwiftShader timing flake in `mech-tnt-chain` (fixed in `2cd87ba`, SwiftShader suite rerun: 160 PASS). Logs: `.tmp/verify/*.log`; reports `.tmp/smoke-report-v-*.json`. The lane play-throughs build their dev copies into `.tmp/build-<lane>` from the same `main`.

### End-to-end play-through (`tools/lead-play.mjs`, screenshots `.tmp/lead-play/NN-*.png`, all looked at)

Real mouse clicks, holds and keys. **Kid creative:** title → big Play → a kid creative world; the backpack opens the picture picker, yellow wool and glass go into the hotbar, number key 2 selects; taps build a little wall (wool with glass on top); a herd near the spawn; walk up to a cow and feed it wheat (hearts); saddle a pig and get on with taps, steer with the carrot on a stick (third-person view too), C gets off; TNT placed with a tap, lit with flint and steel, the blast leaves a crater, one Undo tap puts it all back; fly away and the Home button brings the child home. **Survival Easy:** Esc → pause → door button → title → Worlds → + → Hills & trees + Survival Easy → Play; an empty bag; hold the mouse on a tree trunk (leaves in the way punched too) and collect the logs; the backpack's recipe book makes planks, a crafting table and sticks (the pickaxe shows it needs the table); place the table and tap it, make a wooden pickaxe; hold the mouse looking down to dig a shaft for 9 cobblestone; push against the wall until the "hold jump" picture shows, hold Space and pop out; craft a furnace at the table, place it, cook cobblestone into stone with planks as fuel; dusk with monsters about; a bed from 3 wool + 3 planks, tap it at night, sleep, wake at time 0 with the fade gone, health 20. After the real menu flow opens each world, the script continues in a world with the same options and a fixed seed (kid 12345, survival 314) so its taps land the same way every run; random seeds work too (`--seed random`). The random-seed runs found the starter-animal and grass-targeting problems above; the misses left after those fixes were the script itself tripping over terrain (a hill in front of the tap, TNT placed in a river, a herd member stepping in front), each checked on its screenshot.

### Known issues (honest)

- **Needs a person on the real laptop:** a real touchscreen and trackpad, holding Esc in fullscreen, Sticky Keys, and listening to the sounds (all 150 sounds and the music are in `.tmp/audio-wav/` from the audio lane).
- **Phone portrait (375 px)** is squeezed: hotbar slots shrink to about 29 px and container screens do not fit; laptops and landscape tablets are fine.
- **1024 × 600 touch:** the hearts row sits under the D-pad's right turn button (visual only; the buttons themselves are clear).
- Monsters spawn in dark caves during the day (Java-like) and count toward the monster cap of 20.
- Sleeping keeps the camera standing (no lie-down pose); the hand is not drawn over the in-block overlay.
- Item icons are drawn at 32 px and scaled to 48 px in 1280-wide containers (slightly uneven pixels).
- Tapping animals reaches 5 blocks (blocks reach 8 in the kid scheme).
- Saved worlds made before this build do not get the starter animals (only new worlds).
- The root build grew to 1275 KB (three.js plus all lanes).

## CORE review second recheck fix (LEAD, 2026-10-03, SPEC v1.5)

The reviewer's second recheck filed CORE-R11 (minor): the CORE-R10 fog cull was not picture-neutral at ground level. It hid whole columns past the fog, which removed the pale, fully fogged silhouettes of distant mountains standing against the bluer sky, while SPEC v1.4 and this file said the picture does not change. **Product choice: keep the hazy distant mountains** (the reviewer's option b). The fog cull now hides fully fogged geometry only where the sky behind it is the fog colour, so the picture never changes and the docs say so. Reproduced on the build under review (`0.1.0-18da9388`, kept as `.tmp/r11/before.html`) with the reviewer's scripts, copied unchanged to `.tmp/r11/` except for output names, a streaming guard and an underwater spot finder.

| Finding | Fix | Proof (before → after) |
|---|---|---|
| **R11 (minor)** The fog cull removed fogged mountain silhouettes at ground level; SPEC and STATUS said the picture does not change | **Picture-exact fog cull** in `src/render/renderer.js`. Geometry past `uFogFar` + 0.5 is exactly the fog colour, and so is everything behind it except the sky. Hiding it is therefore exact wherever the sky behind it is the fog colour too: at or below the horizon; at or below `SKY_GLOW_FLOOR` (−0.08) for a column with any part toward the sun while the sunset glow is on; everywhere when the eye is in water or lava. The renderer now records each section's highest vertex per pass (opaque, cutout, translucent) when `setSectionMesh` is called. Per pass it hides the bottom run of sections whose top + 0.5, seen from the eye at the column's far corner, stays below that line (`chunkmerge.fogCutFrom`, unit-tested). The merged column mesh draws from its first kept section (`drawRange`). Anything rising above the line is drawn and shows as the pale silhouette, as without the cull. `SKY_GLOW_FLOOR` is shared with the sky shader. New `getStats().fogTrimmed` counts far columns that still draw their upper part. SPEC v1.5 §5.3.3, §5.5.2, §5.5.4, §5.5.6 and §8.7 record the rule and the horizon contract (FX draws no sun, moon or stars at or below the horizon; clouds use the shared fog). **Cost:** keeping the silhouettes brings back draws in hilly views (below). | Reproduced first: same frame with `renderer.fogCull` off and on at 1280 × 720, 80 views (R 4/6/8/12, four times of day, ground, high and far views; `node .tmp/r11/v3-cullexact.mjs`, `.tmp/r11/before-cullexact.log`): **53 views changed**, up to 62 783 px at R 4 (6.8 % of the frame), 28 287 px at R 6 sunset, and 57 non-fog-colour pixels at R 12 sunset (glow below the horizon). After: **0 changed pixels in all 83 views** (80 plus 3 underwater; `.tmp/r11/final-cullexact.log`; the script retries a view when meshes stream in between the two captures). Pictures, cull off on top and on below: before `.tmp/r11/before-v3pair-R6-t12300-ground-0.png` and `before-v3pair-R4-t6000-ground-0.png` (the mountain is gone below); after `.tmp/r11/final-v3pair-*.png` (both halves identical, the mountain stays). Pop-in while flying toward the peaks (`v3-pop2.mjs`, R 6): fog-flip totals cull on / off 59.8 / 58.7 % (yaw 270) and 30.0 / 28.6 % (yaw 0), the same within run noise. `cored-fog` now asserts **0 changed pixels** at ground level, from high up (where draws must also drop: 223 → 166 at R 8, 127 → 87 at R 6) and at a view with silhouettes (seed 4242 spawn, sunset, toward the sun: about 12 090 pure fog-colour pixels above the horizon at R 6 in every suite run, 1 235 at R 8 in a single GPU run; `.tmp/smoke-r11-cored-fog-silhouette.png`). New unit test: `fogCutFrom` keeps grass tips and peaks above the eye, keeps ground inside the glow band, and over 2 000 random columns every hidden section lies at or below the floor. **Cost**, SwiftShader R 4, the reviewer's same views (`v12q-perf.mjs`), median of 3 interleaved runs (`.tmp/r11/ab4-ss-R4.json`) for ground facing peaks / air / second ground: before **44.7 / 68.9 / 131.2 fps** (74 / 79 / 43 draws) → after **42.0 / 64.5 / 126.3 fps** (92 / 79 / 49 draws). The air view draws exactly the same as before; a direct probe (`.tmp/r11/airprobe.mjs`, 2 interleaved runs) shows the same median frame interval there (13.9 ms) and the same main-thread renderer time (0.5 ms), and an earlier interleaved run measured it at 68.7 vs 69.0 fps (`ab3-ss-R4.json`), so that gap is run noise. On the ground views the renderer's main-thread time goes from 0.5 to 0.6 ms. `cored-perf` R 6: 157 → **183** draws (budget 300); `perf` R 8: 234 → 247; playtest maximum draws 273 → 294 (GPU), 94 → 140 (SwiftShader), with the same median frame rate (144.9 GPU, 71.9 SwiftShader). |

**Commands and results** (`main` working tree at build `0.1.0-60b11726`, RTX 3080 Ti headless Chrome unless noted):

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-60b11726`, root `index.html` 812 KB |
| `npm run test:unit` | **90 / 90 pass** (adds `chunkmerge: the fog cull hides far sections only below the horizon / glow floor`; the shader contract test pins the exact fog-colour horizon and `SKY_GLOW_FLOOR` in the sky shader) |
| `npm test` | **57 PASS**, 3 PENDING (`mobs`, `survival-fall`, `save-load`), 2 SKIP (touch only); `cored-fog` asserts the picture-exact cull |
| `node tools/smoke.mjs --swiftshader --tag ss` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --http --tag http` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --file index.html --tag prod` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --touch --tag touch` | 58 PASS, 4 PENDING |
| `node tools/playtest.mjs --file index.html --tag r11` | **39 / 39**, median 144.9 fps, p99 7.1 ms, max 34.7 ms, at most 294 draws (`.tmp/r11-NN-*.png`). The first run failed 5 checks: the walk ended near a column edge and the take-off overlapped tree leaves in the next column (`.tmp/r11-09-fly-look-down.png`). A rerun of the same build (`r11b`) and the build under review both passed because their walks ended away from the edge. `tools/playtest.mjs` now always centres the player on the open take-off column. |
| `node tools/playtest.mjs --file index.html --swiftshader --tag r11-ss` | **39 / 39**, median 71.9 fps, p90 20.9 ms, at most 140 draws |
| `node .tmp/r11/v3-cullexact.mjs` | 83 views, **0** changed pixels (before: 53 views changed) |
| `node .tmp/r10/ab.mjs --R=4 --reps=3 .tmp/r11/before.html .tmp/r11/final.html` | the SwiftShader table above (`.tmp/r11/ab4-ss-R4.json`) |

## CORE review recheck fixes (LEAD, 2026-10-03, SPEC v1.4)

The reviewer's recheck filed CORE-R10 (major: the CORE-R1 extra mesh ring drew a lot of fully fogged geometry) and kept CORE-R2 open (minor: torch-lit cave walls still showed triangle creases). Both were reproduced on the build under review (`0.1.0-b7eb8e11`, kept as `.tmp/r10/before.html`) and checked again after the fix. Scripts and pictures: `.tmp/r10/`; the reviewer's own scripts in `.tmp/review/` were re-run unchanged.

| Finding | Fix | Proof (before → after) |
|---|---|---|
| **R10 (major)** The extra ring cost about a third of the frame rate on the weak-laptop proxy | **Fog cull** in `src/render/renderer.js`: right before each render, every chunk mesh of a column whose nearest horizontal point to the eye lies beyond `uFogFar` + 0.5 is hidden. That geometry is 100 % fogged (land fog is horizontal; underwater and lava fog are spherical, never shorter). *(Corrected by CORE-R11 above: this was not picture-neutral at ground level. It hid the pale fogged silhouettes of distant mountains; v1.5 keeps them.)* The ring and the M + 1 drop hysteresis stay meshed and cached. `getStats().fogCulled` reports the hidden columns; `renderer.fogCull = false` turns it off for tests. | Reproduced first: `v1b-fogged-geo.mjs` share of drawn triangles wholly past the fog R 4 **39.9 %**, R 6 20.3 %, R 8 18.1 %; after: **1.6 %, 0.6 %, 0.5 %** (what is left sits inside the 0.5 pad). SwiftShader, R 4, the reviewer's same views (`v12q-perf.mjs`), median of 3 interleaved runs (`.tmp/r10/ab.mjs`, `ab2-ss-R4.json`) for ground / air / second ground: before **42.2 / 55.9 / 87.2 fps** (94 / 114 / 75 draws) → fog cull only **47.3 / 73.6 / 139.7 fps** (74 / 79 / 43 draws); old build 68.0 / 76.1 / 144.9. The first ground view stays lower than the old build because the terrain there changed with the CORE-R8 climate change: an experiment build with the old mesh radius and the same world (`.tmp/r10/m0/`) gives 47.0 fps and 66 draws at that spot. New `cored-fog` checks: the cull is exact (nothing drawn wholly past `fogFar` + 0.5, nothing hidden inside `fogFar`), the same frame with the cull off and on changes **0 pixels** from high up and only pure fog-colour pixels at ground level (0 changed at that one view, which had no silhouette; CORE-R11 found up to 6.8 % of the frame changing at other ground views); draws at that view 181 → 144. `cored-perf` R 6: 189 → **157** draws (the build before CORE-R1 had 156). `perf` R 8: 259 → 234. Playtest maximum draws: 341 → 273 (GPU), 159 → 94 (SwiftShader). |
| **R2 (minor, was kept open)** Triangle creases on torch-lit cave walls | **Per-pixel bilinear corner light.** The mesher now gives every quad its four corner lights (`corner`: sky × 8, block × 8 and AO per corner, on all 4 vertices) and names each vertex's corner in flag bits 7–8. The chunk vertex shader decodes them into `flat` varyings, and the fragment shader blends sky, block and AO with bilinear weights from the face position. No face has a diagonal any more, whatever its corners are, and AO is a soft gradient instead of hard steps. Chunk geometry drops the per-vertex `aLight` upload (the face shade now comes from the face bits), so a chunk vertex is 28 bytes (24 before). Hand-built meshes without `corner` still work (`chunkmerge.withCorner`). Mesh contract recorded in SPEC v1.4 §5.3.5, §5.4 and §5.5.3. | The reviewer's cave (`v2-crease.mjs`, seed 2024, the same torches): `.tmp/r10/cmp-R2-cave-zoom.png` (2× zoom of the ceiling block and right wall, before on top): the lighter and darker wedges are gone. The same cave with every texture painted grey (`.tmp/r10/lightonly.mjs`, light × AO × shade only): `.tmp/r10/cmp-R2-lightonly-1.png` and `-2.png` show the chevrons and AO steps before and smooth gradients after. Crease score (mean absolute second difference inside faces, 6 views): **1.42–2.15 → 0.97–1.49** (30–35 % lower); the build before CORE-R1 scored the same as the build under review, confirming the old flip rule changed almost nothing in a real cave. White-wool torch room: `.tmp/r10/cmp-R2-room.png`. New unit tests: every quad of a torch-lit room carries 4 cyclic corner ids whose corner values match the vertex light, its corners form a parallelogram, and the blend at the face centre is the mean of all 4 corners; `withCorner` and the merge keep corner data. **Costs:** chunk geometry (seed 4242, `.tmp/r10/mem.mjs`) 29.8 → 34.8 MB at R 6 and 106 → 124 MB at R 12; SwiftShader same views 47.3 / 73.6 / 139.7 → **44.8 / 65.7 / 130.7 fps** (5–11 % below the fog cull alone, still 6–50 % above the build under review). Experiment builds showed the cost is not the vertex decode or the fragment weights alone (`.tmp/r10/e1`, `e2`, within noise). RTX: display-capped at 144 fps. |

**Commands and results** (`main` working tree at build `0.1.0-18da9388`, RTX 3080 Ti headless Chrome unless noted; the machine was shared with other work, so SwiftShader frame rates were compared only in interleaved runs):

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-18da9388`, root `index.html` 810 KB |
| `npm run test:unit` | **89 / 89 pass** (adds `mesher: every quad carries its four corner lights…` and `chunkmerge: corner lights are merged…`) |
| `npm test` | **57 PASS**, 3 PENDING (`mobs`, `survival-fall`, `save-load`), 2 SKIP (touch only); `cored-fog` now asserts the fog cull |
| `node tools/smoke.mjs --swiftshader --tag ss` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --http --tag http` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --file index.html --tag prod` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --touch --tag touch` | 58 PASS, 4 PENDING |
| `node tools/playtest.mjs --file index.html --tag r10` | **39 / 39**, median 144.9 fps, p99 7.1 ms, max 27.8 ms, at most 273 draws (`.tmp/r10-NN-*.png`) |
| `node tools/playtest.mjs --file index.html --swiftshader --tag r10-ss` | **39 / 39**, median 71.9 fps, p90 20.9 ms, at most 94 draws |
| `node .tmp/review/v1b-fogged-geo.mjs index.html` | fogged share 1.6 / 0.6 / 0.5 % at R 4 / 6 / 8 |
| `node .tmp/r10/ab.mjs --reps=3 .tmp/fix/old.html .tmp/r10/before.html .tmp/r10/r10only.html .tmp/r10/after2.html` | the SwiftShader table above (`.tmp/r10/ab2-ss-R4.json`) |

## CORE review fixes (LEAD, 2026-10-03, SPEC v1.3)

The core reviewer of record filed one major and eight minor findings (CORE-R1…R9). Each was reproduced on the previous build (`0.1.0-346d90c8`, kept as `.tmp/fix/old.html`) before the fix and checked again after it. Side-by-side pictures are old on top, new below. Reproduction scripts are in `.tmp/fix/`.

| Finding | Fix | Proof (before → after) |
|---|---|---|
| **R1 (major)** Fog washed out the middle distance | The world meshes one ring beyond the render distance (`RENDER.MESH_MARGIN` 1; unload moves to R + 5). Every gap of the circular mesh radius now lies beyond `fogFar` for R 3–12. Land fog is linear from 0.8 · `fogFar` (it was 0.6, eased). Underwater and lava fog keep the eased curve. | At R 6 the fog runs 52.8–88, eased, versus 70.4–88 linear. `cored-fog`: every gap is 100 % fogged and the ring past R is meshed (36/36). Pictures: `.tmp/fix/cmp-R6-air.png` (mountain tops crisp), `.tmp/fix/cmp-R8-alt125.png`. Draw calls at R 6: 156 → **189** (`cored-perf`, budget 300). R 8: 254 → 259 (`perf`), up to 341 in the playtest. SwiftShader R 4: 85 → 100 draws, 45 → 41 fps. |
| R2 Torch-lit walls showed sharp triangle creases | Quad flip (`src/world/mesher.js`): the diagonal runs through the corner pair that differs most, so one bright or dark corner spreads over both triangles. Ties keep the classic rule. True per-pixel corner blending stays a P2 option, because it changes the mesh contract. | New unit test: one torch-lit corner sits on the shared diagonal (fails on the old rule). The old AO flip test still passes. Pictures: `.tmp/fix/cmp-creasew-1.png` and `-2.png` (white-wool torch room). The bright wedge beside the floor block is gone. |
| R3 Leaves too opaque | Fancy leaves are 40 % see-through (spruce 36 %), up from 17–20 %. Holes cluster around the leaf clumps; alpha stays 0/255 with the colour fill. | `texstats`: oak 44 → 102, birch 51 → 102, spruce 51 → 92 transparent texels of 256. Pictures: `.tmp/fix/tex-preview-after.png`, `.tmp/fix/cmp-leaves-2.png` (trunk visible through the canopy), `cmp-leaves-3.png` (far trees keep their shape). |
| R4 A quick tap could break a block after a stall | `src/player/input.js` measures the gesture with the events' own timestamps. The hold timer now only marks a pending hold, and the next tick presses attack. A late timer (a stall) waits 120 ms, so a queued quick release stays a tap. | Old build (`node .tmp/fix/r45.mjs`): 4/4 taps broke a block when frames ran between the timer and the release, and taps were lost otherwise. New build: 0 broken, taps recognised. New smoke `coree-tap-stall`: 3/3 placed, 0 broken in both orders. A real 520 ms hold still breaks. Passes on GPU, SwiftShader and touch. |
| R5 `unmeshedWithin` stale after a teleport | It now counts around the player's current column instead of the cached streaming centre. | Old: 0 right after a 3000-block teleport, with 149 columns missing. New: 149, then 0 after 413 ms. `corec-stream-leak` asserts it (81 unmeshed right after a 320-block jump). |
| R6 Water tiled as a high-contrast grid | Narrow, low-contrast water palette with fewer and softer crests that move each frame. | Frame-0 brightness spread 24.9 → **8.4**. Picture: `.tmp/fix/cmp-shore.png`. The water still animates (playtest: 5181 changed pixels). |
| R7 Ragged spikes at the kid outline's corners | Kid outline edges are screen-space capsules with round caps, white over black, clipped at the near plane. | Picture: `.tmp/fix/z-outline-corner-new.png` against `.tmp/review/z-outline-corner.png`: the joints are clean, and an edge seen end-on becomes a round dot. `cored-outline` passes: thick white over black, 2322 white pixels. |
| R8 Small biomes; desert next to snow | Climate scale 1/520 → **1/800** (the SPEC said about 1/700). Hills cool only outside hot climates. The mountain snow line rises in warm climates (`102 + 40 · max(0, temp)`). | `.tmp/fix/biomeadj.mjs` over 3072² blocks × 5 seeds: desert cells within 16 blocks of snow 116–417 → **0–4**. New unit test `coreb climate` fails on the old worldgen (a snow-capped peak beside a desert) and passes now. Still 8–9 biomes within 256 blocks. **Side effect:** spawns move (seed 12345 is now at 90.5, 53, −64.5, in a taiga by the sea), so `tools/playtest.mjs` now takes off from open sky and looks for a cave near the spawn when the flight lands at sea. `coreb surface` checks two regions for decoration. |
| R9 Night looked olive-green | The lifted sky light is tinted toward moonlit blue as daylight falls, about `(0.82, 0.95, 1.55)` at the same brightness. The tint fades inside a torch pool, so block light stays warm. | Flat-world grass at 18000: (23, 38, 14) → **(19, 36, 22)**, about the same brightness. Pictures: `.tmp/fix/cmp-flat-night.png` and `.tmp/fix/cmp-torch-night.png` (a warm pool inside a cool night). Night luma in `cored-daynight` is 13, and the playtest's night is still much darker than day (23 against 140). |

**Commands and results** (`main` working tree at build `0.1.0-b7eb8e11`, RTX 3080 Ti headless Chrome unless noted):

| Command | Result |
|---|---|
| `npm run build` | `0.1.0-b7eb8e11`, root `index.html` 807 KB |
| `npm run test:unit` | **87 / 87 pass** (adds `mesher: a single bright corner…` and `coreb climate…`) |
| `npm test` | **57 PASS**, 3 PENDING (`mobs`, `survival-fall`, `save-load`), 2 SKIP (touch only); adds `coree-tap-stall` |
| `node tools/smoke.mjs --swiftshader --tag ss` | 57 PASS, 3 PENDING, 2 SKIP (R 4: 100 draws, 41 fps; R 6: 189 draws, 29 fps) |
| `node tools/smoke.mjs --file index.html --tag prod` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --http --tag http` | 57 PASS, 3 PENDING, 2 SKIP |
| `node tools/smoke.mjs --touch --tag touch` | 58 PASS, 4 PENDING |
| `node tools/playtest.mjs --file index.html` | **39 / 39**, median 144.9 fps, p99 7.1 ms, max 27.9 ms, play to ready 0.31 s, spawn area 0.59 s |
| `node tools/playtest.mjs --file index.html --swiftshader` | **39 / 39**, median 71 fps, p90 20.9 ms, at most 159 draws |

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
- *(fixed, CORE-R2 recheck, SPEC v1.4)* Smooth light and AO are blended bilinearly per pixel from each quad's four corners, so torch-lit faces have no triangle creases. It costs 4 bytes per chunk vertex (124 MB of chunk geometry at R 12, 35 MB at R 6) and 5–11 % on the SwiftShader proxy.
- *(fixed, CORE-R10; corrected CORE-R11, SPEC v1.5)* The extra mesh ring beyond R is not drawn where it is fully fogged and the sky behind it is the fog colour (fog cull). The picture is unchanged and distant fogged mountains stay. Draw calls at R 6: 183 (157 when v1.4 also hid those silhouettes; budget 300).
- Sky objects (FX lane, not merged): SPEC v1.5 asks FX to draw no sun, moon or stars at or below the horizon and to fog clouds with the shared uniforms; otherwise the fog cull could reveal them behind hidden far terrain. Check this when FX is merged (`cored-fog` and `.tmp/r11/v3-cullexact.mjs`).
- *(fixed, CORE-R1)* Fog haze: the world meshes one ring beyond R and the fog is linear from 80 % of the radius. This costs about 20–35 % more draw calls (189 at R 6, budget 300).
- *(fixed, CORE-R4)* A quick kid tap during a main-thread stall stays a tap (event timestamps, hold committed on the next tick). Pinned by `coree-tap-stall`.
- Biome tint (D4) is still a single grass and leaf colour; taiga and snowy ground use the plains green (CORE-R8 note, P2).
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

## Whole-game acceptance (SPEC §13.1)

Verified on 2026-10-04 in integration with `--strict` (no stub left) on build `0.1.0-84771e68`; evidence in the FEATURE integration section above. A real touchscreen, trackpad and Sticky Keys, and listening to the sounds, still need a person (Known issues).

- [x] 1. Builds; runs from `file://` and over http with the service worker; zero console errors; no third-party network. (`--strict` file:// and `--strict --http`: 160 PASS with page-errors PASS; playtest "no page, console, network or game errors".)
- [x] 2. Kid default path with no reading: Play → creative world in under 4 s → arrows walk and turn, tap places, hold breaks, F flies, H goes home, E opens the picker and red wool goes into the hotbar. (`playtest` 40/40, `kid-play` 41, `inv-play` 48, `menus-inworld` world in 0.3–0.4 s, `lead-play` kid section.)
- [x] 3. Block-loop fidelity: walk about 4.3 b/s, jump apex about 1.25, survival break times, tool wear, drops with magnet and pop. (`coree-*`, `move-jump` 4.18 b/s and apex 1.252, `mobs-pickup` in every pop direction.)
- [x] 4. World: biomes, sea, caves, ores, trees; smooth torch light with no seams at column borders; the day/night cycle never forces a remesh. (`coreb-*`, `corec-*`, `cored-daynight`.)
- [x] 5. Animals: natural spawns that never pile up; breeding with hearts and babies; shear and dye sheep; tame a wolf (sit, follow); animals can't die in kid mode; pens hold animals (P1). (`mobs-*` 16, `mech-fence-pen`, `mobs-play` 68, `lead-starter-animals`.)
- [x] 6. Survival: 2×2 and 3×3 crafting with the recipe book, furnace, chest; health and hunger; fall damage; death → respawn with keep-inventory. (`inv-*`, `survival-fall`, `menus-death`, `inv-play`, `lead-play` survival section.)
- [x] 7. Mechanics: TNT chain, falling sand, doors, bed sets spawn (nap in kid worlds), water flow, farming with bone meal. (`mech-*` 15, `mech-play` 57/57, `lead-play` TNT + Undo and the bed.)
- [x] 8. Persistence: autosave and reload restore blocks (including columns that were unloaded), inventory, chest contents, animals, time and position. (`save-load`, `menus-reload-persist`, `menus-autosave`, `inv-chest-persist`, `mobs-persist`, `menus-inworld` with a real reload.)
- [x] 9. Performance within SPEC §12; SwiftShader at R 4 stays at 10 fps or more; no streaming holes while flying. (playtest median 144.9 fps, p99 7.1 ms; SwiftShader `perf` 43 fps at R 4; `corec-flight-stream` backlog 0.)
- [x] 10. Kid accessibility: target sizes, no stuck keys, no Shift binding, no trackpad hotbar spin, no page zoom, exit guards. (`menus-sizes` at 4 window sizes, `coree-keys-blur`, `coree-wheel`, `kid-*` guards, touch column clear of the HUD.)

## Smoke scenarios

| Scenario | Requires | Last result (2026-10-03 `474e798`; rows marked 2026-10-04 on `0.1.0-84771e68`) | Evidence |
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
| mobs | mobs, physics, world | **PASS** (2026-10-04) | `.tmp/smoke-v-strict-mobs.png` |
| survival-fall | survival, player, physics | **PASS** (2026-10-04; the fall costs 7 HP, judged by `player:hurt`) | |
| save-load | save, world | **PASS** (2026-10-04) | |
| touch-controls | touch, input (`--touch`) | **PASS** (2026-10-04, touch run) | `.tmp/smoke-v-touch-touch.png` |
| context-loss | renderer | **PASS** | |
| perf | — | PASS (234 draws at R 8, 144 fps; SwiftShader 80–91 draws at R 4; meshes one ring beyond R since CORE-R1, fully fogged columns not drawn since CORE-R10) | `.tmp/smoke-report.json` |
| lead-events-roundtrip | — | PASS | |
| lead-unload-persist | — | PASS (real world) | |
| lead-break-contract | — | PASS (real interaction) | |
| lead-batch | — | PASS (sky 13 under the 3×3 roof) | |
| lead-entity-streaming | — | PASS | |
| lead-testapi | — | PASS | |
| corea-* (3), coreb-* (4), corec-* (8), cored-* (11), coree-* (14, one of them touch-only) | lane | all PASS on 2026-10-04 (file:// strict, http strict, SwiftShader, touch) | `.tmp/smoke-v-*.png` |
| inv-* (12), menus-* (16), audio-* (13), fx-* (12), mobs-* (16), mech-* (15), kid-* (14) | lane | all PASS on 2026-10-04 (file:// strict, http strict, SwiftShader, touch; touch-only ones in the touch run) | `.tmp/smoke-report-v-*.json` |
| lead-* (12: the 6 contract scenarios + `lead-kid-hold-entity`, `lead-head-in-block`, `lead-pause-no-redraw`, `lead-new-world-reset`, `lead-starter-animals`, `lead-entity-through-grass`) | various | all PASS on 2026-10-04 | `.tmp/smoke-v-strict-lead-*.png` |

## Open decisions (SPEC §14)

- **D1 TNT on by default:** the parent decides. It is currently on, kid-safe and undoable.
- **D14 lava pools in deep caves (y 6 and below):** on, from CORE-B. The parent decides; `LAVA_LEVEL = 0` in `src/world/worldgen.js` removes them.
- **D15 kid flight take-off hop:** on, from CORE-E (`KID_FLY_LIFT`).
- **D4 baked biome colours:** P2 revisit.
- **D5 texture layer budget:** 238 of 256, now enforced by the unit test.
- **D11 no Shift in the kid scheme:** fly down is C / Z / ▼; parent tip covers the Sticky Keys shortcut.
- **D12 survival item sources:** gravel 5% bone and leaves 2% string are original twists; TNT stays creative-only until creepers (P1).
- **D13 recipe book:** P0 for survival worlds.
- **D16 starter animals (2026-10-04, LEAD):** every new world gets one small group each of cows, sheep, pigs and chickens 10–28 blocks from the spawn, inside the kid border. On; the parent can only change it in code (`STARTER_TYPES` in `src/entities/spawning.js`).
- **D17 default skin (2026-10-04, LEAD):** an original yellow shirt and teal trousers replace the famous default palette.
- **Lane decisions waiting for the parent / a reviewer:** MECH paintings pick a random fitting size (favouring bigger) and an empty-hand tap takes one down in kid creative; sugar cane and cactus grow by a 1/16 roll per random tick; leaves decay 6 steps from a log; creative buckets swap in the hand; survival sleep uses `setTime(0)` (the moon phase does not advance). MOBS: chunk-generation spawns and idle AI use per-column / per-mob random streams; Space also dismounts a pig or boat. MENUS: the pause screen shows Save & Title as a door and Home as a house; the title backdrop is 2D parallax art.

## Handoff log

<!-- newest first: date · lane · what changed · commands run + results · remaining · blockers -->
- 2026-10-04 · LEAD · FEATURE integration: merged lane/inv, menus, audio, fx, mobs, mech, kid into `main` one at a time with `--no-ff` (no conflicts); fixed every reported cross-lane defect and the integration breaks after each merge; found and fixed more by playing (starter animals near the spawn, taps through grass, animals stepping aside, names, an original default skin, clouds against the fog cull); new `tools/lead-play.mjs`; SPEC v1.6 · build `0.1.0-84771e68` 1275 KB; unit 231/231; `--strict` 160 PASS / 5 SKIP; `--strict --http` 160 / 5; SwiftShader 160 / 5; touch 165 PASS; inv-play 48 + touch 34 (2 SKIP); kid-play 41; mech-play 57/57; mobs-play 68 + touch 5; audio-inworld 46; menus-inworld 21/21; lead-play 48/48; playtest 40/40 · next: a person plays it on the real laptop (touchscreen, trackpad, sound), then a FEATURE review · blockers: none
- 2026-10-03 · LEAD · Core review second recheck: CORE-R11. The fog cull is now picture-exact: it hides fully fogged far sections per pass only where the sky behind them is the fog colour, so distant fogged mountains stay. Also added `chunkmerge.fogCutFrom`, `SKY_GLOW_FLOOR` shared with the sky shader, `getStats().fogTrimmed`, a silhouette view in `cored-fog`, and a playtest take-off centring fix; SPEC v1.5 · unit 90/90; smoke 57 PASS / 3 PENDING / 2 SKIP on file://, http, SwiftShader and the minified file; touch 58 PASS / 4 PENDING; playtest 39/39 on GPU and SwiftShader; cull off/on 0 changed pixels in 83 views (53 changed before); SwiftShader R 4 same views 44.7 / 68.9 / 131.2 → 42.0 / 64.5 / 126.3 fps (the air view has identical draws and is run noise) · next: reviewer recheck of R11, then merge the FEATURE lanes (FX must keep the SPEC v1.5 horizon contract) · blockers: none
- 2026-10-03 · LEAD · Core review recheck: CORE-R10 fog cull (columns wholly beyond the fog are not drawn; the CORE-R1 ring stays meshed), CORE-R2 per-pixel bilinear corner light and AO (mesh contract: `corner` array, flag bits 7–8, chunk geometry without `aLight`); SPEC v1.4 · unit 89/89; smoke 57 PASS / 3 PENDING / 2 SKIP on file://, http, SwiftShader and the minified file; touch 58 PASS / 4 PENDING; playtest 39/39 on GPU and SwiftShader; SwiftShader R 4 same views 42.2 / 55.9 / 87.2 → 44.8 / 65.7 / 130.7 fps · next: reviewer recheck of R10 and R2, then merge the FEATURE lanes · blockers: none
- 2026-10-03 · LEAD · Core review fixes CORE-R1…R9: mesh one ring beyond R with a crisp linear fog, a quad flip that spreads a single bright corner, more open leaves, calmer water, kid taps classified by event time, `unmeshedWithin` after a teleport, capsule kid outline, 1/800 climate with no desert beside snow, moonlit night tint; SPEC v1.3; playtest robust to the moved spawn · unit 87/87; smoke 57 PASS / 3 PENDING / 2 SKIP on file://, http, SwiftShader and the minified file; touch 58 PASS / 4 PENDING; playtest 39/39 on GPU and SwiftShader · next: reviewer recheck of R1–R9, then merge the FEATURE lanes · blockers: none
- 2026-10-03 · LEAD · CORE integration: merged lane/corea, coreb, corec, cored, coree into `main` one at a time (build, unit and smoke after each); fixed the LEAD light checks, the CORE-C debug view, the light curve, SwiftShader determinism and settle, the new-world hotbar slot, the outline capture and the entity test cleanup; SPEC v1.2; added `tools/playtest.mjs` · unit 85/85; smoke 56 PASS / 3 PENDING / 2 SKIP on file://, http, SwiftShader and the minified file; touch 57 PASS / 4 PENDING; playtest 39/39 on GPU and SwiftShader · next: merge the FEATURE lanes (INV, KID, MECH, FX first: HUD, touch, doors, sky objects), then `--strict` · blockers: none for CORE; the MOBS, MENUS and AUDIO branches had no commits yet when CORE was merged
- 2026-10-03 · LEAD · v1.1: applied the independent review (lane worktrees + handoff files, persistence invariant, block entity in `block:broken`, single drop owner, undo from `block:changed` with action ids, `voidRescue`, entity streaming, batch edits, test API additions, 8 picker tabs, survival item sources, mob movement rules, one draw per mob, workers P0 + kid flight cap, no Shift, kid outline, fences/gates/panes, boats owner, bedrock rule, minor data and spec fixes) · build 567 KB, unit 13/13, smoke 14 PASS / 7 PENDING / 1 SKIP, http, swiftshader+touch and production-file runs clean · next: integrator commits the foundation, then dispatches CORE lanes A–E in worktrees · blockers: foundation commit (not done in this pass by instruction)
- 2026-10-03 · LEAD · foundation, SPEC v1, stubs, harness · build, unit (10/10) and smoke (green with pending) · next: dispatch the CORE lanes A–E in parallel · blockers: none
