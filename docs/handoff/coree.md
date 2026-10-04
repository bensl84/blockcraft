# Handoff - coree

Branch `lane/coree` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-coree`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-04 · Judge round 1 fixes (KID-1, KID-2, KID-4, KID-5, KID-11, FID-4, ROB-9)

All in CORE-E files (`src/player/interaction.js`, `player.js`, `input.js`, `test/coree.test.mjs`, `tools/scenarios/coree.mjs`). No other lane's file was edited.

- **KID-1 (taps behind grass/flowers built 1-3 cells nearer):** kid scheme with a placeable item in hand: a non-solid cross plant (tuft, fern, flower, sapling, dead bush) no longer catches the ray when a solid face lies within `PLACE_THROUGH_PLANT` = 4 blocks behind it along the ray (4, not the 1.5 suggested: a tap 6 blocks out at the usual -20..-30 deg view meets a tuft ~3 blocks before the ground). A non-replaceable plant (flower) in the placement cell is broken first with the same action id (one undo), then the block goes in. Empty hand / tools / classic: Java targeting unchanged. Judge p3b-build in a poppy meadow: walls 23 taps, 23 placed, 0 wrong (was 7 of 11 wrong). p15-plants: plant share of cursor positions 0.00 over 3 worlds (was 0.17-0.50 on this build).
- **KID-2 (tap on an animal with a block built behind it) and FID-4 (taps on a zombie did nothing):** `doUse` with an entity target: `entityInteract` hook -> kid scheme tap attack (`tapAttacks`: any `monster`; an animal only with an empty hand or a sword/tool; never boats/minecarts) -> held item's `itemUse` -> otherwise nothing. It never falls through to blockUse/placement behind the entity, and a held-use repeat never places through an entity. Classic right click on an entity never places either (Java). Real-mouse check (`animals-tap`): base build cow+grass placed 1, zombie+grass placed 1 and 0 damage; fixed: 0 placed, zombie 20 -> 19.08, wheat still feeds (love 1), saddle still saddles, empty hand on a sheep = 1 hurt. Judge 10-kidfight: 20 taps in 4 s took the zombie 20 -> 1.6 (was 20 -> 20 while the child went 20 -> 14).
- **KID-4 (2-deep water by a 1-block bank, ArrowUp never got out):** kid scheme (auto-jump setting on): in water and pushing toward a wall ahead = swim up automatically; with the feet still in water and pressed against a bank whose top is at most `KID_BANK_HOP` = 1.6 above the feet (one block over the water) and room to stand on it, a hop with exactly the speed that clears it. Judge p9-water: ArrowUp only -> out in 1.1 s (was not out after 10.3 s; Space did not help either on this world). Classic keeps Java (needs Space; unit-tested). The kid.js "stuck in water" picture was NOT added (KID lane file); with the auto climb it is not needed for this case.
- **KID-5 (trackpad two-finger swipe did nothing):** kid scheme, non-notched pixel wheel events over the canvas look around: `dyaw = -deltaX k`, `dpitch = -deltaY k` (scroll down = look down, scroll right = turn right), `k = DRAG_K x SWIPE_SCALE 0.6 x (0.5 + lookSensitivity)` = ~0.12 deg/px, invertY honoured, 120 px clamp per event. Notched wheels still step the hotbar only; ctrl+wheel (pinch) does nothing; classic ignores swipes. The 'turn' hint completes from the yaw change (kid.js already measures it). Base build: 0 deg; fixed: 150 px up -> pitch +18 deg, 200 px right -> yaw -24 deg. `coree-wheel` asserts it. Direction and rate still need the real laptop (natural vs traditional scrolling).
- **KID-11 (small OS arrow):** kid scheme sets a 48 px white arrow with a thick dark outline (SVG data URL, hotspot at the tip) as the canvas cursor; classic clears it (pointer lock hides it anyway). Re-applied on `controls` change. `coree-wheel` asserts the computed style.
- **ROB-9 (NaN save position):** `player.deserialize` refuses non-finite or out-of-world x/y/z (and non-finite yaw/pitch, bad `view`, bad `spawnPoint`): it falls back to `meta.spawn`, else worldgen `findSpawn`, else (0.5, 64, 0.5), and snaps to the surface on `world:ready`. Judge corrupt.mjs `nan-player`: PASS, 1260 colours on screen, the child stands on the shore (was a 1-colour stone overlay).

Commands (RTX 3080 Ti, file://):
- `node build.mjs --dev --out .tmp/build-coree` -> builds.
- `npm run test:unit` -> `tests 235 pass 235 fail 0` (4 new CORE-E tests: KID-1 plant pass-through + flower replace + classic unchanged; KID-2/FID-4 entity taps per scheme and item; KID-4 bank climb kid vs classic; ROB-9 damaged save).
- `node tools/smoke.mjs --tag coree` -> `[smoke] {"PASS":160,"SKIP":5}` (all 13 coree-* PASS; `coree-wheel {"swipeLook":{"yaw":-14.4,"pitch":-19.9}}`). `coree-place-rules` now aims the tuft test at the ground under the tuft (the kid ray passes the tuft by design).
- `node tools/smoke.mjs --tag coree-touch --touch --scenario coree-touch,touch-controls,menus-touch` -> `{"PASS":4}`.

Spec notes for LEAD: SPEC §7.1 says "Trackpad swipes are ignored" - kid scheme now looks with them (KID-5). §7.4 targeting: add the kid "block in hand passes through cross plants (4 blocks)" rule and "a use on an entity never reaches the block behind it; kid taps attack monsters / bare-handed animals".

## 2026-10-03 · CORE-E real modules (input, physics, raycast, player, interaction)

**Stubs deleted:** `input`, `physics`, `raycast`, `player`, `interaction` (all five `registerStub` lines removed; `stub: true` flags removed).

**Files (all CORE-E owned):** `src/player/input.js`, `physics.js`, `raycast.js`, `player.js`, `interaction.js`, `test/coree.test.mjs`, `tools/scenarios/coree.mjs`, this note. No LEAD file was edited.

### What works

- **Movement (SPEC §2.1, Java `LivingEntity.travel`, 20 TPS)** - measured, not estimated:
  walk 4.317 m/s · sprint 5.61 · sneak 1.30 · creative fly 10.9 · sprint-fly 21.8 · fly up/down 7.5 · ladder up 2.352 · jump apex **1.2522** · flat jump **12 ticks** · sprint-jump +0.2 boost · 10-tick re-jump delay · terminal 3.92 · 0.003 velocity cut-off.
  Step-up 0.6 (Java 1.12+ two-variant step), sneak-edge protection (0.05 trims, classic only), auto-jump (1-block steps; never fences/1.5 gates; starts early enough that the player never bumps the block), swimming (+0.04 per held tick, 0.8 drag, 0.005 sink, Java "climb out of water" 0.3 boost), lava, ladders (clamp + climb on horizontal collision *or* jump held), fall distance + `player:land` (Java: the landing tick's partial motion is not counted), footsteps every 1.7 blocks (`player:step` with block sound), `player:water`, `player:jump`, `player:sprint`, `player:fly`, `player:view`.
  Flight: classic double-tap jump (7 ticks), F / `toggleFly` in both schemes, landing ends flight, kid take-off hop (0.25) so flying is visible at once, descend on C/Z (kid) or Shift (classic). Kid streaming guard 11a (caps horizontal flight at 0.35 b/t while `world.unmeshedWithin(R-1) > 2`). Classic sprint: double-tap W, Ctrl/R held; stops on release / collision / sneak / food <= 6 with hunger on. Sneak pose 1.5 high, stays crouched under a 1.5 ceiling.
  The player waits in place while its own column is not loaded (Home / teleport far away), and unloaded columns are solid per cell for every body (`moveAndCollide`).
- **Camera:** interpolated eye (eased sneak eye), `rotation.set(pitch, yaw, roll, 'YXZ')`, pitch clamp 89.9, FOV ease `settings.fov x 1.15 sprint x 1.1 fly` with `1 - 0.5^(dt*20)`, optional view bobbing (Java walkDist bob), 2 deg hurt tilt over 10 ticks from `player:hurt`, third person behind/front 4 blocks clipped 0.2 before solid blocks. Kid auto-pitch (-12 deg after 1.5 s of walking without manual look).
- **Input (SPEC §7.1):** keyboard per scheme with per-key-code counting (W + ArrowUp never stick), kid modifiers ignored (Ctrl/Alt/Meta+key never act), kid gestures for mouse + touch + pen on the canvas (tap < 350 ms & < 12 px = `use`, hold 350 ms = `attack` with the aim following, drag > 12 px = look with `k = 0.0035 (0.5 + lookSensitivity)`, invertY, every button the same, first pointer only, palms > 40 px ignored, contextmenu suppressed, pointer capture), hover aims the free cursor, `pointerleave` clears `aimActive` (never a timer). Keyboard turning: 12 deg tap nudge, continuous turn ramps over 200 ms to `60 + 80 turnSpeed` deg/s; PageUp/PageDown 60 deg/s. Classic: pointer lock with `{unadjustedMovement: true}` and a plain fallback, all promise rejections caught, `pointerlockerror` silent, 150 ms motion drop after lock changes, > 400 px spike filter, left/right/middle = attack/use/pick, one quiet retry after the ~1 s relock cooldown. `releaseAll` on blur, hidden, pointer-lock change, fullscreen change, `setCaptured(true)`, controls change, world exit. Wheel: always `preventDefault` while playing (and ctrl+wheel always: no pinch zoom); screens that capture input keep their own list scrolling; only notched wheels step the hotbar, at most once per 150 ms.
- **Raycast (SPEC §7.3):** Amanatides & Woo DDA, per-cell selection boxes (slabs, torches, plants, carpets, doors, fences, ladders...), fluids only with `opts.fluids` (surface height box), `opts.filter`, origin inside a *solid* block returns it with face UP and dist 0, outward normal of the entered face, `opts.out` for allocation-free per-frame targeting.
- **Interaction (SPEC §7.4):** per-frame targeting through the free cursor (kid: unprojected with the live camera FOV/aspect, identical maths to `__game.worldToNdc`) or the crosshair (classic / locked); entities via `entities.raycast` (items / projectiles / `noTarget` skipped), nearer wins; `renderer.setHighlight({x, y, z, id, state, boxes})` only when the target changes, `null` to clear; no target while the kid cursor is outside the canvas.
  Attack: entity hits every 10 ticks while held (held-item damage, x1.5 crit when falling, `hooks.entityAttack`, survival exhaustion 0.1 and tool wear 1 sword / 2 other); creative instant break with a 5-tick repeat (one hold = one action id); survival mining with `registry.breakTicks` re-evaluated per tick (head in water, airborne), `block:mining` on every stage change 0..9, `block:miningStop`, 6-tick delay, tool wear 1 per block with hardness > 0; bedrock never in survival, never at y 0.
  Use: `preUse` -> `entityInteract` -> `blockUse` (skipped when sneaking with an item; emits `block:use`) -> `itemUse` -> `placers` / default placement (repeats every 4 ticks while held, same action id) -> kid creative "empty hand or a tool breaks". Every press allocates one `newAction()` passed to all hooks (`ctx.action`), breaks and places.
  Default placement: replaceable hit cell is filled in place (short grass, snow layer, water), otherwise hit + normal; refuses out-of-range y, unloaded columns, non-replaceable cells, overlap with the player or a living entity (category `creature`/`monster` or `e.living === true`), `placeOn` lists, `support: 'floor'` without a solid top, wall torches/ladders without a wall. States: torch floor/wall (down face refused), ladder facing away from the wall, `facing` blocks toward the player, `axis` blocks from the face, slabs top/bottom by face and hit height, **slab merging into double slabs (P1)**, stairs facing + upside-down, gates facing + closed, fence/pane `connectionState`, player-placed leaves persistent, item `placeState` bits (bed colour) kept. Survival consumes one item; creative never. Pick block (classic middle click, creative): selects the hotbar slot if present, otherwise replaces the selected slot.
  `breakBlock` / `placeBlock` keep the LEAD contract (block entity read first, `rollDrops` with `game.rand`, drops via `dropItem` with a small pop or into `opts.dropInto`, survival break exhaustion 0.005); `placeBlock` now also refuses overlap with the player / living entities unless `force`.

### Commands run (this worktree) and results

`npm run test:unit`
```
ℹ tests 31
ℹ pass 31
ℹ fail 0
```
(13 foundation + 18 CORE-E: physics landing/walls/seams/step-up/fence/sneak-edge/unloaded/fluids/findFreeY, raycast faces/normals/shapes/fluids/filter/origin-inside, player walk/jump/sprint/sneak/fly/ladder/swim/fall/auto-jump/slab step, placement states, wheel heuristic, interaction hook order / kid break rules / one action per press / survival mining ticks + stages / creative hold repeat / sneak bypass.)

`node build.mjs --dev --out .tmp/build-coree` -> builds (1153 KB dev).

`node tools/smoke.mjs --tag coree` (RTX 3080 Ti, file://)
```
PASS     boot / world / hotbar / inventory-ui / time / kid-home / perf
PENDING  terrain-render   - stub lanes: textures, worldgen, world, lighting, mesher, renderer
PENDING  move-jump        - stub lanes: world, worldgen
PENDING  break-place      - stub lanes: world
PENDING  mobs / survival-fall / save-load / context-loss   (other lanes)
SKIP     touch-controls / coree-touch   - needs --touch
PASS     coree-move-jump    {"walkMps":4.3172,"apex":1.2522,"jumpTicks":12,"move1s":4.18}
PASS     coree-break-place
PASS     coree-kid-gestures {"dragYawDeg":24.1}
PASS     coree-keys-blur    {"tapTurnDeg":12,"holdTurnDeg":87.4}
PASS     coree-wheel
PASS     coree-classic-lock {"lock":{"ok":true,"locked":true},"mouseLookDeg":10.1,"relock":true}
PASS     coree-ladder-swim-step {"ladderMps":2.352}
PASS     coree-fly-camera   {"flyMps":10.64,"backlog":0}
PASS     coree-survival-mining {"ticks":{"dirt":15,"stoneWood":23,"logHand":60,"logAxe":30}}
PASS     coree-place-rules
PASS     coree-auto-pitch   {"pitch":{"early":30,"late":-4.1}}
PASS     coree-entities     {"attack":{"targeted":true,"health":9}}
PASS     lead-events-roundtrip / lead-unload-persist / lead-break-contract / lead-batch / lead-entity-streaming / lead-testapi
PASS     page-errors
[smoke] {"PASS":26,"PENDING":7,"SKIP":2}
```
`node tools/smoke.mjs --tag coree-touch --touch --no-build --file .tmp/smoke-build-coree/index.html --scenario coree-touch,touch-controls`
```
PENDING  touch-controls   - stub lanes: touch
PASS     coree-touch
PASS     page-errors
```
`node tools/smoke.mjs --tag coree-ss --swiftshader` -> `[smoke] {"PASS":26,"PENDING":7,"SKIP":2}` (same set as above; the survival-mining and jump measurements run atomically in one page task after an earlier 1-tick race on SwiftShader).

The built-in `move-jump` and `break-place` stay PENDING only because `world`/`worldgen` are still stubs. I ran verbatim copies of both against this build with the stub world (temporary scenario file, deleted afterwards): **both PASS** (`walk1s 4.18`, `jumpHeight 1.2522`; break grass -> air, place planks).

Screenshots: the stub renderer draws only the sky colour, so `.tmp/smoke-coree-*.png` show no terrain; visual review of the outline, cursor targeting and third-person camera has to happen at integration with CORE-C/D.

### Remaining (by priority)

- **P0:** none known in this lane. Needs integration re-run of `move-jump`, `break-place`, `terrain-render` screenshots once CORE-B/C/D land.
- **P1:** riding is implemented against the documented contract only (`player.riding = id`, `mount.getSeat()`, dismount on `descend`/Shift press) - untested until MOBS ships mounts. View bobbing is implemented (off by default) but only reviewed numerically.
- **P2:** swim-sprint and crawling not done. Kid hint/ghost visuals belong to FX.

### Interface assumptions other lanes must honour

- **World (CORE-C):** `isColumnLoaded(cx, cz)` (false = solid for physics, player waits, no placement), `unmeshedWithin(r)` (kid flight cap), `isOpen`, `getRaw`, `getBlock`, `setBlock(..., {cause, action})` returning false when nothing changed.
- **Renderer (CORE-D):** `renderer.camera` with live `fov` and `aspect` (cursor ray); `setHighlight({x, y, z, id, state, boxes} | null)` is called only on change - keep the last value. The player writes `camera.position`, `camera.rotation` (with roll) and `camera.fov` every frame (calls `updateProjectionMatrix` only when the FOV changed).
- **FX:** `input:gesture {phase: 'down'|'hold'|'tap'|'drag'|'up'|'cancel', x, y (NDC), pointerType}` fires on pointerdown for the immediate ring / crack start; `interaction.mining` + `block:mining` for cracks; `player.swingTicks` (6 -> 0); `player.fov` is the eased FOV. Hurt flash only - the tilt is here.
- **MOBS:** `entity.hurt(damage, {type: 'player', player: true, crit, entity: null, x, y, z, knockback: 0.4, yaw})` - **MOBS applies the 0.4 + 0.4 knockback** (this lane does not touch entity velocity). Living entities for placement blocking: `category` `creature`/`monster` or `e.living === true`. Untargetable: `category` `item`/`projectile` or `e.noTarget`. Survival owns sprint/swim distance exhaustion and jump exhaustion (from `player:jump {sprint}`); this lane adds only break 0.005 (in `breakBlock`) and attack 0.1. Fall damage from `player:land.fallDistance` (Java value: a 10-block drop reports ~9.67, `ceil(fd - 3) = 7`).
- **Riding (MOBS):** set `game.player.riding = entity.id`; provide `entity.getSeat() -> {x, y, z}`; the player clears `riding` itself on a `descend` (kid) or Shift (classic) press or when the mount is gone, and stands on top of the mount if there is room.
- **INV / HUD:** hotbar steps arrive as `input:action` `hotbarNext` / `hotbarPrev` / `hotbar1..9` (down + up). Pick block uses `inventory.selectSlot` / `inventory.set`.
- **MENUS:** show the classic pause / click-to-play overlay from `input:pointerLock {locked: false}`; call `game.input.requestPointerLock()` from the overlay click (it resolves `true`/`false`, never throws, retries once after the relock cooldown).
- **KID / TOUCH:** world-area gestures are CORE-E's; touch buttons drive `setVirtual` / `setMoveVector` (D-pad turn via `turnLeft`/`turnRight` gets the same nudge + ramp). `physics.findFreeY` for stuck rescue (stands on slab tops too). `player.teleport(x, y, z, reason)` resets velocity and fall distance and snaps the render position (no interpolation streak).
- **MECH placers:** `PlaceCtx.x/y/z` is the target cell after the replaceable-cell rule; `state` already contains the computed bits; support/`placeOn` were checked before the placer runs, the body-overlap check is not (call `interaction.placeBlock`, which does it).
- `toggleFly` and `toggleView` are handled from `input:action` immediately (two presses in one tick both count), only while playing and not captured.

### New API members / exports (additive)

- `input`: exports `INPUT_TUNING`, `isNotchedWheel(e)`; event `input:gesture` (above).
- `physics`: exports `COLLISION_EPS`, `fluidHeight(world, x, y, z, raw)`, `onClimbable(world, body)`; `fluidState` also returns `inWater` (Java swim rule, water above feet + 0.4) and `waterTop`.
- `raycast`: `opts.out` (reuse the result object).
- `player`: field `fov` (eased camera FOV, degrees).
- `interaction`: `entityReach()`, `getAimRay(out, render = true)`, `use(action?, placeOnly?)`, `attack(action?)`; exports `placementState(id, baseState, hit, yaw, getRaw?, cell?)` and `facingOfNormal(nx, ny, nz)` (pure, unit-tested). `ix.target` is one stable object updated in place.

### Spec conflicts / notes for the integrator

1. **Wheel rule (§7.1):** "only |deltaY| multiples of 120 or deltaMode 1" misses Chrome on Windows, which reports **100 px per notch** (and `wheelDeltaY` +-120). Implemented: deltaMode 1/2, or `wheelDeltaY` a non-zero multiple of 120, or |deltaY| a multiple of 120, or a multiple of 100 that is >= 100; ctrl+wheel (pinch) never steps. Trackpad pixel streams stay ignored. Please confirm on the real laptop (manual check list §13.3).
2. **Fall distance (§2.1 step 10):** Java-accurate - the landing tick's own motion is not added, so `player:land.fallDistance` for a 10-block drop is ~9.67, not 10. Damage is unchanged (7 HP, `survival-fall` expects 12-13 health).
3. **Ladder (§2.1 step 7):** climbs on horizontal collision *or* while jump is held (Java 1.14+), so a kid holding Space on a ladder goes up.
4. **Kid take-off hop:** switching flight on while standing gives vy 0.25 (kid scheme only) so the child sees "flying" at once; Java gives none. Easy to remove (`KID_FLY_LIFT`).
5. **Tool wear when hitting entities:** spec "2 per hit when used as a weapon (swords lose 1)" implemented literally; mining wears 1 per block with hardness > 0 for every tool (Java swords lose 2 per block mined - spec says 1).

### LEAD requests

- None blocking. Optional: add `input:gesture` and the new exports above to SPEC §6 / §7, and the wheel rule wording from conflict 1.
