# Handoff - inv

Branch `lane/inv` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-inv`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-04 · Judge round 1 fixes (KID-10, ROB-6, ROB-7, POL-2, POL-13)

`git merge main` fast-forwarded to `7f105b0`. All changes in INV files.

| Finding | Fix | Verified |
|---|---|---|
| KID-10 "64" on every creative slot | `showsCount` in `inv_slotview.js`: in creative a full stack shows no number (partial stacks and survival still do); HUD repaints the hotbar on `mode:changed` | creative hotbar `["","","","12","",...]`, survival `["64","64","64","12","16",...]`; smoke `inv-hud` asserts both |
| ROB-6 / POL-13 chest close X over slot k8 | Chest panel gets a header strip (small chest picture) the X overhangs; `.inv-screen` padding keeps the X's 18 px overhang on screen | judge `covered.mjs` at 1280x720, 1366x657, 1024x500, 1920x969, 1366x768, 667x375, 900x600: no covered slot; smoke `inv-chest-unload` asserts it |
| ROB-7 landscape phone 667x375 | `slotSizeFor()` picks the largest slot size (>= 30 px, never above the GUI size) for which panel + recipe book + close fit; picker hotbar and tabs shrink to the panel width and keep clear of the X | judge `inv-sizes.mjs` (9 sizes incl. 667x375): nothing off-screen; picker hit-test at 667x375 .. 1920x969: nothing covered. Side-by-side stacking was not needed: at 667x375 stacked gives 35-44 px slots vs 32 px side by side |
| POL-2 damage flash empties the heart bar | New sprites `heart_full_flash` / `heart_half_flash` (red heart, white outline); `heart_flash` only for empty containers | per-frame sample during the flash: `heart_full_flash,heart_full`, never `heart_flash`/`heart_empty` for a full heart; smoke `inv-hud` asserts it |

Commands: `node build.mjs --dev --out .tmp/build-inv` ok; `npm run test:unit` 233/233 (2 new: slot sizing, counts);
`node tools/smoke.mjs --tag inv`: all `inv-*` PASS (first full run `{"PASS":160,"SKIP":5}`; a rerun hit `ENOSPC` in
`cored-render` because drive C: was full, not a game failure).

## 2026-10-03 · Phase 2: merged the real core, verified in real gameplay

`git merge main` (no conflicts; LEAD files untouched) -> merge commit `c26971e`. INV had no stub fallbacks to remove
(no `registerStub`, no collision/mob fallbacks in INV files). Re-merged `main` at `f50e9b5` (playtest + brightness
curve) after the fixes -> `2af3be7`, clean; unit 101/101, INV smoke `{"PASS":11,"PENDING":2}`, `inv-play` `{"PASS":47,"SKIP":4}`.

### Fixes from in-world play (all in INV files)

| What a child would have seen | Fix |
|---|---|
| `inv-blockuse` FAIL after any earlier scenario: the test aimed with `lookAt` + `press('use')`, but the kid scheme keeps aiming at the last mouse hover (the hotbar), so "use" went elsewhere | Scenario rewritten to drive real input: mouse tap on the table (kid survival), tap on a chest with an empty hand (kid creative: opens, not broken), right click with pointer lock (classic) on a furnace, close with the big red button / Esc |
| 10 air bubbles shown on dry land in every survival world | Bubble icons set `visibility: visible`, which overrides the hidden row. Now `''` (inherit). Smoke `inv-hud` asserts no visible stats icons in creative and no bubbles once the eye leaves the water |
| Iso block icons drawn at 48 px from 32 px atlas cells (1.5x, lumpy pixel rows) and small in the 72 px hotbar / 87 px picker tiles | `iconPx` prefers multiples of 32 (pixel-exact for every icon): hotbar and picker icons are now 64 px. Inventory slots at GUI 3 (54 px) still use 48 (see CORE-A note below) |
| "Needs a crafting table" toast covered the top of the recipe book (exactly the crafting-table picture the child needs next) and stayed over the 3x3 table screen after walking to the table | Under a screen the toast sits in the free strip below the panel, and goes away when that screen closes |
| Recipe book hid recipes while the child was holding the ingredient on the cursor | Book counts the held stack (a tap already returns it to the bag first) and refreshes when the cursor changes |
| Item name ("Torch") stayed over the hotbar after scrolling to an empty slot | Selecting an empty slot hides the name |
| A neighbour's stack count could hide under the enlarged yellow selection frame | Counts of non-selected slots draw above the frame |
| Classic: after closing the inventory with E the mouse was free; one more click on the world was needed (Java grabs it back) | Closing an INV screen in the classic scheme re-requests pointer lock when a user gesture is active and no other screen took over (`relockSoon` in `inventory_ui.js`) |
| `inv-furnace` flaky in touch runs (about 1 in 2) | Test race, not a game bug: with 1 coal the furnace may light on a real-time tick (eating the coal, Java behaviour) before the assert reads the fuel slot. Test now gives 2 coal |

### In-world verification (`tools/inv-play.mjs`, real terrain seed 12345, real mouse / touchscreen input)

New script `node tools/inv-play.mjs [--touch] [--size WxH] [--only creative,survival,classic]` drives the game like a
child: taps the backpack, picker tabs/tiles, hotbar, recipe pictures, slots and blocks in the world (screen pixel from
`worldToNdc`); it only uses the test API for "the child chopped a tree / mined stone" (`give`, item pickups are the MOBS
lane), time of day and fast-forwarding furnaces. Screenshots: `.tmp/play/inv-*.png` (prefixed `touch-`, `1366-`,
`1920-`, `1024-` for the other runs). Each screenshot was looked at.

Results (1280x720 mouse, `--touch`, 1366x768, 1920x1080, 1024x640): every run `{"PASS":47,"SKIP":4}`, 0 page errors
(touch run: the classic block is skipped).

```
PASS  backpack tap opens the picture picker                      (02-picker-building.png)
PASS  picker tiles draw real icon canvases  28 icons, sizes 64   (03-picker-<tab>.png, 8 tabs)
PASS  picked items land in the hotbar                            (04-picker-picked.png)
PASS  tap outside the picker closes it
PASS  hotbar + backpack taps never place or break blocks  placed 0->0, broken 0->0   (verification item 8, mouse + touch)
PASS  tapping a hotbar slot selects it                           (05-hotbar-selected-name.png)
PASS  tap on the ground places the crafting table                (06-table-placed.png)
PASS  tap on a crafting table (block in hand) opens the 3x3 screen ...and does not stack a block on top (07)
PASS  no air bubbles on dry land                                 (10-survival-hud.png)
PASS  backpack opens the survival inventory                      (11-inventory-with-logs.png)
PASS  recipe book shows planks with logs in the bag
PASS  4 taps on planks -> 16 planks                              (12-planks-crafted.png)
PASS  sticks + crafting table from the 2x2 book
PASS  pickaxe shows "needs the table" in the 2x2                 (13-needs-table-toast.png)
PASS  crafting table landed in the hotbar / survival tap places the table / tap opens the 3x3 crafting screen (14)
PASS  wooden pickaxe from the 3x3 recipe book                    (15)
PASS  furnace + stone pickaxe from the book                      (16, 17)
PASS  furnace placed / tap opens the furnace                     (18)
PASS  furnace lights (furnace_lit) when iron + coal go in        (19-furnace-burning.png: flame + arrow fill)
PASS  3 iron ingots smelted / take the ingots / ingots end up in the bag after closing (20)
PASS  lit furnace emits block light  {"sky":15,"block":12}       (21-furnace-glow-night.png, verification item 7)
PASS  furnace goes back to unlit when the fuel is used up, light gone  furnace_lit -> furnace {"block":0} (22)
PASS  chest placed / tap opens the chest / chest keeps what we put in  oak_planksx7   (23, 24)
PASS  holding on the chest breaks it / chest contents are dropped (25; contents reach dropItem, verification item 2 half)
PASS  40 furnaces burning at once  40 lit                        (26)
PASS  classic: click locks the pointer / crosshair shown / key 3 selects slot 3 / wheel selects the next slot (30)
PASS  classic: no item name over an empty slot
PASS  classic: E opens the inventory / pointer unlocked while open / right click picks up half (31)
PASS  classic: E closes the inventory / held stack returned to the bag / pointer re-locks / Esc closes
SKIP  dropped stacks become item entities (pop + magnet)  items lane is still a stub
SKIP  hearts/hunger move from real damage/hunger  survival lane is still a stub
SKIP  Q-drop throws the item forward  items lane is still a stub
SKIP  chest survives save + load  save/menus lanes are still stubs
```

Phase-1 verification list status: 1 block-use from real taps/clicks PASS (kid creative chest opens, not broken);
2 container drops PASS up to `dropItem` (entities need MOBS `items`); 3 Q-drop PENDING (MOBS `items`); 4 chest
save/load PENDING (SAVE + MENUS); 5 real icons PASS (64 px hotbar/picker crisp; 48 px at GUI 3 see CORE-A note);
6 HUD with real survival values PENDING (SURVIVAL/MOBS; HUD rows verified with set values); 7 `furnace_lit` glow +
instant swap PASS; 8 HUD taps never reach the world PASS (mouse + touch); 9 touch overlay overlap PENDING (KID/TOUCH
stubs); 10 spawn eggs in the Animals tab PENDING (MOBS registers entity types; tab currently shows food/dyes/tools only).

Performance with the real world loaded (render distance default, 1280x720, GPU headless Chrome, frame-capped 144):
creative HUD `fps 143.9 frameMs 6.95 workMs 1.1-1.7 tickMs 0.2 drawCalls ~190`; picker open `drawCalls 183-199,
dom 241`; survival HUD `workMs 1.5`; 40 burning furnaces `tickMs 0.16-0.18`. INV adds no draw calls (DOM HUD,
painted only on change) and no measurable tick cost.

### Commands and results (phase 2)

- `node build.mjs --dev --out .tmp/build-inv` -> `(1656 KB, dev)` OK
- `npm run test:unit` -> `ℹ tests 101` `ℹ pass 101` `ℹ fail 0`
- `node tools/smoke.mjs --tag inv` (all scenarios) -> `{"PASS":64,"PENDING":5,"SKIP":2,"FAIL":2}`; the 2 FAILs are
  core (`cored-daynight`, `corec-stream-leak`, both flaky, see below; both PASS re-run in isolation, `cored-daynight`
  fails about 1 in 2). INV scenarios only: `{"PASS":11,"PENDING":2}` (mouse) and `{"PASS":11,"PENDING":2}` (touch):
  ```
  PASS inv-hud  PASS inv-creative-pick  PASS inv-craft-planks  PASS inv-slot-clicks  PASS inv-recipe-book
  PASS inv-table-3x3  PASS inv-furnace  PASS inv-chest-unload  PASS inv-container-drop  PASS inv-blockuse
  PENDING inv-chest-persist - stub lanes: save, menus     PENDING inv-q-drop - stub lanes: items
  ```

### Cross-lane defects (not edited; for the owners)

1. **CORE-D test hygiene - `tools/scenarios/cored.mjs` `cored-entity` (~L384-395)** adds a red-tinted 4-box mob mesh
   and an `oak_log` block model with `R.addObject` and never removes them. They stay in the renderer for every later
   world, so every later flat-world screenshot (all `inv-*`, `lead-*`) shows floating red boxes and a log near spawn
   (`.tmp/smoke-inv-inv-hud-survival.png`). Fix: `R.removeObject(mob); R.removeObject(block)` at the end of the
   scenario (and, if added objects are meant to be world-scoped, clear them on `world:exit`).
2. **CORE-D/C flaky `cored-daynight`** "setTime never remeshes": fails about 1 in 2 when other scenarios ran first
   (`merges 915 -> 917`, `7596 -> 7693`; `sets` unchanged), i.e. background mesh merges still settling when the
   "before" snapshot is taken. Fix: wait until the mesh/merge queue is idle before the snapshot. `corec-stream-leak`
   failed once in the full suite (`geometries 128 -> 145`) and passed twice alone - same kind of settle race.
3. **CORE-E test API, `src/core/testapi.js` `lookAt` / `press('use')`**: in the kid scheme the aim follows the last
   mouse hover (`input.aimActive` stays true), so `lookAt(...)` + `press('use')` acts on whatever the mouse last
   hovered (e.g. the hotbar), not the crosshair. Real play is fine (a tap aims). Repro: `inv-hud` (mouse click on the
   hotbar) then old `inv-blockuse` -> target null. Fix: `lookAt`/`setLook` set `input.aimActive = false` (or aim to
   0,0), or document that tests must tap.
4. **SURVIVAL (stub) - new worlds keep the previous player's health/food/air/XP** (`inv-hud` sets health 3 / food 13
   / xp 3; the next `startWorld` still shows 3.5 hearts). `player.spawn` resets position only. The SURVIVAL lane's
   new-world path must reset `health/maxHealth/food/saturation/air/xpLevel/xpProgress`.
5. **CORE-A (cosmetic)**: icon atlas cells are 32 px, so at GUI scale 3 (54 px inventory slots, 48 px icons) iso block
   icons are scaled 1.5x with uneven pixel rows (zoom of `.tmp/play/inv-02-picker-building.png` before the INV fix).
   Suggest `icons.element(key, px)` painting iso blocks natively at 48 px (or a 48 px atlas) for that case.

### Remaining gaps

- Waiting on other lanes: item entities from container drops / Q-drop (MOBS `items`), real hearts/hunger/XP (SURVIVAL,
  MOBS), chest save + load (SAVE, MENUS), touch-overlay overlap with the hotbar (KID/TOUCH), spawn eggs (MOBS).
- LEAD request 1 (Steve-like default skin palette on the inventory doll) and 2 (XP award for smelting) still open.
- Kid survival: breaking a chest by hand takes ~4.1 s of holding (Java hardness; CORE-E). Long for a 5-year-old -
  KID lane may want a kid-mode break-speed boost.
- Touch: the "hover" white overlay stays on the last tapped slot until the next tap (Java-like on desktop; harmless).

## 2026-10-03 · INV P0 complete, P1 armour + XP bar done

### What changed

Stubs deleted: `invui`, `hud`, `crafting`, `furnace` (no `registerStub` left in INV files).

| File | What |
|---|---|
| `src/inventory/crafting.js` | Real matcher (SPEC §4.6): shaped trimmed to bbox, anywhere in the grid, horizontal mirror, outside cells must be empty; shapeless exact multiset (backtracking) with `#tags`; 2x2 limit; first match wins; `consumeCraft` with `REMAINDERS`; `craftableRecipes` (with `missing`); `smeltingResult`; `fuelTicks`. Additive exports: `ingredientMatches`, `recipeFits`, `recipeGridSize`, `recipeSpecs`, `planRecipe` (concrete grid for the recipe book). |
| `src/inventory/containers.js` | `createChest`, `createFurnace`, `tickFurnace` (Java furnace logic: light only when something can smelt, 200 ticks per item, progress reset when blocked, -2/tick when the fire is out, lava bucket leaves a bucket, output stack limits, `furnace` <-> `furnace_lit` swap keeping facing with `keepBlockEntity: true`, emits `smelt`). Additive: `CHEST_SIZE`, `CONTAINER_BLOCKS`, `normalizeContainer`, `containerStacks`, `furnaceRecipe`, `setFurnaceLit`, `furnaceProgress`. |
| `src/inventory/slots.js` (new) | Pure Java slot rules: left click pick/place/merge/swap, right click half/one, drag distribute (left even split, right one each), shift quick-move (merge first, then empties), double-click gather, slot filters/limits/output slots. |
| `src/inventory/inventory.js` | Additive only: `setArmor(k, s)`, `armorPoints()`, `notify()`. |
| `src/ui/hud.js`, `hud.css` | Hotbar at `--hotbar-slot` (kid 72 px at 1280x720), selected = 4 px yellow + 1.15x + 6 px lift, counts, durability bars (green->red), tap selects on `pointerdown`, backpack button (72 px, idle nudge while the main inventory is empty), name popup (2 s, fades in the last 0.5 s, optional local-voice speech when `speakNames`), survival rows: 10 hearts (shake at <= 4 HP, flash on `player:hurt`, max 2 flashes in 0.45 s), 10 shanks right-aligned (shake when starving), armour row (P1, only when armour > 0), air bubbles (only while `eyeInWater`), XP bar + level (P1); classic crosshair (15 GUI px, `mix-blend-mode: difference`); `toast()` + `toast` event (picture + text, 2 s, Z.TOAST). HUD hides while a container screen is open. Hotbar keys / wheel select only outside containers; inside they go to `invui.hotbarKey`. No per-frame DOM work: rebuild on resize/settings, repaint on `inventory.version` / changed player fields only. |
| `src/ui/inventory_ui.js` | System `invui`: registers `inventory`, `creative`, `crafting`, `furnace`, `chest` with `game.ui`; `registerBlockUse` for `crafting_table`, `furnace`, `furnace_lit`, `chest`; furnace ticking for every loaded furnace block entity (20 TPS, screen open or not; `setBlockEntity` marks the column dirty); drops chest/furnace contents from `block:broken.blockEntity` with `dropItem` (both modes); closes a screen whose block was broken; Q-drop (classic only, Ctrl = whole stack; over a hovered slot inside a container too); serialize = inventory JSON + `pending` (open crafting grid + cursor, re-added on load). New world resets the selected slot to 0. |
| `src/ui/inv_screens.js` | Container screens. Inventory: armour column (faint armour pictures when empty), original doll (skin colours from `settings.skin`), 2x2 grid -> output, 27 + 9. Crafting table 3x3 with big output. Furnace: input / flame (fills from `burnTicks/burnTotal`) / fuel (faint coal picture; accepts fuel + bucket) / arrow (fills from `cookTicks/200`) / output (take only). Chest: 27 slots in a wooden frame + player. **Recipe book** (survival worlds, both crafting screens): paged picture grid (64+ px tiles, gentle breathing animation, ◀ ▶ paging, no scrolling), craftable now first, then "needs the table" recipes dimmed with a table badge (tap -> shake + toast with the crafting-table picture). Tap = return the grid, fill it from the inventory, show the ingredients fading in the grid, craft one into the inventory with a fly-to-slot animation. Close returns grid + cursor (overflow is tossed with `dropItem`). Big red close button (64 px kid). Kid tap outside the panel: return the held stack, else close; classic: drop the held stack. |
| `src/ui/inv_picker.js` | Kid creative picker: 8 picture tabs (PICKER_TABS icons, 78 px), 72-96 px tiles (87 px at 1280x720, 40 per page; 77 per page at 1920x1080), big ◀ ▶ arrows + page dots, hotbar row (tap = choose the slot to fill; keys 1-9 too), tap tile = 64 (or the item's max stack) into the selected slot + fly animation + `ui:click`, trash (empties the selected slot), small backpack button = grown-up inventory. Tap on the dim background closes. Hostile eggs hidden unless `rules.hostileMobs`; eggs hidden until MOBS registers the entity type (`entities.types.has`). |
| `src/ui/inv_slotview.js` | `paintSlot` (cached per slot key), `SlotController` (pointer events incl. touch via `elementFromPoint`, held stack follows the pointer, drag highlight, keys 1-9 swap with the hovered slot). |
| `src/ui/inv_sprites.js` | Original pixel sprites (hearts, shanks, bubbles, armour, flame, arrow, backpack, trash, book, close, table badge) drawn with `fillRect` only. |
| `src/ui/inv.css` | Screen styles (uses the shared `.bc-panel` / `.bc-slot` kit). |
| `test/inv.test.mjs` | 16 unit tests (below). |
| `tools/scenarios/inv.mjs` | 12 `inv-*` smoke scenarios (below). Real mouse/touch input at slot rectangles. |

### Commands and results (2026-10-03, in the worktree)

`node build.mjs --dev --out .tmp/build-inv` -> `[build] 0.1.0-…-dev … (1191 KB, dev)` OK.

`npm run test:unit` -> `ℹ tests 29` `ℹ pass 29` `ℹ fail 0` (13 foundation + 16 INV: shapeless anywhere, shaped with tags / outside cells, mirrored axe/hoe/stairs/shears, 2x2 limit, shapeless multiset, consume + bucket remainders, every recipe planned + matched back (no shadowed recipes in the data), recipe-book helpers, all smelting inputs + fuel values, furnace 200-tick glass + lit swap + facing, no fuel waste / full output / lava bucket, container normalize + drops, slot click / right click / filters + output + limits, drag / quick move / gather).

`node tools/smoke.mjs --tag inv` -> `{"PASS":23,"PENDING":10,"SKIP":1}`, zero page errors:

```
PASS     hotbar
PASS     inventory-ui
PASS     inv-hud             (9 slots, 72 px kid slots, backpack 72 px, hearts/shanks/air/xp values, shake, toast, crosshair only in classic)
PASS     inv-creative-pick   (8 tabs >= 64 px, tiles 87 px, real mouse tap on red wool -> 64 red wool in slot 1, Colours 64 items = 2 pages, paging, trash, unstackable = 1, every tab non-empty)
PASS     inv-craft-planks    (mouse: log -> 2x2 -> 4 planks on the cursor -> inventory; grid returned on close)
PASS     inv-slot-clicks     (right-click half, left-drag even split, right-click one, merge, shift-click both ways, swap, held stack returned on close)
PASS     inv-recipe-book     (tap planks picture -> 4 planks; crafting table; chest refused in 2x2 with a picture toast)
PASS     inv-table-3x3       (mirrored stone axe by real clicks, shift-click output consumes the grid, recipe book pickaxe)
PASS     inv-furnace         (shift routes sand -> input, coal -> fuel; lights with facing kept; flame + arrow fill; no glass at cook tick 199, glass at 200; take output; keeps cooking closed)
PASS     inv-chest-unload    (chest contents survive column unload -> reload)
PENDING  inv-chest-persist   - stub lanes: save, menus
PASS     inv-container-drop  (chest 2 stacks + furnace 3 stacks dropped via interaction.breakBlock in creative)
PENDING  inv-blockuse        - stub lanes: input, player, raycast, interaction
PENDING  inv-q-drop          - stub lanes: items, input
PASS     page-errors
```

`node tools/smoke.mjs --tag invtouch --touch --scenario inv-creative-pick,inv-craft-planks,inv-recipe-book,inv-hud` -> 4 PASS + page-errors PASS (touchscreen taps on tiles and slots).

Viewport check (`.tmp/viewports.mjs`, local helper, not committed): inventory, picker and HUD fit inside 1920x1080 (gui 4), 1366x768 (gui 3) and 1024x640 (gui 2).

Screenshots reviewed: `.tmp/smoke-inv-inv-hud-survival.png`, `-inv-picker.png`, `-inv-picker-colors.png`, `-inv-craft-planks.png`, `-inv-recipe-book.png`, `-inv-table-3x3.png`, `-inv-furnace.png`, `-inv-chest.png`, `.tmp/vp-*.png`. Item icons are still CORE-A's flat stub squares.

### Bug found and fixed during testing

Shift-clicking the crafting output went through the generic quick-move and created the result without consuming the grid (item duplication). Fixed in `inv_slotview.js` and guarded in `inv_screens.js`; `inv-table-3x3` now asserts the grid is consumed.

### Still needs in-world verification (after the core merge)

1. **Block-use hooks from a real tap/right click** open crafting / furnace / chest (`inv-blockuse`, needs CORE-E). In the kid scheme, check that tapping a chest in creative opens it rather than breaking it.
2. **Container drops become real item entities** with pop + magnet (`inv-container-drop` asserts entities once `items` is live), including explosions breaking chests.
3. **Q-drop** throws the item forward with a 40-tick pickup delay (`inv-q-drop`, needs MOBS items + CORE-E input).
4. **Chest save + load** through MENUS (`inv-chest-persist`).
5. **Real icons** (CORE-A) look crisp in slots (32/48 px), hotbar (48 px), tiles (48/64 px); iso block icons are drawn at 32 px, so 48 px is a 1.5x scale - check for uneven pixels.
6. **HUD with real survival values** (MOBS): hearts/hunger/air move, `player:hurt` flash, starvation shake, XP once MOBS feeds `xpLevel`/`xpProgress`.
7. **`furnace_lit` glow** (emit 13) and the instant lit/unlit remesh (CORE-C/D) when the furnace swaps.
8. **HUD taps never reach the world**: hotbar / backpack use `pointerdown` + `stopPropagation`; confirm CORE-E's canvas gestures don't also fire.
9. **Touch overlay overlap** (KID): at 1280 wide the D-pad (right edge ~304 px) can touch the hotbar's left end (~276 px).
10. Spawn eggs appear in the Animals tab once MOBS registers entity types.

### Interface assumptions

- `game.world.getBlock/getRaw/setBlock(…, {cause:'furnace', keepBlockEntity:true})`, `getBlockEntity`, `setBlockEntity` (marks the column dirty), `forEachBlockEntity(fn(be, x, y, z))`.
- `block:broken` payload carries `blockEntity` (verified with the stub `breakBlock`).
- `hooks.blockUse` ctx has `hit.{x,y,z}`.
- `dropItem(game, stack, x, y, z, {vx, vy, vz, pickupDelay, thrower})` may return null (stub) - tolerated.
- `game.entities.types` is a Map/Set of registered entity types (picker egg filter).
- `game.player.{health,maxHealth,food,saturation,air,eyeInWater,xpLevel,xpProgress,getEyePos,getLookDir}`.
- `game.icons.element(key, px)`.

### New events / API members (lane INV)

- Events emitted: `craft {item, count}`, `smelt {item, count, x, y, z}` (x,y,z added), `item:drop {item, count, x, y, z}` (Q-drop and overflow tosses only), `toast {text, icon}` (recipe book "needs a table"), `ui:click`.
- `game.invui`: `screen`, `openContainer(kind,x,y,z)`, `clickSlot(sid, button, shift)`, `slotRect(sid)`, `pick(itemKey)`, `recipeTap(itemKey)`, `hotbarKey(i)`, `dropContents(be,x,y,z)`, `lastDropped`. Slot ids: `p0..p35` player, `c0..c8` grid, `out`, `a0..a3` armour, `k0..k26` chest, `fi`/`ff`/`fo` furnace.
- `game.hud`: `showName(itemKey)`, `slotRect(i)` (plus the frozen `visible`, `toast`).
- `Inventory`: `setArmor`, `armorPoints`, `notify`.

### Spec conflicts / decisions (for the integrator)

1. `item:drop` lists MOBS and INV as emitters. INV emits it only for its own tosses (Q-drop, overflow). If MOBS's `dropItem` also emits it, audio would play twice for a Q-drop - one owner should be chosen.
2. Air bubbles: followed SPEC ("only while the eye is in water"); Java also shows them while air refills.
3. HUD is hidden while a container screen is open (SPEC silent; avoids two hotbars, the picker has its own).
4. Recipe book tap crafts straight into the inventory (the grid is filled and shown fading, then crafted) rather than leaving the result on the output slot.
5. Kid scheme, tap outside a container panel: returns the held stack, otherwise closes the screen (SPEC only defines the classic drop).
6. `inventory.clear()` keeps `selected`; INV resets it to 0 for new worlds in `invui.deserialize(undefined)`.

### LEAD requests

1. **Default skin colours** (`DEFAULT_SETTINGS.skin` in `src/core/settings.js`): blue shirt + indigo trousers + brown hair is the famous default character's palette. The inventory doll (and FX's player model) draw from it. Suggest a different default (for example a green or yellow shirt) for originality (D9).
2. **XP from smelting**: furnaces accumulate `be.xp`, but there is no `survival.addXp(n)` (or similar) to award it when the output is taken. Please add one to the MOBS API (P1).
3. Optional: the furnace's `smelt` payload now carries `x, y, z`; document it in SPEC §6.

### Remaining

- P1: riding/jump bar (needs MOBS horses); awarding smelting XP (LEAD request 2).
- P2: creative search, saved hotbars, recipe-book hover ghost of ingredients, long-press split for touch.
- Containers don't fit a 375 px phone screen (9 x 48 px = 432 px); fine for the laptop target.
