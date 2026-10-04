# Handoff - mobs

Branch `lane/mobs` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-mobs`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · Phase 2: merged the real core, in-world verification

### What changed

- `git merge main` into `lane/mobs` (merge commit `3e7dc7e`, no conflicts).
- **Stub fallbacks removed** (the real core provides them): `src/entities/collide.js` is now a thin wrapper over CORE-E `physics.moveAndCollide / fluidState / boxCollides` (the local fallback collider is gone; the unit test "entity collision" now pins the real physics from the entity side); `mob_render.js` lost `patchStubMaterial` / `ensureUniforms` (CORE-D's `entitymat.js` clone already gives every clone its own `uParts` / light / tint); `mobs.js` no longer checks `isStub('raycast')`; `mob.js` / `vehicles.js` no longer check `isStub('player')`. Only the MECH-stub fallback in the creeper explosion remains (MECH is still a stub).
- **Riding fixes found in play**:
  - The real player ticks *before* entities and copies the seat, so the rider sat one tick behind the mount (the pig slid ahead of the camera). `syncRider()` now runs for the real player after the mount moved (prevX/Y/Z untouched, so the camera interpolates like the mount). Measured offset 0.000.
  - Seats lowered to Java-like seated heights (pig y+0.25, horse y+0.6, boat y-0.3): before, nothing of the animal or the boat was visible from the saddle. Now the horse's ears and mane, the pig's head and the boat hull frame the view.
  - A ridden animal no longer turns its head round to look at its own rider (the horse showed the side of its face).
  - Tapping the horse you sit on while holding a saddle (or horse food) now uses the item instead of getting you off (`acceptsWhileRidden`): after taming-by-riding the child is still on the horse, and before this the saddle tap threw her off.
- **Aim ray**: spawn eggs in the air, boat placement and the bow use CORE-E's `interaction.getAimRay` (the kid free cursor), not the look direction.
- **Determinism**: mobs created by chunk-generation population take *all* their creation rolls (AI stream seed, sheep colour, egg timer, horse stats, baby zombie) from the per-column generator (`opts.rand` -> `Mob.spawnRand`), so streaming columns never draw `game.rand()`. This fixed an intermittent `lead-testapi` FAIL ("setRandomSeed makes game.rand reproducible") seen in one full run. Unit-tested (0 draws while 169 fresh columns populate).
- **Mob light**: the brighter of the eye cell and the feet cell per channel (`entityLight`), so a head inside a leaf / slab / wall cell no longer turns a mob black.
- `tools/scenarios/mobs.mjs`: `eventCount` is cumulative for the page session, so scenarios now compare against a baseline (`evBase`); with the child-input scenarios running first, the `-direct` twins failed on absolute counts. `mobs-gallery` counts entity draw calls as (all) - (entities hidden), since terrain now draws too.
- New in-world playtest `tools/mobs-play.mjs` (+ `tools/mobs-play-lib.mjs`): real `page.mouse` clicks / holds on the animal's pixels (kid scheme: tap = use, hold = hit), real keyboard (W, Space, C, Shift), real `page.touchscreen` taps, plus `window.__game` for setup and checks. Sections: `gallery taps kidhit survival spawning cave terrain touch perf`.

### Commands run and results (2026-10-03, this worktree)

`node build.mjs --dev --out .tmp/build-mobs` -> `0.1.0-b9e7884b-dev ... (1710 KB, dev)`

`npm run test:unit` -> `tests 107 · pass 107 · fail 0` (`# mob tick: 0.187 ms per tick for 24 animals + 20 items`)

`node tools/smoke.mjs --tag mobs` (real Chrome, file://, stub lanes left: audio crafting font furnace fx gate hud invui kid mechanics menus music save touch)

```
PASS mobs · PASS coree-entities · PASS perf · PASS lead-* (6) · PASS page-errors
PASS mobs-gallery {"drawCalls":{"total":94,"entities":19}}   <- exactly one draw call per mob
PASS mobs-breeding · mobs-pickup · mobs-wolf-tame · mobs-kid-no-death   <- the 4 formerly PENDING child-input scenarios, now through real interaction/input/player/physics
PASS mobs-no-pileup {"maxCreatures":24,"chunkgenSpawnsAfterEachRound":[31,31,31]}
PASS mobs-step-up · mobs-breeding-direct · mobs-pickup-direct · mobs-wolf-tame-direct · mobs-kid-no-death-direct
PASS mobs-sheep · mobs-survival · mobs-monsters · mobs-ride · mobs-persist
FAIL survival-fall  - assert: 10-block fall costs 7 HP (health 17)   <- LEAD scenario defect, see Cross-lane defects 1
PENDING save-load (save) · SKIP touch-controls, coree-touch (need --touch)
[smoke] {"PASS":73,"FAIL":1,"PENDING":1,"SKIP":2}
```

`node tools/smoke.mjs --swiftshader --tag mobsss --scenario mobs-gallery,mobs-no-pileup,mobs-monsters,mobs-ride,mobs-breeding,mobs-kid-no-death` -> 7 PASS (gallery: 19 entity draws).

`node tools/mobs-play.mjs` -> `[mobs-play] 68 PASS, 0 FAIL`; `node tools/mobs-play.mjs --touch touch` -> `5 PASS, 0 FAIL`; `node tools/mobs-play.mjs --swiftshader perf` -> 4 PASS.

### Verified in the real world (screenshots in `.tmp/mobs-play/`, all looked at)

| # | Handoff item | Result | Evidence |
|---|---|---|---|
| 1 | Real physics: fence pen holds 6 animals for 3000 ticks | PASS (max 3.68 from centre, 0 escaped) | `terrain-fence-pen.png` |
| 1 | Pig follows a carrot up a slab onto a 1-block platform; steps a 1-block ledge (`mobs-step-up`) | PASS | `terrain-slab-step.png` |
| 1 | Cow in 3-deep water floats up (real `fluidState`) and climbs out within 60 s | PASS | `terrain-cow-swims.png` |
| 1 | Pushed pig slides on ice | PASS (1.99 blocks in 20 ticks) | - |
| 2 | Real mouse taps (kid scheme): wheat on two cows -> love -> baby | PASS | `taps-cows-in-love.png`, `taps-baby-cow.png` |
| 2 | Bones tame a wolf (4 taps, seed 99), it sits, empty-hand tap stands it up, it follows the child who walked away (W held) | PASS | `taps-wolf-tamed-sitting.png`, `taps-wolf-follows.png` |
| 2 | Shears tap -> wool item, walking over it picks it up; red + yellow + blue dye -> rainbow sheep | PASS | `taps-sheep-sheared-wool.png`, `taps-rainbow-sheep.png` |
| 2 | Saddle + tap to ride a pig, carrot on a stick steers (15.75 blocks in 60 ticks), C gets off, tapping the ridden pig gets off | PASS | `taps-riding-pig*.png` |
| 2 | Horse tamed by getting on it, saddled while sitting on it, W rides (13.4 blocks), Space jumps (4.07, jump stat 0.4-1.0) | PASS | `taps-riding-horse*.png` |
| 2 | Lead tap ties a cow, it follows | PASS | `taps-lead.png` (rope visible) |
| 2 | Spawn egg on the ground and into the sky | PASS (2 chickens) | `taps-spawn-egg-chickens.png` |
| 2 | Hold-to-hit a pig in a kid world: hop + squeak, never hurt (12 holds, health 10), no death | PASS | `kidhit-pig-hop.png` |
| 2 | Touchscreen: finger taps feed cows, mount a pig, tap the ridden pig to get off | PASS | `touch-after-ride.png` |
| 3 | Real renderer: one draw call per mob (gallery 19/19, 18 mobs -> 16 draws when 2 are off screen), night darkens through `uDaylight`, torch light reaches mobs (`uLightBlock` 13), closed room = 0 light, torch 3 blocks away = 11 | PASS | `gallery-day.png`, `gallery-night.png`, `gallery-night-torches.png`, `cave-dark-cow.png`, `cave-torch-cow.png` |
| 3 | Babies (big heads), saddles, collars, sitting wolf/cat, sheared sheep, hurt red flash, walk cycle, monsters | PASS by eye | `gallery-babies.png`, `gallery-closeup-*.png`, `side-farm.png`, `side-walk.png`, `side-hurt.png`, `zombie-close.png` |
| 4 | Real player: rider exactly on the seat (0.000 offset), C / Space / classic Shift dismount, boat placed on water by a tap (floats at 3.78), tap the boat to get in, W paddles (5.8), bow tap hits a zombie 8 blocks away and uses one arrow | PASS | `taps-boat-on-water.png`, `taps-in-boat*.png` |
| 4 | Fall damage end-to-end: real 10-block fall = 7, hay = 2; drowning with real `eyeInWater` (air out after 15 s, then damage); lava with real `inLava`; one tap with bread eats it; death -> respawn full, inventory kept | PASS | `survival-underwater.png`, `survival-death.png`, `survival-respawned.png` |
| 5 | Natural spawns with real worldgen: pig/cow/wolf/chicken/sheep, all on sky-lit grass; monsters at night 24+ blocks away, never in block light; in the morning undead ignite only at sky light 15 | PASS | `a1-nearest-animal.png` |
| 8 | Performance, default world R 8 (RTX 3080 Ti): 24 animals cost +14 draw calls (on-screen mobs only), entities + mobs tick 0.10-0.14 ms; fps 143.9 with and without (vsync-capped). SwiftShader: 31.1 fps with 24 animals vs 31.5 without, mob tick 0.19 ms | PASS | - |

### Not verifiable yet (other lanes still stubs)

- **FX** (stub): no hearts / sparkle / smoke particles, no death poof; dropped items render as the stub grey cube (`taps-sheep-sheared-wool.png`). The item entity already feeds `uLightSky/uLightBlock` when FX's real `makeItemMesh` returns an entity material.
- **AUDIO** (stub): mob voices from `mob:sound`, pickup pop.
- **SAVE / MENUS** (stubs): saving `meta.systems.entities / mobs / survival` through IndexedDB. `mobs-persist` proves the serialize -> startWorld round trip.
- **HUD** (stub): number keys do not select hotbar slots yet (the playtest selects via the API as well); hearts / hunger bar not drawn.

### Cross-lane defects

1. **LEAD `tools/smoke.mjs` scenario `survival-fall` (FAIL, health 17).** It teleports 10 blocks up and reads health 60 ticks later. Fall damage is correct (`player:hurt {amount: 7, cause: 'fall'}` on landing, verified in `tools/mobs-play.mjs survival`), but SPEC §2.3 regeneration ("hunger 20 with saturation > 0: heal 1 every 10 ticks") heals 3-4 HP in the ~40 ticks after the landing. Fix: assert on the `player:hurt` event (cause `fall`, amount 7), or read health on `player:land`, or set `player.saturation = 0` before the fall.
2. **LEAD `src/core/testapi.js` `eventCount`** is cumulative for the whole page session (`events.counts` is never reset on `startWorld`), so any scenario asserting an absolute count depends on which scenarios ran before it. Suggest documenting it in the testapi comment or adding `eventCount(name, {sinceWorld: true})` / resetting counts on `world:start`. This lane now uses baselines.
3. **LEAD `tools/scenarios/lead.mjs` `lead-testapi`** (repeat of phase-1 request 1): seed + draw are two separate page calls, so any tick in between that draws `game.rand()` (MOBS passive top-up every 400 ticks, monster cycle, MECH random ticks later) can still make it flaky. Do `setRandomSeed` and the draws inside ONE `t.eval`. (This lane removed the burst of draws from chunk-gen spawning that made it fail once.)
4. **CORE-E `src/player/interaction.js` `attackStep` (kid experience)**: a kid hold that *started on an animal* turns into block breaking once the animal hops away (knockback + panic), and in kid creative blocks break instantly, so holding on a pig digs holes: 11 blocks broken by 12 holds in `tools/mobs-play.mjs kidhit` (`kidhit-pig-hop.png` shows the hole). Suggested fix: remember that the current attack hold began on an entity and do not start mining until the hold is released (Java needs a fresh click to start mining too).

### Remaining gaps (this lane)

- Leads cannot be tied to fence posts (P2, not started); slimes / more animals not started.
- Horse jump is always full strength while Space is held (no charge bar; HUD-side in Java).
- Natural spawning gives no guarantee of animals in sight of the world spawn (seed 12345: nearest cows 14 blocks away); fine for Java parity, a kid preset could seed a group near spawn if the parent wants it.

## 2026-10-03 · MOBS lane: entities, mobs, items, survival (P0 + P1 + leads from P2)

### What changed

All stubs of this lane are real; `registerStub('mobs')`, `registerStub('items')` and `registerStub('survival')` are deleted.

| File | What it is |
|---|---|
| `src/entities/entity.js` | Foundation, unchanged (API frozen). |
| `src/entities/mobs.js` | System `mobs`: registers every MOBS type + `item`, `xp_orb`, `arrow`, `boat`; entity interactions, spawn eggs, boat and bow item uses, a `preUse` hook (tap your mount to get off); pets defend the player; natural spawning; `spawnMob`, `counts`. |
| `src/entities/mob.js` | `Mob` base class: player-formula movement (`a = (attr*mod)^2`, gravity 0.08, drag 0.98, step 0.6), idle AI (wander every 3-8 s within 10 blocks, look at player within 6, panic 100 ticks at x1.25, tempt within 10 stopping at 2.5, breeding, babies follow parents), getting around (jump obstacles <= 1 block with headroom, never path off 4+ drops / into lava, fire, cactus, float when > 40 % submerged, turn away after one failed jump), mob push-apart, hurt + knockback + red flash, kid rule, death tip-over + drops + XP, riding seats, leads (P2). |
| `src/entities/animals.js` | Pig (saddle, ride, carrot-on-a-stick steering), cow (milk), sheep (shear 1-3, dye, grazing regrowth, rainbow easter egg), chicken (eggs every 6000-12000 ticks, slow fall, wing flap), wolf (bone 1/3, sit, follow, teleport beyond 12, beg, tail shows health, defends the player, angry when hit in survival), cat (P1, raw chicken, scares creepers), horse (P1, temper taming by riding, saddle, steering, jump strength). |
| `src/entities/monsters.js` | P1 zombie (melee, burns in sun, baby zombies), skeleton (arrows within 15 every 60/40 ticks, flees tamed wolves, burns), creeper (30-tick fuse within 3, cancelled beyond 7, power 3 through `mechanics.explode`, white flash 2/s, swell, flees cats), spider (climbs walls, neutral in light >= 12, leaps), `arrow` projectile (player bow + skeletons). |
| `src/entities/vehicles.js` | P1 `boat` (floats on the water surface, 0.04 paddle accel, drag 0.9, rider steers by looking, breaks into the item when hit) and `xp_orb` (flies to the player within 8, `addXp`). |
| `src/entities/item_entity.js` | `dropItem` + `item` entity: gravity 0.04, drag 0.98, ground 0.6 x 0.98, pickup delay 10 (40 thrown), magnet within 1.5 at 0.1 b/t, pickup within 1.0, `item:pickup`, merge within 0.5, despawn 6000, lava/fire destroy, float in water, bob + spin via `fx.makeItemMesh`. |
| `src/entities/spawning.js` | Chunk-generation animals on `world:columnLoaded {fresh}` (10 %, 2-4, grass, light >= 9, biome lists via `mobsForBiome`), `populated` set (saved compactly in `meta.systems.mobs`), creature cap 24 including chunk-gen, passive top-up every 400 ticks (>= 24 blocks away), culling of untouched wild animals when a restored column would exceed the cap, monster cycle (P1: every 20 ticks, cap 20, sky <= 7 / block 0, 24+ blocks away, despawn > 128 instantly, > 32 after 30 s at 1/800, peaceful removes all). |
| `src/entities/mob_models.js` | Original box models for all 11 mobs + boat (<= 8 parts each), deterministic box-UV packer, merged buffer builder with `aPart`, walk/sit/graze/flap/aim/spider/tail poses (`cos(p*0.6662)*1.4*amt`). |
| `src/entities/mob_skins.js` | Procedurally painted original skins (PixelCanvas, seeded): 2x2 eyes with a highlight, original creeper face (round eyes + zig-zag mouth), original zombie (mossy skin, purple shirt), sheep in all 16 colours, wolf collar / angry eyes, 7 horse coats, saddles. |
| `src/entities/mob_render.js` | Shared geometry per model+variant and texture per skin; per-entity material = clone of `renderer.createEntityMaterial({map, parts})`; pose -> `uParts`, light -> `uLightSky/uLightBlock`, tint -> `uTint`. One draw call per mob. Stub-renderer shim (see below). |
| `src/entities/mob_ai.js` | Pure helpers: speed maths, yaw, safety checks (drops, lava, fire, cactus), jumpable obstacles, stand spots, wander/flee targets, rainbow rule, baby feeding, XP maths, daylight. |
| `src/entities/collide.js` | Entity movement glue: real `physics.moveAndCollide` / `fluidState` when CORE-E is live, **local fallback collider** while `physics` is a stub (switches automatically). |
| `src/survival/survival.js` | Health, hunger, saturation, exhaustion (jump, sprint, swim, damage, heal), regeneration and starvation (easy floor 10, normal 1), peaceful refill, fall damage from `player:land` with `fallMult`, drowning, lava, fire, cactus, suffocation, void (only when `voidRescue` is off), armour reduction + wear, absorption/regeneration/hunger effects, eating hooks for every `eat`/`drink` item (32 ticks; kid scheme finishes from one tap; crop food on farmland is planted instead), death (`keepInventory`, scatter otherwise), immediate respawn after 20 ticks with fades, respawn at bed/spawn. |
| `src/survival/damage.js` | Pure maths: fall damage, invulnerability frames, armour, exhaustion drain, regen/starvation tick, food values, explosion damage, air. |
| `test/mobs.test.mjs` | 22 unit tests (AI helpers, damage maths, models, skins, fallback collider, and whole mobs simulated in a fake world: cliffs, ledges, water, kid rule, breeding, sheep, chicken, cow, wolf, riding, boat, horse, items, spawning caps, survival, monsters, save/restore, leads, perf). |
| `tools/scenarios/mobs.mjs` | 17 smoke scenarios (below). |

### Commands run and results (2026-10-03, in this worktree)

`node build.mjs --dev --out .tmp/build-mobs` -> `[build] 0.1.0-18b3ae6e-dev -> ...\.tmp\build-mobs\index.html (1256 KB, 419 ms, dev)`

`npm run test:unit`

```
ℹ tests 35
ℹ pass 35
ℹ fail 0
# mob tick: 0.138 ms per tick for 24 animals + 20 items
```

`node tools/smoke.mjs --tag mobs` (full run, real Chrome, file://)

```
PASS     boot · PASS world · PASS hotbar · PASS inventory-ui · PASS time · PASS kid-home · PASS perf
PASS     lead-events-roundtrip · PASS lead-unload-persist · PASS lead-break-contract · PASS lead-batch
PASS     lead-entity-streaming · PASS lead-testapi
PASS     mobs-gallery        412 ms {"drawCalls":19,"renderCache":{"geometries":12,"textures":25,"materials":25}}
PENDING  mobs-breeding         0 ms  - stub lanes: interaction, input, player, physics
PENDING  mobs-pickup           0 ms  - stub lanes: interaction, input, raycast, player, physics
PENDING  mobs-wolf-tame        0 ms  - stub lanes: interaction, input, player, physics
PENDING  mobs-kid-no-death      0 ms  - stub lanes: interaction, input, player, physics
PASS     mobs-no-pileup     3137 ms {"maxCreatures":24,"chunkgenSpawnsAfterEachRound":[27,27,27],"populated":338}
PASS     mobs-step-up         85 ms
PASS     mobs-breeding-direct    137 ms
PASS     mobs-pickup-direct     90 ms
PASS     mobs-wolf-tame-direct    136 ms {"bones":1}
PASS     mobs-kid-no-death-direct    129 ms
PASS     mobs-sheep          210 ms
PASS     mobs-survival        87 ms
PASS     mobs-monsters       157 ms
PASS     mobs-ride           280 ms
PASS     mobs-persist        122 ms
PASS     page-errors           0 ms
PENDING  mobs (physics, world) · survival-fall (player, physics) · terrain-render · move-jump · break-place · save-load · context-loss; SKIP touch-controls
[smoke] {"PASS":26,"PENDING":11,"SKIP":1} in 11.7 s
```

`node tools/smoke.mjs --swiftshader --tag mobsss --scenario mobs-gallery,mobs-no-pileup,mobs-monsters,mobs-ride` -> 5 PASS (incl. page-errors).

Screenshots reviewed: `.tmp/smoke-mobs-mobs-gallery.png` (all mobs, babies, saddle, tamed sitting wolf, boat), `smoke-mobs-mobs-breeding.png` (two cows + baby), `smoke-mobs-mobs-wolf.png`, `smoke-mobs-mobs-sheep.png`, `smoke-mobs-mobs-creeper-fuse.png`. The stub renderer draws no terrain, so mobs float on sky blue in these shots.

### Scenario map

- **SPEC §8.1 acceptance, child-style input** (PENDING until CORE-E): `mobs-breeding`, `mobs-pickup`, `mobs-wolf-tame`, `mobs-kid-no-death`. They use `interactEntity` / `breakTarget`, so they need real `interaction`, `input`, `player`, `physics` (and `raycast` for pickup).
- **Run today**: `mobs-no-pileup` (stub world streams for real: 3 round trips of 20 columns, max 24 creatures, chunk-gen spawns identical every round), `mobs-step-up` (pig follows a carrot over a 1-block ledge), and the `-direct` twins, which call the exact `hooks.entityInteract` handlers through `game.mobs.useOn` / `hit` and `interaction.breakBlock`.
- Built-in `mobs` and `survival-fall` stay PENDING until CORE-E/CORE-C land (they require `physics`/`player`/`world`).

### Needs in-world verification (after the core merge)

1. **Real physics**: once `registerStub('physics')` is gone, entities use `physics.moveAndCollide` automatically. Re-run `mobs-step-up`, `mobs-no-pileup`, `mobs`, the unit tests still pin the fallback. Check fence pens (1.5 collision) hold animals (`mech-fence-pen`), stairs/slabs, mobs on ice, water float with real `fluidState`.
2. **Real interaction**: run `mobs-breeding`, `mobs-pickup`, `mobs-wolf-tame`, `mobs-kid-no-death`; tapping animals with wheat/bone/shears/dyes/saddle/lead/spawn eggs in the kid scheme; hold-to-hit an animal in a kid world (hop + squeak, no damage); spawn egg on a block face and in the air.
3. **Real renderer**: entity shader honours `aPart`/`uParts` (one draw call per mob), `uLightSky/uLightBlock` (mobs darken at night and in caves), `uTint` hurt flash / creeper flash, fog; check babies (big heads), sitting wolf/cat, sheared sheep, saddles, rope of a lead.
4. **Real player**: riding (player copies `getSeat()`, camera), dismount with C/Z (kid), Shift (classic), Space for pig/boat, or tapping the mount; boat placement on water via `raycast(..., {fluids: true})`; bow shots along the look ray; fall damage end-to-end (`survival-fall`), drowning with real `eyeInWater`, lava/fire with real `inLava`.
5. **Real worldgen/lighting**: natural spawns per biome (forest wolves, plains horses/cats), the light >= 9 rule, monster light rule at night and in caves, sun burning only under open sky.
6. **FX / AUDIO**: dropped items through the real `makeItemMesh` (lit), hearts/sparkle/smoke particles, poof on `entity:remove` reason `dead`, mob voices from `mob:sound`, pickup pop.
7. **MENUS save/load**: `meta.systems.entities` (animals incl. parked ones), `meta.systems.mobs.populated`, `meta.systems.survival` through IndexedDB (`mobs-persist` already proves the serialize/deserialize round trip without the save lane).
8. **Performance** at R 6 with 24 animals on the mid laptop: draw calls (one per mob), mob tick (0.14 ms in Node for 24 animals + 20 items).

### Interface assumptions (what this lane relies on from other lanes)

- **CORE-E interaction**: `use()` calls `hooks.preUse`, then `hooks.entityInteract[type](ctx)` for the targeted entity with `ctx = {game, player, stack, slot, entity, sneaking, action}`; `attack()` calls `entity.hurt(damage, {type: 'player', player: true, crit})`. `targetEntity = {entity, dist}` (used by the dismount preUse). Item uses get `ctx.hit` with `face`/`ny` (spawn eggs, eating on farmland).
- **CORE-E player**: when `player.riding !== null`, copy `game.entities.get(riding).getSeat()` and skip own physics (my stub-only sync turns itself off when `player` is no longer a stub); `player:land {fallDistance, blockId}`; maintained `inWater`, `eyeInWater`, `inLava`, `onLadder`, `sprinting`, `flying`; `spawn()` resets `dead`. `player.hurtTime`: survival sets 10 on damage and counts it down each tick - CORE-E should only read it for the tilt (or tell me to stop decrementing).
- **CORE-E physics**: `moveAndCollide` honours `body.stepHeight` (mobs 0.6, items/boats/orbs 0) and treats unloaded columns as solid; `fluidState().water` is the submerged fraction of the body height (floating uses > 0.4).
- **CORE-D renderer**: `createEntityMaterial({map, parts, alphaTest})` and `({color, parts: 1})` return materials with `uniforms.uParts.value` (array of `Matrix4`, one per part), `uLightSky`, `uLightBlock`, `uTint`; vertex attribute `aPart` (Uint8, 1 component, not normalised). I clone per entity and give each clone its own `uParts` matrices and `uTint` vector (three's `cloneUniforms` only slices arrays). `addObject`/`removeObject`. Stub shim: while the renderer is a stub, `patchStubMaterial` injects the same part transform + tint into the stub `MeshBasicMaterial` with `onBeforeCompile`; it never touches a `ShaderMaterial`.
- **FX**: `makeItemMesh(item)` / `disposeItemMesh(obj)`; if the returned material has `uLightSky/uLightBlock` uniforms the item entity sets them. `spawnParticles` kinds used: `heart`, `sparkle`, `smoke`.
- **MECH**: `explode(x, y, z, 3, {source: 'creeper', breakBlocks: rules.mobGriefing})` does the entity/player damage. While MECH is a stub the creeper hurts the player itself (same formula, easy = dmg/2+1) and emits a block-less `explosion` event.
- **CORE-B**: `BIOMES[col.biomes[i]].name` matches `MOBS[type].biomes` names.
- **INV**: `inventory.armor[i]` stacks carry `damage`; survival wears armour by mutating them and emitting `inventory:changed {slot: -1}` (bumping `version`).

### New events and API members (for the SPEC)

- Events: `mobs:rainbow {id, type, x, y, z}` (sheep became a rainbow sheep), `mobs:xp {amount, xp, level, levelUp}` (orb collected).
- `entity:spawn` reasons added: `chunkgen`, `natural` (both silent for FX/AUDIO), `breed`, `drop` (items), `shot` (arrows), `xp`. `entity:remove` reasons added: `pickup`, `merge`, `burn`, `cull`, `hit`, `explode` (all non-poof), plus `despawn` and `dead` as specified.
- `game.mobs`: `spawnXp(x, y, z, amount)`, `alertPets(entity)`, `useOn(idOrEntity, item?, count?)` and `hit(idOrEntity, amount)` (test/debug: same code path as the hooks), `populatedCount()`, `renderStats()`, `spawner`.
- `game.survival`: `eating` getter, `startEating(ctx)`, `cancelEating()`, `addEffect(type, level, ticks)`, `onLand(e)`.
- Mob entities: `getSeat()`, `mount()`, `dismount()`, `interact(ctx)`, `data` keys `baby grow color sheared tamed owner sitting saddled coat speed jump hp temper love cooldown wild eggTimer rainbow dyes leashed`.
- Entity types: `item`, `xp_orb`, `arrow`, `boat` + the 11 mobs.

### Spec conflicts / deliberate deviations (please confirm)

1. **Chunk-generation spawn rolls do not use `game.rand()`** (SPEC §2.6 says "10 % chance (`game.rand()`)"). They use a per-column generator seeded from `hash32(worldSeed, cx, cz)` (Java seeds chunk population per chunk too). Reason: columns stream in during `frame()`, so drawing `game.rand()` there changed the sequence between two test calls - `lead-testapi` ("setRandomSeed makes game.rand reproducible") failed consistently. Still deterministic per world.
2. **Idle-AI choices use a per-mob stream** (`mob.rng`, seeded from `game.rand()` when the mob is created) instead of drawing `game.rand()` every few ticks (SPEC §0.3 lists "AI wander choices"). Still reproducible with `setRandomSeed` before spawning; drops, taming, shearing, eggs, temper and XP use `game.rand()` directly.
3. **Sheep grazing**: the wool always regrows, but the grass -> dirt change (and eating a grass tuft) only happens while `rules.mobGriefing` is on (off in kid worlds).
4. **Dismounting**: besides sneak/`descend` (SPEC §7.5), Space dismounts a pig or boat (not a horse, which jumps), and tapping the animal you ride dismounts (`hooks.preUse`): the touch overlay shows ▼ only while flying, so a child on a tablet could not get off otherwise.
5. **Kid rule visuals**: a hit kid-world animal gets no red flash (only hop + panic + squeak), matching "a hit only does knockback, a hop, panic and a squeak".
6. **Item drops of killed animals** happen outside creative only (and never for babies), so kid creative worlds never fill with meat.

### LEAD requests

1. `tools/scenarios/lead.mjs` `lead-testapi`: draw the two `game.rand()` sequences inside **one** `t.eval` each together with the `setRandomSeed` call (seed + draw atomically). Any lane that rolls `game.rand()` in ticks or frames (MECH random ticks, AUDIO, this lane's top-up/monsters) can otherwise slip a draw between the two calls. This lane now avoids steady-state draws, so it passes today, but it is fragile.
2. SPEC §2.6/§0.3: document deviations 1 and 2 above (or tell me to revert them).
3. SPEC §6: add the new events and `entity:spawn`/`entity:remove` reasons listed above.
4. Stub player (`src/player/player.js`, CORE-E) keeps `flying` across worlds (`perf` turns it on, the next world still flies), which skipped fall damage in a later scenario; my scenarios call `setFlying(false)` after `startWorld`. Worth checking in the real player (`spawn()` for a new world should land the player).
5. AUDIO catalogue (§8.3.2) has no bow/arrow/boat sounds: proposing `bow.shoot`, `arrow.hit`, `boat.break` (not emitted yet, to avoid unknown names).

### Remaining

- P0: none known in this lane; the four child-input acceptance scenarios wait for CORE-E (above).
- P1: done (cat, horse, pig riding, boats, zombie, skeleton, creeper, spider, sun burning, XP orbs, bow, armour reduction, rainbow sheep). Armour equip UI is INV's.
- P2: leads done (hold-only; tying to fence posts not done). Slimes and more animals not started (need `src/data/mobs.js` entries from LEAD).

### Blockers

None for this lane's code. Full in-world verification waits for CORE-C/D/E (and FX/AUDIO/MENUS for the effects and saving).
