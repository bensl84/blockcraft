# Handoff - menus

Branch `lane/menus` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-menus`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

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
