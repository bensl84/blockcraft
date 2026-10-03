# Handoff - inv

Branch `lane/inv` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-inv`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

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
