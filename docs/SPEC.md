# Blockcraft — Engineering Specification

Version 1.6 · 2026-10-04 · owner: LEAD (architect / integrator) · v1.1 applies the independent review (lane isolation, persistence, undo data, test API, kid controls, content gaps) · v1.2 records the CORE integration (lanes A–E merged): light curve with the brightness lift, accepted lane spec conflicts, streaming radii, new lane events and decisions D14–D15 · v1.3 applies the CORE review (CORE-R1…R9): meshing one ring beyond the fog with a crisp linear fog, quad flip, leaves and water textures, tap classification by event time, `unmeshedWithin` after a teleport, capsule kid outline, larger climate regions, moonlit night tint · v1.4 applies the CORE review recheck (CORE-R10, CORE-R2): columns wholly beyond the fog are not drawn, and smooth light and AO are blended bilinearly per pixel from each quad's four corners (mesh contract: `corner` array, flag bits 7–8; chunk geometry uploads no `aLight`) · v1.5 applies CORE-R11: the fog cull hides fully fogged geometry only where the sky behind it is the fog colour, so the picture never changes and distant fogged mountains stay; the sky keeps an exact fog-colour horizon and FX draws no sky objects below it · v1.6 records the FEATURE integration (lanes INV, MENUS, AUDIO, FX, MOBS, MECH, KID merged): placer return contract, kid entity holds, new-world resets, a frozen renderer behind menus, the in-block overlay, autosave natural causes, item pickup reach, touch column clear of the HUD, dirt under generated pumpkins and boulders, creeper blasts through MECH

This file is the single source of truth for Blockcraft. Two kinds of files back it up:

- **Normative for numbers and content:** `src/core/constants.js` and the data files `src/data/blocks.js`, `items.js`, `recipes.js` and `mobs.js`.
- **Normative for behaviour, interfaces and acceptance:** this document.

If the code and this document disagree, do not quietly pick one. Write the conflict in your handoff note (`docs/handoff/<lane>.md`) so the integrator can fix it.

**Who reads what.** Each engineer (lane) reads:

- this whole document;
- the section for their lane (CORE: §5 and §7, FEATURE: §8);
- the stub files they own, whose header comments repeat their contract.

---

## Contents

0. [How to work on Blockcraft](#0-how-to-work-on-blockcraft)
1. [Product vision and kid-first defaults](#1-product-vision-and-kid-first-defaults)
2. [Features, priorities and gameplay numbers](#2-features-priorities-and-gameplay-numbers)
3. [Architecture](#3-architecture)
4. [Content and data model](#4-content-and-data-model)
5. [CORE lanes A–D: textures, worldgen, world, renderer](#5-core-lanes-ad)
6. [Event bus catalogue](#6-event-bus-catalogue)
7. [CORE-E: input, physics, raycast, interaction, player](#7-core-e-input-physics-raycast-interaction-player)
8. [FEATURE lanes](#8-feature-lanes)
9. [UI style guide](#9-ui-style-guide)
10. [Controls](#10-controls)
11. [Test API: `window.__game`](#11-test-api-window__game)
12. [Performance budgets](#12-performance-budgets)
13. [Acceptance criteria and test plan](#13-acceptance-criteria-and-test-plan)
14. [Open decisions and risks](#14-open-decisions-and-risks)

Appendices: [A. block table](#appendix-a-block-table) · [B. item list](#appendix-b-item-list)

---

## 0. How to work on Blockcraft

### 0.1 Ownership and isolation

**Every lane works in its own git worktree on its own branch.** The integrator commits the foundation on `main` before any lane starts, then creates one worktree per lane:

```
node tools/lane-worktree.mjs <lane>        # corea coreb corec cored coree mobs inv audio menus kid mech fx
```

- This creates branch `lane/<lane>` in the sibling folder `../bc-<lane>`, with `node_modules` linked to the main checkout through a Windows directory junction (`mklink /J` equivalent; no admin rights). The tool never commits, pushes or deletes.
- A lane builds, tests and commits **only inside its own worktree**. A half-edited file in one lane can therefore never break another lane's build or smoke run.
- **Handoffs go to `docs/handoff/<lane>.md`** (format in `docs/handoff/README.md`). Lanes never edit `docs/STATUS.md`.
- **The integrator** merges `lane/*` branches into `main`, re-runs every check (§13.3), and is the only writer of `docs/STATUS.md`, the SPEC and LEAD files.
- To remove a worktree later: `git worktree remove ../bc-<lane>` (this removes the junction, never the shared `node_modules`). Never delete a worktree folder with a recursive delete while the junction exists.

**File ownership**

- **Edit only the files your lane owns** (see §3.1). LEAD files are read-only for lanes: the build, `src/main.js`, `src/core/*`, `src/data/*`, `src/ui/screens.js`, `src/styles.css`, `tools/smoke.mjs`, `tools/lane-worktree.mjs`, `tools/scenarios/lead.mjs`, `test/foundation.test.mjs`, `docs/SPEC.md`, `docs/STATUS.md`.
- **New files are fine** inside your lane's own folder or file prefix (§3.1). Examples: `src/world/light_queue.js` for CORE-C, `src/fx/particles.js` for FX.
- **Stub files must keep their signatures.** Each stub module exports its final, frozen API, documented here and in the file's JSDoc.
  - Allowed: adding optional parameters, fields or methods.
  - Not allowed: renaming, removing, or changing a meaning.
  - When your module is real, **delete its `registerStub('<name>')` line**. The test harness then starts holding your module to its scenarios.

### 0.2 Building and testing per lane

All commands run **in your own worktree** (`../bc-<lane>`); `.tmp/` there is private to your lane.

- **Build:** `node build.mjs --dev --out .tmp/build-<lane>`. Never write the root `index.html` from a lane; only the integrator runs `npm run build` on `main`.
- **Smoke test:** `node tools/smoke.mjs --tag <lane>`. Narrow it with `--scenario a,b` and add `--swiftshader` or `--touch` as needed.
  - Screenshots go to `.tmp/smoke-<lane>-*.png`.
  - Keep `.tmp` paths short. Chrome fails on `file://` paths longer than about 260 characters, and git fails on paths that long too — keep worktrees as siblings of the main checkout, not deeper.
- **Before you hand off:** commit on `lane/<lane>`, make sure `npm run test:unit` and `node tools/smoke.mjs --tag <lane>` pass in the worktree, and write the results into `docs/handoff/<lane>.md`.
- **Unit tests:** `npm run test:unit` runs `test/**/*.test.mjs`. Add yours as `test/<lane>.test.mjs`.
- **Lane scenarios:** add them in `tools/scenarios/<lane>.mjs` (`export default [ { name: '<lane>-thing', requires: [...], run } ]`).
  - The harness loads every file in that folder automatically.
  - Prefix scenario names with your lane.

### 0.3 Rules for all code

- **CSS:** put your CSS in your own file (for example `src/ui/hud.css`) and import it from your JS. esbuild inlines it. Use the shared classes and variables from §9.
- **Dependencies:** no new npm dependencies. Only three.js r170, which is already installed.
- **Network:** none at runtime. No `fetch` of remote content, no fonts, no CDN.
- **Determinism:** no `Math.random` in worldgen or textures. Use `core/math.js` (`hash32`, `mulberry32`, `Rng`).
- **Gameplay randomness:** every gameplay roll (drops, taming chance, AI wander choices, spawn rolls, crop and sapling growth, egg laying, explosion ray jitter) uses **`game.rand()`**, never `Math.random`. Tests fix it with `__game.setRandomSeed(seed)` (§11).
- **Block changes:** every block removal goes through `interaction.breakBlock` (§7.4), which alone spawns block drops. Bulk edits (explosions, tree growth, fluid spreading, bone-meal patches) are wrapped in `world.beginBatch()` / `world.endBatch()` (§5.3.2). Changes caused by another change carry its `action` id forward (§8.5.2).
- **Originality:**
  - Never copy Mojang textures, sounds, music, logos, splash texts or UI wording.
  - Never put the word "Minecraft" in the UI.
  - Iconic designs, such as the creeper face, must be original variations.
- **Hot-path hygiene:**
  - No per-frame object allocation in hot loops.
  - Reuse typed arrays.
  - `dispose()` every geometry you replace.
  - Never create materials or textures per section.
- **Errors:** never let `tick()` or `frame()` throw. main.js catches the error and records it in `__game.errors`, and any recorded error fails the smoke test.
- **Kid-first:**
  - Every interactive control is at least 48 CSS px; primary controls at least 80 px.
  - Every input reacts within 50 ms, visually or audibly.
  - No reading is required for the core loop.
- **Cross-lane calls:** go through the event bus (§6), the hook registries (`core/hooks.js`), the entity-type registry (`entities/entity.js`), or the documented public methods of another lane's system object (`game.<system>.<method>`). Every such call must tolerate a stub, which returns a safe default.

---

## 1. Product vision and kid-first defaults

### 1.1 Vision

Blockcraft is an original, offline, single-file browser game in the spirit of Minecraft.

- **Player:** a 5-year-old on a Windows laptop with keyboard and trackpad, a mouse, and possibly a touchscreen.
- **Parent's bar:** "all the things of Minecraft… a 9 out of 10", with controls a 5-year-old can manage.
- **Platforms:** it must work when opened from `file://` and from GitHub Pages, where it is installable and works offline through the service worker.

### 1.2 Feel pillars, in priority order

1. Exact movement physics at 20 TPS (§2.1).
2. The block loop: aim, outline, timed mining with cracks, particles, drops, placement.
3. The look: 16×16 pixel art with nearest-neighbour sampling, fixed face shade, vertex ambient occlusion, flood-fill light, fog, a day/night sky.
4. The camera: FOV 70, sprint FOV ×1.15, fly FOV ×1.1, eased.
5. Material sounds (all synthesised), the pickup pop, and calm generative piano.
6. A hotbar-centred HUD at integer GUI scale.
7. Animals with believable idle behaviour, breeding with hearts, babies, and pets.

### 1.3 Kid-first defaults

These are the defaults for a new world when nobody changes anything.

| Setting | Default | Notes |
|---|---|---|
| Game mode | **Creative** | Survival Easy and Survival Normal are offered as picture cards |
| Difficulty | **Peaceful** | No hostile mobs, no hunger |
| World preset | **Hills & trees** (`default`) | Flat (`flat`) is offered first in the world picker; `snowy` is P1, `islands` P2 |
| Control scheme | **Kid** | Free cursor, tap to place, hold to break, drag to look, A/D and arrow keys turn (§10) |
| Day/night cycle | **Off**, locked at 09:00 (dayTime 3000) | Parent can turn it on |
| Weather | Off | |
| Fall, drowning and fire damage | Off | Turned on by survival presets |
| Keep inventory, immediate respawn | On | |
| Animals can die | Off | A hit animal hops away with a squeak |
| TNT | **On** | Blasts are kid-safe in sound and can be undone (§14) |
| Mob griefing (creepers breaking blocks) | Off | |
| Auto-jump | On | |
| View bobbing | Off | |
| Render distance | Auto (6 on a mid laptop) | Dynamic scaling |
| Home button, undo, void rescue, soft border (512) | On | |
| Music / effects / master volume | 0.35 / 1.0 / 0.65 | Master limiter is always on |

**No reading needed.** Every core-loop control is an icon. Text appears only in the parent area, which is behind the parent gate.

### 1.4 Non-goals

- Multiplayer, accounts, chat.
- Nether and End, enchanting, potions, redstone circuits beyond what is listed as P2, villages (P2).
- Hard difficulty, hardcore mode.

---

## 2. Features, priorities and gameplay numbers

**Priority definitions.**

- **P0:** must ship for "it is Minecraft".
- **P1:** needed for 9/10.
- **P2:** polish and stretch.

Each lane implements its P0 items first, then P1, then P2.

### 2.0 Feature list by lane

| Area | P0 | P1 | P2 |
|---|---|---|---|
| World (B, C) | Procedural terrain: hills, plains, forest, desert and snowy biomes, sea at 48, beaches, caves, ores, trees (oak, birch, spruce), flowers, grass; bedrock floor; Flat preset; streaming with fog; **worker offload of generation and meshing** (main-thread fallback); batch edits; modified columns survive unload | Snowy preset; sugar cane, cactus, pumpkins and melons in worldgen | Islands preset; villages |
| Render (A, D) | Procedural 16×16 textures; array texture; AO and smooth light; sky and block light; opaque, cutout and translucent passes; fog; day/night; selection outline (thick kid outline); one draw call per mob; **column-merged draws if the SwiftShader proxy is over the draw-call budget** | Dynamic quality scaling; fancy/fast leaves | Cave culling |
| Player (E) | Java-accurate walk, jump, step, sneak-edge, fly, swim, ladder; kid controls (no Shift); classic pointer lock; DDA raycast; break and place with the correct rules (fence/pane connections) | Sprint-jump tuning, view bobbing, third person; slab merging into double slabs | Swim sprint, crawling |
| Mobs (MOBS) | Pig, cow, sheep (shear, dye, regrow), chicken (eggs), wolf (tame, sit, follow, teleport); breeding with hearts; babies; natural spawns that never pile up; dropped items with magnet; survival health, hunger, fall and drown damage | Cat; horse riding with saddle; pig riding; **boats**; zombie, skeleton, creeper, spider; sun burning; XP orbs; bow; armour; rainbow-sheep easter egg | Slimes, more animals, leads |
| Inventory (INV) | Hotbar HUD; survival inventory with 2×2 crafting; crafting table 3×3; furnace; chest; kid creative picker (8 tabs); **recipe book (tap to craft) in survival worlds** | Armour slots; XP bar | Creative search, saved hotbars |
| Mechanics (MECH) | Falling sand and gravel; TNT and explosions with chain reactions; torches and plants need support; doors; beds (set spawn, sleep; nap when the day is locked); water flow and buckets; farming (hoe, wheat, carrots, potatoes, bone meal, saplings) | Lava with obsidian, cobblestone and stone; fire (never spreads by default); cake; sugar cane and cactus growth; **fences with connections, fence gates, glass panes, paintings**; double slabs, stacking snow layers, leaf decay, grass spreading, sugar cane needs water, snowy grass | Snow accumulation, ice melt |
| Audio (AUDIO) | Material dig, place and step sounds; pickup pop; UI click; gentle hurt; animal voices; explosion; limiter | Generative piano music with reverb; hostile voices; door, eat and bucket sounds | Positional mixing polish |
| Menus (MENUS) | Title with Play; world picker; new-world presets; pause; death screen; loading; IndexedDB save and load with autosave; settings behind the parent gate | Thumbnails; backups; original pixel font | Export and import |
| Touch and kid (KID) | Touch D-pad, jump and fly buttons, hotbar, inventory, pause, Home; Home teleport; void rescue; undo; stuck rescue; exit guards | Onboarding hints; text-to-speech names; home arrow; soft border | Photo button |
| FX (FX) | Break particles; crack overlay; held item and arm view model; sun, moon, stars, clouds; underwater tint; kid ghost block; item meshes | Third-person player model; hearts, sparkles and smoke particles; hurt flash; fades | Rain and snow weather |

### 2.1 Player movement (Java Edition, per tick, 20 TPS)

All values are in `PHYS` in `core/constants.js`. Velocities are in blocks per tick (b/t).

**Body**

| Item | Value |
|---|---|
| Hitbox | 0.6 wide × 1.8 high, eye at 1.62 |
| Sneaking | 1.5 high, eye 1.27 |
| Step height | 0.6 |
| Collision epsilon | 1e-7 |

**Speed targets the implementation must reproduce (±5%)**

| Movement | Speed |
|---|---|
| Walk | 4.317 m/s (0.2159 b/t) |
| Sprint | 5.612 m/s |
| Sneak | 1.3 m/s |
| Creative fly | 10.92 m/s |
| Sprint-fly | 21.6 m/s |
| Fly up / down (holding jump / descend) | 7.5 m/s (0.375 b/t, Java) |
| Kid flight while streaming lags | capped at 7 m/s (§2.1 step 11a) |
| Ladder up | 2.35 m/s |

| Jump | Value |
|---|---|
| Initial vy | 0.42 |
| Apex | **1.2522 blocks** (assertion: 1.15–1.35) |
| Flat jump duration | 12 ticks |
| Sprint-jump boost | +0.2 b/t along the facing direction |

**Algorithm per tick.** CORE-E implements this in `player.js`; it is the same formula as Java's `LivingEntity.travel`.

1. **Input.**
   - Let `f = input.move.forward` and `s = input.move.strafe`. In the kid scheme `s = 0`.
   - Multiply both by 0.98. Multiply by 0.3 more while sneaking on the ground (**classic scheme only**: the kid scheme has no sneaking, so nothing ever slows the child down).
   - If `f² + s² > 1`, normalise.
2. **Acceleration `a`.**

   | Situation | a |
   |---|---|
   | Flying | `0.05 × (sprint ? 2 : 1)` |
   | In water | 0.02 |
   | In lava | 0.02 |
   | On ground | `0.1 × (sprint ? 1.3 : 1) × 0.216 / slip³`, where `slip` = slipperiness of the block under the feet (0.6, ice 0.98). With slip 0.6 this is 0.1. |
   | In the air | `sprint ? 0.026 : 0.02` |

3. **Apply acceleration.** `vx += (s·right.x + f·fwd.x)·a`, and the same for `vz`. Here `fwd = (−sin yaw, −cos yaw)` and `right = (cos yaw, −sin yaw)`.
4. **Vertical intent.**
   - Ground jump: when the jump input is held and on ground (and not flying), `vy = 0.42`. If sprinting, also add `0.2·fwd`. Emit `player:jump`.
   - Water or lava: jump held → `vy += 0.04`.
   - Flying: `vy += 0.15` if jump is held, `vy −= 0.15` if `descend` (kid: C, Z, touch ▼) or `sneak` (classic: Shift) is held. Call the result `vyIntent`; it is the vy used by the move in step 6.
   - Auto-jump (`settings.autoJump`, on ground, moving forward): if the next cell in the move direction at feet level has a collision top ≤ 1.0 above the feet and 2 cells of headroom above it, jump.
5. **Ladder.** If the body overlaps a climbable cell:
   - Clamp `vx` and `vz` to ±0.15 and set `vy = max(vy, −0.15)`.
   - If sneaking, set `vy = max(vy, 0)`.
6. **Move.** Call `moveAndCollide(world, body, vx, vy, vz, {sneakEdge})`. `sneakEdge` is true when sneaking and on ground, in the classic scheme only.
7. **Ladder climb.** If `collidedH` and on a ladder, set `vy = 0.2`.
8. **Drag and gravity** (applied after the move):

   | Situation | Rule |
   |---|---|
   | Flying | `vy = vyIntent × 0.6` (Java `Player.travel`: the value from step 4, even if the move was blocked); `vx, vz ×= 0.91`; no gravity. Steady climb: `v = (v + 0.15) × 0.6` ⇒ moves 0.375 b/t = **7.5 m/s** |
   | Water | `v ×= 0.8` on all axes, then `vy −= 0.005` |
   | Lava | `v ×= 0.5`, then `vy −= 0.02` |
   | Otherwise | `vy = (vy − 0.08) × 0.98`; `vx, vz ×= (onGround ? slip × 0.91 : 0.91)` |
   | Any axis with \|v\| < 0.003 | set to 0 |
   | Terminal | 3.92 b/t |

9. **Collision response.** A blocked axis gets velocity 0. `onGround` is true when Y movement was clipped while moving down.
10. **Falling.**
    - While falling, `fallDistance −= dy`.
    - On landing, emit `player:land {fallDistance, x, y, z, blockId}`, then reset `fallDistance` to 0.
    - Water, ladders, flying and cobweb also reset it.
11. **Flight.** Landing ends flight.
    - Classic: double-tapping jump within 7 ticks toggles flight (creative only).
    - Kid: the `toggleFly` action toggles flight (F key or the Fly button). Double-tap is disabled.
    - **11a. Streaming guard (kid scheme):** while `world.unmeshedWithin(R − 1) > KID.STREAM_BACKLOG_COLUMNS` (2), clamp the horizontal flight speed to `KID.STREAM_FLY_CAP` (0.35 b/t = 7 m/s) so a child flying flat out never outruns terrain streaming into holes.
12. **Sprint** (classic only).
    - Start by double-tapping forward within 7 ticks, or holding `sprint` while moving forward.
    - Stop when forward is released, on `collidedH`, when sneaking, or when food ≤ 6 in survival.
    - Kid scheme: no sprint.
13. **Footsteps.** On ground, emit `player:step {x, y, z, blockId, sound}` every 1.7 blocks walked (horizontal), using the block under the feet.
14. **Water state.** Body in water: any water cell overlaps the box. Eye in water: water cell at eye height. Emit `player:water` when either changes.

**Camera** (per frame, `player.frame`):

- Interpolated position at eye height.
- `camera.rotation.set(pitch, yaw, 0, 'YXZ')`; pitch clamped to ±89.9°.
- FOV eases toward `settings.fov × (sprint 1.15) × (fly 1.1)` with `fov += (target − fov) × (1 − 0.5^(dt·20))`.
- View bobbing only if `settings.viewBobbing`.
- Hurt tilt: 2° roll decaying over 10 ticks. **The player lane owns the tilt**; FX only draws the red vignette.
- Third person (`view` 1 or 2): the camera is 4 blocks behind (1) or in front (2) along the look ray, clipped by a raycast at 0.2 before any solid block.

### 2.2 Reach, breaking, placing, tools

**Reach**

| Context | Reach |
|---|---|
| Survival | 4.5 |
| Creative | 5.0 |
| Kid scheme | **8.0** (cursor targeting) |
| Entities, survival | 3.0 |
| Entities, creative or kid | 5.0 |

**Survival break time.** Use `registry.breakTicks(id, toolDef, {headInWater, onGround})`. This is Java's formula: per tick, progress += `speed / hardness / (canHarvest ? 30 : 100)`, where `speed` is the tool tier speed if the tool type matches the block, otherwise 1.

- Speed multipliers: ×0.2 when the head is in water, ×0.2 when airborne.
- Sanity values (unit-tested):

  | Block | Tool | Time |
  |---|---|---|
  | Dirt | hand | 0.75 s |
  | Log | hand | 3.0 s |
  | Log | wooden axe | 1.5 s |
  | Stone | hand | 7.5 s, no drop |
  | Stone | wooden pickaxe | 1.15 s |
  | Obsidian | diamond pickaxe | 9.4 s |

- There is a 6-tick pause before the next block starts.
- The crack stage is `floor(progress × 10)`, giving stages 0–9.

**Creative breaking.** Blocks break instantly. Holding the button repeats every **5 ticks** (250 ms).

**Placing.** Holding the button repeats every 4 ticks.

**Arm swing.** Lasts 6 ticks.

**Tool tiers** (`items.js` `TIERS`)

| Tier | Level | Speed | Durability |
|---|---:|---:|---:|
| Wooden | 1 | 2 | 59 |
| Stone | 2 | 4 | 131 |
| Iron | 3 | 6 | 250 |
| Golden | 1 | 12 | 32 |
| Diamond | 4 | 8 | 1561 |

- **Shears:** speed 15 on leaves, 5 on wool.
- **Harvest levels:** stone, cobble and coal need level 1. Iron and lapis need 2. Gold, diamond, redstone and emerald need 3. Obsidian needs 4.
- **Durability cost:** a tool loses 1 per block mined and 2 per hit when used as a weapon (swords lose 1). Hoe use costs 1.

### 2.3 Health, hunger, damage, combat (survival)

Owner: FEATURE-MOBS (`survival.js`). Constants: `SURVIVAL`.

**Health**

- 20 HP (10 hearts). After a hit there are 10 ticks of invulnerability; during them only a bigger hit counts, by the difference.
- Creative ignores all damage except the void.
- **Void:** while `rules.voidRescue` is on (the default for every world, survival included), `survival.damage('void')` returns false and the kid lane rescues the player as soon as the feet drop below y 0 (`KID.VOID_RESCUE_Y`), before any damage. Only when a parent turns the rule off does void damage apply below y −16 (`SURVIVAL.VOID_Y`). This resolves §2.3 against §2.7: there is no race, because survival never damages for the void while the rescue is on.

**Hunger**

- Hunger is 20 and saturation starts at 5. Saturation is always ≤ hunger.
- When exhaustion reaches 4.0, remove 1 saturation, or 1 hunger if saturation is 0.
- Exhaustion costs:

  | Action | Exhaustion |
  |---|---:|
  | Sprinting | 0.1 per metre |
  | Swimming | 0.01 per metre |
  | Jump | 0.05 |
  | Sprint-jump | 0.2 |
  | Attack | 0.1 |
  | Taking damage | 0.1 |
  | Breaking a block | 0.005 |
  | Each HP healed | 6.0 |

- Regeneration and starvation:
  - Hunger 20 with saturation > 0: heal 1 every 10 ticks.
  - Hunger ≥ 18: heal 1 every 80 ticks.
  - Hunger ≤ 6: cannot sprint.
  - Hunger 0: 1 damage every 80 ticks. Easy stops at 10 HP, Normal at 1 HP.
- Peaceful (or `rules.hunger` false): hunger and health refill by 1 every 20 ticks.

**Eating**

- Takes 32 ticks while `use` is held. In the kid scheme a single tap starts eating and it completes on its own unless the slot changes.
- Blocked at full hunger, except for `alwaysEdible` foods.
- Food values are in `items.js` (`food: {hunger, saturation, effects}`).

**Damage sources** (each gated by a rule)

| Source | Damage | Rule |
|---|---|---|
| Fall | `ceil(fallDistance − 3) × fallMult(block landed on)`. Hay ×0.2, bed ×0.5. Landing in water or on a ladder: 0. | `fallDamage` |
| Drowning | Air 300, minus 1 per tick with the eye in water. At −20 air: 2 damage and air back to 0. Surfacing refills +4 per tick. | `drowningDamage` |
| Lava | 4 per 10 ticks plus 300 ticks of fire | `fireDamage` |
| Fire | 1 per 20 ticks | `fireDamage` |
| Cactus | 1 per 10 ticks of contact | — |
| Suffocation | 1 per 10 ticks with the head inside an opaque block | — |
| Void | 4 per 10 ticks below y −16 | only when `rules.voidRescue` is false; otherwise the kid lane rescues at y < 0 |

**Melee**

- Damage is the held item's `damage` (fist 1, swords 4/5/6/4/7, axes 7/9/9/7/9).
- A critical hit (falling, `vy < 0`, not on ground) does ×1.5.
- Knockback: 0.4 horizontal plus a 0.4 hop.
- **No attack cooldown.** Spam-clicking works, which is easier for a 5-year-old.

**Survival item sources before the P1 monsters** (original Blockcraft twists, so P0 features work in survival)

| Item | Source | Unlocks |
|---|---|---|
| bone | gravel: 5% extra drop | wolf taming, bone meal farming |
| string | oak and birch leaves: 2% | bows, white wool, leads |
| flint | gravel: 10% (Java) | flint and steel, arrows |
| gunpowder | creepers only (P1) | TNT — until creepers ship, TNT exists only in creative (the default kid world) |

**Death and respawn**

- On death, show the death screen unless `rules.immediateRespawn` is on; in that case respawn after 20 ticks with a fade.
- `keepInventory` on: nothing drops. Off: the inventory scatters as item entities.
- Respawn at the bed or world spawn with full health and hunger.

### 2.4 Time and light

**Time** (`TIME_EVENTS` in constants)

- A day is 24000 ticks (20 minutes).
- dayTime 0 = 06:00 sunrise, 6000 = noon, 12000 = dusk, 13000 = night, 18000 = midnight, 23000 = dawn.
- The bed can be used from 12542 to 23459.
- Moon phase = `day % 8`.

**Light**

- Light levels run 0–15, stored per cell as `sky << 4 | block`.
- Emitters: glowstone, lava, jack o'lantern and fire 15; torch 14; lit furnace 13; brown mushroom 1.
- Propagation:
  - Block light loses 1 per step plus the block's filter.
  - Sky light moves straight down through filter-0 cells without loss, and loses 1 per step sideways or upward.
  - Water, ice and leaves filter 1. Opaque blocks filter 15.

**Rendering of light**

- Effective sky: `effSky = max(0, sky − (1 − daylight) × 11)`.
- `L = max(effSky, block)` and `bright = 0.8^(15−L)`, never below `uMinLight = 0.06 + 0.24 × settings.brightness`. At the kid default brightness 0.7 the floor is about 0.23.
- Block light gets a warm tint of (1.0, 0.92, 0.78).

### 2.5 Fluids, falling blocks, explosions, farming, blocks with behaviour

Owner: FEATURE-MECH.

**Water**

- Flows every 5 ticks. Levels run from 0 (source) to 7, so it reaches 7 blocks on flat ground.
- Falling water (state bit 3) resets the level.
- It prefers a path toward a drop within 4 blocks.
- Infinite source: a flowing cell next to 2 or more sources, sitting on a solid block or a source, becomes a source.
- It pushes entities at about 0.014 b/t toward the flow.
- It washes away torches, crops, flowers, grass and saplings.

**Lava (P1)**

- Flows every 30 ticks, reaching 3 blocks (level step 2). Never creates sources.
- Where lava meets water: a lava source becomes obsidian, flowing lava becomes cobblestone, and lava flowing down onto water makes stone.

**Falling blocks** (sand, gravel)

- Scheduled 2 ticks after they lose support (air or fluid below).
- They fall as an entity (`falling_block`) with gravity 0.04 and drag 0.98.
- On landing they place themselves; if the landing cell is not replaceable, they drop as an item.

**TNT**

- Primed by flint and steel, by fire, or by another explosion. The normal fuse is 80 ticks; when set off by an explosion the fuse is 10–30 ticks.
- On priming the entity hops 0.2 b/t up with up to 0.02 random sideways velocity.
- It flashes white every 5 ticks and swells to 1.3× over the last 10 ticks.
- Power 4. `rules.tntExplodes` false means a harmless poof with no blocks broken.

**Explosion**

- 1352 rays (the 16³ grid surface). Each ray has intensity `power × (0.7..1.3)`, steps 0.3 blocks, and loses `0.225 + (blast + 0.3) × 0.3` per block.
- A block is destroyed while the intensity stays > 0.
- Entity damage: `(1 − d/(2P)) × exposure`, giving `7P(i² + i) + 1`, with knockback scaled by the impact.
- *(v1.6)* MECH owns every explosion, the creeper's included (`mechanics.explode(…, {source: 'creeper'})`). A creeper's blast scales its damage to the player with difficulty like Java (easy: half + 1); the player's own TNT does not.
- Drops: TNT drops 100% of destroyed blocks when `dropItemsOnBreak` is on; creepers drop with chance 1/P.
- Explosions in water break no blocks.
- Caps: at most 2 explosions resolved per tick (the rest queue) and at most 600 blocks per explosion.
- **How the blocks go:** one `action = interaction.newAction()` per explosion; all breaks inside one `world.beginBatch()`/`endBatch()`; each break is `interaction.breakBlock(x, y, z, {by: 'explosion', action, drops, dropInto})`. The collected drops are **merged by item and spawned as at most 32 item entities** spread over the blast area. Chained TNT inside the radius is primed, not broken.
- **Payload:** `explosion {x, y, z, power, source, action, count, blocks: [{x, y, z, id, state}]}` (the array is what KID's undo and FX use).

**Farming**

- **Hoe:** turns grass or dirt with air above into farmland (durability −1).
- **Hydration:** farmland within 4 horizontal blocks of water (same y or one above) is moisture 7; otherwise moisture decays and dry, empty farmland turns back to dirt.
- **Trampling:** survival only, when `fallDistance > 1`.
- **Crops:** wheat, carrots and potatoes have 8 ages (0–7) and need light ≥ 9 to grow. On each random tick they grow with chance 1/3 if hydrated, 1/7 if dry.
- **Random ticks:** 3 random cells per loaded section per tick.
- **Bone meal:** crops +2 to 5 ages; saplings 45% chance to advance; on a grass block, grass and flowers sprout in a 7×7 area. Emits `bonemeal`.
- **Saplings:** a random tick has a 1/7 chance to advance the stage; stage 1 then grows a tree via CORE-B `placeTree` (needs light ≥ 9).
- **Drops:** grass drops seeds 12.5% of the time. Mature wheat gives 1 wheat and 1–4 seeds. Mature carrots and potatoes give 2–5.

**Doors** (2 tall)

- Placing needs a solid floor and two free cells.
- `facing` is the player's look facing.
- Use toggles bit 2 on both halves and emits `door:toggle`.
- Breaking either half removes the other (cause `cascade`, no extra drop).

**Fences, fence gates, glass panes (P1)**

- Fence and pane state bits 0–3 are the N/E/S/W connections (`registry.connectionState`). CORE-E sets them on placement; MECH recomputes the 4 neighbours on every `block:changed` (passing the change's `action`).
- Fences join fences, gates and opaque cubes; panes join panes, glass-like solid cubes and opaque cubes. Fence and closed-gate collision is 1.5 high, so animals and the player stay in pens.
- `oak_fence_gate`: facing (bits 0–1, toward the player who placed it) and open (bit 2). `hooks.registerBlockUse('oak_fence_gate')` toggles bit 2 and emits `door:toggle {x, y, z, open, kind: 'gate'}`. Open gates have no collision.

**Beds** (2 long, 16 colours)

- The foot is placed at the target cell and the head one cell further along the player's facing. Both cells need to be replaceable with a solid floor.
- Use always sets the spawn point (toast plus `player:spawnSet`).
- Sleep is possible only while `time.isNight()` and no monster is within 8 horizontal / 5 vertical blocks. A 100-tick fade-out is followed by `setTime(0)`.
- **Nap (kid default):** while `rules.daylightCycle` is false, using a bed always works: `sleep:start {nap: true}`, a short fade with a starry sky (`setTime(18000)` for `KID.NAP_TICKS`), then `setTime(KID_LOCKED_TIME)` (09:00) and `sleep:end {nap: true}`. `trySleep` returns `{ok: true, nap: true}`.
- The second half is removed on break.

**Torches, flowers, crops, saplings, doors, ladders, carpets, snow layers, sugar cane, cactus**

- Each needs its support (`support` / `placeOn` in blocks.js).
- When the support changes, MECH checks the neighbours on `block:changed` and breaks unsupported blocks with `interaction.breakBlock(x, y, z, {by: 'support'})`.

**Fire (P1)**

- Lit by flint and steel on a top face.
- Burns out after 30–90 ticks.
- **Never spreads** while `rules.fireSpread` is false (the default).

**Fidelity set (P1, MECH)**

- Double slabs: placing a slab on the open face of the same slab sets state bit 1 (`STATE.SLAB_DOUBLE`, full-block boxes).
- Snow layers stack by tapping a layer with snow (bits 0–2, up to 8).
- Leaf decay: worldgen leaves (bit 0 clear) more than 4 blocks from a log decay on random ticks; player-placed leaves have `STATE.LEAVES_PERSISTENT` and never decay.
- Grass spreads onto lit dirt (light ≥ 9) next to grass; grass under an opaque block turns to dirt.
- Sugar cane needs water next to its bottom block and grows to 3 tall.
- Grass under a snow layer gets its `snowy` bit (bit 0) and loses it when the snow goes.

**Paintings (P1, MECH):** `painting` item (recipe stick ring around `#wool`) hangs a `painting` entity on a wall face, picking the largest of 8 original procedurally painted pictures that fits. Breaking it drops the item.

**Cake (P1)**

- 7 bites. Each bite gives `survival.addFood(2, 0.4)`.
- In creative a bite still gives the eating sound and animation.

### 2.6 Mobs

Data is in `src/data/mobs.js`; behaviour is owned by FEATURE-MOBS.

**Stats**

| Mob | HP | Size (w × h) | Speed attribute | Main behaviour |
|---|---:|---|---:|---|
| Pig (P0) | 10 | 0.9 × 0.9 | 0.25 | Breeds with carrot or potato; saddle and ride (P1) |
| Cow (P0) | 10 | 0.9 × 1.4 | 0.2 | Breeds with wheat; bucket gives milk |
| Sheep (P0) | 8 | 0.9 × 1.3 | 0.23 | Breeds with wheat; shears give 1–3 wool; eats grass to regrow; dye recolours |
| Chicken (P0) | 4 | 0.4 × 0.7 | 0.25 | Breeds with seeds; lays an egg every 6000–12000 ticks; slow fall; no fall damage |
| Wolf (P0) | 8 (tamed 40) | 0.6 × 0.85 | 0.3 | Tamed with a bone (1/3 chance); sit toggle; follows; teleports beyond 12 blocks; begs |
| Cat (P1) | 10 | 0.6 × 0.7 | 0.3 | Tamed with raw chicken; scares creepers |
| Horse (P1) | 15–30 | 1.4 × 1.6 | 0.11–0.34 | Tamed by riding (temper); saddle; jump 0.4–1.0 |
| Zombie (P1) | 20 | 0.6 × 1.95 | 0.23 | Melee 2.5 / 3 (easy / normal); follows from 35; burns in sun |
| Skeleton (P1) | 20 | 0.6 × 1.99 | 0.25 | Arrows within 15 blocks every 60 / 40 ticks; burns in sun |
| Creeper (P1) | 20 | 0.6 × 1.7 | 0.25 | 30-tick fuse within 3 blocks, cancelled beyond 7; power 3 |
| Spider (P1) | 16 | 1.4 × 0.9 | 0.3 | Climbs walls; neutral in light ≥ 12 |

**Ground speed.** A mob's speed in b/s ≈ `43.2 × (attribute × modifier)²`. A pig wanders at 2.7 b/s and panics at 4.2 b/s.

**AI**

- **Wander:** every 3–8 s, pick a random point within 10 blocks.
- **Look at player:** within 6 blocks.
- **Panic:** after being hurt, for 100 ticks at modifier 1.25.
- **Tempt:** follows a player within 10 blocks who holds a tempt item, stopping at 2.5 blocks.
- **Breeding:**
  - Feeding a breed item starts 600 ticks of "love" with heart particles.
  - Two mobs of the same type in love within 8 blocks approach each other and make a baby.
  - Each parent then waits 6000 ticks before breeding again.
- **Babies:** scale 0.5 with a head 1.5× larger relative to the body. They grow up after 24000 ticks; each feeding cuts that by 10%.
- **Hurt and death:** red tint for 10 ticks. On death the mob tips over (90° over 20 ticks), then a smoke "poof" plus drops.
- **Getting around** (step-up is only 0.6, so these are required):
  - **Jump** (`vy = 0.42`) when blocked horizontally (`collidedH`) by an obstacle whose top is ≤ 1 block above the feet and with headroom above it.
  - **Never path** off a drop of 4 blocks or more, into lava or fire, or onto cactus: wander targets and steps that would do so are rejected.
  - **Float** in water: `vy += 0.04` per tick while more than 40% submerged (chickens, wolves and babies included).
  - **Turn away** from fences, gates and walls: if still blocked after one jump attempt, pick a new wander target.
- **Rainbow sheep (P1, original):** dye the same sheep with 3 different colours within 200 ticks and its wool cycles through the 16 colours (one per second, `MOBS.sheep.rainbow`); shearing it drops a random colour.
- **Animals can't die (kid default)** (`rules.animalsCanDie === false`): a hit only does knockback, a hop, panic and a squeak. Health never drops.

**Spawning** (`SPAWN`)

- **Biome lists:** `MOBS[type].biomes` is the only source (`mobsForBiome(biome, isImplemented)` in `data/mobs.js`); unimplemented mob types are filtered out.
- **Chunk generation:** on `world:columnLoaded` with `fresh: true` (the column is lit by then, so the light test works), a 10% chance (`game.rand()`) of a group of 2–4 animals from the biome list, placed on grass with light ≥ 9.
  - **Never twice:** MOBS keeps a `populated` set of column keys (serialized in `meta.systems.mobs`; a compact hashed bitmap is fine) and never populates a column again, even though unmodified columns are regenerated as `fresh` every session.
  - The **creature cap of 24** applies to chunk-generation spawns too.
- **Passive top-up:** every 400 ticks, when there are fewer than 24 creatures in the loaded area.
- **Streaming:** entities of an unloading column are parked and restored with it (§8.1), so they never pile up in memory or in the scene.
- **Monsters** (only when `rules.hostileMobs` and difficulty is not peaceful):
  - One attempt every 20 ticks, cap 20.
  - Only where sky light (effective) ≤ 7 and block light is 0, at least 24 blocks from the player.
  - Despawn instantly beyond 128 blocks. Beyond 32 blocks, after 30 s idle, each has a 1/800 chance per tick to despawn.
- Switching to peaceful removes existing monsters.

### 2.7 Kid helpers

Owner: FEATURE-KID.

- **Home:** the H key, the `home` action, or an 80 px button at the top left.
  - About 0.5 s of whoosh and fade, then teleport to `meta.home` (or `meta.spawn`), facing the build.
  - A home arrow appears when the player is more than 48 blocks away.
- **Void rescue** (`rules.voidRescue`, on by default in every world): if the feet go below y 0 (`KID.VOID_RESCUE_Y`), or 10 blocks below the lowest terrain, teleport silently to the surface. No damage, no death screen (§2.3).
- **Stuck rescue:** if the player presses move for 3 s or more without moving while enclosed at head height, pulse the Up button. Holding Jump for 1 s then pops the player to free space (`physics.findFreeY`). *(v1.6)* Head inside an opaque block, **or the body inside any solid block** (sand or gravel that fell on the child lands in the feet cell), pops on its own after 2 s.
- **Soft border:** at `rules.worldBorder` (512) from spawn, the player is pushed back gently (0.1 b/t) inside thickening fog (`renderer.setFogOverride(near, far)`, cleared with `null`).
- **Undo:** the U key or the Undo button. Reverts the last 50 player actions (one tap, one hold-break, one door, one bed or one explosion = one entry, including the second door/bed half and torches that fell off). Undo restores blocks only, never items. Data model in §8.5.2.
- **Bed nap:** with the day locked, a bed gives a short nap with stars (§2.5) instead of "you can only sleep at night".
- **Hints:** after 6–8 s without progress, show an animated pictogram for walk, turn, place, break, pick a block, fly. Each hint loops at most 3 times per session. A sparkle and chime on success.
- **Exit guards:** see §8.5.

---

## 3. Architecture

### 3.1 Modules and owner lanes

**Lanes**

- **CORE (built in parallel, first):**
  - **CORE-A** textures
  - **CORE-B** worldgen
  - **CORE-C** world data, lighting, mesher
  - **CORE-D** renderer and sky
  - **CORE-E** player, physics, input, raycast, interaction
- **FEATURE (built in parallel, second):**
  - **MOBS** mobs, entities, survival damage
  - **INV** inventory, crafting, furnace, chest UI, HUD
  - **AUDIO**
  - **MENUS** menus, title, save/load, settings, font, parent gate
  - **KID** touch and kid controls
  - **MECH** block mechanics
  - **FX** visual polish
- **LEAD:** the architect and integrator.

| File | Owner | Purpose |
|---|---|---|
| `build.mjs`, `tools/png.mjs`, `tools/serve.mjs`, `tools/smoke.mjs`, `tools/spec-tables.mjs`, `tools/scenarios/lead.mjs`, `tools/lane-worktree.mjs`, `tools/playtest.mjs` | LEAD | Build, static server, Playwright harness, spec appendix generator, lane worktrees, scripted integration playtest |
| `docs/SPEC.md`, `docs/STATUS.md` | LEAD | Specification; status record (integrator only) |
| `docs/handoff/<lane>.md` | each lane | That lane's handoff notes (§0.1) |
| `tools/scenarios/<lane>.mjs` | each lane | That lane's smoke scenarios |
| `test/foundation.test.mjs` | LEAD | Data and contract unit tests |
| `test/<lane>.test.mjs` | each lane | That lane's unit tests |
| `src/index.template.html`, `src/styles.css`, `src/main.js` | LEAD | Shell, base UI kit, bootstrap, loop |
| `src/core/constants.js`, `events.js`, `math.js`, `registry.js`, `hooks.js`, `settings.js`, `dom.js`, `stubs.js`, `types.js`, `time.js`, `testapi.js` | LEAD | Shared, frozen foundations |
| `src/ui/screens.js` | LEAD | Screen manager (`game.ui`) |
| `src/data/blocks.js`, `items.js`, `recipes.js`, `mobs.js` | LEAD | Content data (frozen; changes go through the integrator) |
| `src/textures/textures.js`, `toolkit.js`, `src/textures/*` | **CORE-A** | Procedural textures, item icons, pixel toolkit |
| `src/world/worldgen.js`, `noise.js`, `src/world/gen_*.js` | **CORE-B** | Terrain, biomes, caves, ores, trees, spawn |
| `src/world/column.js`, `world.js`, `lighting.js`, `mesher.js`, `src/worker/worker.js`, `src/world/*` (others) | **CORE-C** | Storage, streaming, light, meshing, workers (P1) |
| `src/render/renderer.js`, `sky.js`, `src/render/*` (except `celestial*`) | **CORE-D** | three.js renderer, shaders, sky, quality |
| `src/player/input.js`, `physics.js`, `raycast.js`, `player.js`, `interaction.js`, `src/player/*` | **CORE-E** | Input, collision, picking, movement, camera, break/place |
| `src/entities/entity.js` (foundation), `mobs.js`, `item_entity.js`, `src/entities/*`, `src/survival/*` | **MOBS** | Entities, mobs, AI, models, drops, health and hunger |
| `src/inventory/inventory.js` (foundation), `crafting.js`, `containers.js`, `src/inventory/*`, `src/ui/hud.js`, `src/ui/inventory_ui.js`, `src/ui/hud*`, `src/ui/inv_*` | **INV** | Inventory model, crafting, furnace, chest, HUD, container screens |
| `src/audio/*` | **AUDIO** | Synth sound effects, music |
| `src/ui/menus.js`, `src/ui/pixelfont.js`, `src/ui/parentgate.js`, `src/ui/menu_*`, `src/save/*` | **MENUS** | Screens, settings UI, font, gate, IndexedDB, autosave |
| `src/ui/touch.js`, `src/ui/touch_*`, `src/kid/*` | **KID** | Touch controls, kid helpers, exit guards, undo, hints |
| `src/mechanics/*` | **MECH** | Block behaviour |
| `src/fx/*`, `src/render/celestial*.js` | **FX** | Particles, view model, player model, sky objects, overlays |

### 3.2 Game object (`game`)

Created in `main.js`. Every system receives it.

```js
game = {
  version, dev,                 // build version string, DEV flag
  canvas, uiRoot,               // <canvas id="game-canvas">, <div id="ui-root">
  events,                       // EventBus (§6)
  settings,                     // global settings (core/settings.js DEFAULT_SETTINGS shape); change via game.setSetting(k, v)
  state,                        // 'boot' | 'title' | 'loading' | 'playing' | 'paused'
  meta,                         // WorldMeta of the open world or null (§3.6)
  textures,                     // TextureSet (CORE-A)
  icons,                        // ItemIconSet (CORE-A)
  inventory,                    // Inventory model (src/inventory/inventory.js)
  guiScale,                     // integer GUI scale (core/dom.js)
  tickCount, frameCount,
  perf: { fps, frameMs, workMs, tickMs },
  errors: [],                   // recorded errors (testapi exposes them)
  systems: [], sys: {},         // registration order, name -> system
  // system shortcuts (same objects as game.sys[name]):
  time, ui, input, world, player, interaction, mechanics, entities, mobs, survival,
  invui, hud, kid, touch, fx, audio, save, menus, renderer,
  // methods:
  setState(s), isCreative(), setMode('creative'|'survival'), setDifficulty(d), setRule(key, value),
  setSetting(key, value), reportError(err, where), startWorld(opts) -> Promise<meta>, exitToTitle() -> Promise,
  rand() -> [0,1)                 // shared gameplay random source (§0.3); setRandomSeed(seed) re-seeds it
  stepTicks(n) -> tickCount       // run n ticks synchronously + one frame (test API runTicks)
  afterTick: Set<fn(game)>        // LEAD/test only (recordTicks)
}
```

Rules:

- `game.state` changes only through `setState`, which emits `game:state`.
- Mode, difficulty and rules live in `game.meta`. Change them only through the setters, which emit events.

### 3.3 Stub protocol

- Each stub module calls `registerStub(name)` at import time. `main.js` imports every lane module, so all stubs are always registered.
- Stub names (CORE): `textures` `icons` (A) · `worldgen` `noise` (B) · `world` `lighting` `mesher` (C) · `renderer` `sky` (D) · `input` `physics` `raycast` `player` `interaction` (E).
- Stub names (FEATURE): `mobs` `items` `survival` (MOBS) · `invui` `hud` `crafting` `furnace` (INV) · `audio` `music` (AUDIO) · `menus` `save` `font` `gate` (MENUS) · `touch` `kid` (KID) · `mechanics` (MECH) · `fx` (FX).
- Smoke scenarios list `requires: [stub names]`. A scenario whose requirement is still a stub reports **PENDING**; with `--strict` it reports FAIL.

### 3.4 System lifecycle and order

```ts
interface System {
  name: string;                               // unique; key in game.sys and WorldMeta.systems
  stub?: boolean;
  init?(game): void | Promise<void>;          // once at boot
  tick?(game): void;                          // 20 TPS, only while state === 'playing'
  frame?(game, dt: number, alpha: number): void; // every requestAnimationFrame, all states; dt seconds (clamped 0.1), alpha = tick interpolation 0..1
  serialize?(game): object;                   // JSON-safe per-world data -> meta.systems[name]
  deserialize?(game, data: object | undefined): void; // on world start; undefined for a new world
  dispose?(game): void;
}
```

**Boot order** (`main.js`):

1. Build textures with `buildTextures()`, then `bindTextures()`.
2. Create all systems.
3. Build icons with `buildItemIcons()` and set `--icons-url`.
4. `init()`: **renderer first**, then the registration order below.
5. Install the pixel font.
6. Apply the GUI scale.
7. Register the service worker (http(s) only).
8. Start the loop.
9. `setState('title')`, emit `game:ready`, set `__game.ready = true`.

**Registration order.** This is also the tick and frame order:

`time → ui → input → world → player → interaction → mechanics → entities → mobs → survival → invui → hud → kid → touch → fx → audio → save → menus → renderer`

Consequences:

- `input.tick` snapshots edge presses first.
- The player moves before interaction targets.
- The renderer's `frame()` runs last and actually renders.

### 3.5 Main loop

- Fixed timestep: `TICK_DT = 0.05 s` (20 TPS), accumulator driven by `requestAnimationFrame`.
- `dt` is clamped to `MAX_FRAME_DT = 0.1 s`. At most 5 ticks run per frame; any further backlog is dropped, so the game slows down instead of spiralling.
- `alpha = acc / TICK_DT` is passed to `frame()`. Render-time positions are interpolated `prev → current`.
- Ticks run only in state `playing`. The `paused` state (pause, settings, title screens) freezes ticks. Container screens such as inventory, chest, crafting and furnace do **not** pause; they only capture input.
- Every system call is wrapped in try/catch. Errors go to `game.reportError`, are deduplicated, and are capped at 100.

### 3.6 World lifecycle and WorldMeta

**`game.startWorld(opts) → Promise<meta>`**

- New world: `opts = {preset, mode, difficulty, seed?, name?, rules?}`.
- Load: `{meta, columns}` exactly as returned by `game.save.loadWorld(id)`.

Steps:

1. Close any open world (no save).
2. Close any screen.
3. `setState('loading')`.
4. Build or normalise the meta.
5. Emit `world:starting {meta, isNew}`.
6. `world.open(meta, columns)` and `inventory.clear()`.
7. Call every `system.deserialize(game, meta.systems[name])`.
8. New world only: `findSpawn`, `player.spawn`, and the creative kid hotbar (`KID_CREATIVE_HOTBAR`).
9. Set the render distance.
10. `await world.pregenerate(cx, cz, min(3, R))`, emitting `world:progress`.
11. New world only: snap the player to `world.getSurfaceY`.
12. `setState('playing')`, set `__game.worldReady = true`, emit `world:ready {meta, isNew}`.

**`game.exitToTitle()`**

1. Run `save.saveNow('exit')` if the save lane is live.
2. Emit `world:exit {meta}`.
3. `world.close()`, `renderer.clearWorld()`, `entities.clear()`.
4. Set `meta = null` and `setState('title')`. Menus reopens the title on `world:exit`.

**WorldMeta** (JSON-safe; stored in IndexedDB `worlds`)

```js
{ id: 'w<base36 time><rand>', name: 'Sunny Meadow 12', seed: uint32,
  preset: 'default'|'flat'|'islands'|'snowy', mode: 'creative'|'survival', difficulty: 'peaceful'|'easy'|'normal',
  rules: { ...DEFAULT_RULES (+ SURVIVAL_RULES for survival; peaceful forces hostileMobs=false, hunger=false) },
  createdAt, lastPlayed, playTicks, spawn: {x,y,z}, home: {x,y,z,yaw}|null, thumbnail: dataURL|null,
  formatVersion: 1, systems: { time:{}, player:{}, survival:{}, invui:{inventory json}, entities:{list (loaded + parked)}, mobs:{populated}, mechanics:{}, kid:{} } }
```

### 3.7 Coordinates and conventions

**Axes and cells**

- Y is up. Block `(x, y, z)` occupies `[x, x+1) × [y, y+1) × [z, z+1)`. World y runs 0–127.
- North = −Z, south = +Z, east = +X, west = −X.

**Columns and sections**

- A column is `(cx, cz) = (x >> 4, z >> 4)`, with local coordinates `lx = x & 15`, `lz = z & 15`.
- Sections are `sy = y >> 4`, from 0 to 7.
- Column index: `colIndex(lx, y, lz) = lx | lz<<4 | y<<8`. Section `s` is the contiguous range `[s·4096, s·4096 + 4096)`.
- Map key for a column: `colKey(cx, cz) = 'cx,cz'`.

**Block values**

- A block value is a Uint16: `id | state << 8`. Ids are 0–255; state bits are per shape (`STATE` in blocks.js, §4.3).

**Faces** (`FACE`, same order as three.js BoxGeometry groups)

| Index | Face | Shade |
|---:|---|---:|
| 0 | east (+X) | 0.6 |
| 1 | west (−X) | 0.6 |
| 2 | up (+Y) | 1.0 |
| 3 | down (−Y) | 0.5 |
| 4 | south (+Z) | 0.8 |
| 5 | north (−Z) | 0.8 |

**Horizontal facing** (state bits 0–1)

- 0 = N, 1 = E, 2 = S, 3 = W. It is the direction the block's **front** points.
- `FACING_TO_FACE = [5, 0, 4, 1]`.
- Axis (logs, hay): 0 = Y, 1 = X, 2 = Z.

**Angles**

- Radians internally; degrees in the test API.
- `yaw = 0` looks north (−Z). **+yaw turns left** (counter-clockwise from above, the three.js `rotation.y` convention).
- `+pitch` looks up.
- Look vector: `(−sin yaw · cos pitch, sin pitch, −cos yaw · cos pitch)`.

**Entities**

- Position is the feet centre. Velocity is in blocks per tick.
- `prev*` fields hold the previous tick's values for interpolation.

**Units**

- Time in ticks unless named `ms` or `dt` (seconds).
- Distances in blocks.
- Colours `#rrggbb`, or 0–1 floats in shaders.
- **Gamma-space pipeline:**
  - `THREE.ColorManagement.enabled = false`; `renderer.outputColorSpace = LinearSRGBColorSpace`.
  - Textures use `NoColorSpace`, so texture bytes are displayed as is.
  - No lane uses three's built-in lit materials for world content.

### 3.8 Settings (`src/core/settings.js`)

Settings are global per device and stored in localStorage under `blockcraft:settings:v1`. Read them from `game.settings`. Change them **only** with `game.setSetting(key, value)`, which persists the change and emits `settings:changed`.

| Group | Keys (defaults) |
|---|---|
| Controls | `controls` (`'kid'` or `'classic'`), `touchControls` (`'auto'`, `'on'`, `'off'`), `lookSensitivity` (0.5), `turnSpeed` (0.5), `invertY` (false), `autoJump` (true), `autoPitch` (true), `buttonSize` (`'S'`, **`'M'`**, `'L'`), `touchOpacity` (0.85), `leftHanded` (false) |
| Video | `renderDistance` (0 = auto, else 3–12), `dynamicQuality` (true), `pixelRatioCap` (0 = auto), `fancyLeaves` (true), `waving` (true), `clouds` (true), `smoothLighting` (true), `viewBobbing` (false), `fov` (70), `brightness` (0.7), `guiScale` (0 = auto), `showFps` (false) |
| Audio | `masterVolume` (0.65), `musicVolume` (0.35), `sfxVolume` (1.0), `muted` (false) |
| Kid | `hints` (true), `speakNames` (false) |
| Misc | `lastWorldId` (null), `skin` (`{hair, shirt, pants, skin}` colours for the player model) |

Per-world rules live in `game.meta.rules` (§1.3, `DEFAULT_RULES` / `SURVIVAL_RULES` in constants, including `voidRescue`). Change them only with `game.setRule(key, value)`, which emits `rules:changed`.

**Who reacts to a setting change** (`settings:changed`). Settings without an owner here are read when used.

| Setting | Owner | Reaction |
|---|---|---|
| `renderDistance` | CORE-C (world) | `world.setRenderDistance(n)` immediately (0 = auto: CORE-D's preset). A manual value (≠ 0) **disables dynamic down-scaling of R** (DPR scaling still runs). |
| `smoothLighting` | CORE-C (world) | `world.remeshAll()` |
| `fancyLeaves` | CORE-D (renderer) | rebuild textures (`buildTextures({fastLeaves})`, `bindTextures`, `game.textures = …`), re-upload the array texture, then `world.remeshAll()` |
| `fov`, `viewBobbing`, `autoPitch`, `controls` | CORE-E | read live; `controls` also releases all input |
| `guiScale`, `buttonSize` | LEAD | `applyGuiScale` (already wired in `main.js`) |
| `waving`, `clouds`, `brightness`, `pixelRatioCap` | CORE-D / FX | uniforms / DPR updated live (`brightness` 0..1 = strength of the classic brightness lift `uGamma` plus the cave floor `uMinLight = 0.05 + 0.15·brightness`, §5.5.3) |
| `masterVolume`, `musicVolume`, `sfxVolume`, `muted` | AUDIO | gains updated live |

---

## 4. Content and data model

### 4.1 Overview

**Blocks** (`src/data/blocks.js`): 142 blocks with stable ids 0–141 (append-only). Appendix A has the full table.

- Terrain: stone, grass, dirt, cobble, bedrock, sand, gravel, sandstone, clay, snow block and layer, ice, water, lava, obsidian, mossy cobble, granite, diorite, andesite.
- 7 ores.
- 3 woods (log, planks, leaves, sapling each).
- 13 plants: grass, fern, dead bush, 8 flowers, sugar cane, cactus.
- Pumpkin, jack o'lantern, melon; crops (wheat, carrots, potatoes) and farmland.
- Glass, bricks, stone bricks, bookshelf, glowstone.
- Functional: crafting table, furnace (plus lit), chest, bed, door, ladder, torch, TNT.
- 7 storage blocks; hay; 3 slabs, 2 stairs, fence, fence gate, glass pane, fire, cake.
- Wool ×16, stained glass ×16, carpet ×16; brown and red mushrooms.

**Items** (`src/data/items.js`): 276 items. Appendix B lists them by data tab; the kid picker groups them into 8 picture tabs (`PICKER_TABS`, §8.2.4).

- One block item for every block with an item.
- 25 tools (5 types × 5 tiers), shears, flint and steel, buckets ×4.
- 16 dyes, 16 beds, foods, materials, 16 armour pieces (P1).
- Saddle, carrot on a stick, bow and arrow, boat, lead, painting.
- 11 spawn eggs.

**Recipes** (`src/data/recipes.js`): 191 crafting recipes (shaped and shapeless, with tags `#planks`, `#logs`, `#wool`, `#coals`) and 19 smelting recipes.

**Mobs** (`src/data/mobs.js`): 11 types plus the spawn constants. `MOBS[type].biomes` is the only biome list (`mobsForBiome`); `attack` is always `{easy, normal}`.

### 4.2 Registry API (`src/core/registry.js`, LEAD, pure)

**Enums and typed tables** (indexed by block id 0–255; undefined ids behave as air)

- `SHAPE` (`SHAPE.CUBE === 1`, …) and `PASS {OPAQUE 0, CUTOUT 1, TRANSLUCENT 2, NONE 3}`.
- `B_SHAPE`, `B_PASS`, `B_SOLID`, `B_OPAQUE`, `B_EMIT`, `B_FILTER` (opaque = 15), `B_HARDNESS`, `B_REPLACEABLE`.
- `B_LIQUID` (1 water, 2 lava), `B_WAVE`, `B_ANIM`, `B_GRAVITY`, `B_CLIMBABLE`, `B_SLIP`, `B_STATEFUL_TEX`, `B_DEFINED`.

**Names**

- `ID[name]` gives the numeric id (`ID.stone === 1`).
- `blockDef(id)`, `blockName(id)`, `idOf(name)` (throws on an unknown name).
- `isOpaque`, `isSolid`, `isReplaceable`, `isLiquid`.

**Textures**

- `faceTexKey(id, state, face) → string`.
- `REQUIRED_TEXTURE_KEYS` (sorted; includes `crack_0..9` and `missing`).
- `ANIMATED_TEXTURES {water: 1, lava: 2, fire: 3}`.
- `bindTextures(textureSet)`, `faceLayer(id, state, face) → array layer` (the base layer for animated textures), `texturesBound()`.

**Boxes**

- `getCollisionBoxes(id, state)` and `getSelectionBoxes(id, state)` return **shared, frozen** arrays of `[minX, minY, minZ, maxX, maxY, maxZ]` in block-local units. Fence and closed-gate collision reaches 1.5.
- `connectionState(getRaw, x, y, z, id) → bits`: N/E/S/W connection bits for a fence or pane from its neighbours (pure; CORE-E on placement, MECH on neighbour changes).

**Mining**

- `canHarvest(id, toolDef)`, `toolSpeed(id, toolDef)`, `breakTicks(id, toolDef, ctx) → ticks` (0 = instant, Infinity = unbreakable).
- `rollDrops(id, state, rand, toolDef) → ItemStack[]`.
- `blockItem(id) → itemKey | null`, `itemPlaces(itemKey) → {id, state} | null`.

### 4.3 Shapes and state bits

| Shape | Blocks | State bits | Collision / selection (block-local) | Mesher notes |
|---|---|---|---|---|
| cube | most | logs and hay: axis 0–1; facing blocks: facing 0–1; grass: bit 0 snowy; leaves: bit 0 persistent (player-placed) | full | AO, smooth light, culling; rotate side UVs for horizontal logs |
| cross | plants, saplings, mushrooms | sapling: bit 0 stage | none / [3,0,3]–[13,13,13] px | two diagonal quads, 0.9 wide, hash jitter ±0.15 in x/z, light from own cell, no AO |
| crop | wheat, carrots, potatoes | age 0–7 | none / height (age+1)·2 px | four planes in a `#` shape at 4/16 and 12/16 |
| liquid | water, lava | level 0–7 (0 = source), bit 3 falling | none / none (raycast with `fluids`) | top at 14/16 × (8−level)/8 when air is above (P0 flat; P1 averaged corners); faces only against non-opaque cells that are not the same liquid |
| torch | torch | 0 floor; 1–4 wall toward N, E, S, W | none / 4×10 px (shifted toward the wall) | 2×10×2 px box, tilted 22.5° for wall torches, light from own cell |
| slab | 3 slabs | bit 0 top; bit 1 double (P1) | half; double = full | half-cube faces; double = full cube faces |
| stairs (P1) | 2 stairs | 0–1 facing (ascending direction), bit 2 upside-down | slab + half block on the facing side | |
| door | oak_door | 0–1 facing, bit 2 open, bit 3 upper, bit 4 hinge right | 3/16 panel on edge `F` when closed; open → edge `(F+3)&3` (hinge left) or `(F+1)&3` | cutout pass, lower/upper texture |
| bed | bed | 0–1 facing (toward the head), bit 2 head, bit 3 occupied, bits 4–7 colour | 9/16 high | top texture rotated by facing; ends and sides from `texFn` |
| ladder | ladder | 0–1 facing (away from the wall) | 3/16 panel on edge `(F+2)&3` | single quad 1/16 off the wall, cutout |
| layer | snow | 0–2 layers−1 | collision (n−1)/8, selection n/8 | |
| carpet | 16 carpets | — | 1/16 | |
| farmland | farmland | 0–2 moisture (7 = wet) | 15/16 | top texture dry or wet |
| cactus | cactus | 0–3 age | collision inset 1/16 and 15/16 high; selection inset, full height | side faces inset by 1/16 |
| chest | chest | 0–1 facing | inset 1/16, 14/16 high | box model with front texture on the facing side |
| cake (P1) | cake | 0–2 bites | x from (1+2·bites)/16 to 15/16, 8/16 high | west face shows `cake_inner` once bitten |
| fence (P1) | oak_fence | bits 0–3 connections N/E/S/W (`connectionState`) | post 4/16 wide plus one arm per bit; collision 1.5 high, selection 1.0 | post plus two rails per connected side |
| gate (P1) | oak_fence_gate | 0–1 facing, bit 2 open | closed: 4/16-thick panel across the facing axis, collision 1.5; open: no collision, same selection | two posts plus rails; open = rails swung inward |
| pane (P1) | glass_pane | bits 0–3 connections | post 2/16 plus arms, full height | thin glass; cutout pass |
| fire (P1) | fire | 0–3 age | none / 1/16 | 4 inward-tilted planes, animated |

### 4.4 Block def fields

The field reference is at the top of `src/data/blocks.js`. Key semantics:

- `opaque`: a full light-blocking cube. It culls neighbour faces and casts AO.
- `solid`: has collision. The exact boxes come from the registry.
- `pass`: the render pass. It is independent of `opaque`; for example lava is pass opaque but not `opaque`.
- `filter`: extra light lost entering the cell. Leaves, water and ice are 1; glass 0; opaque 15. **Slabs and stairs are 15** while staying non-`opaque`, so a slab or stair roof keeps sky light out but still gets no face culling or AO.
- `drops`, `dropFn`, `requiresTool`: interpreted only by `registry.rollDrops`. Always call that function (with `game.rand`); never re-implement drop logic.
- `support`, `placeOn`: placement validity (CORE-E) and support checks (MECH).
- `fallMult`: fall damage multiplier on landing (hay 0.2, bed 0.5).
- `contactDamage`: 1 for cactus (MOBS applies it).

### 4.5 Items

- An ItemStack is `{item: string, count: number, damage?: number, data?: object}`. An empty slot is `null`.
- Stack sizes: 64; 16 for eggs, snowballs and buckets; 1 for tools, armour, filled buckets, beds, saddles, stew, cake and boats.
- `creative: false` items never appear in the picker: lava bucket and **bedrock** (a child could place bedrock and never remove it).
- Icons are one of:
  - `iso:<block>`: CORE-A draws an isometric cube from the block's top and side textures, with proportional slab, stairs and carpet versions.
  - `tex:<texture key>`: a flat block texture (plants, torch, ladder).
  - `sprite:<name>`: CORE-A paints an original 16×16 sprite. `dye`, `bed` and `spawn_egg` sprites are tinted with the item's `tint` or `colors`.

### 4.6 Crafting rules

FEATURE-INV implements these in `src/inventory/crafting.js`.

- **Shaped recipes:**
  - Trim the pattern to its bounding box.
  - It may sit anywhere in the grid, and a horizontal mirror also counts.
  - Every grid cell outside the pattern must be empty.
- **Shapeless recipes:** the multiset of non-empty cells equals the ingredient list exactly.
- **Tags:** an ingredient written `#tag` accepts any item in `TAGS[tag]`.
- **Grid size:** a 2×2 grid only matches patterns or ingredient lists that fit in 2×2 (4 or fewer ingredients).
- **First match wins** (array order).
- **Consumption:** one item per used cell; `REMAINDERS` items (milk, water or lava bucket) leave an empty bucket behind.
- **Smelting:** 200 ticks per item. Fuel burn times come from `items.js fuel`: coal 1600, planks and logs 300, stick 100, coal block 16000, lava bucket 20000.

---

## 5. CORE lanes A–D

### 5.1 CORE-A — Textures (`src/textures/*`)

**API.** The stub `src/textures/textures.js` has the full JSDoc.

```js
export const TEX_SIZE = 16, ICON_SIZE = 32;
export function buildTextures(opts?: {fastLeaves?, halfAnim?}): TextureSet & { animated: Map<key,{mode,frames,fps}> }   // PURE, no DOM
// halfAnim: water and lava get 8 frames (only for GPUs with < count layers); CORE-D then uses the `animated` frame counts in the shader
export function getTexturePixels(textureSet, key, frame = 0): Uint8Array   // 16*16*4 view
export function buildItemIcons(textureSet): ItemIconSet                    // browser (canvas)
// TextureSet: { size: 16, count, data: Uint8Array(16*16*4*count), index: Map<key, layer>, layer(key) -> base layer ('missing' for unknown) }
// ItemIconSet: { size: 32, canvas, cols, rows, url (data: PNG), index, rect(key), style(key, px), element(key, px) -> <span class="bc-icon">, pixels16(key) -> RGBA 16x16, has(key) }
```

**Contract**

1. **Layer list.** It is exactly `REQUIRED_TEXTURE_KEYS` in sorted order. Animated keys take consecutive layers:
   - `water`: 16 frames at 8 fps
   - `lava`: 16 frames at 4 fps
   - `fire`: 8 frames at 12 fps

   The total is about 238 layers and must stay ≤ 256 (the WebGL2 minimum `MAX_ARRAY_TEXTURE_LAYERS`); `test/foundation.test.mjs` asserts it. New blocks should reuse existing textures where they can (the gate and pane do). If `renderer.gpu.maxLayers < count` on some device, CORE-A rebuilds with `buildTextures({halfAnim: true})` (water and lava at 8 frames) and CORE-D uses that.
2. **Pixel layout.** Row 0 is the TOP row of the image. RGBA8 is straight (not premultiplied) alpha.
3. **Cutout textures** (leaves, glass, plants, crops, torch, ladder, door, fire): alpha is 0 or 255 only. Fill the RGB of transparent texels with the average of nearby opaque texels so mipmaps don't get dark fringes. *(v1.3)* Fancy leaves are about 40 % see-through (spruce 36 %), with the holes clustered around the leaf clumps, so canopies read as leaves rather than solid green cubes.
4. **Translucent textures** (water α≈175, ice α≈190, stained glass α≈150): constant alpha per texture is fine. *(v1.3)* Water keeps a low contrast (luma standard deviation about 8–10 per frame) with soft, moving crests: every water block shows the same frame, so contrast reads as a block grid across lakes and oceans.
5. **Determinism.** Each texture is seeded from `hashString(key)`, so the same bytes come out every run. This is unit-tested.
6. **Crack stages** `crack_0..9`: black pixels at α150 with α70 neighbours. Stage s shows the first `ceil(60·(s+1)/10)` pixels of 3 random-walk crack paths.
7. **Tint-free.** Biome tints are baked in: a single grass colour (`#78b84a` family) and per-species leaf colours. There is no per-vertex tint attribute.
8. **Style.**
   - 4–6 palette colours per texture.
   - No anti-aliasing, so no `arc` or `fillText`.
   - All neighbourhood operations wrap so tiles join seamlessly.
   - Use the palettes and recipes in the research notes (grass, dirt, stone, cobble, planks, logs, ores, wool palette = `COLOR_HEX`, TNT, crafting table, furnace, glass, glowstone, flowers, crops, door, bed).
   - Designs must be original; do not trace Mojang art.
9. **Icons.**
   - The 32 px atlas cell is either an isometric block (top full brightness, left ×0.8, right ×0.6) or a 16 px sprite drawn at 2×.
   - Sprites: stroke shapes, then a top-left bevel, then a dark outline.
   - Spawn eggs use `colors`, dyes and beds use `tint`.
   - `element(key, px)` must render crisply (`image-rendering: pixelated`) at any multiple of 16.
10. **Toolkit** (`toolkit.js`, also used by MOBS and FX): `texRng`, `hash2`, `vnoise` (tiling), `fbm`, `voronoiWrap`, `quant`, `PixelCanvas {set, get, alpha, fill, bevel, outline, copyTo, toCanvas}`. Keep the signatures and determinism.

**Performance:** `buildTextures` under 60 ms and `buildItemIcons` under 150 ms on a mid laptop. Both run at boot before the title screen.

### 5.2 CORE-B — Worldgen (`src/world/worldgen.js`, `noise.js`)

**API**

```js
export const BIOMES   // [{id, name, surface, filler, trees:{kinds, perColumn}, flowers, grassDensity, snowLayer?}] ids 0..8 save-stable (animals: data/mobs.js)
export const BIOME_BY_NAME
export function generateColumn(seed, cx, cz, preset, out: {blocks: Uint16Array(32768) zeroed, biomes: Uint8Array(256)}) -> out
export function getTerrainHeight(seed, x, z, preset) -> y of top terrain block (pre-decoration)
export function getBiomeAt(seed, x, z, preset) -> biome id
export function findSpawn(seed, preset) -> {x: bx+0.5, y: feet, z: bz+0.5}
export function placeTree(set(x,y,z,id,state), get(x,y,z)->id, x, y, z, kind: 'oak'|'birch'|'spruce', rand) -> boolean
// noise.js
export function createNoise(seed) -> {noise2(x,y) in [-1,1], noise3(x,y,z) in [-1,1]}
export function fbm2(n2, x, y, octaves=4, lacunarity=2, gain=0.5)
```

**Requirements**

- **Pure and deterministic.** No DOM, no three.js, no `Math.random`. Use your own seeded simplex with a Fisher-Yates permutation.
- **Pull model.** Features that cross column borders (trees, ore blobs, cave worms) are computed from deterministic positions: `hash(seed, wx, wz)`, with candidates searched in neighbouring columns within the maximum feature radius (3 for trees). Only cells inside the column being generated are written, so there are no cross-column writes and it can run in a worker.
- **`default` preset ("Hills & trees", gentle for kids)**
  - Continentalness, erosion and peaks/valleys 2D noise with piecewise-linear splines.
  - Most land between y 50 and 72, occasional hills to about 95, oceans down to about y 30, sea level 48. Water fills air below y 48.
  - Beaches of sand within ±2 of sea level near the coast.
  - Biomes come from temperature/humidity noise at about 1/700 scale (*v1.3: 1/800*). They **only** change the surface and decoration, never the height, to avoid cliffs at biome borders.
  - *(v1.3)* Hills cool toward taiga and snow only outside hot climates, and the mountain snow line rises in a warm climate (`102 + 40 · max(0, temp)`), so a desert never borders snow (unit test `coreb climate`).
  - Layers: bedrock at y = 0 plus a random 1–3 above it; stone; 3–4 filler blocks; surface block.
  - Caves: "spaghetti" style — `|n1| < 0.08 && |n2| < 0.08` on a 4×4×4 lattice, trilinearly interpolated. Mostly below y 44, rare surface openings. Never carve within 2 blocks of water or the ocean floor.
  - Ores (blobs replacing stone):

    | Ore | y range | Blob size | Per column |
    |---|---|---:|---:|
    | Coal | 5–100 | 8 | 12 |
    | Iron | 5–64 | 6 | 8 |
    | Gold | 5–32 | 6 | 2 |
    | Lapis | 5–30 | 5 | 1 |
    | Redstone | 5–16 | 6 | 4 |
    | Diamond | 5–16 | 4 | 1 |
    | Emerald (mountains) | 5–30 | 1 | 1 |
    | Granite, diorite, andesite | 5–80 | 24 | 2 each |
    | Gravel | 5–64 | 16 | 2 |
    | Dirt | 5–64 | 16 | 2 |
    | Clay (under shallow water) | — | 6 | — |

  - Trees per biome density: oak height 4–6 with a leaf blob; birch 5–7; spruce 6–9 with a cone. Never on sand or in water.
  - Decoration: flowers in patches of 3–8 from the biome list, short grass, ferns, dead bushes (desert), cactus (desert, 1–3 tall), sugar cane (next to water, 1–3), pumpkins (rare, 1 in about 40 columns), melons (rare). *(v1.6)* The ground under a pumpkin, melon or boulder stone is dirt, not grass (grass under an opaque block turns to dirt by itself, which remeshed every new area in its first minutes).
  - Snowy biome: snow layer (state 0) on top of every exposed solid block; ice where sea water meets air.
- **`flat` preset:** exactly bedrock at y 0, dirt at y 1–2, grass at y 3. The player stands at y = 4. No decoration in P0; P1 adds a few flowers and trees at hashed positions, at most 1 tree per 4 columns.
- **`snowy` (P1)** forces the snowy biome. **`islands` (P2)** is an archipelago over ocean.
- **Spawn:** search outward in a spiral from (0, 0) to radius 256 for a dry grass surface at least 3 blocks from water, with no leaves above. Return the feet position at the block centre. It must be deterministic.

- *(v1.2, as built by CORE-B)* Extra decoration: mossy-cobblestone boulders (taiga, some forests and mountains), branching oaks (plains and forests), mushrooms on cave floors and rarely in forests. Lava pools in carved cells at y ≤ 6 (D14). "Water fills air below y 48" means sea water above the terrain top; cave air below 48 stays dry. Flat-preset decoration keeps 24 blocks clear around the origin. `generateColumn` uses shared scratch memory: never run two at once in one thread or worker.

**Performance:** `generateColumn` under 3 ms per column on a mid laptop (8 sections of noise plus decoration), measured in a unit test with a fast desktop budget of 1 ms.

### 5.3 CORE-C — World, lighting, mesher (`src/world/*`)

#### 5.3.1 Data layout (frozen; `src/world/column.js`)

- **`Column`:**
  - `cx`, `cz`
  - `blocks: Uint16Array(32768)`, indexed by `colIndex`
  - `light: Uint8Array(32768)` (sky << 4 | block)
  - `heightmap: Uint8Array(256)` (lowest y such that every cell at or above it has filter 0)
  - `biomes: Uint8Array(256)`
  - `state` (`COL_STATE`: EMPTY 0, GENERATED 1, LIT 2, MESHED 3)
  - `dirtyMask` and `nonEmptyMask` (8-bit section masks)
  - `modified`, `saveDirty`, `fresh`
  - `blockEntities: Map<colIndex, object>`
  - `lastTouched`
- **Memory:** about **98 KB per loaded column** (64 KB blocks + 32 KB light + small arrays). Columns unload at R + 5 (*v1.3*), so R = 6 keeps up to about 380 columns (≈ 37 MB) and R = 12 about 910 (≈ 89 MB).
- **Unloaded modified columns** stay in `world.savedColumns` as **encoded bytes** (`save/codec.js`, typically 1–4 KB) and are decoded lazily in `ensureColumn`. `loadWorld` hands columns over encoded (`{data, blockEntities}`); it never decodes them all up front.

#### 5.3.2 World API (`game.world`; frozen; the stub implements every member)

```js
name 'world'; isOpen; seed; preset; renderDistance; columns: Map; savedColumns: Map; pendingSave: Map; center {cx, cz}
// column record: {data?: Uint8Array (codec bytes), blocks?: Uint16Array(32768), blockEntities?: [{i: colIndex, data}]} - data or blocks
open(meta, savedColumns: Map<colKey, record> | null)
close()
getColumn(cx, cz) -> Column | null
isColumnLoaded(cx, cz) -> bool          // generated AND lit (gameplay-safe)
forEachColumn(fn(col))
getRaw(x, y, z) -> uint16               // 0 out of range / unloaded
getBlock(x, y, z) -> id ; getState(x, y, z) -> state
getLight(x, y, z) -> sky<<4|block        // y >= 128 or unloaded: 0xF0 ; y < 0: 0
getSkyLight(x, y, z) ; getBlockLight(x, y, z)
getHeight(x, z) -> heightmap value (128 if unloaded)
getSurfaceY(x, z) -> feet y standing on the highest collision box top; -1 if none
setBlock(x, y, z, id, state = 0, opts = {cause, silent, keepBlockEntity, action}) -> bool
beginBatch() ; endBatch() ; inBatch() -> bool ; setBlocks([[x, y, z, id, state?], ...], opts) -> changed count
markSectionDirtyAt(x, y, z) ; markSectionDirty(cx, sy, cz) ; remeshAll()
unmeshedWithin(r) -> number of columns within r of the player's column that are not MESHED   // v1.3: the player's CURRENT column (right after a teleport too)
getBlockEntity(x, y, z) ; setBlockEntity(x, y, z, data|null) ; forEachBlockEntity(fn(data, x, y, z))
setRenderDistance(n)                    // clamps 3..12, emits 'world:renderDistance'
ensureColumn(cx, cz) -> Column          // synchronous generate/restore + light
meshColumn(col)                          // synchronous mesh of dirty sections
pregenerate(cx, cz, radius, onProgress(done,total)) -> Promise   // spawn area; yields between ~14 ms slices
frame(game, dt)                          // streaming (§5.3.3)
getDirtyColumns() -> [[cx, cz]] ; exportColumn(cx, cz) -> {blocks: Uint16Array copy, blockEntities: [{i, data}]} | null ; markColumnSaved(cx, cz)
stats() -> {columns, columnsMeshed, genAvgMs, meshAvgMs, renderDistance, savedColumns, pendingSave, ...}
// v1.2 additions (CORE-C): disableWorkers(reason) ; enableWorkers() ; stats() also has columnsLit, sectionMeshes, lightAvgMs,
// workers, workerReason, inFlight, genInFlight, workerMeshes, workerGens, syncMeshes, urgentMeshes, droppedResults, streamMs
```

**`setBlock` semantics.** It does all of the following in one synchronous call:

1. Write the value.
2. Drop the block entity unless `keepBlockEntity`.
3. Set `modified` and `saveDirty` (unless `cause === 'worldgen'`).
4. Update the heightmap.
5. Run the **incremental relight** (both channels, across columns).
6. Mark dirty the section and any neighbour sections touched on borders, including those whose AO or smooth light changed.
7. Emit `block:changed {x, y, z, oldId, oldState, id, state, cause, action}` unless `silent`. `action` is `opts.action` (0 when none), the id KID groups undo by (§8.5.2).

It returns false for an unloaded column, out-of-range y, or no change.

**Batches** (`beginBatch` / `endBatch`, nesting allowed, always paired with try/finally). Inside a batch, steps 1–4 and 7 run per cell as usual (`block:changed` is still emitted per cell, immediately), but steps 5–6 are deferred: the outermost `endBatch()` runs **one combined relight** (`lighting.relightBatch`, a single removal + propagation BFS seeded from every changed cell) and merges the dirty sections. Light values read inside a batch are stale. Explosions, tree growth (`placeTree` through a batch), fluid spreading and bone-meal patches must use batches; a 600-block explosion then costs one relight, not 600.

**Persistence invariant** (fixes "saved edits lost on unload"):

- A **loaded** column is the authority for its own data.
- For every **modified column that is not loaded**, `world.savedColumns` holds its latest data. Unloading a modified column always writes its export there (encoded); if the column is also unsaved (`saveDirty`), the export goes into `world.pendingSave` as well.
- `markColumnSaved(cx, cz)` clears `saveDirty` on a loaded column and **moves** a `pendingSave` record into `savedColumns`; it never drops data.
- `ensureColumn` restores from `pendingSave` first (the column stays `saveDirty`), then from `savedColumns`; both records are dropped once the column is loaded again.
- Smoke `lead-unload-persist` and the `CONTRACT world` unit test pin this.

**Remesh latency.** The world remeshes sections dirtied by edits **in the same frame**, before any streaming work and outside the budget. A 5-year-old must never see a delay between the click and the change.

#### 5.3.3 Streaming pipeline

- **States:** EMPTY → GENERATED (terrain plus decoration from `generateColumn`, or restored from save) → LIT (needs the 3×3 neighbourhood GENERATED) → MESHED (needs the 3×3 neighbourhood LIT).
- **Radii:** data out to R + 3 (`DATA_MARGIN` + 1, so the diagonal neighbours of every lit column exist; light reaches about R + 1.5), meshes within R (circular), meshes dropped beyond R + 1 (the column goes back to LIT, bounding draw calls and geometries), unload beyond R + 4 (`UNLOAD_MARGIN`). *(v1.2: as built by CORE-C.)*
- *(v1.3, review CORE-R1)* The mesh radius is **M = R + `MESH_MARGIN` (1)**: one ring beyond the fog radius, so every gap of the circular mesh radius (and the newest, still-streaming ring) lies past `fogFar` = (R − 0.5)·16 and the fog can be a crisp linear ramp from 0.8 · `fogFar`. Data to M + 3 = R + 4, light to M + 1.5, meshes dropped beyond M + 1, unload beyond R + 5 (`UNLOAD_MARGIN`). Draw calls at R 6 stay about 150–200 (budget 300).
- *(v1.4, review CORE-R10; v1.5, review CORE-R11)* The extra ring and the M + 1 drop hysteresis cost little drawing: the renderer skips fully fogged geometry beyond `uFogFar` + 0.5 wherever the sky behind it is the fog colour (§5.5.6 "Fog cull"). Parts that rise above the horizon (a distant mountain, a tall tree) are drawn and show as pale fogged silhouettes, exactly as without the cull. The columns stay meshed and cached, so a column is ready the moment it comes within the fog. Draw calls at R 6: about 183 (`cored-perf`; 157 with v1.4, which also hid those silhouettes).
- **Order:**
  - Precomputed offsets sorted by distance², with a look-direction bias of `dist² − 2·dot(lookDir, offset)`.
  - Rebuild the queue when the player crosses a column border.
- **Budget:**
  - `RENDER.CHUNK_BUDGET_MS` (4 ms) per frame while playing, scaled down to 2 ms when `perf.frameMs > 20`.
  - 14 ms while loading.
  - Edits are never budgeted.
- **Unload:** every modified column is exported into `savedColumns` (and into `pendingSave` when unsaved, for MENUS) per the persistence invariant above; then the renderer drops the meshes with `removeColumnMeshes`, the column is deleted, and `world:columnUnloaded` is emitted (the entity manager parks that column's entities).
- **Events:**
  - `world:columnGenerated {cx, cz, fresh}` when terrain exists (not lit yet — do not read light here).
  - `world:columnLoaded {cx, cz, fresh}` when lit. **MOBS spawns chunk-generation animals here** for `fresh` columns not in its `populated` set.
- **Saved data wins:** columns found in `pendingSave` or `savedColumns` are restored instead of generated (`fresh = false`).
- **Settings:** the world listens for `renderDistance` and `smoothLighting` changes (§3.8).

#### 5.3.4 Lighting (`lighting.js`)

```js
export function computeHeightmap(col)
export function lightColumn(world, col)                       // GENERATED -> LIT, incl. border reconciliation with LIT neighbours
export function relightBlock(world, x, y, z, oldRaw, newRaw)   // incremental, called by setBlock
export function relightBatch(world, changes)                   // flat [x, y, z, oldRaw, newRaw, ...]; one combined pass (endBatch)
```

- Two-channel BFS using a preallocated `Int32Array` ring queue of packed world coordinates.
- **Removal:** a queue of `(pos, oldLevel)`, run fully, then re-propagation.
- **Sky special case:** level 15 moving down through filter-0 cells stays 15.
- **Initial lighting:**
  - Fill 15 above the heightmap.
  - Seed the BFS only from sky-15 cells with a darker non-opaque horizontal neighbour.
  - Seed block light from emitters.
- **Border reconciliation:** when a column becomes LIT, re-seed propagation from both sides of every border it shares with an already-LIT neighbour. Mark the touched neighbour sections dirty.
- **Typical costs:** an edit < 1 ms; removing a big roof may take 5–20 ms, which is allowed once. **Initial lighting of one column ≤ 2 ms on the SwiftShader proxy** (`RENDER.LIGHT_COLUMN_BUDGET_MS`, benchmarked by CORE-C); a 600-cell batch relight ≤ 15 ms on the dev machine.
- **Unit tests** (CORE-C writes them):
  - A torch next to a column border lights both sides symmetrically.
  - Removing it returns all cells to 0.
  - Sky light under a 1-block roof equals 14 at the edge and decays inward.

#### 5.3.5 Mesher (`mesher.js`)

```js
export const PADDED_VOLUME = 5832, FACE_CORNERS, CORNER_UV, QUAD_INDICES = [0,1,2, 0,2,3]
export function buildPadded(world, cx, sy, cz, outBlocks: Uint16Array(5832), outLight: Uint8Array(5832)) -> bool (section has blocks)
export function meshSection(paddedBlocks, paddedLight, opts: {fancyLeaves, smoothLighting, waving}) -> SectionMesh | null
export function meshBlockModel(id, state) -> MeshBuffers          // isolated block, x/z in [-0.5,0.5], y in [0,1]
```

**Padded input**

- Copies the section plus a 1-cell border from 26 neighbours.
- Index: `padIndex(x, y, z) = (x+1) + (z+1)·18 + (y+1)·324` for x, y, z in −1..16.
- Cells outside the world are air: light 0xF0 above, 0 below. Unloaded neighbours are air with 0xF0.

**Output: `SectionMesh = {opaque, cutout, translucent}`**

- Each entry is `MeshBuffers | null`, or the whole result is `null` if empty.
- `MeshBuffers = {position: Float32Array(quads·12), tex: Uint16Array(quads·16), light: Uint8Array(quads·16), corner: Uint16Array(quads·16), quads}`. There are 4 vertices per quad and **no index array**: the renderer uses `QUAD_INDICES` offset by 4 per quad. *(v1.4)* `corner` is new; a producer without it still works (the renderer builds it from `light`, `chunkmerge.withCorner`).

| Attribute | Layout per vertex | Meaning |
|---|---|---|
| `position` | f32 x, y, z | Section-local (0..16). Plants and torches use fractional values. |
| `tex` (`aTex`) | u16 `layer`, u16 `u`, u16 `v`, u16 `flags` | `u`, `v` in 1/256 of a tile (0..256): `u` grows left to right, `v` grows top to bottom (v = 0 is the image's top row). `flags`: bits 0–2 face (0–5, 6 = non-axis plant); bits 3–4 `ANIM` mode; bits 5–6 `WAVE` mode; *(v1.4)* bits 7–8 which corner of its quad this vertex is (0 BL, 1 BR, 2 TR, 3 TL, see below); bits 9–15 reserved (0). |
| `light` (`aLight`) | u8 `sky16`, u8 `block16`, u8 `ao`, u8 `shade` | This vertex's light: `sky16`/`block16` = smooth light × 16 (0..240); `ao` 0..3 (3 = unoccluded); `shade` = face shade × 255. Block models and entity atlas meshes draw from it; *(v1.4)* chunk geometry does not upload it. |
| `corner` (`aCorner`) *(v1.4)* | 4 × u16, the same on all 4 vertices of a quad | The quad's four corner lights in corner order BL, BR, TR, TL, each `sky8 \| block8 << 7 \| ao << 14` with `sky8`/`block8` = smooth light × 8 (0..120) and `ao` 0..3. The chunk shader blends them bilinearly per pixel. |

**Vertex order.** Each quad's corners are bottom-left, bottom-right, top-right, top-left **as seen from outside** (CCW = front face). See `FACE_CORNERS`: the up face has its texture top toward north, the down face toward south. The quad flip rotates the start corner by one when `a00 + a11 > a01 + a10`, using combined AO × light brightness. *(v1.3, review CORE-R2)* The diagonal runs through the corner pair that differs most (`|a00 − a11|` against `|a01 − a10|`), so a single odd corner, dark or torch-bright, is shared by both triangles and spreads instead of making a sharp wedge; ties keep the rule above. *(v1.4, review CORE-R2)* That flip only helped faces with a single odd corner; torch light falls off in a diamond, so most cave faces have two or more differing corners and still showed sharp triangle wedges. Every quad now carries its four corner lights (`corner`) and each vertex names its own corner (flag bits 7–8; the vertices run around the quad, so with the flip the ids are a rotation of 0, 1, 2, 3). The chunk shader blends light and AO bilinearly per pixel, so no face has a diagonal whatever its corners are, and AO is a soft gradient instead of steps. The flip still runs but no longer changes the picture.

**Rules**

- **Culling:** a face is emitted unless the neighbour is `B_OPAQUE`. Same-id non-opaque neighbours are culled for glass, stained glass, water and ice. Leaves are culled against leaves only when `fancyLeaves` is false.
- **Liquids:** emit faces only toward non-opaque cells that are not the same liquid. The water top is translucent at 14/16 height. Lava is in the opaque pass.
- **AO** (0fps): `s1 = opaque(p+n+u)`, `s2 = opaque(p+n+v)`, `c = opaque(p+n+u+v)`, `ao = s1 && s2 ? 0 : 3 − (s1 + s2 + c)`. Only `B_OPAQUE` cells occlude.
- **Smooth light:** average sky and block light over the same 4 cells, excluding opaque cells, and excluding the corner when `s1 && s2`. When `smoothLighting` is off, use the face neighbour's light and ao = 3.
- **Pass:** `B_PASS[id]`. Cross plants, crops, torch, door, ladder, fire, leaves and glass go in cutout. Water, ice and stained glass go in translucent.
- **Allocation:** write into preallocated scratch arrays and `slice()` exact copies for output. Nothing is allocated per quad.

**Performance:** under 0.6 ms per typical surface section on a desktop, and under 2 ms on a weak laptop.

**Workers (P0).** Creative flight is 10.9 m/s and children fly constantly: at R = 6 that is about 13 new columns every 1.5 s, each needing generation, lighting and 8 meshed sections, which the 4 ms main-thread budget cannot keep up with on a weak laptop. So generation and meshing run in a blob worker from the start; the main thread keeps lighting, edits and the fallback. `src/worker/worker.js` is bundled as a classic IIFE and injected as `WORKER_SRC`. Create it with `new Worker(URL.createObjectURL(new Blob([WORKER_SRC])))` inside try/catch, with a main-thread fallback (also used in Node tests). The kid flight cap (§2.1 step 11a) is the safety net.

- Protocol: `{id, op: 'generate', seed, cx, cz, preset}` returns `{id, ok, blocks, biomes}`; `{id, op: 'mesh', blocks, light, opts, version}` returns `{id, ok, mesh}`.
- Use transferables. Results older than the section's edit version are dropped.
- The worker needs the texture layer table: send `textureSet.index` entries once (`{op: 'init', layers: [...]}`) and call `bindTextures({layer: k => map.get(k)})` in the worker.

### 5.4 Shared mesh contract (C → D)

CORE-D builds one `BufferGeometry` per section per pass:

- `position`: `BufferAttribute(Float32Array, 3)`.
- `aTex`: `BufferAttribute(Uint16Array, 4)`, **not normalised**, read as float in the shader (no `gpuType` integer path).
- `aLight`: `BufferAttribute(Uint8Array, 4)`, **not normalised** — block models and entity atlas meshes only. *(v1.4)* Chunk geometry does not upload it: the chunk shader takes the face shade from the face bits and the light from `aCorner`.
- *(v1.4)* `aCorner`: `BufferAttribute(Uint16Array, 4)`, **not normalised**, read as float (exact up to 65535) and decoded in the vertex shader. Chunk vertices are 28 bytes (position 12, `aTex` 8, `aCorner` 8; 24 before). Measured chunk geometry, seed 4242: about 35 MB at R 6 and 124 MB at R 12 (`.tmp/r10/mem.mjs`). Merged column arrays keep `position`, `tex` and `corner` only.
- Index: a view of one shared, precomputed `Uint16Array` of `QUAD_INDICES` for 16384 quads (`subarray(0, quads·6)`); one `BufferAttribute` per geometry. A pass with **more than 16384 quads** (a section dense with stairs, fences or panes) uses a second shared `Uint32Array` index buffer, grown by doubling; the mesher never has to split.
- Bounds: set `boundingSphere` and `boundingBox` manually (centre (8, 8, 8), radius 13.86).
- The mesh sits at `(cx·16, sy·16, cz·16)` with `matrixAutoUpdate = false`.
- *(v1.2, as built by CORE-D, allowed by §5.5.6)* Opaque and cutout geometry is **merged per column per pass** (one draw each). An edited section is drawn as its own small "hot" mesh the same frame while its old quads in the column buffer collapse to degenerate triangles; the column is re-merged 3 s after the last edit. Translucent geometry stays per section and keeps its own index copy so its quads can be re-sorted back to front.
- *(v1.2)* The mesher never mutates a `MeshBuffers` after handing it to `setSectionMesh` (hot and translucent meshes use the arrays directly; context restore re-uploads them).

### 5.5 CORE-D — Renderer and sky (`src/render/*`)

#### 5.5.1 Responsibilities

**Why one array texture instead of an atlas:** WebGL2 `DataArrayTexture` layers never bleed into each other, so there is no need for atlas gutters, half-texel insets or per-tile mip tricks. Mipmaps work per layer, which removes the far-distance sparkle. Layers are addressed by an integer (`aTex.x`). The two costs are the 256-layer minimum guarantee (we use about 238, D5) and needing WebGL2, which every target browser has.

- The WebGL2 renderer and the gamma-space pipeline (§3.7).
- The `DataArrayTexture`: `magFilter` Nearest, `minFilter` NearestMipmapLinear, mipmaps, flipY false, `NoColorSpace`. *(v1.2: no anisotropy. Forcing it through ANGLE/D3D11, which every Windows laptop uses, switched magnification to linear and blurred the pixel art.)*
- Three chunk `ShaderMaterial`s sharing one uniforms object.
- Section mesh management, sky, fog, selection outline.
- Entity materials and block models, the view-model pass.
- Dynamic quality, context loss, stats, the debug overlay (F3 `debug` action).

#### 5.5.2 API (`game.renderer`; frozen)

```js
three: THREE.WebGLRenderer ; scene ; camera (PerspectiveCamera, rotation.order 'YXZ') ; worldGroup ; dynamicGroup
viewModelScene ; viewModelCamera          // rendered after the world with a depth clear (held item / hand)
uniforms: {uTex, uDaylight, uSkyColor, uFogColor, uFogNear, uFogFar, uTime, uMinLight, uWave}   // + uFogSphere, uAnimFrames, uAnimFps, uGamma (v1.2)
sky                                       // last computeSky() result
gpu: {renderer, vendor, maxLayers} ; quality: {preset: 'low'|'medium'|'high', dpr}
init(game) ; resize()
setSectionMesh(cx, sy, cz, SectionMesh|null)   // replaces + disposes previous geometries; null removes
removeColumnMeshes(cx, cz) ; clearWorld()
setHighlight({x, y, z, boxes} | null)          // outline (boxes from getSelectionBoxes): classic = thin black lines, alpha 0.4, polygon-offset;
                                               // kid = box edges as camera-facing quad strips ~0.03 blocks wide, white over a black border
                                               // (v1.3: screen-space capsules with round caps, so corners join cleanly)
setFogOverride(near, far | null)               // kid soft border (thickening fog); null restores render-distance fog
setRenderDistance(n)                           // fogFar = (n - 0.5) * 16, fogNear = fogFar * 0.8 (v1.3; was 0.6), camera.far = fogFar + 32
addObject(obj3d) ; removeObject(obj3d)         // dynamic objects (entities, particles, fx)
createEntityMaterial({map?, atlas?, transparent?, alphaTest?, color?, parts?}) -> material with uniforms uLightSky, uLightBlock (0..15), uTint (vec4)
                                               // parts: N <= 8 -> + uniform mat4 uParts[N]; geometry attribute aPart (Uint8) picks the matrix
createBlockModel(id, state) -> THREE.Mesh      // meshBlockModel geometry + atlas entity material; caller disposes geometry
captureThumbnail(w = 160, h = 100) -> jpeg data URL (renders then copies; v1.6: without the block outline)
redraw                                         // v1.6: true = draw the next frame even while frozen. Paused, or on the title with no
                                               //   world, the renderer draws 2 frames and then skips the world until something
                                               //   visible changes (streamed meshes, resize, settings, ui open/close, context
                                               //   restore); getStats().frozenSkips counts the skipped frames
getStats() -> {drawCalls, triangles, geometries, textures, programs, sectionMeshes, dpr}   // per frame, all passes summed
                                               // (v1.4: + fogCulled = columns past the fog not drawn at all last frame;
                                               //  v1.5: + fogTrimmed = columns past the fog that still draw what rises above the horizon)
fogCull                                        // v1.4: true (default) skips fully fogged geometry; v1.5: only where the sky behind it is
                                               // the fog colour, so the picture never changes; tests set false to compare pictures
frame(game, dt, alpha)                          // updates uniforms from game.time / sky, renders world then view model
dispose()
```

#### 5.5.3 Chunk shader contract

**Vertex shader**

- `layer = aTex.x`; if `anim = (flags >> 3) & 3` is non-zero, add `mod(floor(uTime·FPS[anim]), FRAMES[anim])`, with FRAMES and FPS from `ANIM`.
- Output a `flat` varying for the layer (`glslVersion: THREE.GLSL3`).
- `uv = aTex.yz / 256`.
- ~~`sky = aLight.x / 16`, `block = aLight.y / 16`, `ao = aLight.z`, `shade = aLight.w / 255`.~~ *(v1.4, review CORE-R2)* Decode `aCorner` into four corner values each of sky (`/ 8`), block (`/ 8`) and the AO factor `[0.5, 0.7, 0.85, 1.0][ao]` × face shade, all `flat` varyings; the face shade comes from the face bits (`FACE_SHADE`, plants 0.9, as the mesher's ×255 values). The vertex's corner (flag bits 7–8) gives a smooth varying `face` = BL (0, 0), BR (1, 0), TR (1, 1), TL (0, 1).
- Wave (`(flags >> 5) & 3`, when `uWave > 0`):
  - Leaves sway ±0.03 in x/z.
  - Plants sway only the top vertices (`v < 128`).
  - Water bobs y by ±0.03.
  - Use world-position-based phases.

**Fragment shader**

```
tex = texture(uTex, vec3(uv, layer))
cutout: discard if a < threshold (0.5, lowered toward 0.18 with the mip level so leaves keep their shape far away)
translucent: keep alpha (water ~0.7)
effSky = max(0, sky - (1 - uDaylight) * 11)
skyB = pow(0.8, 15 - effSky) ; b = pow(0.8, 15 - block)          // close to the classic f / (4 - 3f) ramp
blk = (b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4))   // warm; whiter near a torch, orange at the edge
lift(l) = mix(l, 1 - (1 - l)^4, uGamma)                               // classic brightness lift, uGamma = settings.brightness
moon = (1 - uDaylight) * (1 - smoothstep(0.1, 0.45, lift(blk).r))      // v1.3: moonlit sky tint, fading out inside a torch pool
light = max(min(lift(skyB) * mix(1, (0.82, 0.95, 1.55), moon), 1), lift(blk))   // block light stays warm
light = max(light, vec3(uMinLight))                                  // uMinLight = 0.05 + 0.15 * brightness
w = ((1 - u)(1 - v), u(1 - v), uv, (1 - u)v) for face = (u, v)        // v1.4: bilinear weights of the 4 corners
sky = dot(sky4, w) ; block = dot(block4, w) ; aoF·shade = dot(ao4, w)  // light() above takes the blended sky and block
color = tex.rgb * aoF·shade * light
fog: f = clamp((d - uFogNear) / (uFogFar - uFogNear)), linear on land (v1.3), eased 1 - (1 - f)^2 underwater / in lava, toward uFogColor
     d = horizontal distance on land (flying high must not wash out the ground), spherical underwater and in lava
```

*(v1.2)* Without the brightness lift a torch visibly lit only about 3 blocks and every cell at light 8 or less sat on one flat floor; with it (default 0.7) a torch warmly lights a 13 × 13 room, as in the original. The fog ramp is eased because the circular mesh radius leaves diagonal gaps that begin before `uFogFar` (worst case about 52 % into a linear ramp at R 4); eased, every gap is at least 75 % fogged for R 3–12 (`cored-fog`). *(v1.3, review CORE-R1)* That washed out the middle distance (terrain 70 blocks away was about 74 % fogged at R 6). The world now meshes one ring beyond R (§5.3.3), every gap lies past `uFogFar` for R 3–12, and the land fog is linear from 0.8 · `uFogFar` (`cored-fog` asserts every gap is fully fogged). Entity materials use the same light and fog code (they share `uGamma`).

**Passes**

| Pass | Settings |
|---|---|
| Opaque | `transparent: false`, depthWrite on, front-to-back |
| Cutout | Same shader with `discard`, `side: DoubleSide`, depthWrite on |
| Translucent (water, ice, stained glass) | `transparent: true`, `depthWrite: false`, `side: DoubleSide`; three sorts it by bounding-sphere centre |

- Precompile all programs with `renderer.compile` before the first world frame.
- Mipmapped cutout alpha erodes leaves at distance; compensate by lowering the alpha test with `fwidth`/LOD, or accept it.

**Underwater** (camera eye in water): fog near 0, far 20, colour `#1e4cc0` darkened by daylight. FX adds the overlay tint.

#### 5.5.4 Sky (`sky.js`, pure)

```js
export function computeSky(dayTime, rain = 0, day = 0) -> {celestialAngle, daylight 0..1, skyColor [r,g,b], fogColor, sunsetColor [r,g,b,a]|null, starBrightness, moonPhase, sunDir [x,y,z]}
```

- Celestial angle (Java formula): `f = frac(t/24000 − 0.25)`, then `angle = f + ((1 − (cos(fπ)+1)/2) − f)/3`.
- `daylight = clamp(cos(angle·2π)·2 + 0.5, 0, 1) × (1 − 0.25·rain)`.
- Renderer:
  - A sky dome or gradient: zenith = skyColor, horizon = fogColor blended with the sunset glow toward the sun.
  - *(v1.5, review CORE-R11)* At and below the horizon (sine of elevation ≤ 0) the dome is exactly `uFogColor`, and the sunrise / sunset glow is exactly 0 at and below `SKY_GLOW_FLOOR` (−0.08, `shaders.js`; the sky shader reads the same constant). The fog cull (§5.5.6) depends on both, and a unit test pins them.
  - `scene.background` matches the fog colour at the horizon.
  - `uDaylight = sky.daylight`.
- Sun, moon, stars and clouds are drawn by FX (`render/celestial*.js`) using `renderer.sky`. *(v1.5)* So that the fog cull never changes the picture, FX draws no sun, moon or stars at or below the horizon, and clouds and particles use the shared fog uniforms (fully fog-coloured past `uFogFar`).

#### 5.5.5 Entity materials

- `createEntityMaterial` returns a `ShaderMaterial` that uses the same lighting curve and fog as chunks, with uniform light: `uLightSky`, `uLightBlock`, an optional `uTint` overlay (hurt red `vec4(1, 0, 0, 0.4)`, TNT flash white), and alpha test 0.1.
- `map` mode samples a 2D `CanvasTexture` (mob skins, sprites). Set `magFilter` Nearest and `NoColorSpace`.
- `atlas` mode samples the array texture with the chunk vertex format (`position`, `aTex`, `aLight`) and uses `aLight.z/.w` for AO and shade.
- The caller clones a material per entity, sharing textures, and sets `uLightSky` and `uLightBlock` each frame from `world.getLight` at the entity's eye.
- **One draw call per mob** (`parts` option): MOBS merges a mob's boxes (head, body, legs, tail, wool layer…) into ONE geometry with a per-vertex `aPart` index, and poses it by writing `uParts[i]` matrices each frame. The vertex shader applies `uParts[int(aPart)]` before the model matrix. 24 animals then cost 24 draws, not 150–200.
- Dropped-item meshes share one cached geometry per item key (FX); only the Object3D is per entity.

#### 5.5.6 Quality and devices

**Initial preset** (from `WEBGL_debug_renderer_info`, when `settings.renderDistance === 0`)

| GPU | Render distance | DPR cap |
|---|---:|---:|
| SwiftShader, llvmpipe, Basic Render | 4 | 1.0 |
| Intel HD/UHD | 5 | 1.0 |
| Iris, Radeon or other integrated | 6 | 1.25 |
| Discrete | 8 | 1.5 |
| Touch-primary devices | 5 | 1.0 |

The **low** preset (SwiftShader / Intel HD) also forces fast leaves for the session (`buildTextures({fastLeaves: true})`) without changing the saved `fancyLeaves` setting.

Call `game.world.setRenderDistance` in `init`.

**Dynamic scaling** (when `settings.dynamicQuality`)

- Ignore the first 5 s.
- If p90 frame time > 22 ms for 2 s: lower DPR first (by 0.25, minimum 0.75), then R − 1 (minimum 3).
- If < 12 ms for 8 s: R + 1 up to the preset maximum.
- 5 s cooldown between changes.
- Do not scale down when frame intervals sit near 33 ms but `perf.workMs < 8` (a 30 Hz display or energy saver).

**Draw calls:** log `renderer.info` with `autoReset = false`, resetting once per frame. Budget ≤ 300 typical at R = 6. Sections alone are 250–500 draws at R = 6, so CORE-D measures the SwiftShader proxy early: **if it is over budget, column-merged geometry (one geometry per column per pass) is P0**, not P1. Mobs are one draw each and items share geometry (§5.5.5).

**Fog cull** *(v1.4, review CORE-R10; v1.5, review CORE-R11)*: right before each render, the renderer cuts the chunk geometry of every column whose nearest horizontal point to the eye lies beyond `uFogFar` + 0.5 (the pad covers plant jitter, sway and the water wave). That geometry is 100 % fogged: it draws exactly `uFogColor` (land fog is horizontal; underwater and lava fog are spherical, never shorter), and so does everything behind it except the sky. Hiding a piece of it therefore changes no pixel exactly when the sky behind it is the fog colour too: every view direction at or below the horizon; at or below `SKY_GLOW_FLOOR` for a column with any part toward the sun while the sunset glow is on; and every direction while the eye is in water or lava (flat sky).

- Per pass (opaque, cutout, translucent), a section of such a column is hidden when its highest vertex + 0.5, seen from the eye at the column's farthest corner, stays at or below that line (`chunkmerge.fogCutFrom`, unit-tested). Section tops only grow upward within a pass, so the merged column mesh draws from its first kept section (`drawRange`), and hot and translucent section meshes are hidden one by one. Section tops come from the mesh positions when `setSectionMesh` is called.
- Whatever rises above the line, such as a distant mountain or a tall tree, is drawn and shows as a pale fogged silhouette against the bluer sky, exactly as without the cull. v1.4 hid whole columns, which removed those silhouettes at ground level (review CORE-R11: a large pale mountain vanished; up to 7 % of the frame changed at R 4).
- `cored-fog` renders the same frame with the cull off and on (no streaming in between) and asserts that **no pixel changes** at ground level, from high up (where it must also save draws), and at a view with silhouettes (seed 4242 spawn, sunset, toward the sun).
- Cost of keeping the silhouettes, SwiftShader R 4, same views (ground facing peaks / air / second ground): draws 94 / 114 / 75 without any cull, 74 / 79 / 43 with the v1.4 cull, **92 / 79 / 49** with this one; frame rate about 4–6 % below v1.4 on the two ground views and the same in the air (within noise).

**Manual render distance:** when `settings.renderDistance` is not 0 (auto), dynamic scaling may lower the DPR but never R.

**fancyLeaves:** CORE-D owns the change (§3.8): rebuild textures, re-upload, then `world.remeshAll()`.

**Context loss:**

- three r170 restores the context automatically. Keep CPU-side arrays (do not free attribute data), pause rendering while lost, and recover with no console errors.
- Test: `__game.contextLossTest()`.
- If the context is not restored within 5 s, show the "tap to reload" overlay. Game state is safe because of autosave.

---

## 6. Event bus catalogue

Use `game.events.on(name, fn) → unsubscribe`, `emit(name, payload)`. Delivery is synchronous; a handler that throws is isolated and recorded. Payloads are plain objects. Add new events only with a lane prefix (for example `fx:...`) and document them in your handoff note.

**`block:broken.drops` is informational.** `interaction.breakBlock` is the only code that spawns block drops (§7.4); nobody spawns items from this event except INV for container contents (`blockEntity`).

| Event | Emitter | Payload | Typical listeners |
|---|---|---|---|
| `game:ready` | LEAD | `{bootMs}` | menus (show title) |
| `game:state` | LEAD | `{from, to}` | audio, kid, fx |
| `settings:changed` | LEAD | `{key, value, settings}` | all |
| `mode:changed` / `difficulty:changed` / `rules:changed` | LEAD | `{mode}` / `{difficulty}` / `{key, value, rules}` | hud, mobs, player |
| `world:starting` | LEAD | `{meta, isNew}` | menus (loading), audio |
| `world:progress` | LEAD | `{done, total}` | menus (loading bar) |
| `world:ready` | LEAD | `{meta, isNew}` | kid (hints), audio (music), save (timers) |
| `world:exit` | LEAD | `{meta}` | menus (title), all systems reset world state |
| `world:columnGenerated` | C | `{cx, cz, fresh}` (terrain only, not lit) | — |
| `world:columnLoaded` / `world:columnUnloaded` | C | `{cx, cz, fresh}` / `{cx, cz}` | mobs (chunk-gen animals on loaded + fresh), entities (restore / park), mechanics |
| `world:renderDistance` | C | `{distance}` | renderer (fog) |
| `block:changed` | C | `{x, y, z, oldId, oldState, id, state, cause, action}` | mechanics (support, fluids, falling, connections), fx, **kid (undo records)** |
| `block:broken` | E | `{x, y, z, id, state, by: 'player'\|'support'\|'cascade'\|'explosion'\|'mob'\|'test'\|…, drops: ItemStack[], blockEntity, action}` | audio, fx (particles), inv (drops `blockEntity` contents) |
| `block:placed` | E | `{x, y, z, id, state, by, item, oldId, oldState, action}` | audio, mechanics |
| `block:mining` | E | `{x, y, z, id, progress, stage}` (on stage change) | fx (crack), audio (hit sounds) |
| `block:miningStop` | E | `{x, y, z}` | fx |
| `block:use` | E | `{x, y, z, id, hook}` (after a blockUse hook consumed) | audio |
| `player:swing` / `player:jump` | E | `{}` / `{sprint}` | fx (arm), survival (exhaustion) |
| `player:land` | E | `{fallDistance, x, y, z, blockId}` | survival (fall damage), audio, mechanics (trample) |
| `player:step` | E | `{x, y, z, blockId, sound}` | audio |
| `player:water` | E | `{inWater, eyeInWater}` | audio (splash, muffle), fx (tint), survival (air) |
| `player:fly` / `player:sprint` / `player:view` | E | `{flying}` / `{sprinting}` / `{view}` | hud, touch, fx |
| `player:teleport` | E | `{x, y, z, reason: 'home'\|'void'\|'stuck'\|'respawn'\|'test'\|…}` | fx (fade), audio (whoosh) |
| `player:hurt` | MOBS | `{amount, cause, health, source}` | hud, fx (flash), audio, kid |
| `player:heal` | MOBS | `{amount, health}` | hud |
| `player:eat` / `player:ate` | MOBS | `{item}` | audio, fx |
| `player:death` / `player:respawn` | MOBS | `{cause}` / `{x, y, z}` | menus (death screen), fx |
| `player:hotbar` | inventory model | `{slot, item}` | hud (name popup), audio (tick), fx (view model) |
| `player:sleep` | MECH | `{sleeping, nap}` | fx (fade), menus |
| `player:spawnSet` | MECH | `{x, y, z}` | hud (toast) |
| `inventory:changed` | inventory model | `{slot}` (−1 = many) | hud, invui |
| `item:pickup` | MOBS | `{item, count}` | audio (pop), hud |
| `item:drop` | MOBS, INV | `{item, count, x, y, z}` | audio |
| `item:broken` | inventory model | `{item}` | audio, fx |
| `entity:spawn` / `entity:remove` | MOBS (base) | `{id, type, x, y, z, reason: 'spawn'\|'load'\|'breed'\|…}` / `{id, type, reason: 'dead'\|'despawn'\|'unload'\|'clear'\|…}` | fx (poof) and audio — **only for reason `spawn`/`breed` and `dead`/`despawn`**, never `load`/`unload` |
| `mob:hurt` / `mob:death` | MOBS | `{id, type, amount?, x, y, z, by}` | audio, fx |
| `mob:sound` | MOBS | `{id, type, kind: 'idle'\|'hurt'\|'death'\|'step'\|'eat'\|'tame'\|'angry'\|'hiss', x, y, z}` | audio |
| `mob:tamed` / `mob:bred` / `mob:sheared` / `mob:love` | MOBS | `{id, type, x, y, z}` | fx (hearts), audio |
| `explosion` | MECH | `{x, y, z, power, source, action, count, blocks: [{x, y, z, id, state}]}` (`blocks` is always an array) | audio, fx, kid (one undo entry), mobs (damage is done by MECH) |
| `tnt:primed` | MECH | `{id, x, y, z, fuse}` | audio (fuse hiss) |
| `door:toggle` | MECH | `{x, y, z, open, kind: 'door'\|'gate'}` | audio |
| `bonemeal` | MECH | `{x, y, z}` | fx (sparkles), audio |
| `sleep:start` / `sleep:end` | MECH | `{nap}` | fx (fade, starry sky), audio |
| `ui:open` / `ui:close` | LEAD (`game.ui`) | `{screen, opts}` / `{screen}` | audio, kid, touch |
| `ui:click` | any UI | `{}` | audio (click) |
| `craft` / `smelt` | INV | `{item, count}` | audio (success), kid (hints) |
| `input:action` | E | `{action, down, source: 'key'\|'mouse'\|'touch'\|'virtual'\|'release'\|'test'}` | ui manager, hud (hotbar keys), kid (home, undo), player (toggleFly, toggleView) |
| `input:pointerType` / `input:pointerLock` | E | `{type}` / `{locked}` | touch (show/hide), menus (click-to-play overlay) |
| `input:gesture` | E | `{phase: 'down'\|'hold'\|'tap'\|'drag'\|'up'\|'cancel', x, y (NDC), pointerType}` (v1.2) | fx (instant ring / crack start), audio — fires on pointerdown, within 50 ms |
| `kid:home` / `kid:undo` / `kid:rescue` / `hint` | KID | `{x, y, z}` / `{count}` / `{reason}` / `{name}` | fx, audio |
| `save:start` / `save:done` | MENUS | `{reason}` / `{ok, reason, ms}` | hud (spinner) |
| `time:dawn` / `day` / `noon` / `dusk` / `night` / `midnight` / `set` | LEAD | `{dayTime, day}` | audio (music mood), mobs |
| `sound` | anyone | `{name, x?, y?, z?, volume?, pitch?}` | audio (catalogue §8.3.2) |
| `toast` | anyone | `{text, icon?: itemKey}` | hud |

---

## 7. CORE-E: input, physics, raycast, interaction, player

### 7.1 Input (`src/player/input.js`, `game.input`)

```js
ACTIONS, UI_ACTIONS, KEY_BINDINGS {kid, classic}     // exported constants (see stub); 'descend' = fly down (kid C/Z, touch ▼)
scheme 'kid'|'classic' ; lastPointerType 'mouse'|'touch'|'pen' ; pointerLocked
move {forward, strafe}  (per tick, -1..1) ; virtualMove ; aim {x, y} NDC ; aimActive ; lookDelta {yaw, pitch} (radians, consumed by player.frame)
init ; tick (FIRST: snapshot edge presses, compute move) ; frame (apply keyboard turning, mouse look into lookDelta)
isDown(action) ; wasPressed(action)          // gameplay actions read false while captured
setVirtual(action, down) ; press(action) ; setMoveVector(forward, strafe) ; addLook(dyaw, dpitch)
tap(ndcX, ndcY) ; hold(ndcX, ndcY, ms)      // aim + use / aim + attack
releaseAll() ; setCaptured(owner, bool) ; isCaptured() ; requestPointerLock() -> Promise<bool>
lastManualLookMs ; noteManualLook()          // any manual look (and test setLook/lookAt) resets the auto-pitch timer
```

**Kid scheme** (default)

- **Cursor:** free and visible. The `aim` follows the pointer over the canvas. Hovering shows the outline, and the FX ghost block.
- **Programmatic aim:** the test API, `tap()` and `hold()` set `aim` and `aimActive = true`. Only a real `pointerleave` or `blur` clears `aimActive`; never reset it on a timer, or headless tests (where the mouse never moves) lose their target.
- **Pointer events** on the canvas cover mouse, touch and pen. Every button means the same thing:

  | Gesture | Condition | Result |
  |---|---|---|
  | Tap | released in under 350 ms and moved under 12 px | aim at the point, press `use` |
  | Hold | 350 ms or more without moving | aim at the point, hold `attack` until release; the aim follows small moves |

  *(v1.3, review CORE-R4)* Durations are measured with the events' own `timeStamp`s, not handler times, and the hold timer only marks the gesture as a pending hold; the next tick presses `attack`. When the timer ran late (a main-thread stall), the press waits a 120 ms grace period, so a quick release queued behind the stall stays a tap and never breaks a block (`coree-tap-stall`).
  | Drag | more than 12 px within the first 350 ms | look: `dyaw = −dx·k`, `dpitch = −dy·k`, with `k = 0.0035·(0.5 + lookSensitivity)` rad/px, inverted y if `invertY` |

  - React on `pointerdown`: FX shows a ring or crack start immediately.
  - Only the first pointer in the world area looks. Contacts larger than 40 px (palms) are ignored.
  - `contextmenu` is suppressed.
- **Keyboard turning:** `turnLeft`/`turnRight` produce a 10–15° nudge on a tap under 150 ms. Holding ramps over 200 ms to `60 + 80·turnSpeed` °/s (100°/s at the default). `lookUp`/`lookDown` (PageUp/PageDown) pitch at 60°/s.
- **Auto-pitch** (`settings.autoPitch`, default on): while walking with no manual look input for 1.5 s (`KID.AUTO_PITCH_DELAY_TICKS`), ease pitch toward −12°. Every manual look — drag, PageUp/PageDown, `addLook`, and the test API's `setLook`/`lookAt` — calls `noteManualLook()`, which restarts the timer, so tests are not overridden.
- **No Shift in the kid scheme:** five quick Shift presses open the Windows Sticky Keys dialog and drop fullscreen. Fly-down is `descend` on C and Z (and the touch ▼); the kid scheme has no sneak at all.
- **Wheel:** only notched wheels emit `hotbarNext`/`hotbarPrev`, at most once per 150 ms: `deltaMode` 1 or 2, `wheelDeltaY` a non-zero multiple of 120, |deltaY| a multiple of 120, or (v1.2) a multiple of 100 that is at least 100 — Chrome on Windows reports 100 px per notch. Ctrl + wheel (pinch) never steps. Trackpad swipes are ignored. Always `preventDefault` the wheel (passive: false), which also blocks pinch zoom.

**Classic scheme**

- **Pointer lock:** a click on the canvas requests the lock with `{unadjustedMovement: true}`, falling back to a plain request. Always `.catch`, and listen for `pointerlockerror`.
- **Mouse look:** `movementX/Y × 0.0022·(0.5 + lookSensitivity)` rad. Drop motion for 150 ms after a lock change, and discard events larger than 400 px on either axis.
- **Buttons:** left = `attack`, right = `use`, middle = `pick`.
- **Esc:** releases the lock. The menus show the pause screen from `pointerlockchange`, not from keydown.
- **Re-lock:** the ~1 s relock cooldown is handled by keeping the "click to play" overlay up silently, with no error text.

**Both schemes**

- **Release everything** (`releaseAll`) on `blur`, `visibilitychange` (hidden), pointer-lock change, fullscreen change, and `setCaptured(true)`.
- **Never bind** Ctrl, Alt, Meta, Tab or the F keys in the kid scheme.
- **`setCaptured(owner, true)`** (UI screens): movement, attack and use read false and the pointer lock is released. UI actions (`UI_ACTIONS`) still emit `input:action`.
- **Emit** `input:action` on every press and release, `input:pointerType` when the pointer type changes, and `input:pointerLock`.

### 7.2 Physics (`src/player/physics.js`)

```js
moveAndCollide(world, body, dx, dy, dz, {sneakEdge}) -> {dx, dy, dz} applied (shared object)
collectBlockBoxes(world, minX, minY, minZ, maxX, maxY, maxZ, out = []) -> world-space boxes
boxCollides(world, minX, minY, minZ, maxX, maxY, maxZ) -> bool
fluidState(world, body, eyeHeight) -> {water: 0..1 submerged fraction, lava: bool, eyeInWater: bool}
findFreeY(world, x, y, z, width, height) -> y
```

**Algorithm**

1. Collect the collision boxes (registry) of every cell overlapping the box expanded by the motion.
2. Clip **Y first, then the larger of X and Z, then the other**, using Java's `calculateOffset` per axis. Use a 1e-7 epsilon so bodies don't snag on seams.
3. **Step-up:** if on ground (or Y was clipped downward) and horizontal motion was clipped, retry with the box raised by `stepHeight` (default 0.6). Keep the result if it went further horizontally, then move back down onto the step.
4. **Sneak edge:** cancel the parts of horizontal motion (in 0.05 increments per axis) that would leave no support within 0.6 below the feet.
5. Set `onGround`, `collidedH` and `collidedV`.

**Users:** the player and all entities. Unloaded columns count as solid, so nothing falls out of the world while terrain streams in.

### 7.3 Raycast (`src/player/raycast.js`)

```js
raycast(world, ox, oy, oz, dx, dy, dz, maxDist, {fluids?, filter?}) -> RayHit | null
// RayHit = {x, y, z, face, nx, ny, nz, id, state, dist, px, py, pz}
```

- Amanatides & Woo DDA over cells.
- For each cell, test the ray against `getSelectionBoxes` (full cubes trivially). Cells whose selection list is empty are skipped (air, fluids unless `opts.fluids`, plants are hit only through their box).
- If the origin is inside a solid block, return it with `face = UP`.
- The normal `(nx, ny, nz)` is the outward normal of the face that was entered.

### 7.4 Interaction (`src/player/interaction.js`, `game.interaction`)

```js
target: RayHit|null ; targetEntity: {entity, dist}|null ; mining: {x, y, z, id, progress, stage, ticks, totalTicks}|null
reach() ; getAimRay(out) -> {ox, oy, oz, dx, dy, dz}
breakBlock(x, y, z, {by='player', drops?, toolDef?, action?, dropInto?}) -> bool // THE shared break routine (mechanics/kid/tests use it)
placeBlock(x, y, z, id, state, {by='player', item, force, action?}) -> bool        // THE shared place routine
newAction() -> int                                                                    // undo grouping id (§8.5.2)
use() ; attack() ; pickBlock()
tick ; frame
```

**Targeting (every frame)**

- The ray starts at the interpolated eye and goes through `input.aim`: unproject the NDC with the camera, or use the centre when locked.
- Block hit within `reach()`; entity hit through `entities.raycast` within the entity reach; the nearer one wins.
- Call `renderer.setHighlight` only when the target changes.
- Kid scheme: no target while the cursor is outside the canvas (`aimActive` false), unless a touch is active.

**Attack** (`attack` held)

- **Entity target:** run `hooks.entityAttack[type]`; otherwise `entity.hurt(damage, {type: 'player', player: true, crit})`. Repeat every 10 ticks while held (spam clicks always register). Swing. Exhaustion 0.1. Tool durability as in §2.2.
- **Kid scheme (v1.6):** a hold that hit an entity stays an entity hold until it is released. When the animal hops away the hold does nothing, instead of digging the block behind it (kid creative breaks blocks instantly). The classic scheme keeps the Java behaviour.
- **Block target, creative:** `breakBlock` instantly, then every 5 ticks while held.
- **Block target, survival:**
  - Accumulate `1/breakTicks` per tick.
  - Emit `block:mining` when the stage changes.
  - At 1, call `breakBlock` with `toolDef`, then damage the tool and add exhaustion.
  - Wait 6 ticks before the next block.
  - A target change resets the progress (`block:miningStop`).
- **Unbreakable:** blocks with hardness < 0 (bedrock) in survival. In creative the player may break bedrock **above y 0 only**; the y 0 floor is never removable (and bedrock is not in the picker).

**`breakBlock`**

1. Read the raw value **and `const be = world.getBlockEntity(x, y, z)`** before anything changes (`setBlock` deletes the block entity). Refuse air; refuse hardness < 0 unless `by` is `'player'`/`'test'` in creative at y > 0.
2. Roll drops (`rollDrops` with `game.rand`, only when `drops` is true: by default survival and `rules.dropItemsOnBreak`).
3. `world.setBlock(air, {cause: by, action})`, where `action = opts.action || newAction()`.
4. Emit `block:broken {…, drops, blockEntity: be, action}`. INV drops `be.items` (chest) or `be.input`, `be.fuel`, `be.output` (furnace) with `dropItem`, in both modes.
5. **`breakBlock` alone spawns the block's drops:** `dropItem` (MOBS) for each at the cell centre with a small pop — or, when `opts.dropInto` is an array, it pushes `{stack, x, y, z}` there instead (explosions merge them, §2.5). Player-broken blocks also add exhaustion 0.005 in survival.

Every player `use()`/`attack()` press allocates one `newAction()` and passes it to every break, place and hook (`ctx.action`) it causes. Mechanics explosions do the same; follow-up changes reuse the causing change's `action`.

**Use** (`use` pressed; repeats every 4 ticks while held, for placement only). In order:

1. `hooks.preUse` (riding dismount, etc.).
2. Entity target → `hooks.entityInteract[type]`.
3. Block target, when not (sneaking with a non-empty hand) → `hooks.blockUse[blockName]`. If consumed, emit `block:use`.
4. Held item → `hooks.itemUse[itemKey]`.
   - Food handlers **must return false** when the target is a farmland top face and the item places a crop (carrot, potato), so planting wins.
   - Bucket and flint handlers do their own raycast with `fluids` when needed.
5. Held item places a block (`itemPlaces`) → `hooks.placers[blockName]` if registered, else the **default placement** below.
   - **Placer return contract (v1.6):** a placer returns **true** when it placed the block (door, bed: both halves, with `ctx.action`). `interaction` then swings the arm and, outside creative, consumes **one** item from the selected slot itself, so a placer **never consumes the item**. **false** means refused: nothing is placed, nothing is consumed, and the default placement does **not** run.
6. Kid scheme, creative, nothing consumed, and the hand is **empty or holds a tool** (an item with `tool`) → break the targeted block instantly. Tapping with food, dye, bone or any other non-placeable item never breaks blocks.

**Default placement rules**

- **Target cell:** the hit cell itself if it is replaceable and a different block; otherwise `hit + normal`.
- **Refuse when:**
  - y is outside 0–127, or the column is not loaded, or the cell is not replaceable;
  - the new block's collision boxes intersect the player's box or any living entity's box;
  - `placeOn` doesn't contain the block below;
  - `support: 'floor'` with no solid top below.
- **Torch** (`floor_or_wall`):
  - Up face → state 0.
  - Side face → `1 + facingOf(−normal)`, where facingOf maps (0,0,−1)→0, (1,0,0)→1, (0,0,1)→2, (−1,0,0)→3.
  - Down face → refuse.
- **Ladder** (`wall`): side faces only; state = `facingOf(normal)`.
- **`facing` blocks:** state = `yawToFacing(yaw + π)`, so the front faces the player.
- **`axis` blocks:** up/down face → 0, east/west → 1, south/north → 2.
- **Slabs:** up face → bottom; down face → top; side face → top if the hit point's fractional y > 0.5. (P1) Tapping the open face of the same slab merges it into a double slab (state bit 1).
- **Fences and panes:** state = `connectionState(world.getRaw, x, y, z, id)`.
- **Fence gates:** facing like `facing` blocks; closed.
- **Leaves:** player-placed leaves get `STATE.LEAVES_PERSISTENT`.
- **Stairs:** facing = `yawToFacing(yaw)`; upside-down by the same rule as slabs.
- **Survival:** consume one item (`inventory.consumeSelected`). Creative never consumes.
- Swing, then emit `block:placed`.

**Pick block** (classic middle click, creative): `blockItem(id)`. If it is already in the hotbar, select it; otherwise replace the selected slot.

### 7.5 Player (`src/player/player.js`, `game.player`)

**Fields** (frozen; HUD, MOBS, FX and KID read them)

- Position and motion: `x y z prevX prevY prevZ vx vy vz width height eyeHeight stepHeight onGround collidedH collidedV`.
- Look and movement state: `yaw pitch flying sneaking sprinting inWater eyeInWater inLava onLadder fallDistance view`.
- Survival: `health maxHealth food saturation exhaustion air xp xpLevel xpProgress dead hurtTime fireTicks effects`.
- Other: `riding sleeping spawnPoint renderX renderY renderZ swingTicks`.

**Methods**

```js
spawn(x, y, z, yaw = 0, pitch = 0) ; teleport(x, y, z, reason) ; getEyePos(out, render = false) ; getLookDir(out)
setFlying(bool) ; canFly() (creative) ; swing() ; tick ; frame ; serialize() -> {x,y,z,yaw,pitch,flying,view,spawnPoint} ; deserialize
```

**Behaviour**

- Movement per §2.1.
- **Riding** (P1): when `riding !== null`, the player skips its own physics and copies the seat position given by the mount (`entity.getSeat()`: pig, horse, boat). MOBS reads `input.move` for steering. Sneak (classic) or `descend` (kid) dismounts.
- **Kid flight cap** while terrain streaming lags: §2.1 step 11a.
- **Sleeping:** no movement.
- **`toggleFly`** action → `setFlying(!flying)` (creative).
- **`toggleView`** cycles `view` 0 → 1 → 2 → 0 and emits `player:view`.

---

## 8. FEATURE lanes

### 8.1 MOBS — mobs, entities, survival damage

**Entity base** (`src/entities/entity.js`, foundation already implemented)

- `Entity` fields: `id type x y z prev* vx vy vz yaw prevYaw pitch headYaw width height onGround collidedH collidedV inWater inLava fallDistance noGravity health maxHealth hurtTime invulnTicks deathTime age removed persistent category object3d data`.
- `Entity` methods: `getBox`, `tick(game)`, `hurt(amount, source) → bool`, `die(source)`, `render(game, alpha)`, `remove()`, `dispose(game)`, `serialize()`.
- `registerEntityType(type, {create(game, x, y, z, opts), load?(game, data), persistent = true, category})`.
- `game.entities` (EntityManager): `spawn(type, x, y, z, opts)`, `add`, `get`, `all`, `ofType`, `count(filter)`, `forEach`, `remove(e, reason)`, `queryBox`, `queryRadius`, `raycast(ox, oy, oz, dx, dy, dz, maxDist, filter, grow)`, `tick`, `frame`, `clear`, `serialize`, `deserialize`.
- Entities in unloaded columns are not ticked.
- Other lanes register their own types (MECH: `falling_block`, `tnt`, `painting`; MOBS: `boat`).
- **Entities and streaming** (implemented in the foundation `entity.js`): on `world:columnUnloaded` every entity in that column is removed (`entity:remove` reason `'unload'`); persistent ones are first serialized into `entities.parked` (keyed by column). On `world:columnLoaded` they are rebuilt (`entity:spawn` reason `'load'`). `serialize()` includes parked entities; `deserialize()` parks everything until its column is lit. An entity found in a column that is not in memory at all is parked too.
- `entity:spawn` carries `reason`: `'spawn'` (default), `'load'`, `'breed'`, or another lane value via `spawn(type, x, y, z, {reason})`. FX and AUDIO stay silent for `'load'`.

**Mobs** (`src/entities/mobs.js`, system `mobs`)

- `spawnMob(type, x, y, z, {baby, color, tamedBy, variant}) → Entity | null` and `counts() → {creature, monster}`.
- Registers each type in `MOBS` in `init`.
- Implements §2.6:
  - AI (including the jump / drop / water / fence rules), breeding, babies, taming, sheep wool (state in `entity.data.color`, `data.sheared`), chicken eggs, the rainbow sheep (P1).
  - Spawning on `world:columnLoaded` (`fresh`), the `populated` set (serialized), caps that include chunk-generation spawns.
  - Every roll uses `game.rand()`.
  - **Boats (P1):** entity `boat` (`oak_boat` item use on water), water physics (floats on the surface, 0.04 b/t² paddle acceleration, drag 0.9), riding through `getSeat()`, breaks into the item when hit.
  - Spawn eggs: `hooks.registerItemUse('<mob>_spawn_egg')` spawns on the target face (and works in the air in front of the player).
  - Entity interactions: shears, dye, bucket→milk, bone, food, saddle.
- **Rendering:**
  - Box models with the part sizes and pivots from the asset research (pig, cow, sheep and wool layer, chicken, wolf, cat, horse, zombie, skeleton, creeper, spider).
  - One procedurally painted `CanvasTexture` skin per type (box-UV layout), with original faces: kid-friendly 2×2 eyes with a highlight. The creeper face must be an original design.
  - Walk animation `cos(p·0.6662)·1.4·amt`; idle; head look (±50°); hurt tint through `uTint`; death tip-over plus poof.
  - Material from `renderer.createEntityMaterial({map, parts: N})`, cloned per entity. **One merged geometry per mob type** with the `aPart` attribute (shared across mobs of that type), posed with `uParts` — one draw call per mob (§5.5.5).
- **Movement:** `moveAndCollide` with step 0.6 and gravity 0.08/drag 0.98 (living entities use the player formula of §2.1 with `a = (attr·mod)²`).
- **Kid rule:** `animalsCanDie`.
- **Item entity** (`item_entity.js`): `dropItem(game, stack, x, y, z, {vx, vy, vz, pickupDelay, thrower}) → Entity | null`.
  - Gravity 0.04, drag 0.98, ground friction 0.6 × 0.98.
  - Bobbing and spinning mesh from `game.fx.makeItemMesh(item)`.
  - Pickup delay 10 ticks (40 when thrown).
  - Magnet: within 1.5 blocks of the player, pull at 0.1 b/t; picked up within 1.0 when there is space, calling `inventory.add`. Emit `item:pickup`. *(v1.6)* Distances are measured to the player's body from 0.5 below the feet to the head (Java inflates the pickup box by 0.5 down), so a drop at the far side of the 1-deep hole just dug is still pulled in.
  - Merges with an identical stack within 0.5. Despawns after 6000 ticks. Lava destroys it.
- **Survival** (`src/survival/survival.js`, system `survival`): `damage(amount, cause, source) → bool`, `heal`, `addExhaustion`, `canEat`, `applyFood(itemKey)`, `addFood(h, s)`, `kill(cause)`, `respawn()`, `serialize`, `deserialize`, implementing §2.3.
  - Food item-use hooks for every `use: 'eat'` or `'drink'` item.
  - Fall damage from `player:land`, using the `fallMult` of the landing block.
  - Contact damage (cactus), lava, fire, suffocation, drowning.
  - Peaceful refill.
  - In creative, `damage` returns false except for `void`.

**Acceptance**

- Smoke `mobs` and `survival-fall` pass.
- Add scenarios: `mobs-breeding` (two cows plus wheat give a baby within 200 ticks — use `interactEntity` and `runTicks`), `mobs-pickup` (a broken block in survival gives +1 item), `mobs-wolf-tame` (bone, with `setRandomSeed`), `mobs-kid-no-death` (hitting a pig 20 times with `interactEntity(id, 'attack')` leaves health unchanged), `mobs-no-pileup` (walk 20 columns away and back 3 times: the creature count never exceeds 24 and never grows from repopulating the same columns), `mobs-step-up` (a pig wandering into a 1-block ledge gets over it within 100 ticks).
- Mob count stays within caps; no entity leaks after `exitToTitle` (`entities().length === 0`).

### 8.2 INV — inventory, crafting, furnace, chest, HUD

**8.2.1 Inventory model** (`src/inventory/inventory.js`, foundation implemented)

- `slots[36]` (0–8 hotbar), `armor[4]`, `offhand`, `cursor`, `selected`, `version`.
- Methods: `get`, `set`, `getSelected`, `selectSlot`, `add(stack) → leftover`, `count`, `removeItem`, `consumeSelected`, `replaceSelected`, `damageSelected → broke`, `find`, `clear`, `fillHotbar`, `toJSON`/`fromJSON`.
- Emits `inventory:changed`, `player:hotbar`, `item:broken`.
- `KID_CREATIVE_HOTBAR` = grass, planks, cobble, glass, red wool, torch, door, glowstone, pig egg.

**8.2.2 Crafting** (`crafting.js`, pure): `matchRecipe(grid, w, h) → {recipe, result} | null`, `consumeCraft(grid, w, h, recipe) → newGrid`, `craftableRecipes(inventory, gridSize)`, `smeltingResult(itemKey)`, `fuelTicks(itemKey)`. Rules in §4.6.

**8.2.3 Containers** (`containers.js`)

- `createChest() → {type: 'chest', items[27]}`.
- `createFurnace() → {type: 'furnace', input, fuel, output, burnTicks, burnTotal, cookTicks, xp}`.
- `tickFurnace(game, be, x, y, z)`:
  - Swaps `furnace` and `furnace_lit` while keeping the facing (`keepBlockEntity: true`).
  - 200 ticks per item.
  - Output stack limits apply.
- Block entities are stored with `world.setBlockEntity` and created on first open.
- Breaking a container drops its contents in both modes: INV listens to `block:broken` and drops `payload.blockEntity.items` (chest) or `.input`, `.fuel`, `.output` (furnace) with `dropItem`. The payload carries the block entity because `setBlock` has already removed it from the world.

**8.2.4 Screens** (`inventory_ui.js`, system `invui`). Register with `game.ui`, and register the block-use hooks that open them: `hooks.registerBlockUse('crafting_table')`, `('furnace')`, `('furnace_lit')` and `('chest')`.

- **`inventory`** (survival): armour column, player doll (optional), 2×2 crafting grid, output, 27 main slots and 9 hotbar slots.
- **`creative`** (kid picker):
  - Full-screen picture grid with 72–96 px tiles.
  - **8 picture tabs**, defined in data as `PICKER_TABS` and filled by `creativePickerItems(tabId, {hostileMobs, hasMob})` (`data/items.js`):

    | Tab | Data tabs | Extra items shown there too |
    |---|---|---|
    | Building | building | — |
    | Colours | colors | — |
    | Nature | nature | — |
    | Functional | functional | — |
    | Tools & Combat | tools, combat | — |
    | Food | food | — |
    | Animals | animals (spawn eggs) | wheat, wheat_seeds, carrot, bone, bone_meal, shears, bucket, saddle, all 16 dyes |
    | Materials | materials | — |

  - Hidden: `creative: false` items (bedrock, lava bucket), hostile spawn eggs while `rules.hostileMobs` is off, and eggs whose mob is not implemented yet (`hasMob = (t) => entities.types.has(t)`). Every other item is reachable (unit-tested).
  - Paging with big ◀ ▶ arrows. No search box in P0; no drag needed.
  - Tapping a tile puts that item (count 64, or 1 if unstackable) into the selected hotbar slot, with a "fwoop" animation and `ui:click`.
  - A trash slot, plus a "survival inventory" toggle for grown-ups.
- **`crafting`** (3×3), opened by `hooks.registerBlockUse('crafting_table')`.
- **`furnace`**: input, fuel and output slots, with the flame and the progress arrow.
- **`chest`**: 27 slots plus the player inventory.

Slot interactions (Java):

- Left click picks up or places a whole stack (merging or swapping).
- Right click takes half, or places one.
- Shift-click quick-moves between sections.
- Keys 1–9 swap with the hotbar while hovering a slot.
- Clicking outside the panel drops the cursor stack (classic only).

The kid scheme uses the same left-click semantics on tap.

- **Recipe book (P0 in survival worlds):** a picture list of craftable items (`craftableRecipes`); tapping one fills the grid and crafts. Without it, survival needs reading or memorised recipes, which a 5-year-old does not have.
- **Q drop:** classic scheme only (`drop` action): 1 item, or the whole stack with Ctrl. Calls `dropItem`.

**8.2.5 HUD** (`hud.js`, system `hud`). Layer `uiLayer(game, 'hud', Z.HUD)`. Positions follow Java with integer GUI scale (§9), enlarged for kids.

- **Hotbar:** 9 slots of `--hotbar-slot` at the bottom centre, at least 16 px above the bottom edge.
  - Selected slot: **4 px yellow (`--select`) border + 1.15× scale + 6 px lift**.
  - Stack counts and durability bars.
  - Tapping or clicking a slot selects it (on `pointerdown`).
  - A backpack button (at least 64 px) at the right end opens the inventory or picker (both schemes).
- **Item name popup:** above the hotbar for 40 ticks, fading over the last 10. It also triggers speech if `speakNames`.
- **Survival only:**
  - 10 hearts, which shake at ≤ 4 HP and flash on damage.
  - 10 hunger shanks, right-aligned.
  - Armour row (P1).
  - Air bubbles, only while the eye is in water.
  - XP bar and level (P1).
- **Crosshair:** classic scheme only. 15 GUI px, inverted-colour blend.
- **`toast(text, iconItem)`** and listening to the `toast` event: a centred picture toast for 2 s.
- **Hotbar input:** handles `input:action` `hotbar1..9`, `hotbarNext`, `hotbarPrev` → `inventory.selectSlot` **only while no container screen is open** (`game.ui.current` not inventory/creative/crafting/furnace/chest); inside a container the same keys swap the hovered slot (INV). Handles `toggleHud`.
- **Performance:** re-render only on `inventory.version` or player stat changes, never per frame.

**Acceptance**

- `hotbar` and `inventory-ui` pass.
- Add `inv-craft-planks` (log into the 2×2 grid gives 4 planks), `inv-furnace` (sand plus coal gives glass after 200 ticks), `inv-chest-persist` (an item in a chest survives a save/load, together with MENUS), `inv-creative-pick` (a tap on the red wool tile puts it in the selected slot).
- All slot targets at least 48 px. Creative tiles at least 64 px.

### 8.3 AUDIO (`src/audio/*`, system `audio`)

**8.3.1 API.** `unlocked`, `unlock() → Promise<bool>`, `play(name, {x, y, z, volume, pitch})`, `playBlock(kind, soundType, x, y, z, opts)`, `startMusic()`, `stopMusic()`, `stats() → {voices, byName}` (live voice counts, for `__game.audioStats()`), `frame` (listener position from the camera). No spawn sound for `entity:spawn` reason `'load'`.

**Graph and levels**

- Signal chain: SFX bus → `DynamicsCompressor` (threshold −18 dB, ratio 4, attack 3 ms, release 0.25 s) → master gain → output limiter (threshold −6 dB, ratio 12+, attack 3 ms).
- The music bus (gain `musicVolume`) runs through a shared convolver reverb (3.5 s procedural impulse response).
- Volumes come from `settings` (`masterVolume`, `musicVolume`, `sfxVolume`, `muted`) and update live on `settings:changed`.
- Limits: at most 32 voices, at most 4 of one name, at most 12 starts per second for one name. Pitch is randomised ±5%.
- **Unlock:** create or resume the context on the first user gesture (`pointerdown` or `keydown` on the window, or the Play button). Resume again on `visibilitychange`.

**8.3.2 Sound catalogue** (all synthesised; the synthesis recipes are in the research notes)

- **UI:** `ui.click`, `ui.open`, `ui.close`, `ui.tick` (hotbar), `ui.success` (craft), `ui.whoosh` (home), `ui.error` (gentle "not here").
- **Blocks:** `playBlock(kind ∈ break|place|step|hit|land, soundType)`, where `soundType` is one of `stone wood grass dirt gravel sand cloth glass snow metal plant liquid`.
- **Player:** `player.hurt` (gentle), `player.land`, `player.bigfall`, `player.splash`, `player.swim`, `player.eat`, `player.burp`, `player.levelup`, `item.pop` (pickup), `item.break`.
- **Mobs:** `<voice>.idle|hurt|death|step`, with voice in `pig cow sheep chicken wolf cat horse zombie skeleton creeper spider`. Extras: `wolf.bark`, `wolf.whine`, `cat.purr`, `creeper.hiss`.
- **World:** `tnt.fuse`, `explosion` (peak ≤ −6 dBFS, no startle; ducks music to 30% for 1 s), `door.open`, `door.close`, `chest.open`, `chest.close`, `furnace.crackle`, `bucket.fill`, `bucket.empty`, `fire.ignite`, `lava.pop`, `shear`, `bonemeal`, `egg.lay`, `water.ambient`.

**Event mapping.** Subscribe to the events in §6:

| Event | Sound |
|---|---|
| `block:broken` | break |
| `block:placed` | place |
| `block:mining` | hit, every 4 ticks while mining |
| `player:step` | step |
| `player:land` | land / bigfall at fall ≥ 5 |
| `item:pickup` | pop |
| `mob:sound` | mob voices |
| `ui:click` / `ui:open` | click / open |
| `explosion` | explosion |
| `tnt:primed` | fuse |
| `door:toggle` | door |
| `player:hurt` | hurt |
| `player:eat` | eat loop |
| `craft` | success |
| `kid:home` | whoosh |
| `sound` | any catalogued name |

**Music (P1):** C418-*inspired* but entirely original generative piano.

- Pre-rendered note samples are built once with an `OfflineAudioContext` after the first gesture.
- Major-seventh and ninth chords, 58–72 bpm, sparse melody with phrase repetition, long silences.
- First piece after 20–40 s, then gaps of 40–150 s.
- Night mood: Dorian or Lydian, wetter reverb.

**Acceptance**

- No console errors when audio is locked (headless).
- `__game.game.audio.unlocked` becomes true after a click.
- Add scenario `audio-events`: emit 50 `block:broken` events in one tick → no more than 4 voices of that sound, no errors.
- Measured peak (`AnalyserNode`) of `explosion` ≤ −6 dBFS.

### 8.4 MENUS — screens, save/load, settings, font, gate

**8.4.1 Screens** (`menus.js`, system `menus`; registered with `game.ui`)

| Screen | Contents and behaviour |
|---|---|
| `title` | Original logo, animated scenery (the renderer may show a slowly rotating world behind it, P1), a huge pulsing **▶ Play** (≥ 200×120 px) and a "worlds" picture button. Play resumes `settings.lastWorldId` if it exists, else creates a default kid world. Play must call `game.audio.unlock()` and `game.kid.enterFullscreen()` **synchronously inside the click handler**. |
| `worlds` | Picture cards (≥ 240×160 px) with thumbnails and an auto name, plus a big "+" card. Delete and rename are behind the parent gate with a ✓/✗ confirmation. |
| `newWorld` | Picture presets (Flat, Hills & trees, Snowy P1) and mode cards (Creative, Survival Easy, Survival Normal). One tap each, then a big ▶. Names are generated automatically. |
| `loading` | Shown on `world:starting`, progress from `world:progress`, hidden on `world:ready`. |
| `pause` (`pausesGame`) | Big ▶ Resume, 🏠 Save & Title, a dull 48 px gear → parent gate → `settings`. |
| `settings` (`pausesGame`, parent area) | Controls (scheme, turn speed, look sensitivity, invert, button size, auto-jump), world (mode, difficulty, rules toggles, day/night, border, set home), video (render distance, fancy leaves, clouds, brightness, FOV, show FPS), audio sliders and mute, hints and speech, restore backup (P1), export and import (P2). Every change goes through `game.setSetting` or `game.setRule`. |
| `death` (`escClose: false`) | Big Respawn button → `survival.respawn()`. Not used when `rules.immediateRespawn` is on. |

Classic scheme: on `input:pointerLock {locked: false}` while playing with no screen open, open `pause`.

**8.4.2 Pixel font** (`pixelfont.js`): `installPixelFont() → Promise<bool>`, `FONT_NAME`.

- Original 5×7 glyphs for ASCII 32–126, written in code.
- Build a TTF in memory (one square contour per lit pixel; tables `head hhea maxp OS/2 name cmap post loca glyf hmtx`) and register it with `FontFace`.
- CSS `--font` already lists it first, so text falls back to other fonts until it loads.

**8.4.3 Save system** (`src/save/storage.js`, system `save`)

- **API:** `available`, `saving`, `lastSaveAt`, `listWorlds()`, `loadWorld(id) → {meta, columns: Map<colKey, {data: Uint8Array, blockEntities}>} | null` (columns stay **encoded**; the world decodes them lazily), `saveNow(reason) → Promise<bool>`, `deleteWorld(id)`, `exportWorld(id)`, `importWorld(file)`.
- **IndexedDB `blockcraft` version 1:**
  - Store `worlds` (keyPath `id`): the WorldMeta.
  - Store `columns` (keyPath `key` = `${worldId}:${cx}:${cz}`, index `worldId`): `{key, worldId, cx, cz, v: 1, data: Uint8Array (codec.js encodeColumn), blockEntities: [{i, data}], savedAt}`.
- **Codec** (`src/save/codec.js`, foundation implemented): `encodeColumn(Uint16Array) → Uint8Array`, `decodeColumn(Uint8Array) → Uint16Array`. Bytes are `'B' 'C' 1` followed by runs of `varint(len) u16le(value)`.
- **`saveNow` steps:**
  1. `meta.systems[name] = sys.serialize(game)` for every system that has `serialize`.
  2. Update `meta.lastPlayed` (and `thumbnail` via `renderer.captureThumbnail()` on exit or pause, at most every 60 s).
  3. One readwrite transaction: put the meta, then put every dirty column (`world.getDirtyColumns()` plus `world.pendingSave`). Export each with `world.exportColumn` and call `world.markColumnSaved` **synchronously right after the export, in the same task** (it moves pending records into `savedColumns`, §5.3.2). If the transaction fails, keep the exported records and write them first on the next attempt.
  4. Set `settings.lastWorldId`.
  5. Emit `save:start` and `save:done`.
  Never block the loop; a save in progress makes a new request coalesce.
- **Autosave triggers:**
  - 2.5 s after the last `block:changed` (debounced). *(v1.6)* Natural changes (`cause` `growth`, `melt`, `decay`: MECH random ticks) count as soft changes, saved within 30 s, so they never push a child's edit out to the 30 s interval.
  - At least every 30 s while there are changes.
  - Immediately on `visibilitychange` → hidden, on `pagehide`, on the `pause` screen, on `kid:home`, and on fullscreen exit.
- **Persistence:** call `navigator.storage.persist()` on http(s).
- **Origins:** `file://` and GitHub Pages have separate stores. Mention this in the parent tips.
- **Backups (P1):** keep the last 3 metas plus a daily snapshot, restorable in settings.

**8.4.4 Parent gate** (`parentgate.js`): `openParentGate(game) → Promise<bool>`.

- Press and hold for 3 s, then answer a random two-digit sum on an on-screen number pad.
- Sits at Z.GATE.
- Used for settings, delete/rename, export/import, scheme change, and any link out.

**8.4.5 Parent tips** (a page in `settings`, behind the gate; plain text is fine there):

- Turn off the Windows Sticky Keys shortcut (Settings → Accessibility → Keyboard → Sticky keys → "Keyboard shortcut for Sticky keys" off). Blockcraft never uses Shift in the kid scheme, but a child may still mash it.
- Saves opened from a file and from the website are separate.
- Survival is for grown-ups or older kids: the recipe book shows pictures, but survival still means gathering and crafting. Creative is the default for a reason.
- TNT is on by default and undoable (U). It can be turned off in the world rules.

**Acceptance**

- `save-load` passes (with CORE-C).
- Add `menus-flow`: from title Play → playing → Esc/pause → Save & Title → the title lists 1 world.
- `menus-autosave`: a `block:changed` followed by 3 s puts `save:done` in the events.
- Gate: 3 random taps without the hold never pass.
- All buttons are at least 48 px and Play at least 200×120 px at 1280×720 and at a 375 px-wide viewport.

### 8.5 KID — touch controls and kid helpers

**8.5.1 Touch** (`src/ui/touch.js`, system `touch`): `visible`, `setVisible(bool)`.

- **Shown** when `settings.touchControls === 'on'`, or `'auto'` and `input.lastPointerType === 'touch'`.
- **Layout** (sizes from `--touch-btn`: 80, 96 or 112 px; at least 24 px from the edges; mirrored when `leftHanded`):

  | Control | Position and behaviour |
  |---|---|
  | D-pad | Bottom left, centred at (24 + 140, H − 24 − 140): ▲ forward, ▼ back, ◀ ▶ **turn** (`setVirtual('turnLeft'/'turnRight')`), with an 8–12 px safe ring. Optional fixed joystick (160 px base, 64 px knob) via `setMoveVector`. |
  | Jump / Up | 112 px, about 100 px from the right edge and 140 px from the bottom. *(v1.6)* When the jump / down / fly column would overlap the HUD block (hotbar, backpack, survival rows; narrow or touch laptops, or Down while flying at 1280 × 720), the column is lifted so its bottom sits 8 px above the HUD. |
  | Down ▼ | 96 px, shown only while flying: `setVirtual('descend')`. |
  | Fly toggle | 80 px, above the jump button. |
  | Pause, Home | Top right and top left (Home may be owned by `kid.js`; one implementation only). |
  | Hotbar, inventory button | Rendered by INV. |

- **Behaviour:**
  - Buttons act on `pointerdown` and capture their pointer.
  - Track each pointer by id. Ignore contacts larger than 40 px.
  - The world area belongs to CORE-E (tap, hold and drag).
  - Plates are `rgba(0,0,0,0.55)` with white glyphs; opacity from `settings.touchOpacity`.

**8.5.2 Kid helpers** (`src/kid/kid.js`, system `kid`)

- **API:** `goHome()`, `setHome()`, `undo() → bool`, `enterFullscreen() → Promise<bool>`, `tick`, `frame`, `serialize`, `deserialize`. Behaviour as in §2.7.
- **Home:** 80 px button at the top left plus the H key.
- **Undo** (data model fixed in v1.1 — `block:placed` alone cannot restore replaced water, grass or snow, and doors/beds touch two cells):
  - Record from **`block:changed`**, which carries `oldId`/`oldState` and `action`. Group by `action`: one entry = every change sharing one non-zero action id, `{action, tick, cells: [{x, y, z, before: raw, after: raw}]}` (first `before` per cell kept).
  - An action becomes an undo entry when any of its changes has cause `'player'` or `'explosion'`; its `'cascade'` and `'support'` changes (second door/bed half, a torch that lost its wall, fence connection updates) join the same entry because MECH passes the action along. Changes with cause `'undo'`, `'worldgen'` or `'test'` are never recorded.
  - Ring buffer of `KID.UNDO_ENTRIES` (50). Undo restores each cell's `before` (newest cell first) in one batch with `world.setBlock(…, {cause: 'undo'})`, only where the current value still equals `after`.
- **Exit guards:**
  - `enterFullscreen()` (from the Play click): `document.documentElement.requestFullscreen({navigationUI: 'hide'})`, then `navigator.keyboard?.lock()`. Holding Esc for 2 s exits.
  - On `fullscreenchange` to exit while playing: save, then show a big ▶ "keep playing" overlay that re-enters on click.
  - After the first interaction, `beforeunload` → `preventDefault` + `returnValue`.
  - keydown blocks F5, Ctrl+R, Ctrl+±/0, F1, F3, F6, F7 and Alt+Left.
  - `history.pushState({bc: 1}, '', location.href)` (exactly this: changing the path throws on `file://`) so the back gesture lands in the game.
  - `overscroll-behavior: none` (already in the base CSS).
- **Hints (P1):** pictogram overlays at Z.KID with an optional `speechSynthesis` line using `localService` voices only.

**Acceptance**

- `kid-home` passes.
- Add `kid-void` (survival world: teleport to y −30 → back on the surface within 10 ticks, health unchanged, no `player:hurt` with cause `void`), `kid-undo` (place then undo → air; place a door then undo → both halves gone; place into water then undo → water back), `touch-controls` (with `--touch`).
- Every touch target at least 80 px for primary controls.

### 8.6 MECH — block mechanics (`src/mechanics/*`, system `mechanics`)

**API:** `explode(x, y, z, power, {source, breakBlocks, fire}) → blocks destroyed`, `primeTnt(x, y, z, fuse = 80) → Entity | null`, `scheduleTick(x, y, z, delay)`, `applyBoneMeal(x, y, z) → bool`, `trySleep(x, y, z) → {ok, reason}`, `serialize`, `deserialize`. Behaviour as in §2.5.

**Infrastructure**

- **Rules that keep other lanes working:** remove blocks only with `interaction.breakBlock` (explosions too, with `dropInto`); wrap explosions, tree growth, fluid spreading and bone-meal patches in `world.beginBatch()`/`endBatch()`; pass the causing change's `action` into every follow-up change (store it with scheduled ticks); use `game.rand()`.
- **Scheduled ticks:** a min-heap keyed by game tick, deduplicated per cell, with at most 1024 executions per tick.
- **Random ticks:** 3 per loaded section per tick, using `world.forEachColumn` and the column's `nonEmptyMask`.
- **Neighbour updates:** on `block:changed`, schedule a 1-tick check of the 6 neighbours and the cell itself (support, falling, fluids).

**Registrations**

- **Entity types:** `falling_block` (rendered with `renderer.createBlockModel`), `tnt` (block model plus a white `uTint` flash), `painting` (P1).
- **`hooks.registerItemUse`:** `flint_and_steel`, `bucket`, `water_bucket`, `lava_bucket`, the hoes, `bone_meal`, `painting` (P1).
- **`hooks.registerBlockUse`:** `oak_door`, `oak_fence_gate` (P1), `bed`, `cake`, `tnt` (with flint).
- **`hooks.registerPlacer`:** `oak_door`, `bed`.
- **Neighbour reactions:** fence/pane connection updates (P1) and the fidelity set (§2.5, P1).

**Acceptance.** Add these scenarios:

- `mech-sand-falls`: place sand 5 above the ground; within 40 ticks it rests on the ground.
- `mech-tnt-chain`: 2 TNT 3 apart, prime one; both gone within 200 ticks and `explosion` emitted twice.
- `mech-door`: place, use, use → open state flips twice.
- `mech-water-flow`: a source on flat ground spreads to distance 7 within 200 ticks.
- `mech-farm`: hoe dirt, seeds, bone meal ×3 → wheat age 7.
- `mech-torch-support`: break the block under a torch → torch gone, and the torch's `block:changed` carries the same `action` as the break.
- `mech-tnt-batch`: one TNT in stone → `explosion.blocks` is an array with `count` entries, at most 32 item entities spawned in survival, and the explosion frame stays under 50 ms.
- `mech-bed-nap` (kid default world): use a bed → `sleep:start {nap: true}`, then time returns to 3000.
- `mech-fence-pen` (P1): a closed ring of fences and a gate keeps a pig inside for 400 ticks; opening the gate lets the player through.

No frame above 50 ms during the TNT chain on the RTX machine.

### 8.7 FX — visual polish (`src/fx/*`, `src/render/celestial*.js`, system `fx`)

**API:** `spawnParticles(kind, x, y, z, opts)`, `blockBreakParticles(x, y, z, id, state)`, `makeItemMesh(itemKey) → Object3D` (geometry **cached per item key** and shared; `disposeItemMesh` never disposes the shared geometry), `disposeItemMesh(obj)`, `fade(to, ms) → Promise`, `hurtFlash()` (red vignette only — the camera tilt is the player lane's), plus `weather` (P2) `{rain: 0..1}`, which the renderer reads. No poof for `entity:spawn`/`entity:remove` with reason `load`/`unload`.

**Particles**

- One pooled `InstancedMesh` or `Points` system with at most 2000 particles.
- **Block break:** 16–32 particles sampling random 4×4 patches of the block's face texture (atlas UV sub-rect), with gravity, lit by world light.
- **Other kinds:** `smoke`, `explosion`, `heart`, `sparkle`, `splash`, `bubble`, `crit`, `angry`, `poof`, `flame`.

**Other visuals**

- **View model** (first person): arm plus held item in `renderer.viewModelScene`, with `viewModelCamera` at the origin. Equip-swap animation on `player:hotbar`. Swing from `player.swingTicks` (6 ticks). Block items use `createBlockModel`; flat items are extruded sprites (`icons.pixels16`, 1/16 thickness).
- **Player model** (third person, P1): Steve-like proportions, but original. Colours from `settings.skin`.
- **Sky objects:**
  - Square sun and 8 moon phases on the celestial angle (`renderer.sky.sunDir`).
  - Stars (`starBrightness`).
  - Flat clouds at `CLOUD_HEIGHT` (108), drifting +X at 0.03 b/t, procedural cloud map, toggled by `settings.clouds`.
  - *(v1.5, review CORE-R11)* No sun, moon or stars at or below the horizon, and clouds use the shared fog uniforms, so the renderer's fog cull stays picture-neutral (§5.5.4).
- **Crack overlay:** a box at 1.002 scale using the `crack_<stage>` layers with multiply-style blending, `depthWrite: false` and polygonOffset −1. Driven by `interaction.mining` and `block:mining`.
- **Kid ghost block:** a translucent (α 0.35) preview of the held placeable block at the target cell, kid scheme only, while the cursor hovers. Pulses gently.
- **Bed nap:** fade plus a starry sky for `sleep:start {nap: true}`.
- **Underwater:** a blue overlay div at Z.FX_OVERLAY with opacity 0.25, shown while `player.eyeInWater`.
- **In a block** *(v1.6)*: while the camera sits inside an opaque full cube (head in sand, a wall behind the third-person camera), that block's side texture fills the screen in big pixels at about a third of its brightness, as in the original, instead of seeing through the world. `fx.stats().inBlock`.
- **Hurt flash:** red vignette only (the hurt tilt is the player lane's, §2.1).
- **Fades:** sleep and home.
- **Flash safety:** never more than 3 flashes per second (WCAG 2.3.1).

**Acceptance.** Add `fx-break-particles` (a break creates more than 10 particles that are all gone within 60 ticks) and `fx-itemmesh` (100 `makeItemMesh`/dispose cycles leave the `geometries` count flat). The `crack` and `ghost` screenshots are reviewed by the integrator.

---

## 9. UI style guide

**DOM layers.** Every lane creates its root with `uiLayer(game, id, Z.X)` inside `#ui-root`.

| Layer | Z |
|---|---:|
| FX overlay | 10 |
| HUD | 20 |
| KID | 30 |
| TOUCH | 40 |
| Containers | 50 |
| Screens | 60 |
| Toast | 70 |
| Gate | 80 |
| Loading | 90 |
| Debug | 100 |

- `#ui-root` and the layers have `pointer-events: none`. Interactive elements opt back in: buttons, `.bc-panel`, `.bc-screen`, `.bc-slot` and `[data-interactive]` get it automatically.

**GUI scale**

- `--gui` is the largest integer `s` (2–6) with `w/s ≥ 320` and `h/s ≥ 240` (`settings.guiScale` overrides).
- Derived variables:
  - `--hotbar-slot`: kid `24·gui`, classic `20·gui`; clamped 64–88 px for kid, ≥ 40 px for classic.
  - `--slot`: `18·gui`, at least 48 px for kid.
  - `--touch-btn`: 80, 96 or 112 px.
- Draw everything in GUI units with pixel-snapped sizes and `image-rendering: pixelated` for icons.

**Font:** `var(--font)`, the original pixel font (MENUS) with monospace fallbacks. White text on dark gets a `2px 2px 0 #3f3f3f` shadow; dark text `#3f3f3f` goes on grey panels. There is no essential text in kid paths.

**Colours** (`styles.css` `:root`)

| Use | Colour |
|---|---|
| Panel | `#c6c6c6`, light bevel `#fff`, dark bevel `#555`, black outline |
| Slots | `#8b8b8b`, dark `#373737` top-left, light `#fff` bottom-right inset |
| Buttons | `#727272` with bevels; hover `#8b98c8` |
| Selection and focus | `#ffd400` |
| Plates | `rgba(0,0,0,0.55)` with a 2 px white border |

**Shared classes**

- `.bc-panel`, `.bc-btn`, `.bc-btn-big`, `.bc-btn-play`, `.bc-plate-btn`.
- `.bc-slot`, `.bc-icon` (via `game.icons.element(key, px)`), `.bc-count`, `.bc-durability > i`.
- `.bc-screen`, `.bc-dim`, `.bc-center`, `.bc-stack`, `.bc-row`, `.bc-title`, `.bc-hidden`.

**Kid rules**

- Primary controls at least 80 px, secondary at least 56 px, nothing clickable under 48 px. At least 8 px between targets. At least 24 px from screen edges.
- Selection is never shown by colour alone: use a border, scale and lift.
- Contrast: icons on plates at least 3:1, any text at least 4.5:1.
- React on `pointerdown` and emit `ui:click`.
- Gentle idle animation on things the child should press.
- No scrolling lists in kid paths: page with big ◀ ▶.

---

## 10. Controls

### 10.1 Keyboard

| Key | Kid scheme (default) | Classic scheme |
|---|---|---|
| W / ↑ | forward | W forward · ↑ look up |
| S / ↓ | back | S back · ↓ look down |
| A / ← , D / → | **turn** left / right | A/D strafe · ←/→ turn |
| PageUp / PageDown | look up / down | — |
| Space | jump · swim up · fly up | jump · double-tap = fly (creative) |
| C / Z | fly down (`descend`) | — |
| Shift | — (**never bound**: Sticky Keys) | sneak · fly down |
| Ctrl / R | — | sprint (also double-tap W) |
| 1–9 · wheel (notched only) | hotbar | hotbar |
| E | block picker / inventory | inventory |
| F | fly toggle | fly toggle |
| H | Home | Home |
| U | Undo | Undo |
| V | camera view | camera view (also F5) |
| Q | — (no dropping) | drop (Ctrl+Q stack) |
| Esc | pause / close screen | pause / close screen |
| F1 / F3 | — | hide HUD / debug |

### 10.2 Mouse, trackpad and touch in the world area

- **Kid scheme:** tap = use or place; hold 350 ms = break (a ring appears immediately); drag = look; every button means the same thing (§7.1).
- **Classic scheme:** pointer-lock mouse look; left = break or attack; right = place or use; middle = pick block.

### 10.3 Touch overlay

See §8.5.1: D-pad turning, jump and fly buttons, hotbar, inventory, pause, Home.

---

## 11. Test API: `window.__game`

Owner LEAD (`src/core/testapi.js`). Additive changes only.

- **Angles** are in degrees: yaw 0 = north, + turns left; pitch + = up.
- **Safety:** every member returns safe values while lanes are stubs.
- **Errors:** `__game.errors` must stay empty.

| Member | Returns / effect |
|---|---|
| `ready`, `worldReady`, `version`, `errors[]`, `game` | flags, build version, recorded errors, the live game object |
| `stubs()`, `state()` | stub names still registered, `game.state` |
| `startWorld(opts)`, `exitToTitle()` | Promise<true> |
| `pos()` | `{x, y, z, yaw, pitch, onGround, flying, inWater, health, food, vx, vy, vz, sneaking, sprinting, eyeInWater, inLava, onLadder, air, fallDistance, view, collidedH, tick}` |
| `teleport(x, y, z)`, `setLook(yawDeg, pitchDeg)`, `look(dyawDeg, dpitchDeg)` | move or rotate (look waits 2 frames); `setLook`/`look` reset the kid auto-pitch timer |
| `lookAt(x, y, z)` | turn the eye toward a world point (waits 2 frames) → `{yaw, pitch}` |
| `aimAt(x, y, z)`, `worldToNdc(x, y, z)` | put the kid cursor (`input.aim`, `aimActive`) on a world point → `{x, y, onScreen, target}`; projection only |
| `tapAt(ndcX, ndcY)`, `holdAt(ndcX, ndcY, ms)` | kid gestures at a screen point (tap = aim + use; hold = aim + attack for ms) |
| `interactEntity(id, 'use'\|'attack')` | look at the mob, aim at it and use (feed, shear, tame, dye, ride) or hit it → `{ok, targeted, health, data}` |
| `recordTicks(n, {sync?})` | per-tick player states (`pos()` shape) for the next n ticks; `sync` runs them with `runTicks` |
| `move(forward, right, ms)` | hold the virtual move vector for ms of real time → `pos()` |
| `jump()`, `hold(action, ms)`, `press(action)`, `setFlying(bool)` | virtual input |
| `getBlock(x, y, z)` → name, `getBlockId`, `getState`, `getLight` → `{sky, block}`, `setBlock(x, y, z, name, state)`, `surfaceY(x, z)` | world access |
| `target()` | `{x, y, z, face, nx, ny, nz, name, state, dist}` or null |
| `breakTarget(timeoutMs = 4000)` | centre aim, hold `attack` until the targeted block changes → `{ok, x, y, z, before, after}` |
| `placeTarget(timeoutMs = 2000)` | centre aim, hold `use` until the cell at target + normal changes → `{ok, x, y, z, before, placed}` |
| `selectSlot(i)`, `selected()` → `{slot, item, count}`, `give(item, count)` → leftover, `inventory()`, `setSlot(i, item, count)` | inventory |
| `openInventory()` → screen name, `openScreen(name, opts)`, `closeUI()`, `uiOpen()` | UI |
| `setTime(t)`, `getTime()`, `setMode(m)`, `setDifficulty(d)`, `setRule(k, v)`, `meta()` | world settings |
| `spawn(type, x, y, z, opts)` → id, `entities()` → `[{id, type, x, y, z, health, data}]` | entities |
| `stats()` | `{fps, frameMs, workMs, tickMs, ticks, frames, chunksLoaded, columnsMeshed, renderDistance, sectionMeshes, drawCalls, triangles, geometries, textures, programs, dpr, entities, gpu, textureLayers}` |
| `setRenderDistance(n)`, `pixelStats(w, h)` → `{uniqueColors, meanLuma, stdLuma}`, `contextLossTest()` | rendering checks |
| `waitTicks(n)`, `waitFrames(n)`, `sleep(ms)` | timing |
| `runTicks(n)` | run n ticks synchronously, then one frame (crops, babies, furnaces) → tick count |
| `setRandomSeed(seed)` | fix `game.rand()` (every gameplay roll, §0.3) |
| `waitFor(predicate, timeoutMs)` | poll until true → bool. In the page: a function `(api, game) => bool`. From the harness: `t.call('waitFor', 'expression', ms)` (polled from Node because the page CSP forbids compiling strings) or `t.waitFor(fn, arg, ms)` |
| `audioStats()` | `{voices, byName}` from AUDIO |
| `events(name, limit)` → `[{tick, payload}]`, `eventCount(name)` | event log (last 400) |
| `save()`, `listWorlds()`, `settings()`, `setSetting(k, v)`, `blockId(name)` | persistence and misc |

---

## 12. Performance budgets

**Reference machines**

- **Mid laptop:** Intel Iris Xe class, 1080p at DPR 1.25.
- **Weak proxy:** SwiftShader (`--swiftshader`). Use it for relative gates only.
- **Dev:** RTX 3080 Ti headless.

| Metric | Budget | How it is measured |
|---|---|---|
| Frame rate at the default R (6) | ≥ 60 fps on the mid laptop; dev machine `workMs` p90 ≤ 6 ms | `stats().workMs` in the `perf` scenario |
| Draw calls at R 6 | ≤ 300 typical, ≤ 600 worst (one per mob; column-merged chunks if needed, §5.5.6) | `stats().drawCalls` |
| Boot to title | < 1.5 s (dev < 0.5 s) | `__game.game.bootMs` |
| Play click to playable | **< 4 s** on the mid laptop (dev < 1.5 s, SwiftShader < 4 s) | `worldReadyMs` note in the `world` scenario |
| Chunk work while playing | ≤ 4 ms per frame (2 ms when frames are late); edits outside the budget, same frame | world stats |
| Block edit → visible | same frame; remesh ≤ 3 ms per section | CORE-C unit and bench tests |
| Section mesh | ≤ 0.6 ms desktop, ≤ 2 ms weak | CORE-C bench |
| Column generation | ≤ 3 ms mid laptop (≤ 1 ms desktop) | CORE-B bench |
| Column initial lighting | ≤ 2 ms on the SwiftShader proxy | CORE-C bench |
| Lighting edit | < 1 ms typical; 600-cell batch ≤ 15 ms dev | CORE-C bench |
| Streaming during kid flight | no unmeshed column within R − 1 for more than 1 s while flying at the capped speed | CORE-C + CORE-E scenario |
| Memory | JS heap < 300 MB; GPU < 150 MB; ≈ 98 KB per loaded column (≈ 31 MB at R 6); `geometries` and entity count bounded after walking 20 columns away and back | `perf` + leak scenario (CORE-C/D, MOBS) |
| Particles | ≤ 2000 live | FX |
| Entities | ≤ 24 creatures + 20 monsters + drops; mob tick ≤ 1 ms total | MOBS |
| Build size | `index.html` < 2.5 MB (minified) | build output |
| Input reaction | ≤ 50 ms visual or audio feedback for every press | manual + FX/AUDIO |

---

## 13. Acceptance criteria and test plan

### 13.1 Whole-game acceptance (integration phase, `--strict`)

1. **Builds and runs from both locations:**
   - `npm run build` writes the root `index.html`, which works opened from `file://` **and** served over http (`--http`), where the service worker registers.
   - Zero console or page errors.
   - No network requests except same-origin files.
2. **Kid default path works with no reading:** title → Play → in a creative world within 4 s.
   - Walk with the arrow keys, turn, tap to place the hotbar block, hold to break, fly with F, go Home with H.
   - Open the picker with E and put red wool in the hotbar.
3. **Fidelity of the block loop:**
   - Walk is about 4.3 blocks in 1 s; the jump apex is about 1.25.
   - Break and place work in both schemes.
   - Survival break times match `breakTicks`; tools wear out.
   - Drops fly to the player and are picked up with a pop.
4. **World:**
   - Hills, forests, desert, snow, sea, caves and ores.
   - Torches light caves smoothly with no seams at column borders.
   - The day/night cycle (when enabled) changes the sky and lighting with no remesh.
5. **Animals:** pigs, cows, sheep, chickens and wolves spawn naturally.
   - Feed two of the same type → hearts → a baby.
   - Shear and dye sheep; tame a wolf (sit, follow).
   - In kid mode a hit animal cannot die.
6. **Survival:** crafting (2×2 and 3×3), furnace and chest work. Health, hunger and fall damage follow §2.3. Death leads to respawn with keep-inventory.
7. **Mechanics:** TNT chain reactions, falling sand, doors, beds (spawn), water flow, farming with bone meal.
8. **Persistence:** autosave plus reload restores the blocks, inventory, animals, time and position.
9. **Performance** within §12. SwiftShader stays interactive (≥ 10 fps at R 4).
10. **Accessibility for kids:**
    - Every interactive element meets its minimum size.
    - Keys never stick after a blur.
    - Trackpad swipes don't spin the hotbar.
    - Wheel events can't zoom the page.
    - F5 and Ctrl+R are blocked during play (kid lane).

### 13.2 Per-lane acceptance

Each lane is done when all of the following hold:

1. Its `registerStub` lines are deleted.
2. Existing smoke scenarios that require it pass.
3. Its own scenarios (`tools/scenarios/<lane>.mjs`) and unit tests pass.
4. `test/foundation.test.mjs` still passes.
5. `node build.mjs --dev --out .tmp/build-<lane>` builds.
6. Its section's acceptance bullets hold.

| Lane | Must make pass | Own checks to add (minimum) |
|---|---|---|
| CORE-A | foundation texture contract; `terrain-render` (with C and D) | `texa-determinism`, icon atlas covers every item, atlas screenshot `.tmp/smoke-<tag>-icons.png` reviewed |
| CORE-B | foundation worldgen contract | determinism over 100 columns, spawn on dry grass, biome variety (≥ 4 biomes within 512 blocks for seed 12345), gen ≤ 1 ms per column bench |
| CORE-C | `world`, `terrain-render`, `break-place` (with E), `save-load` (with MENUS), `lead-unload-persist`, `lead-batch`, `CONTRACT world` unit test | light symmetry across borders, remove/re-add torch, no geometry leak after streaming away and back, edit remesh same frame |
| CORE-D | `terrain-render`, `context-loss`, `perf` draw-call bound | day vs night luma, fog hides pop-in, outline visible, no remesh on `setTime` |
| CORE-E | `move-jump`, `break-place`, `lead-break-contract`, `lead-testapi` | kid tap/hold/drag (`page.mouse`), classic pointer-lock path doesn't error, keys release on blur, notched wheel vs trackpad, ladder climb, swim up, step-up 0.5 slab, sneak edge |
| MOBS | `mobs`, `survival-fall`, `lead-entity-streaming` | see §8.1 |
| INV | `hotbar`, `inventory-ui` | see §8.2 |
| AUDIO | — | see §8.3 |
| MENUS | `save-load` | see §8.4 |
| KID | `kid-home`, `touch-controls` (with `--touch`) | see §8.5 |
| MECH | — | see §8.6 |
| FX | — | see §8.7 |

### 13.3 Test plan and tools

**Unit tests** (`npm run test:unit`, `node --test "test/**/*.test.mjs"`)

- The foundation covers data integrity (ids, references, texture coverage, boxes), Java break times, the event bus, inventory semantics, the texture/worldgen/mesher contracts and the save codec.
- Lanes add `test/<lane>.test.mjs` for pure modules: crafting, physics, raycast, lighting, mesher, worldgen, codec, AI helpers.

**Smoke test** (`npm test` = `node tools/smoke.mjs`)

- Builds a dev build into `.tmp/smoke-build[-tag]`, launches the real Chrome headless with Playwright, waits for `__game.ready`, then runs the scenarios.
- Collects every `pageerror` and `console.error`, plus `__game.errors` after each scenario.
- Screenshots go to `.tmp/smoke-[tag-]<name>.png`, failures to `…-FAIL.png`, and the report to `.tmp/smoke-report[-tag].json`.
- Flags:

  | Flag | Effect |
  |---|---|
  | `--scenario a,b` | run only these scenarios |
  | `--tag` | name the build folder, screenshots and report |
  | `--http` | serve over http and check the service worker |
  | `--swiftshader` | CPU renderer (weak-laptop proxy) |
  | `--touch` | `hasTouch`, enables touch-only scenarios |
  | `--strict` | PENDING counts as failure |
  | `--file` / `--no-build` / `--out` | use an existing build |
  | `--headed` | visible browser |
  | `--list` | list scenarios |
  | `--timeout` | per-scenario timeout |

**Built-in scenarios:** `boot`, `world`, `terrain-render`, `move-jump`, `break-place`, `hotbar`, `inventory-ui`, `time`, `kid-home`, `mobs`, `survival-fall`, `save-load`, `touch-controls`, `context-loss`, `perf`, plus `page-errors`.

**LEAD contract scenarios** (`tools/scenarios/lead.mjs`, run against stubs today and against real lanes later): `lead-events-roundtrip`, `lead-unload-persist` (edit → save → 20 columns away → back: the edit is still there, twice, plus the unsaved path), `lead-break-contract` (block entity in `block:broken`, shared action ids, replaceable placement, bedrock rule), `lead-batch`, `lead-entity-streaming`, `lead-testapi`.

**Integration loop** (LEAD, on `main`): merge one `lane/*` branch at a time; after each merge run `npm run build`, `npm run test:unit`, `npm test`; when all lanes are in, `npm test -- --strict`, `npm test -- --strict --http`, `npm test -- --swiftshader` and `npm test -- --touch`. Update `docs/STATUS.md` from the handoff notes only after re-running their commands. Review the screenshots, then run scripted playtests (a 5-minute walk, build and fly script; survival day 1).

**Scripted playtest** (`node tools/playtest.mjs [--swiftshader] [--seed N|random] [--file path] [--tag name]`, LEAD): a ~75 s session in real Chrome driven by real input (Play click, arrow keys, Space, F/C flight, H home, kid taps and holds on the canvas, drag look, classic pointer lock, Esc pause and resume). It flies, digs into a cave, places torches, builds a 5 × 5 planks house with glass windows, a door and a roof (every block hover-verified, then tapped), swims, checks day/night, column-border torch light and water animation, and records fps percentiles, draw calls and streaming completeness. Screenshots go to `.tmp/<tag>-NN-<step>.png` (tag `integ`, or `integ-ss` with `--swiftshader`), the report to `.tmp/<tag>-report.json`; exit code 1 on any failed check or error. The test API is used only to place the camera where a script cannot navigate, to pick hotbar slots (the HUD owns the hotbar keys) and to read state.

**Manual checks** (parent-facing, before release):

- Windows touchpad with "Most sensitive" palm check.
- A real touchscreen.
- Installing the GitHub Pages app and launching it offline.
- Holding Esc for 2 s in fullscreen.

---

## 14. Open decisions and risks

| # | Item | Default chosen | Risk / note |
|---|---|---|---|
| D1 | TNT explodes by default | **On**, kid-safe sound, undoable | The kid research suggested off. The parent's "all of Minecraft" bar favours on. Easy to flip with `DEFAULT_RULES.tntExplodes`. **Decision for the parent.** |
| D2 | Kid scheme A/D = turn (no strafe) | Turn | Matches Bedrock "player relative" and 5-year-olds' sense of left and right. Classic scheme keeps strafe. |
| D3 | World height 128, sea level 48 | as stated | Halves gen and memory compared with 256. Mountains are capped at about 110. |
| D4 | No tint attribute; biome colours baked | Single grass and leaf colours per species | Less biome colour variety. Revisit as P2 (it would need a vertex attribute and a texture change). |
| D5 | Texture layers ≈ 238 | under 256 | Adding many new textures would cross the WebGL2 minimum. CORE-D checks `MAX_ARRAY_TEXTURE_LAYERS` and must split arrays if needed. |
| D6 | Generation and meshing off the main thread | **Workers P0** (v1.1), main-thread fallback | Kids fly constantly; main-thread streaming at 4 ms/frame leaves holes on weak laptops. Plus the kid flight cap while streaming lags (§2.1 step 11a). |
| D7 | Saves differ between `file://` and GitHub Pages | separate origins | Parent tip plus export/import (P2). |
| D8 | Keyboard Lock and fullscreen in headless tests | not testable headless | Manual check. Tests only assert the API presence path doesn't throw. |
| D9 | Copyright | original art, audio, names | Creeper and "Steve-like" designs must be clearly original variants. The integrator reviews screenshots. |
| D10 | Ctrl sprint in the classic scheme | Ctrl and R, plus double-tap W | Ctrl+W outside fullscreen closes the tab. Keep R or double-tap as the documented method. |
| D11 | Shift in the kid scheme | **Unbound**; fly down = C / Z / touch ▼ | Five Shift presses open the Windows Sticky Keys dialog and drop fullscreen. Parent tip explains how to disable the shortcut. |
| D12 | Survival-only item sources before P1 monsters | Gravel 5% bone, oak/birch leaves 2% string (original twists) | Gunpowder stays creeper-only, so TNT is creative-only until creepers ship (P1). |
| D13 | Recipe book priority | **P0 for survival worlds** | A non-reader cannot use survival crafting without it. |
| D14 | Lava pools in deep caves (CORE-B) | **On**: carved cave cells at y ≤ 6 hold lava | Original-like and very deep, and the pools glow. **Decision for the parent**; `LAVA_LEVEL = 0` in `src/world/worldgen.js` removes them. Caves below sea level otherwise stay dry. |
| D15 | Kid flight take-off hop (CORE-E) | **On**: switching flight on while standing gives a 0.25 hop in the kid scheme | The child sees that flying started. The original has no hop. `KID_FLY_LIFT` in `src/player/player.js`. |

---

## Appendix A. Block table

Generated from `src/data/blocks.js`, which is normative. Hardness is in Java units, light = emission. Tool `(n)` = required harvest level.

<!-- BEGIN:BLOCK_TABLE -->
| id | name | shape / pass | hard. | tool (lvl) | light | drops | flags |
|---:|---|---|---:|---|---:|---|---|
| 0 | air | none / none | 0 | — |  | — | no-collide replaceable |
| 1 | stone | cube / opaque | 1.5 | pickaxe (1) |  | cobblestone | opaque |
| 2 | grass_block | cube / opaque | 0.6 | shovel |  | dirt | opaque |
| 3 | dirt | cube / opaque | 0.5 | shovel |  | self | opaque |
| 4 | cobblestone | cube / opaque | 2 | pickaxe (1) |  | self | opaque |
| 5 | bedrock | cube / opaque | ∞ | — |  | — | opaque |
| 6 | sand | cube / opaque | 0.5 | shovel |  | self | opaque falls |
| 7 | gravel | cube / opaque | 0.6 | shovel |  | special (dropFn) | opaque falls |
| 8 | sandstone | cube / opaque | 0.8 | pickaxe (1) |  | self | opaque |
| 9 | clay | cube / opaque | 0.6 | shovel |  | clay_ball 4 | opaque |
| 10 | snow_block | cube / opaque | 0.2 | shovel |  | snowball 4 | opaque |
| 11 | snow | layer / opaque | 0.1 | shovel |  | special (dropFn) | replaceable support:floor |
| 12 | ice | cube / translucent | 0.5 | pickaxe |  | — | slip 0.98 filter 1 |
| 13 | water | liquid / translucent | 100 | — |  | — | no-collide replaceable anim filter 1 |
| 14 | lava | liquid / opaque | 100 | — | 15 | — | no-collide replaceable anim filter 1 |
| 15 | obsidian | cube / opaque | 50 | pickaxe (4) |  | self | opaque |
| 16 | mossy_cobblestone | cube / opaque | 2 | pickaxe (1) |  | self | opaque |
| 17 | coal_ore | cube / opaque | 3 | pickaxe (1) |  | coal | opaque |
| 18 | iron_ore | cube / opaque | 3 | pickaxe (2) |  | raw_iron | opaque |
| 19 | gold_ore | cube / opaque | 3 | pickaxe (3) |  | raw_gold | opaque |
| 20 | diamond_ore | cube / opaque | 3 | pickaxe (3) |  | diamond | opaque |
| 21 | redstone_ore | cube / opaque | 3 | pickaxe (3) |  | redstone 4-5 | opaque |
| 22 | lapis_ore | cube / opaque | 3 | pickaxe (2) |  | lapis_lazuli 4-9 | opaque |
| 23 | emerald_ore | cube / opaque | 3 | pickaxe (3) |  | emerald | opaque |
| 24 | oak_log | cube / opaque | 2 | axe |  | self | opaque flammable axis |
| 25 | birch_log | cube / opaque | 2 | axe |  | self | opaque flammable axis |
| 26 | spruce_log | cube / opaque | 2 | axe |  | self | opaque flammable axis |
| 27 | oak_planks | cube / opaque | 2 | axe |  | self | opaque flammable |
| 28 | birch_planks | cube / opaque | 2 | axe |  | self | opaque flammable |
| 29 | spruce_planks | cube / opaque | 2 | axe |  | self | opaque flammable |
| 30 | oak_leaves | cube / cutout | 0.2 | hoe |  | oak_sapling 5%, stick 1-2 2%, apple 0.5%, string 2% | flammable filter 1 |
| 31 | birch_leaves | cube / cutout | 0.2 | hoe |  | birch_sapling 5%, stick 1-2 2%, string 2% | flammable filter 1 |
| 32 | spruce_leaves | cube / cutout | 0.2 | hoe |  | spruce_sapling 5%, stick 1-2 2% | flammable filter 1 |
| 33 | oak_sapling | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 34 | birch_sapling | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 35 | spruce_sapling | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 36 | short_grass | cross / cutout | 0 | — |  | wheat_seeds 12.5% | no-collide flammable replaceable support:floor |
| 37 | fern | cross / cutout | 0 | — |  | wheat_seeds 12.5% | no-collide flammable replaceable support:floor |
| 38 | dead_bush | cross / cutout | 0 | — |  | special (dropFn) | no-collide flammable replaceable support:floor |
| 39 | dandelion | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 40 | poppy | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 41 | cornflower | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 42 | blue_orchid | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 43 | allium | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 44 | lily_of_the_valley | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 45 | orange_tulip | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 46 | pink_tulip | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 47 | sugar_cane | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 48 | cactus | cactus / opaque | 0.4 | — |  | self | support:floor contact 1 |
| 49 | pumpkin | cube / opaque | 1 | axe |  | self | opaque |
| 50 | jack_o_lantern | cube / opaque | 1 | axe | 15 | self | opaque facing |
| 51 | melon | cube / opaque | 1 | axe |  | melon_slice 3-7 | opaque |
| 52 | wheat | crop / cutout | 0 | — |  | special (dropFn) | no-collide support:floor |
| 53 | carrots | crop / cutout | 0 | — |  | special (dropFn) | no-collide support:floor |
| 54 | potatoes | crop / cutout | 0 | — |  | special (dropFn) | no-collide support:floor |
| 55 | farmland | farmland / opaque | 0.6 | shovel |  | dirt |  |
| 56 | glass | cube / cutout | 0.3 | — |  | — |  |
| 57 | bricks | cube / opaque | 2 | pickaxe (1) |  | self | opaque |
| 58 | stone_bricks | cube / opaque | 1.5 | pickaxe (1) |  | self | opaque |
| 59 | mossy_stone_bricks | cube / opaque | 1.5 | pickaxe (1) |  | self | opaque |
| 60 | bookshelf | cube / opaque | 1.5 | axe |  | book 3 | opaque flammable |
| 61 | glowstone | cube / opaque | 0.3 | — | 15 | glowstone_dust 2-4 | opaque |
| 62 | crafting_table | cube / opaque | 2.5 | axe |  | self | opaque flammable facing |
| 63 | furnace | cube / opaque | 3.5 | pickaxe (1) |  | self | opaque facing |
| 64 | furnace_lit | cube / opaque | 3.5 | pickaxe (1) | 13 | furnace | opaque facing |
| 65 | chest | chest / opaque | 2.5 | axe |  | self | flammable facing |
| 66 | bed | bed / opaque | 0.2 | — |  | special (dropFn) | flammable fall x0.5 |
| 67 | oak_door | door / cutout | 3 | axe |  | special (dropFn) | flammable support:floor |
| 68 | ladder | ladder / cutout | 0.4 | axe |  | self | facing climb support:wall |
| 69 | torch | torch / cutout | 0 | — | 14 | self | no-collide support:floor_or_wall |
| 70 | tnt | cube / opaque | 0 | — |  | self | opaque flammable |
| 71 | iron_block | cube / opaque | 5 | pickaxe (2) |  | self | opaque |
| 72 | gold_block | cube / opaque | 3 | pickaxe (3) |  | self | opaque |
| 73 | diamond_block | cube / opaque | 5 | pickaxe (3) |  | self | opaque |
| 74 | emerald_block | cube / opaque | 5 | pickaxe (3) |  | self | opaque |
| 75 | lapis_block | cube / opaque | 3 | pickaxe (2) |  | self | opaque |
| 76 | coal_block | cube / opaque | 5 | pickaxe (1) |  | self | opaque flammable |
| 77 | redstone_block | cube / opaque | 5 | pickaxe (1) |  | self | opaque |
| 78 | hay_block | cube / opaque | 0.5 | hoe |  | self | opaque flammable axis fall x0.2 |
| 79 | oak_slab | slab / opaque | 2 | axe |  | self | flammable filter 15 |
| 80 | cobblestone_slab | slab / opaque | 2 | pickaxe (1) |  | self | filter 15 |
| 81 | stone_brick_slab | slab / opaque | 2 | pickaxe (1) |  | self | filter 15 |
| 82 | oak_stairs | stairs / opaque | 2 | axe |  | self | flammable filter 15 |
| 83 | cobblestone_stairs | stairs / opaque | 2 | pickaxe (1) |  | self | filter 15 |
| 84 | oak_fence | fence / opaque | 2 | axe |  | self | flammable |
| 85 | fire | fire / cutout | 0 | — | 15 | — | no-collide replaceable anim support:floor |
| 86 | cake | cake / opaque | 0.5 | — |  | — |  |
| 87 | white_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 88 | orange_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 89 | magenta_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 90 | light_blue_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 91 | yellow_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 92 | lime_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 93 | pink_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 94 | gray_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 95 | light_gray_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 96 | cyan_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 97 | purple_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 98 | blue_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 99 | brown_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 100 | green_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 101 | red_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 102 | black_wool | cube / opaque | 0.8 | shears |  | self | opaque flammable |
| 103 | white_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 104 | orange_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 105 | magenta_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 106 | light_blue_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 107 | yellow_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 108 | lime_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 109 | pink_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 110 | gray_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 111 | light_gray_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 112 | cyan_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 113 | purple_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 114 | blue_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 115 | brown_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 116 | green_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 117 | red_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 118 | black_stained_glass | cube / translucent | 0.3 | — |  | — |  |
| 119 | brown_mushroom | cross / cutout | 0 | — | 1 | self | no-collide flammable support:floor |
| 120 | red_mushroom | cross / cutout | 0 | — |  | self | no-collide flammable support:floor |
| 121 | granite | cube / opaque | 1.5 | pickaxe (1) |  | self | opaque |
| 122 | diorite | cube / opaque | 1.5 | pickaxe (1) |  | self | opaque |
| 123 | andesite | cube / opaque | 1.5 | pickaxe (1) |  | self | opaque |
| 124 | white_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 125 | orange_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 126 | magenta_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 127 | light_blue_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 128 | yellow_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 129 | lime_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 130 | pink_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 131 | gray_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 132 | light_gray_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 133 | cyan_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 134 | purple_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 135 | blue_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 136 | brown_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 137 | green_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 138 | red_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 139 | black_carpet | carpet / opaque | 0.1 | — |  | self | flammable support:floor |
| 140 | oak_fence_gate | gate / opaque | 2 | axe |  | self | flammable facing |
| 141 | glass_pane | pane / cutout | 0.3 | — |  | — |  |
<!-- END:BLOCK_TABLE -->

## Appendix B. Item list

Generated from `src/data/items.js`, by creative tab. `(P1)`/`(P2)` mark behaviour priority.

<!-- BEGIN:ITEM_LIST -->
- **building** (30): stone, cobblestone, bedrock, sandstone, obsidian, mossy_cobblestone, oak_planks, birch_planks, spruce_planks, glass, bricks, stone_bricks, mossy_stone_bricks, bookshelf, iron_block, gold_block, diamond_block, emerald_block, lapis_block, coal_block, redstone_block, hay_block, oak_slab, cobblestone_slab, stone_brick_slab, oak_stairs (P1), cobblestone_stairs (P1), oak_fence (P1), oak_fence_gate (P1), glass_pane (P1)
- **nature** (45): grass_block, dirt, sand, gravel, clay, snow_block, snow, ice, coal_ore, iron_ore, gold_ore, diamond_ore, redstone_ore, lapis_ore, emerald_ore, oak_log, birch_log, spruce_log, oak_leaves, birch_leaves, spruce_leaves, oak_sapling, birch_sapling, spruce_sapling, short_grass, fern, dead_bush, dandelion, poppy, cornflower, blue_orchid, allium, lily_of_the_valley, orange_tulip, pink_tulip, sugar_cane, cactus, pumpkin, melon, brown_mushroom, red_mushroom, granite, diorite, andesite, wheat_seeds
- **functional** (26): jack_o_lantern, glowstone, crafting_table, furnace, chest, oak_door, ladder, torch, tnt, white_bed, orange_bed, magenta_bed, light_blue_bed, yellow_bed, lime_bed, pink_bed, gray_bed, light_gray_bed, cyan_bed, purple_bed, blue_bed, brown_bed, green_bed, red_bed, black_bed, painting (P1)
- **food** (20): cake (P1), milk_bucket (P1), apple, golden_apple, bread, carrot, potato, baked_potato, porkchop, cooked_porkchop, beef, cooked_beef, chicken, cooked_chicken, mutton, cooked_mutton, rotten_flesh, melon_slice, pumpkin_pie (P1), mushroom_stew (P1)
- **colors** (64): white_wool, orange_wool, magenta_wool, light_blue_wool, yellow_wool, lime_wool, pink_wool, gray_wool, light_gray_wool, cyan_wool, purple_wool, blue_wool, brown_wool, green_wool, red_wool, black_wool, white_stained_glass, orange_stained_glass, magenta_stained_glass, light_blue_stained_glass, yellow_stained_glass, lime_stained_glass, pink_stained_glass, gray_stained_glass, light_gray_stained_glass, cyan_stained_glass, purple_stained_glass, blue_stained_glass, brown_stained_glass, green_stained_glass, red_stained_glass, black_stained_glass, white_carpet (P1), orange_carpet (P1), magenta_carpet (P1), light_blue_carpet (P1), yellow_carpet (P1), lime_carpet (P1), pink_carpet (P1), gray_carpet (P1), light_gray_carpet (P1), cyan_carpet (P1), purple_carpet (P1), blue_carpet (P1), brown_carpet (P1), green_carpet (P1), red_carpet (P1), black_carpet (P1), white_dye, orange_dye, magenta_dye, light_blue_dye, yellow_dye, lime_dye, pink_dye, gray_dye, light_gray_dye, cyan_dye, purple_dye, blue_dye, brown_dye, green_dye, red_dye, black_dye
- **tools** (29): wooden_pickaxe, stone_pickaxe, iron_pickaxe, golden_pickaxe, diamond_pickaxe, wooden_axe, stone_axe, iron_axe, golden_axe, diamond_axe, wooden_shovel, stone_shovel, iron_shovel, golden_shovel, diamond_shovel, wooden_hoe, stone_hoe, iron_hoe, golden_hoe, diamond_hoe, shears, flint_and_steel, bucket, water_bucket, lava_bucket (P1), saddle (P1), carrot_on_a_stick (P1), lead (P2), oak_boat (P1)
- **combat** (23): wooden_sword, stone_sword, iron_sword, golden_sword, diamond_sword, bow (P1), arrow (P1), leather_helmet (P1), leather_chestplate (P1), leather_leggings (P1), leather_boots (P1), iron_helmet (P1), iron_chestplate (P1), iron_leggings (P1), iron_boots (P1), golden_helmet (P1), golden_chestplate (P1), golden_leggings (P1), golden_boots (P1), diamond_helmet (P1), diamond_chestplate (P1), diamond_leggings (P1), diamond_boots (P1)
- **materials** (28): stick, coal, charcoal, raw_iron, raw_gold, iron_ingot, gold_ingot, diamond, emerald, lapis_lazuli, redstone, flint, string, feather, gunpowder, leather, bone, bone_meal, wheat, sugar, clay_ball, brick, paper, book, glowstone_dust, bowl, egg (P1), snowball (P2)
- **animals** (11): pig_spawn_egg, cow_spawn_egg, sheep_spawn_egg, chicken_spawn_egg, wolf_spawn_egg, cat_spawn_egg (P1), horse_spawn_egg (P1), zombie_spawn_egg (P1), skeleton_spawn_egg (P1), creeper_spawn_egg (P1), spider_spawn_egg (P1)
<!-- END:ITEM_LIST -->
