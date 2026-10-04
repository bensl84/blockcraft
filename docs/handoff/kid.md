# Handoff - kid

Branch `lane/kid` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-kid`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-04 · Fixer round 1: KID-8, POL-11, POL-12

Merged `main` (fast-forward to `7f105b0`) first.

### What changed

- **KID-8 (Undo had no Redo):**
  - `undo.js`: `UndoLog` keeps a redo stack. A successful undo pushes its entry there. `redo(world)` puts each cell's `after` back (oldest cell first, one batch, cause `'undo'`, so it is not recorded twice), and only where the cell still holds `before`. The entry then returns to the undo list. Any new qualifying action clears the stack, and so does `clear()`. `applyEntry(world, entry, forward)` serves both directions.
  - `kid.js` / `kid.css` / `pixelicons.js`: a 56 px Redo plate (a mirrored undo arrow) at left 200, top 36, beside Undo. It shows for `REDO_SHOW_MS` (10 s) after the last undo or redo, while something can still be redone.
  - Additive API: `kid.redo() → bool`, `kid.redoVisible`. Additive event: `kid:redo {count}`. Redo plays a lower-pitched whoosh. An empty redo plays `ui.error` and shakes the button.
- **POL-11 (Home / Undo peeked out from under the picker):** `kid.frame()` sets `.kid-under-screen` on the kid layer while `game.ui.current` is set. Home, Undo, Redo, the home arrow and the hint plate then get `visibility: hidden; pointer-events: none`. This covers every container and menu screen, pause included, because the pause screen has its own Home and the kid buttons do nothing while paused.
- **POL-12 (hearts under the D-pad ▶ at 1024 x 600):** `touch_logic.touchLayout` now lifts the D-pad when any of its buttons overlaps the HUD block horizontally. The button's bottom ends up `GAP` above the HUD top, and the D-pad never rises above the top row (pause / Home bottom + `GAP`). The joystick rises the same way. Unchanged at 1280 x 720 and 1366 x 768 (no overlap there).

### Verification

- `npm run test:unit`: fail 0. Added two tests:
  - `redo (KID-8)…`: door halves, round-trips, dead cells skipped, and a new action clears the stack.
  - D-pad and joystick clear of the HUD at 1024x600, 1024x640 and 1280x720, both hands.
- New smoke checks:
  - `kid-undo-real`: the Redo button shows beside Undo, two real clicks put the two undone blocks back (newest undo first), it hides when nothing is left, and the redone blocks undo again.
  - `kid-buttons`: Home and Undo are hidden under `creative` and `pause` and come back after closing.
  - New `kid-touch-hud` (touch only, 1024 x 600 survival): every D-pad button and the joystick stay clear of the hearts row and hotbar, and below the Home row.
- Real-browser repro and after (`.tmp/kidfix/repro.mjs`; screenshots in `.tmp/kidfix/before|after/`):
  - **Undo:** 5 taps then 5 Undo taps left everything as air, with no redo control. After the fix, 3 Redo taps restore 3 blocks, a new placement hides Redo, and Redo hides by itself after 10.6 s.
  - **Picker at 1366x768 and 1024x640:** Home and Undo were visible under the picker. After the fix they are hidden under the picker and under pause, and visible again after closing.
  - **Touch at 1024x600, survival:**
    - Before: turnRight `[216,392,88,88]` overlapped the hearts at `[223,462]`, and the joystick overlapped too.
    - After: turnRight is at `[216,346,88,88]` and the joystick at `[84,274,160,160]`, with no overlaps. 1024x640 is also clear now. 1280x720 and 1366x768 are unchanged.

### Remaining

- 800 x 480 (phone landscape, not a target) is still crowded. Even lifted as far as the top row allows, the D-pad's ▼ button reaches the hearts row because the centred hotbar starts at x 111. A smaller button size or a phone layout would be needed there.
- Redo has no key. Input bindings belong to CORE-E; Redo is button-only for now.

## 2026-10-03 · Phase 2: merged main (real core) and verified in-world

### What changed

- Merged `main` into `lane/kid` (no conflicts; merge commit `725a9d7`).
- Removed the phase-1 stub fallbacks:
  - `kid.js`: deleted `ownBoxCollides` and every `isStub('physics')` branch. Collision, `findFreeY` and the border push now always use `player/physics.js`.
  - `touch.js`: deleted its own window `pointerdown` listener. The overlay now reads `input.lastPointerType` (CORE-E keeps it).
- **Fix (stuck rescue, real physics):** jumping inside a 2-deep pit lifted the head above the rim for a few ticks. The detector read that as "free" and reset, so holding Jump never popped the child out. Enclosure is now judged from the floor last stood on (`groundY`, updated on ground / flying / water / ladder / teleport). The rim pick uses it too.
- **Fix (far Home):** Home into a column that is not loaded yet left the player inside a hill (the y was checked before the column existed). The kid system now watches that spot. When the column streams in and the player is buried, it lifts them to the surface. Before, the suffocation auto-pop took about 2 s and could land them in a cave pocket.
- **Kid-friendliness after looking at the screenshots:**
  - The home arrow's yellow tip is bigger (48x32, was 30x20); it was hard to read at a glance.
  - The hint plate is darker (0.72 alpha, was 0.55). Busy terrain showed through and muddied the pictogram.
  - The home arrow also shows deep in the border fog (`fogT > 0.3`). At the border everything is white, and a radius of 48 or less meant the arrow never appeared there.
  - When the arrow and a hint plate show together, the plate moves down below the arrow (`.kid-arrow-on`).
- Scenarios:
  - `kid-undo-real` is rewritten as real gameplay: mouse taps build a 3-block wall, the Undo button and the U key remove the newest blocks one at a time, a hold breaks a block and Undo puts it back, and an empty undo plays `ui.error`.
  - The MECH half (door placer + `mechanics.explode`) moved to the new `kid-undo-mech` (requires `mechanics`).
  - `kid-touch-world` now also covers D-pad ▲ walking, ◀/▶ turning, sliding from ▲ to ◀, the Jump button, Fly → Up → Down → Fly off → lands, and a world tap through the overlay.
- New `tools/kid-play.mjs` drives the real game like a child (real keyboard / mouse / touch) and saves `.tmp/kidplay-*.png`. Run it with `node tools/kid-play.mjs [--only walk,build,border,void,stuck,farhome,touch,perf]`.

### In-world verification (real core, headless Chrome 1280x720, `node tools/kid-play.mjs`)

```
PASS  hint-walk-appears      idle 7 s shows the walk pictogram
PASS  keyboard-walk          holding W walks (6.2 blocks)
PASS  hint-walk-done         walking clears the walk hint
PASS  hint-turn-appears      next hint is turn
PASS  keyboard-turn          holding A turns left (77.0 deg)
PASS  hint-turn-done         turning clears the turn hint
PASS  hint-turn-drag         a drag-look counts as the turn step
PASS  hint-place-appears     next hint is place
PASS  tap-build              tapping built 3/3 blocks
PASS  undo-button            Undo button removed the newest block
PASS  home-arrow             home arrow visible 72 blocks away
PASS  home-arrow-ahead       facing home the arrow points up (0.0 deg)
PASS  home-key               H took the player home
PASS  home-faces-build       after Home the player faces the build (off by 0.0 deg)
PASS  border-walk            walking 4 s outward (jumping) stops at the border (max 48.04 of 48)
PASS  border-fog             fog override is on at the border {"near":1.8,"far":18}
PASS  border-arrow           the home arrow shows the way back inside the border fog
PASS  arrow-hint-stack       hint plate below the arrow
PASS  border-fly             flying outward stops at the border (max 48.00)
PASS  border-fog-clear       fog override cleared back inside
PASS  void-rescue            falling through a hole dug to y 0 is rescued (lowest y 1.9, back to y 66)
PASS  void-no-fall           no hard landing after the rescue (player:land fallDistance 0)
PASS  void-health            health untouched (20)
PASS  stuck-pit              pushing in a 2-deep pit for 3 s shows the "hold jump" help
PASS  stuck-pop              holding Space 1 s pops onto the rim
PASS  stuck-sand             head-in-sand pops out on its own within 2.5 s
PASS  home-far               far Home (700 blocks, unloaded, y 40 inside a hill) lands standing on the surface
PASS  touch-auto-1280 / -1024       a finger tap shows the touch controls
PASS  touch-no-overlap-1280 / -1024 Home / Undo / Pause / D-pad / Jump / Fly do not overlap
PASS  perf-kid               kid tick 0.032 ms, kid+touch frame 0.037 ms (fps 144, 178 draw calls)
PASS  perf-stats             overlay on/off: 178 / 177 draw calls (DOM only, no GPU cost)
PASS  *-page-errors          none
```

Screenshots reviewed (`.tmp/`):
- `kidplay-spawn`, `kidplay-hint-walk` / `-turn` / `-place`
- `kidplay-built`, `kidplay-after-undo`
- `kidplay-home-arrow`, `kidplay-home-fade`, `kidplay-home-arrived` (faces the wall, sparkles), `kidplay-home-far`
- `kidplay-border-ground`, `kidplay-border-flight` (white-out wall), `kidplay-border-arrow-hint`
- `kidplay-void-falling`, `kidplay-void-rescued`
- `kidplay-stuck-pit`, `kidplay-stuck-popped`, `kidplay-stuck-sand`, `kidplay-stuck-sand-popped`
- `kidplay-touch-1280x720[-flying]`, `kidplay-touch-1024x600[-flying]`
- smoke: `smoke-kid-kid-undo-real-tower`, `smoke-kid-kid-undo-real-empty`, `smoke-kidtouch-kid-touch-world[-flying]`

Phase-1 "needs in-world verification" list:

| # | Item | Result |
|---|---|---|
| 1 | Real input sets `lastPointerType`; canvas tap/drag works around the overlay | PASS (`kid-touch-world`: drag looks, a world tap places through the overlay layer) |
| 2 | D-pad turning turns | PASS (◀ +38° in 0.5 s, ▶ back; slide ▲→◀ swaps walk for turn) |
| 3 | Fly → `toggleFly`; Down → `descend` | PASS (Up +2 blocks in 0.7 s, Down −1, Fly off lands) |
| 4 | `kid-undo-real` | PASS for tap / hold / button / U. Door + explosion: PENDING (`kid-undo-mech`, MECH still a stub) |
| 5 | Border push with real physics, ground + flight, fog | PASS (max 48.04 / 48.00; fog wall seen) |
| 6 | Stuck: dug pit / sand on head / survival damage | pit + head-in-block PASS (after the fix). Falling sand and suffocation damage not verifiable: MECH and SURVIVAL are stubs |
| 7 | Void rescue with real gravity, no fall damage | PASS (fallDistance 0 on landing; damage itself needs SURVIVAL) |
| 8 | Home into an unloaded column | was FAIL (buried at y 40 under a 55 surface); PASS after the fix |
| 9 | Hint walk/turn detection with real input | PASS (W, A, and drag-look) |
| 10 | Hotbar overlap with the D-pad at 1024 wide | NOT VERIFIABLE: HUD/INV are still stubs. LEAD request 2 still stands: at 1024x600 only x 304..760 (456 px) is free between the D-pad and the Down/Jump buttons; a 9 x 72 px hotbar is 648 px |
| 11 | Manual: Esc-hold in real fullscreen, real touchscreen palm rejection, Sticky Keys | NOT DONE (needs a person on the real laptop) |

### Commands run and results (phase 2)

`npm run test:unit`: `tests 100 / pass 100 / fail 0`

`node tools/smoke.mjs --tag kid` (all scenarios):
```
PASS     kid-home / kid-buttons / kid-void / kid-undo / kid-undo-real / kid-border / kid-stuck / kid-hints / kid-speech / kid-home-arrow / kid-guards
PENDING  kid-undo-mech     - stub lanes: mechanics
FAIL     cored-daynight    - flaky in the full run only (see Cross-lane defects); PASS alone 4/4 on this branch and on main
[smoke] {"PASS":65,"PENDING":4,"SKIP":4,"FAIL":1}
```
`node tools/smoke.mjs --tag kidtouch --touch`:
```
PASS     touch-controls / kid-touch-overlay / kid-touch-world
FAIL     coree-touch       - order-dependent, also fails on main (see Cross-lane defects); PASS alone
[smoke] {"PASS":69,"PENDING":4,"FAIL":1}
```
`node build.mjs --out .tmp/build-kid-prod` (852 KB) + `smoke --scenario boot,world,kid-home,kid-buttons,kid-undo,kid-undo-real,kid-void,kid-stuck,kid-border,kid-hints,kid-guards`: `{"PASS":12}`

### Cross-lane defects (not edited; for the owners)

1. **CORE-E test `coree-touch` is order-dependent** (`tools/scenarios/coree.mjs` ~line 595). Repro: `node tools/smoke.mjs --touch --scenario hotbar,coree-touch` (or `coree-place-rules,coree-touch`) gives FAIL "touch tap places". It fails the same way on `main`.
   - Cause (a): it never calls `selectSlot(0)` and asserts `grass_block`.
   - Cause (b): `Inventory.clear()` does not reset `selected`, so a new world inherits the previous world's slot.
   - Cause (c): after `touch-controls` it fails "input:pointerType emitted" instead, because `lastPointerType` is already `touch` and the event fires only on change.
   - Suggested fix: in the scenario, `selectSlot(0)` and set `game.input.lastPointerType = 'mouse'` first.
2. **INV: a new world keeps the previous world's selected hotbar slot** (`src/inventory/inventory.js` `clear()`). A new creative world should start on slot 1 (grass). Suggested fix: `this.selected = 0` in `clear()`, or in `startWorld` when `isNew`.
3. **CORE-D test `cored-daynight` is flaky in the full suite.** "setTime never remeshes" compares `merges` counts that background column merges from earlier scenarios still bump (7406 → 7441 seen). It passed 4/4 alone. Suggested fix: wait for the streaming / merge queue to go idle before taking the "before" sample, or count only light-triggered remeshes.
4. **Renderer/FX (polish, Minecraft parity):** with the head inside an opaque block (sand dropped on the head), the camera sees straight through the world, plus the huge outline of the block it is inside (`.tmp/kidplay-stuck-sand.png`). Minecraft draws the block's texture as a full-screen overlay. Suggested: FX or the renderer draws an in-block overlay when `B_OPAQUE[block at eye]`, and interaction skips targeting the block the eye is inside. The kid auto-pop still fixes it within 2 s.
5. **CORE-E (minor):** right after a teleport into an unloaded column, the player drifted about 0.1 blocks horizontally in the first tick after the column loaded (x 701 → 700.91, while inside solid terrain). That looks like depenetration. It is harmless now that Home settles the player, so this is only for information.

### Remaining gaps

- `kid-undo-mech` (door halves + explosion in one undo) waits for MECH.
- Survival suffocation damage during the head-in-block auto-pop, and real falling sand, wait for SURVIVAL / MECH.
- Hotbar vs D-pad on narrow screens waits for HUD/INV (LEAD request 2).
- FX `fade` / `spawnParticles` and the AUDIO mapping of `ui.whoosh` / `ui.error` / `ui.success` wait for those lanes (the kid fallbacks are used today).
- Manual checks on the real laptop: Esc held in fullscreen, a real touchscreen, Sticky Keys.
- P2 photo button: not done.

## 2026-10-03 · P0 + P1 complete against the stubs (code commit `db8282b`)

### What changed

Stubs deleted: `registerStub('touch')`, `registerStub('kid')`.

| File | What |
|---|---|
| `src/kid/kid.js` | System `kid`: Home, home arrow, void rescue, stuck rescue, soft border, undo, hints, speech, guards wiring |
| `src/kid/undo.js` | `UndoLog` (pure): §8.5.2 data model, ring of `KID.UNDO_ENTRIES` |
| `src/kid/logic.js` | Pure helpers: arrow angle, border state/fog, void rule, `StuckDetector`, `HintPlan`, `pickVoice` |
| `src/kid/guards.js` | Exit guards: fullscreen + keyboard lock, keep-playing overlay, beforeunload, blocked keys, history entry |
| `src/kid/hints.js` | Animated pictograms (keys and touch variants): walk, turn, place, break, pick, fly, unstuck |
| `src/kid/speech.js` | Local-only `speechSynthesis` (block names on hotbar select, hint lines) |
| `src/kid/pixelicons.js` | Original 16x16 pixel glyphs as crisp inline SVG (no font dependency) |
| `src/kid/kid.css` | Kid UI styles and all pictogram animations (2.4 s loop) |
| `src/ui/touch.js` | System `touch`: D-pad / joystick, Jump/Up, Fly, Down, Pause |
| `src/ui/touch_logic.js` | Pure layout + gesture math (unit-tested) |
| `src/ui/touch.css` | Touch styles |
| `test/kid.test.mjs` | 15 unit tests |
| `tools/scenarios/kid.mjs` | 12 smoke scenarios (`kid-*`) |

### Behaviour summary

- **Home** (H, `home` action, 80 px button top-left at 24/24): fade out, teleport on tick 3 (inside the `kid-home` 5-tick window), face the newest build (centroid of the last 5 undo entries; `meta.home.yaw` wins when set), pitch -12°, fade in, DOM sparkle burst plus `fx.spawnParticles('sparkle')` when FX is live. Emits `kid:home`. If the home cell is now blocked, it lifts to free space.
- **Home arrow**: an 88 px plate at the top centre with a house and a yellow tip that orbits to point home, shown beyond 48 blocks.
- **Void rescue**: feet below y 0, or 10 below the lowest solid block of the column, while `rules.voidRescue` → silent teleport to the surface (spawn/home if the column has none). Emits `kid:rescue {reason:'void'}`; `player:teleport` has reason `void`.
- **Stuck rescue**: either pushing move for 3 s without moving with all four head-level neighbours solid, or the head inside an opaque block for 0.5 s → `kid:stuck {stuck:true, reason}`. The touch Up button pulses; the keyboard "hold space" pictogram shows. Holding Jump for 1 s pops the player out. A pit pops them onto the lowest rim cell. Head-in-block uses findFreeY and auto-pops after 2 s.
- **Soft border**: a circle of `rules.worldBorder` around `meta.spawn`. Outside it, outward velocity is removed and the player is pushed 0.1 b/t toward spawn (`moveAndCollide` when physics is live). Fog thickens over the last 32 blocks via `renderer.setFogOverride`, cleared with `null`.
- **Undo** (U / 72 px button): exactly §8.5.2. Entries are recorded from `block:changed`, grouped by `action`; an action qualifies on cause `player`/`explosion`, and `cascade`/`support` changes join it even when they arrive first. `undo`/`worldgen`/`test` and action 0 are ignored. It keeps the first `before` and the latest `after` per cell, restores newest cell first in one `beginBatch/endBatch` with cause `undo`, and only where the current value equals `after`. Entries that can no longer be restored are skipped. If a restored block now holds the player, the player is lifted silently. Emits `kid:undo {count}` + `sound ui.whoosh`, or `sound ui.error` with a button shake.
- **Hints** (P1): after 7 s with no new hint completed and no building, the next of walk → turn → place → break → pick → fly (fly is skipped when the player can't fly) shows as a pictogram plate at 17% from the top. It plays at most 3 loops per hint per session. Completing a shown hint plays a sparkle + `sound ui.success`. Emits `hint {name}`. Kid scheme only, gated by `settings.hints`. The keyboard or touch variant follows `touch.visible`.
- **Speech** (P1): `settings.speakNames` speaks the item name 250 ms after `player:hotbar`, plus the hint line. Only voices with `localService` are used; with none, nothing is spoken.
- **Exit guards**:
  - `enterFullscreen()` calls `requestFullscreen({navigationUI:'hide'})`, then `navigator.keyboard.lock()`.
  - Losing fullscreen while a world is open autosaves (save lane, when live) and shows a huge ▶ keep-playing overlay (layer `kid-guard` at `Z.TOAST`, above the pause screen). It re-enters fullscreen on click and closes the pause screen; a 48 px "stay in a window" button is there for grown-ups.
  - `beforeunload` after the first interaction while a world is open (plus an autosave attempt).
  - While a world is open, keydown blocks F1/F3/F5/F6/F7, Ctrl/Cmd+R, Ctrl+±/0, Alt+←/→, the browser keys, and Ctrl+P/S/O/F/U/D/H/J/G. This is preventDefault only, so classic F5 = camera still reaches input.
  - `history.pushState({bc:1}, '', location.href)` after the first interaction, re-pushed on popstate.
- **Touch overlay**:
  - Shown for `touchControls` `on`, or `auto` after a touch/pen pointer. It reads `input:pointerType` and also listens to window `pointerdown` itself, so it works while input is a stub.
  - Hidden while any screen is open or not playing; everything held is released on hide, blur, visibility change and scheme change.
  - Layout (from `touch_logic.js`, `M` size, 1280x720): D-pad of 88 px buttons centred at (164, H-164) with a 12 px capture ring. It has 8 sectors, so sliding a finger goes from walk to turn, and the diagonals do both.
  - Jump: 112 px, centre (W-100, H-140). Fly: 80 px, above Jump (creative only). Down: 96 px, left of Jump, shown only while flying. Pause: 80 px, top right.
  - Short screens shrink the D-pad toward 80 px and move Fly next to Down.
  - Mirrored for `leftHanded`; S/M/L sizes; opacity from `touchOpacity`; contacts over 40 px are ignored.
  - Joystick style: `touch.setStyle('joystick')` (160/64 px; kid scheme: y = walk, x = turn via `addLook`).

### Commands run and results (2026-10-03, against core stubs)

`node build.mjs --dev --out .tmp/build-kid`: builds (1166 KB dev). `node build.mjs --out .tmp/build-kid-prod`: 630 KB minified (foundation was 567 KB).

`npm run test:unit`
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

`node tools/smoke.mjs --tag kid`
```
PASS     kid-home
PASS     kid-buttons
PASS     kid-void
PASS     kid-undo
PENDING  kid-undo-real    - stub lanes: input, player, physics, raycast, interaction, world, mechanics
PASS     kid-border
PASS     kid-stuck
PASS     kid-hints
PASS     kid-speech
PASS     kid-home-arrow
PASS     kid-guards
SKIP     kid-touch-overlay  - needs --touch
SKIP     kid-touch-world    - needs --touch
PASS     page-errors
[smoke] {"PASS":23,"PENDING":8,"SKIP":3}   (all LEAD/foundation scenarios still pass)
```

`node tools/smoke.mjs --tag kidtouch --touch`
```
PASS     kid-touch-overlay
PENDING  kid-touch-world  - stub lanes: input, player, physics, raycast, interaction, world
PENDING  touch-controls   - stub lanes: input
[smoke] {"PASS":24,"PENDING":10}
```

`node tools/smoke.mjs --file .tmp/build-kid-prod/index.html --tag kidprod --scenario boot,world,kid-home,kid-buttons,kid-undo,kid-void,kid-hints,kid-guards`: `{"PASS":9}` (minified build, strict CSP).

Headless Chrome granted fullscreen to the real Play click, so the keep-playing overlay path ran for real (`fullscreen: true`). The speech run used a local Windows voice ("Microsoft David").

Screenshots reviewed:
- `.tmp/smoke-kid-kid-buttons.png` (Home/Undo + sparkles)
- `.tmp/smoke-kid-kid-home-arrow.png`
- `.tmp/smoke-kid-kid-stuck.png`
- `.tmp/smoke-kid-kid-keep-playing.png`
- `.tmp/smoke-kid-hint-<name>-<keys|touch>.png` (14 pictograms)
- `.tmp/smoke-kidtouch-kid-touch*.png` (normal, pressed, flying, left-handed, joystick)

### Needs in-world verification once the core lanes are merged

1. `touch-controls` (LEAD) and `kid-touch-world`:
   - the real input sets `lastPointerType` and emits `input:pointerType`;
   - the canvas tap/hold/drag still works around the overlay. The layer is `pointer-events: none`; only the buttons opt in.
2. D-pad turning actually turns. It holds `turnLeft`/`turnRight` virtually; the stub input ignores turning. Walking forward holds `forward` (works in the stub).
3. Fly button → `toggleFly` → `player.setFlying`. The stub player ignores the action. Down → `descend` while flying.
4. `kid-undo-real`: a real tap place, then the MECH door placer (both halves must share the action), then `mechanics.explode` and one undo.
5. Border push with real physics: `moveAndCollide` with flags restored. Check that the player can't walk out on the ground or in flight, and look at the fog wall on the real renderer (`renderFar` field assumed; it falls back to `renderDistance*16`).
6. Stuck rescue with real physics:
   - a kid in a dug 1x1 pit 2 deep;
   - sand falling on the head;
   - survival suffocation damage (MOBS) during the 2 s before the auto-pop is up to about 4 HP. Shorten `STUCK.HEAD_AUTO_POP_TICKS` if that is too harsh.
7. Void rescue with real gravity: falling from y 5 into a hole through bedrock (creative can't break y 0, so mostly islands/test teleports). Confirm no `player:land` fall damage after the rescue (the teleport resets fallDistance).
8. Home into an unloaded column (home far away): the player waits on the "unloaded = solid" rule, and `freeY` runs only when the column is loaded. Watch for spawning inside terrain → the stuck rescue should catch it.
9. Hint `turn` detection uses yaw change plus the `turnLeft`/`turnRight` actions; `walk` uses `input.move.forward`. Check that both fire with real input (drag look counts as turn).
10. Hotbar overlap: on 1024-wide screens the INV kid hotbar (9 × 72 px) can overlap the D-pad's ◀ button. See LEAD request 2.
11. Manual checks:
    - holding Esc for 2 s in real fullscreen (keyboard lock);
    - a real touchscreen with palm rejection;
    - Windows Sticky Keys untouched (no Shift binding).

### Interface assumptions

- The `block:changed` payload is as documented (`state` is the 8-bit state; raw = `id | state<<8`).
- MECH passes the causing `action` to cascade/support changes.
- `player.teleport(x, y, z, reason)` resets velocity and fallDistance, and emits `player:teleport`.
- `player.canFly()` and `player.flying` exist.
- `physics.boxCollides` / `findFreeY` / `moveAndCollide` are used only when `isStub('physics')` is false; my own collision scan with registry boxes is used otherwise.
- `renderer.setFogOverride(near, far)` / `(null)`; `renderer.renderFar` is read if present.
- `fx.fade(to, ms)` and `fx.spawnParticles('sparkle', …)` are used when FX is not a stub. Otherwise the kid layer has its own fade (white-blue, 85%) — no double fade after FX lands.
- `game.save.saveNow(reason)` is used only when the save lane is not a stub.
- The Play button in MENUS must keep calling `game.kid.enterFullscreen()` synchronously inside the click (the stub title does).

### New events and API members (for the SPEC)

- Events: `kid:stuck {stuck, reason: 'enclosed'|'suffocate'|null}` (touch pulses Up), `kid:homeSet {x, y, z}`. `kid:rescue` reasons are `void` and `stuck`. `player:teleport` reasons from kid: `home`, `void`, `stuck`.
- Sounds requested through `sound`: `ui.whoosh` (undo), `ui.error` (nothing to undo), `ui.success` (hint done). The Home whoosh is left to AUDIO's `kid:home` mapping.
- `game.kid`: `requestHome()` (the animated path that buttons/H use; `goHome()` stays instant), `undoLog`, `stuck`, `hints`, `guards`, `speech`, `homeArrow {visible, deg, dist}`, `border {dist, over, fogT}`, `showHint(name, variant)`, `hideHint()`, `hintShown`, `sparkle(x, y, n)`.
- `game.touch`: `setVisible(null)` returns to automatic, plus `style`, `setStyle('dpad'|'joystick')`, `layout`, `held()`, `releaseAll()`.
- DOM hooks for tests: `[data-kid=home|undo|home-arrow|hint|guard|keep-playing|stay-windowed]`, `[data-touch=forward|back|turnLeft|turnRight|jump|fly|down|pause|dpad|joystick]`.

### Spec conflicts / interpretations

- §2.7 "hint loops at most 3 times per session": each hint plays up to 3 animation loops in total per page session, then never returns.
- §2.7 void rule "10 blocks below the lowest terrain": the lowest solid block of the player's own column.
- §2.7 stuck "pops to free space (physics.findFreeY)": `findFreeY` does nothing for a player standing free in a pit, so a pit pops onto the lowest rim cell. Head-in-block uses `findFreeY` as specified.
- §8.5.1 Fly at 80 px, but S/M/L scaling isn't specified; Fly = max(80, B-16), Jump = B+16 (112 at M), D-pad buttons = max(80, B-8) so the M centre matches (24+140).
- The keep-playing overlay sits at `Z.TOAST` (it must be above the pause screen that Esc opens); it is not a `game.ui` screen.
- The inventory button and hotbar on touch are left to INV per §8.5.1 (no duplicate here).

### LEAD requests

1. Add a `touchStyle: 'dpad'|'joystick'` setting (MENUS toggle). Until then `touch.setStyle` stores it in localStorage `blockcraft:touchStyle`.
2. INV/HUD coordination: in touch mode on narrow (≤ 1100 px) screens, the kid hotbar should stay between x ≈ 312 and W − 276 (or lift above the D-pad's bottom row) so it doesn't overlap the D-pad and the Down button.
3. Document `kid:stuck` and `kid:homeSet` in SPEC §6, and the `game.kid` / `game.touch` additions above.
4. Optional: map `ui.whoosh` for `player:teleport` reason `home` in AUDIO only (not for `void`, which must stay silent).

### Remaining

- P2 photo button: not done.
- P1/P2 all other items: done; they need in-world verification as listed above.
