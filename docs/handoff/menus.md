# Handoff - menus

Branch `lane/menus` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-menus`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-04 · Judge round 1 fixes (KID-9, ROB-2, ROB-5, POL-14)

- **KID-9** `src/save/autosave.js` + `storage.js`: block changes with cause `explosion` / `undo` / `redo` (and the `explosion` / `kid:undo` events) are saved 0.4 s after they settle (`AUTOSAVE_BULK_MS`), not 2.5 s. Repro `.tmp/menus-fix/kid9.mjs` (blast, autosave, Undo with the real `u` key, renderer crash via CDP `Page.crash` 0.5 / 1 s later, reopen): before `afterReopenDiff:61` (crater back), after `afterReopenDiff:0` at both 0.5 s and 1 s.
- **ROB-2** new `src/save/worldlock.js`: Web Locks `blockcraft-world-<id>` (`ifAvailable`) held from world:ready (menus claim it before loading) to world:exit / pagehide (re-claimed on bfcache pageshow); BroadcastChannel ping fallback. `menus.loadWorld` refuses a held world and opens the new `worldBusy` screen (world picture + lock + two-windows icon, big Back). A world opened past the menus (test API, restore) emits `save:conflict`, is never saved, and goes to `worldBusy`. New save members: `claimWorld(id)`, `releaseWorld()`, `conflictId`. `.tmp/menus-fix/lock.mjs` 9/9 PASS (file://, real clicks, tab 2 Play + world card refused, tab 1 renderer crash frees the lock, gold block survives, Save & Title frees it).
- **ROB-5** `backends.js`: no 4 s timeout; a slow open is waited for, one extra open after 6 s, memory only after two real errors; `globalIdb()` wraps the throwing `indexedDB` getter. `storage.js`: init waits at most 1.5 s, then every world call waits (`isReady`, `whenReady()`); memory fallback sets `storageProblem` ('blocked' | 'error') and emits `save:storage`. Title Play shows the loading layer while the database opens; title banner (new `nosave` icon) when saving is off. `.tmp/menus-fix/rob5.mjs` 6/6 PASS (9 s open: same world resumed on idb; storage blocked: memory + banner + Play works; no banner normally).
- **POL-14** `menu_styles.css`: the "+" card is the opaque `--panel` bevelled card with a dashed inner frame and a pulsing green plus; the header icon sits on a bevelled grey badge instead of the dark plate.
- New events: `save:conflict {id}`, `save:storage {available, problem}`. New icons: `windows`, `nosave`. New screen: `worldBusy`.
- `npm run test:unit` 237/237 (6 new menus tests). `node tools/smoke.mjs --tag menus` `{"PASS":160,"SKIP":5}`; `--touch --scenario menus-touch` PASS.

## 2026-10-03 · MENUS phase 2: merged the real CORE, verified in real gameplay

### What changed

- `git merge main` into `lane/menus` (merge commit `0e97072`): no conflicts. MENUS had no stub fallbacks of its own, so nothing to remove.
- `src/save/storage.js`: world thumbnails hide the block selection outline during the (synchronous) capture and restore it right after. Before: every pause/exit picture had the white kid outline box in the middle.
- `src/ui/menu_worlds.js` + `menu_styles.css`: new-world cards follow the window height too; on short wide windows (<= 640 px tall, >= 3:2) the big Play sits to the right of the cards; at <= 420 px tall the top bar and cards shrink and the labels hide. Before: at 1366x600 (a small laptop browser window) Play was cut off at the bottom and the selected card covered the "+" badge; at 812x375 Play was off screen.
- `menu_styles.css`: settings tabs become a 2-wide icon grid when the window is <= 480 px tall (landscape phone). Before: the Helpers/Saves/Tips tabs were below the screen edge.
- `menu_settings.js`: "Menu size" renamed "Hotbar and inventory size" with the hint "The big menu buttons always stay big." (`guiScale` drives the HUD/inventory only; the kid menus keep fixed big sizes on purpose.)
- `tools/scenarios/menus.mjs` `menus-sizes`: also checks 1366x600 and 812x375, flags anything off the top/bottom edge, and screenshots title/worlds/newWorld/pause/settings/death at every size.
- New `tools/menus-inworld.mjs`: in-world verification driver (real `page.mouse`/keyboard, real CDP touch with `--touch`, real page reload with IndexedDB, screenshots + `results.json` in `.tmp/inworld*/`). Usage: `node build.mjs --dev --out .tmp/build-menus && node tools/menus-inworld.mjs [--touch] [--swiftshader] [--w 1366 --h 600]`.

### Verified in real gameplay (real core, `tools/menus-inworld.mjs`)

Stub lanes at the time: audio crafting furnace fx hud invui items kid mechanics mobs music survival touch.

```
PASS boot to title {"ms":418}
PASS Play press -> loading screen -> playing {"loadMs":380,"progress":30,"clicks":1}
PASS load time < 4 s (dev GPU) {"loadMs":307..380}                  (SwiftShader: 307 ms at R4)
PASS fps playing (menus closed) {"fps":144,"drawCalls":225,"R":8}   (SwiftShader: 35 fps, 78 draw calls, R4)
PASS child taps place blocks in the real world {"placedEvents":2}
PASS Esc opens pause and the world stops {"state":"paused"}
PASS pause saves with a rendered thumbnail {"thumbLen":16091}
PASS Resume closes pause, back to playing
PASS Save & Title returns to the title; worlds button shows the world picture
PASS worlds card shows the saved world (data:image/jpeg thumbnail)
PASS new Snowy Survival Normal world from real taps {"preset":"snowy","mode":"survival","difficulty":"normal"}
PASS death screen (PENDING real fall damage: survival is a stub)    -> player:death emitted by the script
PASS Respawn button closes the death screen (survival stub)
PASS settings reach the real lanes {"before":{"R":8,"tris":577487},"after":{"R":5,"tris":387909},"toggles":{"fancyLeaves":false,"smoothLighting":false,"showFps":true,"clouds":false}}
PASS classic: losing pointer lock opens pause {"lockedByClick":true}
PASS classic: Resume inside the relock cooldown shows a non-blocking hint, then locks {"during":{"hint":true,"pe":"none"},"after":{"locked":true}}
PASS classic: Resume relocks
PASS reload persists blocks, inventory, slot, position, time {"gold":"gold_block","diamonds":7,"slot":3,"time":9000}
PASS autosave keeps edits in columns that streamed out; Play resumes the last world where it was left {"glass":"glass","pending":0,"farX":375.5}
PASS menus add no frame cost over the world {"world":{"p50":7},"pause":{"p50":6.9},"drawCalls":{"world":244,"pause":242}}   (SwiftShader p50 27.9 vs 27.8 ms)
PASS no page errors
[inworld] 21/21 PASS   (also 20/20 with --swiftshader and with --w 1366 --h 600, run before the cooldown step was added)
```

Touch (`--touch`, laptop touchscreen 1280x720, real CDP touch events):
```
PASS touch: finger tap on Play starts the world {"pointerType":"touch"}
PASS touch: tapping the world builds
PASS touch: a short hold does not pass; a 3 s finger hold + sum opens settings
PASS touch: Resume with a finger
PASS touch: new Flat Survival Easy world from finger taps
PASS no page errors
[inworld] 6/6 PASS
```

Screenshots looked at (worktree `.tmp/`): `inworld/01-title-first-run.png`, `02-loading.png`, `03-playing-first.png`, `04-built.png`, `05-pause.png`, `06-title-after-exit.png` (worlds button with the real picture), `07-worlds.png`, `08-newworld-picked.png`, `09-survival-snowy.png`, `10-death.png`, `12/13-settings-video*.png`, `14-world-after-settings.png` (fast leaves visible), `15-classic-pause.png`, `16-classic-resume-cooldown.png` (mouse hint), `19-worlds-after-reload.png`, `thumbnail.png` (no outline after the fix); `inworld-touch/01..07`; `inworld-1366x600/*`; `nw-1366x600.png`, `nw-812x375.png`, `nw-667x375.png`; `smoke-menus-menus-{title,worlds,newworld,pause,settings,death}-{1280x720,1366x600,375x667,812x375}.png`.

Perf: title/worlds/new-world screens cost ~0.3 ms script per frame at 144 Hz (about 12 % of one core, mostly the game loop and CSS animations, not the panorama). The pause screen over the real world adds no frame time and no draw calls (RTX and SwiftShader).

### Commands run and results

`node build.mjs --dev --out .tmp/build-menus` -> builds (1697 KB dev).

`npm run test:unit` -> `tests 100 · pass 100 · fail 0`.

`node tools/smoke.mjs --tag menus`
```
PENDING  mobs           - stub lanes: mobs
PENDING  survival-fall  - stub lanes: survival
SKIP     touch-controls · coree-touch · menus-touch  - need --touch
FAIL     coree-classic-lock  - assert: still playing   (CORE-E test expectation, see Cross-lane defects #1)
PASS     menus-title · menus-flow · menus-autosave · menus-gate · menus-sizes {"problems":[]} · menus-newworld · menus-edit-worlds
PASS     menus-settings · menus-death · menus-loading · menus-classic-pause · menus-backups · menus-export-import
PASS     menus-reload-persist · menus-thumbnail · save-load · lead-* · all other core* scenarios · page-errors
[smoke] {"PASS":71,"PENDING":2,"SKIP":3,"FAIL":1}
```
`--touch --scenario menus-touch,touch-controls,coree-touch` -> menus-touch PASS, coree-touch PASS, touch-controls PENDING (touch stub).
`--http --scenario boot,menus-flow,menus-autosave,menus-backups,menus-export-import,menus-reload-persist,save-load,menus-thumbnail` -> 9/9 PASS.
`--swiftshader --scenario menus-title,menus-flow,menus-sizes,menus-thumbnail,menus-reload-persist` -> 6/6 PASS.

### Status of the phase-1 "needs in-world verification" list

1. Thumbnails: PASS (outline removed from the picture).
2. Reload persistence: PASS for blocks, inventory, selected slot, position, time. Animals: PENDING (mobs lane is a stub). No DataCloneError with the real systems.
3. Autosave while streaming: PASS (edit in a column that streamed out is written, `pendingSave` drains to 0, edit is back after reload).
4. Classic scheme: PASS (unlock -> pause, Resume relocks, the hint during the cooldown is `pointer-events: none`).
5. KID fullscreen / AUDIO unlock / click sound: PENDING (kid and audio lanes are stubs). `ui:click` is emitted once per press.
6. Death with real survival: PENDING (survival stub; the death screen and Respawn work from `player:death`).
7. Settings reactions: PASS for render distance, fancy leaves, smooth lighting, clouds, control scheme. Show FPS / GUI scale / volumes: PENDING (hud and audio stubs).
8. Loading: PASS, 0.3-0.4 s on the RTX, 0.3 s on SwiftShader (R4), well under 4 s.
9. Touch + trackpad: PASS with emulated touch (CDP) and mouse; real hardware not available here.

### Cross-lane defects

1. **CORE-E test `coree-classic-lock` fails once real MENUS is merged** (`tools/scenarios/coree.mjs` ~line 309: `t.assert(await t.call('state') === 'playing', 'still playing')`). The scenario calls `document.exitPointerLock()` while playing in the classic scheme; SPEC §8.4 ("Classic scheme: on `input:pointerLock {locked: false}` while playing with no screen open, open `pause`") and CORE-E's own handoff say MENUS then opens `pause`, so `game.state` is `'paused'`. Repro: `node tools/smoke.mjs --tag menus --scenario coree-classic-lock` on `lane/menus`. Suggested fix (CORE-E or LEAD): accept the pause, e.g. `const st = await t.call('state'); t.assert(st === 'playing' || (st === 'paused' && await t.call('uiOpen') === 'pause'), ...)`, then `await t.call('closeUI')` before the `finally`.
2. (Suggestion, LEAD/CORE-D, not a bug) While a `pausesGame` screen is open the world image is frozen, but the renderer still draws every frame (SwiftShader: 33 full-cost frames a second behind the pause screen; on the title it still renders the empty sky). Skipping world renders while paused (redraw only on resize or a settings change) would save laptop battery and heat.
3. (Suggestion, CORE-D) `renderer.captureThumbnail` could hide the selection outline itself; MENUS now does it around the call (`setHighlight(null)` / restore).

### Remaining gaps

- Waiting on stub lanes: survival (real fall death), mobs (animals in saves), kid (fullscreen + keyboard lock from Play), audio (unlock, click sound, volumes), hud (Show FPS, GUI scale, the touch pause button), touch.
- Real touchscreen and Windows trackpad hardware not available here (emulated touch and mouse only).
- After a finger tap the last pressed button keeps the CSS `:hover` look (LEAD `.bc-btn:hover` in `src/styles.css`); harmless, left as is.

## 2026-10-03 · MENUS lane P0 + P1 + P2 implemented (SPEC §8.4)

### What changed

Stubs deleted: `registerStub('menus')`, `registerStub('save')`, `registerStub('font')`, `registerStub('gate')`.
Frozen signatures kept (`createMenusSystem`, `createSaveSystem`, `installPixelFont`/`FONT_NAME`, `openParentGate`).

| File | What it is |
|---|---|
| `src/ui/menus.js` | System `menus`: title, pause, death screens; loading layer (Z.LOADING); classic click-to-play hint; Play/new/load glue |
| `src/ui/menu_worlds.js` | `worlds` (paged picture cards, big "+", gated edit mode with rename + delete and check/cross confirm) and `newWorld` (picture presets + mode cards + big Play) |
| `src/ui/menu_settings.js` | `settings` parent area: Controls, World, Video, Sound, Helpers, Saves (backups, export, import), Tips |
| `src/ui/menu_art.js` | Original procedural pixel art: 16x16 icons (auto outline + bevel), block tiles, BLOCKCRAFT logo, preset/mode pictures, parallax title scenery with walking pig/sheep/chicken |
| `src/ui/menu_widgets.js` | Press handling (feedback + `ui:click` on pointerdown; mouse acts on pointerdown, touch on pointerup = real user gesture), icon buttons, toggles, choices, sliders |
| `src/ui/menu_logic.js` | Pure: `GateMachine`, `makeSum`, world names, new-world options, picker paging |
| `src/ui/menu_styles.css` | All menu CSS (imported from menus.js) |
| `src/ui/pixelfont.js` | 95 original 5x7 glyphs (+2-row descenders) -> TrueType built in memory -> `FontFace` |
| `src/ui/parentgate.js` | Gate DOM at Z.GATE: hold the lock 3 s (ring fills), then a two-digit sum on a number pad; keys captured while open |
| `src/save/storage.js` | System `save`: IndexedDB save/load, autosave, retry, backups, export/import |
| `src/save/backends.js` | IndexedDB backend (db `blockcraft` v1, stores `worlds` + `columns` with index `worldId`) and an in-memory backend (fallback + tests) |
| `src/save/autosave.js` | Pure autosave cadence (2.5 s debounce after block changes, 30 s cap while anything changes) |
| `src/save/worldfile.js` | Pure export/import JSON format (base64 codec bytes, validated with `decodeColumn`) |
| `test/menus.test.mjs` | 15 unit tests |
| `tools/scenarios/menus.mjs` | 16 smoke scenarios (`menus-*`) |

### What works (verified in real Chrome with the current stub core)

- **Title**: original logo (stone letters with grass caps), animated parallax scenery (clouds, mountains, hills, trees, walking animals), Play 260x140 pulsing, worlds picture button showing the last world's picture, dull 52 px grown-ups gear, Enter/Space also Play. Play resumes `settings.lastWorldId` if it exists, else creates the default kid world (Hills & trees, Creative, Peaceful). `audio.unlock()` and `kid.enterFullscreen()` run synchronously in the press handler (mouse pointerdown / touch pointerup / keydown).
- **Worlds**: cards >= 240x160 with thumbnail (or preset picture), mode badge (star / sword + sun / sword + moon), name, "x min ago"; "+" card first; paged with 96 px arrows (sides on wide screens, below on phones), page dots; no scrolling. Edit mode behind the gate: rename (text + dice for a random name) and delete with check/cross confirm.
- **New world**: Flat / Hills & trees / Snowy pictures and Creative / Survival Easy / Survival Normal cards; one tap each (selection = yellow border + lift + scale + check badge); big Play; automatic friendly names that never repeat.
- **Loading**: dirt background, world picture, hopping block tiles, progress bar from `world:progress`; shown on `world:starting`, hidden on `world:ready` (and on state title/playing).
- **Pause** (`pausesGame`): big Resume (classic scheme re-requests pointer lock), Home (kid.goHome), Save & Title (exit door), dull gear -> gate -> settings. Saves immediately (with thumbnail, <= 1 per 60 s).
- **Death** (`escClose: false`): three hearts + big Respawn -> `survival.respawn()`; not shown when `rules.immediateRespawn`; closes on `player:respawn`.
- **Classic scheme**: `input:pointerLock {locked:false}` while playing with no screen -> pause; a non-interactive mouse hint shows while unlocked.
- **Settings** (parent area): every change through `setSetting` / `setRule` / `setMode` / `setDifficulty`; set home; world rename; backups list + restore; export (download) and import (file picker); parent tips (Sticky Keys, separate file/website saves, creative default, TNT undo, ...). Esc goes back (to pause, or to the title).
- **Parent gate**: random taps never pass (2000-run fuzz in unit tests + real-click smoke); Esc cancels without closing the screen underneath; digits do not reach the hotbar while open.
- **Saves**: one readwrite transaction per save (meta + every dirty column + `pendingSave` records), `exportColumn` + `markColumnSaved` together in the same task; failed transactions keep their records (newest-export-wins sequencing) and write them first next time; non-urgent requests coalesce; hidden/pagehide/unload saves run immediately. Triggers: 2.5 s after the last `block:changed`, 30 s cap while playing, pause screen, `kid:home`, visibility hidden, pagehide, beforeunload, fullscreen exit, new world (so it is listed at once). `navigator.storage.persist()` on http(s). `settings.lastWorldId` set on open/save, cleared when that world is deleted.
- **Backups (P1)**: up to 3 rolling meta copies (<= one per 10 min) + one daily snapshot of meta and columns, made after a pause/exit save; restorable from settings (open world is saved, closed, restored, reopened).
- **Export / import (P2)**: JSON world file; import validates every column and creates a new world ("... copy" on a name clash).
- **Pixel font**: installs in ~ms at boot; `document.fonts.check('16px BlockcraftPixel')` is true; no network.
- Perf (dev RTX): boot to title 214-270 ms; title re-open 0.3 ms; menu frame cost ~0.02 ms; new-world screen 5.6 ms after the idle warm-up (pictures are drawn in idle slices after the title shows). SwiftShader boot 366 ms.

### Commands run and results

`node build.mjs --dev --out .tmp/build-menus` -> builds (1228 KB dev).

`npm run test:unit`
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

`node tools/smoke.mjs --tag menus`
```
PASS     boot · PASS world · PENDING terrain-render · PENDING move-jump · PENDING break-place · PASS hotbar
PASS     inventory-ui · PASS time · PASS kid-home · PENDING mobs · PENDING survival-fall
PENDING  save-load        - stub lanes: world
SKIP     touch-controls   - needs --touch
PENDING  context-loss · PASS perf
PASS     lead-events-roundtrip · lead-unload-persist · lead-break-contract · lead-batch · lead-entity-streaming · lead-testapi
PASS     menus-title         769 ms {"play":{"w":260,"h":140}}
PASS     menus-flow          516 ms
PASS     menus-autosave     3103 ms {"saves":[{"reason":"exit"},{"reason":"new"},{"reason":"auto","ok":true}]}
PASS     menus-gate         5661 ms
PASS     menus-sizes        4336 ms {"problems":[]}
PASS     menus-newworld      236 ms
PASS     menus-edit-worlds  3659 ms
PASS     menus-settings     3527 ms
PASS     menus-death         181 ms
PASS     menus-loading       276 ms {"progressEvents":2}
PASS     menus-classic-pause   82 ms
PASS     menus-backups       228 ms
PASS     menus-export-import  110 ms
SKIP     menus-touch          - needs --touch
PENDING  menus-reload-persist - stub lanes: world, player, physics
PENDING  menus-thumbnail      - stub lanes: renderer, world, textures, mesher
PASS     page-errors
[smoke] {"PASS":27,"PENDING":9,"SKIP":2} in 29.2 s
```

`node tools/smoke.mjs --tag menus-touch --touch --scenario menus-touch,touch-controls` -> `PASS menus-touch`, `PENDING touch-controls` (touch, input stubs), `PASS page-errors`.
`node tools/smoke.mjs --tag menus --http --scenario boot,menus-flow,menus-autosave,menus-backups,menus-export-import` -> all PASS (IndexedDB over http).
`node tools/smoke.mjs --tag menus --swiftshader --scenario menus-title,menus-flow,menus-sizes` -> all PASS.

Trial runs against the stub core (requirements temporarily relaxed in a scratch copy, then restored): `menus-reload-persist` PASSED (block, position, hotbar slot survive a page reload and Play resumes the world); the LEAD `save-load` steps PASS (gold block persisted). `menus-thumbnail` fails as expected with the stub renderer (1 colour), so it stays PENDING on the real renderer.

Screenshots reviewed: `.tmp/smoke-menus-menus-title.png`, `-menus-title-375.png`, `-menus-worlds.png`, `-menus-worlds-375.png`, `-menus-newworld.png`, `-menus-newworld-375.png`, `-menus-pause.png`, `-menus-settings-world.png`, `-menus-settings-375.png`, `-menus-settings-tips.png`, `-menus-gate-hold.png`, `-menus-delete-confirm.png`, `-menus-death.png`, `-menus-loading.png`.

### Needs in-world verification (after the CORE merge)

1. `menus-thumbnail`: pause/exit thumbnails show the rendered world (renderer.captureThumbnail) and look good on the world cards, title worlds button and loading screen.
2. `menus-reload-persist` and the LEAD `save-load` with the real world/player/inventory: blocks, inventory, position, time, animals (§13.1 #8). Check every system's `serialize` output is JSON/structured-clone safe (IndexedDB backend falls back to a JSON copy on DataCloneError).
3. Autosave while streaming: unloaded modified columns in `world.pendingSave` are written and moved by `markColumnSaved` (works with the stub world; re-check with the real CORE-C world and its workers).
4. Classic scheme with the real input lane: Esc releases pointer lock -> pause opens; Resume re-locks inside the click; the mouse hint shows during the ~1 s relock cooldown and never blocks canvas clicks (it is `pointer-events: none`).
5. Play with the real KID/AUDIO lanes: fullscreen + keyboard lock and audio unlock from the Play press (mouse, touch end, Enter); `ui:click` sound on every press.
6. Death screen with real survival deaths when a parent turns off "Respawn right away".
7. Settings reactions in the real lanes (render distance, fancy leaves, smooth lighting, volumes, controls scheme, GUI scale, show FPS).
8. Loading time and progress with real pregeneration (< 4 s on the mid laptop).
9. Real touchscreen + Windows trackpad: taps on cards/Play, hold on the gate lock.

### Interface assumptions

- `game.save.loadWorld(id)` returns columns as `Map<'cx,cz', {data: Uint8Array (codec bytes), blockEntities}>` (SPEC §8.4.3; the world decodes lazily). The old stub JSDoc said `{blocks}` - the SPEC wins.
- `world.getDirtyColumns()`, `world.pendingSave` (Map keyed `'cx,cz'`), `exportColumn` (`{blocks}` or `{data}`), `markColumnSaved` exactly as SPEC §5.3.2.
- `renderer.captureThumbnail(240, 150)` returns a `data:image/...` URL (ignored if missing/short).
- `survival.respawn()`, `kid.goHome()`, `kid.setHome()`, `kid.enterFullscreen()`, `audio.unlock()`, `input.requestPointerLock()`, `input.pointerLocked` per the frozen APIs; all calls tolerate stubs.

### New events and API members (please document in the SPEC)

- Event `menus:gate` `{open: true}` when the gate opens, `{passed: bool}` when it closes.
- `game.save` (all optional additions): `backend` ('idb' | 'memory'), `retryCount`, `backupsIdle` (Promise), `renameWorld(id, name)`, `listBackups(worldId)`, `restoreBackup(worldId, backupId)`; `exportWorld` resolves a JSON `Blob` with `.filename`; `importWorld(file|blob|string)` resolves the new meta or null; `createSaveSystem(game, {backend})` optional backend.
- `game.menus`: `play()`, `startNew(opts)`, `loadWorld(id)`, `openSettings(from)`, `gate()`, `loadingVisible`, `loadingProgress`, `art` (icon data URLs for review).
- `parentgate.js`: `isParentGateOpen()`, `cancelParentGate()`; `openParentGate(game, {holdMs})` optional.
- Storage keys: backups live in the `worlds` store as `<id>~b0..2` (meta copies) and `<id>~d` (daily) with `backupOf`; daily columns use worldId `<id>~d`. `listWorlds()` hides them.

### Spec conflicts / deviations

- SPEC §8.4.1 pause lists "🏠 Save & Title". The KID lane's Home (teleport) also uses a house, so the pause screen draws Save & Title as an exit door and adds a separate house button for Home (go home). Please update the SPEC wording or say which you prefer.
- SPEC §8.4.1 title "renderer may show a slowly rotating world (P1)": implemented as a 2D parallax scenery inside MENUS instead (no renderer dependency, ~0.02 ms/frame). A 3D title world would need a CORE-D API; not requested.

### LEAD requests

1. `main.js startWorld`: if `world.open`/`pregenerate` throws, `game.state` stays `'loading'` (and `world:ready` never fires). MENUS recovers for its own calls (hides loading, reopens the title), but a `try/catch` in `startWorld` that resets the state would protect every caller. Workaround in place: menus catches and calls `startFailed`.
2. `src/styles.css` `.bc-btn` font-size `max(18px, calc(var(--gui) * 7))` gives 21 px at GUI scale 3, which is not a multiple of the pixel font's 8 px em, so default button text is slightly soft. Suggest `calc(var(--gui) * 8)` (or multiples of 8 px). MENUS sets its own 16/24/32 px sizes as a workaround.
3. Document the new event/API members listed above in SPEC §6 / §8.4.3.

### Remaining

- P0/P1/P2 items of §8.4 are implemented. Remaining work is the in-world verification list above (later phase).
