# Handoff - kid

Branch `lane/kid` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-kid`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

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
