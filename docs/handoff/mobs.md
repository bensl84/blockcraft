# Handoff - mobs

Branch `lane/mobs` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-mobs`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

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
