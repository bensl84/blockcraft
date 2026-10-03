# Handoff - mech

Branch `lane/mech` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-mech`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · MECH lane: stub replaced, P0 + P1 done, P2 partly

### What changed

`registerStub('mechanics')` is deleted; `src/mechanics/*` is real. Files (all lane-owned):

| File | What it does |
|---|---|
| `src/mechanics/mechanics.js` | The `mechanics` system: scheduled ticks, random ticks, neighbour reactions, falling blocks, fire, crops/farmland/saplings/cane/cactus/grass/leaves, bone meal, TNT priming, explosions (queue, 2 per tick, one action, one batch, merged drops, damage + knockback), beds and sleep, water current, serialize/deserialize |
| `src/mechanics/scheduler.js` | Min-heap of block ticks, deduplicated per (cell, kind), carries the causing `action`, <= 1024 runs per tick, JSON round trip |
| `src/mechanics/rules.js` | Pure predicates: support status (torch floor/wall, ladder, plants `placeOn`, crops, carpets, snow, fire, sugar cane needs water, doors and beds as two-part blocks), wash-away, solid top/side, blast table |
| `src/mechanics/fluids.js` | Pure water/lava flow: levels 0-7 + falling bit, water every 5 ticks / step 1 / looks 4 ahead for a drop, lava every 30 ticks / step 2 / looks 2 ahead, infinite water source, decay when cut off, lava+water -> obsidian / cobblestone / stone, washing, flow vector |
| `src/mechanics/explosion.js` | Pure explosion maths: 1352 rays, intensity `P x (0.7..1.3)`, 0.3 steps, `0.225 + (blast + 0.3) x 0.3` loss, nearest-first cap of 600, exposure sampling, `impact` and `floor(7P(i^2+i)+1)` damage |
| `src/mechanics/body.js` | Tiny per-axis AABB mover for MECH's own non-living entities (works whether CORE-E physics is a stub or real) |
| `src/mechanics/entities.js` | Entity types `falling_block` and `tnt` (block model via `renderer.createBlockModel`, recentred; TNT hop, 80 fuse, white `uTint` flash every 5 ticks, 1.3x swell over the last 10) |
| `src/mechanics/uses.js` | Hooks: blockUse `oak_door`, `oak_fence_gate`, `bed`, `cake`, `tnt`; itemUse `flint_and_steel`, `bucket`, `water_bucket`, `lava_bucket`, every hoe, `bone_meal`; placers `oak_door`, `bed`, the 3 slabs (double slab), `snow` (stacking layers); test helper `mechanics.useAt` |
| `src/mechanics/painting.js` | P1 paintings: `painting` entity + item use, 8 original procedurally painted pictures (largest that fits), pops off when the wall goes |
| `src/mechanics/raycells.js` | Grid DDA for the bucket handlers (they need to see fluid sources) |
| `test/mech.test.mjs` | 30 unit tests (fake in-memory world + an interaction double that follows the §7.4 contract) |
| `tools/scenarios/mech.mjs` | 13 smoke scenarios (`mech-*`) |

Feature status:

- **P0 done:** falling sand/gravel (entity, lands or drops), TNT (flint, fire, explosion chain 10-30 fuse, hop, flash, swell, `tntExplodes=false` = harmless poof), explosions (rays, 600 cap, 2 per tick queue, water stops block damage, one `newAction()`, one batch, `breakBlock(... {by: 'explosion', action, drops, dropInto})`, drops merged into <= 32 item entities, entity/player damage + knockback, chained TNT primed not broken), support pops (torches, plants, crops, saplings, doors, ladders, carpets, snow layers, fire, sugar cane, cactus) carrying the causing action, doors (2 tall, hinge pairing, toggle both halves, `door:toggle`, cascade break without extra drop), beds (2 long, colour bits, spawn point + toast + `player:spawnSet`, survival sleep at night only / no monsters within 8x5, 100 ticks then `setTime(0)`, kid nap: `setTime(18000)` for `KID.NAP_TICKS` then 09:00), water flow + buckets, farming (hoe, hydration, dry farmland reverts, crops 1/3 wet 1/7 dry at light >= 9, bone meal 2-5 ages / saplings 45% / 7x7 grass patch, saplings -> CORE-B `placeTree` in a batch), trampling (survival, `player:land`).
- **P1 done:** lava + mixing, fire (flint on a top face, 30-90 ticks, never spreads unless `rules.fireSpread`; fire primes adjacent TNT), cake (7 bites, `survival.addFood(2, 0.4)`), sugar cane / cactus growth to 3, fence + pane connection refresh, fence gates, paintings, double slabs, stacking snow layers, leaf decay (persistent bit respected), grass spread / dies under opaque, snowy grass bit.
- **P2:** ice and snow layers melt next to block light > 11. Snow accumulation (needs weather) not done.
- No trapdoors exist in the block registry, so none were added.

### Commands and results (run in this worktree)

`node build.mjs --dev --out .tmp/build-mech`

```
[build] 0.1.0-ef016c75-dev -> ...\bc-mech\.tmp\build-mech\index.html (1172 KB, 159 ms, dev)
```

`npm run test:unit` (13 foundation + 30 mech)

```
ℹ tests 43
ℹ pass 43
ℹ fail 0
```

`node tools/smoke.mjs --tag mech`

```
PASS     boot / world / hotbar / inventory-ui / time / kid-home / perf
PASS     lead-events-roundtrip / lead-unload-persist / lead-break-contract / lead-batch / lead-entity-streaming / lead-testapi
PASS     mech-sand-falls     159 ms
PASS     mech-tnt-chain      249 ms {"worstTickMs":7.3}
PASS     mech-door            84 ms
PASS     mech-water-flow     186 ms
PASS     mech-farm            81 ms
PASS     mech-torch-support     74 ms
PASS     mech-tnt-batch       96 ms {"lastExplosion":{"count":24,"items":1,"ms":1.8,"harmless":false}}
PASS     mech-bed-nap        135 ms
PASS     mech-visuals        167 ms {"entities":["painting","tnt","falling_block"]}
PASS     mech-save-ticks      57 ms
PENDING  mech-input-door       0 ms  - stub lanes: input, interaction, raycast, player, physics
PENDING  mech-input-bucket      0 ms  - stub lanes: input, interaction, raycast, player, physics
PENDING  mech-fence-pen        0 ms  - stub lanes: mobs, physics, interaction, input, raycast, player
PENDING  terrain-render, move-jump, break-place, mobs, survival-fall, save-load, context-loss (other lanes' stubs)
SKIP     touch-controls (needs --touch)
PASS     page-errors           0 ms
[smoke] {"PASS":24,"PENDING":10,"SKIP":1} in 7.8 s
```

Screenshots reviewed: `.tmp/smoke-mech-mech-visuals.png` (original "rainbow hills" 4x2 painting on a wall, primed TNT and a falling block as stub-renderer boxes), `.tmp/smoke-mech-mech-sand-falling.png`, `.tmp/smoke-mech-mech-tnt-primed.png`. With the stub renderer only entities draw (no chunks, no textures on block models), so these prove placement/visibility only.

How the scenarios verify now: they drive MECH through the frozen contracts the CORE stubs already implement (`world.setBlock` + `block:changed`, `interaction.breakBlock/placeBlock/newAction`, entities, time) and through the additive helper `game.mechanics.useAt(x, y, z, {item, face})`, which replays CORE-E's `use()` steps 3-5 (blockUse -> itemUse -> placer). The three PENDING `mech-input-*`/`mech-fence-pen` scenarios go through the real input/raycast/physics/mobs path and must be run once those lanes are merged.

### Still needs in-world verification (after the CORE merge)

1. `mech-input-door`, `mech-input-bucket`, `mech-fence-pen` must PASS (real kid tap path, bucket raycast through `interaction.getAimRay`, pig kept in a fence pen, gate opens).
2. Falling block and TNT look: real `createBlockModel` geometry (recentred by bounding box), light uniforms, TNT white `uTint` flash and swell, no z-fighting where sand lands.
3. Paintings with the real entity material (`createEntityMaterial({map})` on a `PlaneGeometry`): texture shows, faces the right way on all 4 walls, lit from the cell in front, removed cleanly (no geometry leak).
4. Water/lava visuals from the real mesher: levels, falling bit, flow speed feel; lava light.
5. Water current pushes the player (MECH adds 0.014 b/t to `player.vx/vz`) and explosion knockback (adds to `player.vx/vy/vz`): CORE-E physics must keep velocity added from outside.
6. Explosion frame time with the real batched relight and remesh (target < 50 ms, 600-block cap) and the FX/AUDIO reaction to a large `explosion.blocks` payload; KID undo restores a crater in one step.
7. Bed nap: FX fade + starry sky on `sleep:start {nap: true}`; `player.sleeping` honoured by CORE-E (no movement while asleep).
8. Growth with real light (crops, saplings, grass spread at light >= 9), real `placeTree` from CORE-B, leaf decay never eating worldgen trees, random-tick cost at R 6-12 (3 per section, columns within R + 1).
9. Item drops from MOBS `dropItem`: explosion drops (<= 32 entities, merged), falling blocks that cannot land, washed-away plants in survival.
10. Trampling with the real `player:land` payload.

### Interface assumptions

- `world.setBlock` emits `block:changed` synchronously (also inside batches) with `action`; `world.isOpen`, `isColumnLoaded`, `getColumn`, `forEachColumn`, `Column.blocks/nonEmptyMask/state` per §5.3.
- `interaction.breakBlock(x, y, z, {by, drops, toolDef, action, dropInto})` honours `toolDef` (explosions pass a "right tool" so stone gives cobblestone) and `dropInto`; `placeBlock(..., {force})` skips the replaceable/overlap checks (used for double slabs, snow layers, buckets); `getAimRay()` and `reach()` exist.
- Hook contexts exactly as in `core/hooks.js` (`ctx.hit` is a RayHit with `face`, `nx/ny/nz`, `py`; `PlaceCtx.x/y/z` is the target cell).
- `player.spawnPoint` is what survival respawn uses; `player.sleeping` disables movement.
- `game.audio.playBlock` is called directly for the land/till sounds (guarded); other sounds go through the `sound` event (`bucket.fill`, `bucket.empty`, `fire.ignite`, `player.eat`).

### New events and API members (for the SPEC)

- `explosion` payload adds `harmless: boolean` (true for the `tntExplodes = false` poof; `blocks` is still an array).
- New events: `mech:landed {x, y, z, id, action}`, `mech:tree {x, y, z, kind}`, `mech:till {x, y, z}`, `mech:cake {x, y, z, bites}`, `mech:painting {id, x, y, z, picture?|removed?}`.
- Additive `game.mechanics` members: `primeTnt(x, y, z, fuse, {action, by})`, `explode(..., {now})`, `queueExplosion`, `scheduleTick(x, y, z, delay, kind?, action?)`, `trySleep` reasons `'no_bed'` and `'sleeping'`, `sleeping()`, `useAt(x, y, z, {item, face, sneaking, action})`, `hangPainting(hit, action)`, `advanceSapling`, `landFallingBlock`, `getRaw`, `scheduler`, `stats` (`lastExplosion {count, items, ms, harmless}`).
- `serialize()` = `{v: 1, ticks, parked, explosions}` (pending block ticks survive save/load; ticks of unloaded columns are parked and resume on `world:columnLoaded`).

### Spec conflicts / decisions to confirm

1. **§0.3/§8.6 "every block removal goes through breakBlock".** MECH uses `world.setBlock` directly where a break event would be wrong: fluid flow and decay, bucket pickup, a falling block lifting off its cell, fire burning out, growth/melting and state flips (doors, gates, cake bites, fence connections, snowy grass). Real removals with drops or particles (support pops, cascades, explosions, decay, washing away, cake finished, TNT priming) do use `breakBlock`. Please confirm or tighten the rule.
2. **`applyBoneMeal` return value.** Returns true when bone meal *applies* (it is used up), including a sapling whose 45% roll failed. The stub comment said "true if anything grew".
3. **Creative buckets swap in hand** (empty <-> filled) instead of Java's "keep the empty bucket and add a filled one": the kid hotbar is full, so Java's way would hide the water bucket in the main inventory.
4. **TNT priming cause.** Flint/fire priming removes the TNT block with `by: 'tnt'` (not recorded by KID undo); TNT chained by an explosion uses `by: 'explosion'`, so undoing that explosion restores the chained TNT block.
5. **Door facing.** With `facing` = the player's look facing and the registry's closed panel on edge `F`, the closed panel sits on the far side of the cell (Java puts it on the near side). Harmless; noting it.
6. **Survival sleep** uses `time.setTime(0)` as specified; that does not advance `time.day` (moon phase). `time.advance(24000 - dayTime)` would; LEAD's call.
7. **MECH entities move with `body.js`**, not `physics.moveAndCollide`, so sand/TNT work regardless of CORE-E. Living entities are unaffected.

### LEAD requests

- None blocking. Optional: document the new `mech:*` events, the `harmless` field and the `useAt` helper in SPEC §6/§8.6; decide items 1, 2 and 6 above.
