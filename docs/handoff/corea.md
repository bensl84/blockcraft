# Handoff - corea

Branch `lane/corea` · worktree `C:\Users\BSLeo\AppData\Roaming\Claude\scratch-workspaces\d51430ec-3a3a-439b-8900-0c874bdb1f07\b2153cc3-275b-457e-b8c5-e9c375a931eb\scratch-2026-10-03-20c18c\bc-corea`

<!-- newest first: date · what changed · commands run + results (copy the PASS/FAIL lines) · remaining · blockers · spec conflicts -->

## 2026-10-03 · CORE-A textures and item icons complete (P0 + P1 + P2 scope of §5.1)

### What changed

- `registerStub('textures')` and `registerStub('icons')` are **deleted**; both modules are real.
- `src/textures/textures.js` - public API unchanged (`TEX_SIZE`, `ICON_SIZE`, `buildTextures`, `getTexturePixels`, `buildItemIcons`). Assembles the layers; `buildItemIcons` wraps the pure atlas in a canvas + PNG data URL.
- `src/textures/toolkit.js` - every frozen signature kept and deterministic; additions listed below.
- New painter modules (all pure, no DOM, deterministic from `hashString(key)`):
  - `tex_terrain.js` - stone family, dirt/grass, sand/sandstone, gravel, clay, snow, ice, obsidian, bedrock, granite/diorite/andesite, 7 ores (on the shared stone base, so ores sit flush in stone walls), 3 woods (logs, log tops with rings, planks, leaves with fancy/fast variants).
  - `tex_building.js` - glass, bricks, stone bricks (+mossy), bookshelf, glowstone, crafting table, furnace (+lit), chest, 7 storage blocks, hay, TNT, pumpkin / jack o'lantern (friendly face), melon, cactus, cake, farmland dry/wet, door upper/lower, bed parts, 16 wool, 16 stained glass, 16+16 bed tops, `crack_0..9`, `missing`.
  - `tex_plants.js` - saplings, grass, fern, dead bush, 8 flowers, sugar cane, mushrooms, ladder, torch, wheat 0-7, carrots 0-3, potatoes 0-3.
  - `tex_anim.js` - water (16 f), lava (16 f), fire (8 f, cutout); seamless loops; alpha classes (`CUTOUT_KEYS`, `TRANSLUCENT_ALPHA`).
  - `icons.js` - pure `paintIconAtlas(textureSet)`: iso blocks (top x1.0, left/south x0.8, right/east x0.6) with slab, stairs, carpet, snow layer, farmland, chest, cake, cactus, fence and gate models; glass and stained glass draw their back faces first; `tex:` icons at 2x; sprites at 2x.
  - `sprites.js` - 105 original sprites (every `requiredSprites()` name): materials, foods, buckets, gear, 25 tools (5 shapes x 5 tier palettes), 16 armour pieces, tinted `dye` and `bed`, two-colour `spawn_egg`.
- Tests and tools: `test/corea.test.mjs`, `tools/scenarios/corea.mjs`, plus review-only tools `tools/corea-preview.mjs` (Node PNG sheets: textures, tiling, icons) and `tools/corea-diorama.mjs` + `tools/corea-diorama-page.js` (three.js voxel diorama with the real array texture, CORE-D sampling settings, screenshots to `.tmp/corea-diorama-*.png`). Nothing under `tools/corea-*` ships.

### Commands run and results (all in this worktree)

`npm run test:unit`

```
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

`node build.mjs --dev --out .tmp/build-corea` -> builds (1195 KB dev).

`node tools/smoke.mjs --tag corea`

```
PASS     boot                 56 ms {"textureLayers":238,"bootMs":209}
PASS     world               192 ms
PENDING  terrain-render        0 ms  - stub lanes: worldgen, world, lighting, mesher, renderer
PENDING  move-jump             0 ms  - stub lanes: input, player, physics, world, worldgen
PENDING  break-place           0 ms  - stub lanes: input, player, physics, raycast, interaction, world
PASS     hotbar               54 ms
PASS     inventory-ui        118 ms
PASS     time               1054 ms
PASS     kid-home            301 ms
PENDING  mobs                  0 ms  - stub lanes: mobs, physics, world
PENDING  survival-fall         0 ms  - stub lanes: survival, player, physics
PENDING  save-load             0 ms  - stub lanes: save, world
SKIP     touch-controls        0 ms  - needs --touch
PENDING  context-loss          0 ms  - stub lanes: renderer
PASS     perf               3112 ms
PASS     corea-icons         400 ms {"textureBuildMs":23.1,"iconBuildMs":66.4,"atlasKB":213}
PASS     corea-textures       71 ms {"layers":238}
PASS     corea-determinism     31 ms {"hash":"844fa740"}
PASS     lead-events-roundtrip     47 ms
PASS     lead-unload-persist    333 ms
PASS     lead-break-contract     54 ms
PASS     lead-batch           42 ms
PASS     lead-entity-streaming    172 ms
PASS     lead-testapi        506 ms
PASS     page-errors           0 ms
[smoke] {"PASS":17,"PENDING":7,"SKIP":1} in 7.0 s
```

`node tools/smoke.mjs --tag corea-ss --swiftshader --scenario boot,corea-icons,corea-textures,corea-determinism` -> 5 PASS (textures 27.1 ms, icons 47.2 ms).

Screenshots reviewed: `.tmp/smoke-corea-icons.png` (every item icon in 48 px inventory slots), `.tmp/smoke-corea-textures.png`, `.tmp/corea-diorama-{wide,close,ground}.png`, `.tmp/corea-tiles.png`.

### Performance

| Measure | Dev (RTX, Chrome, cold) | Node warm | Budget (mid laptop) |
|---|---:|---:|---:|
| `buildTextures` | 23-27 ms | ~10 ms | 60 ms |
| `buildItemIcons` (paint + PNG encode) | 47-66 ms | paint ~8 ms | 150 ms |

Unverified: a real mid laptop (Iris Xe). The icon time is about half PNG encoding (`toDataURL`); if it runs over on real hardware, the fallback is `toBlob` + object URL after boot.

### Interface assumptions other lanes must honour

- **CORE-C mesher UVs.** Partial-height boxes sample the **bottom** rows of side textures (u = block-local x, v = 1 - y, like a slab). The bed side/end textures put their content in rows 7-15, cake sides in rows 8-15, the chest frame at x 1-14 / rows 2-15 (sides) and x/z 1-14 (top). The up face has its texture top toward north (as in §5.3.5); the bed top texture has the pillow at the top rows, so the mesher must rotate it so texture-up points toward the head (`facing`).
- **Torch model:** stick at x 7-8, rows 6-15; the glowing tip is rows 6-7, so the torch top face should sample x 7-8, rows 6-7. Rows 3-5 hold a small flame that only the flat icon shows.
- **Door:** `oak_door_upper` has four transparent window panes (cutout); the lower half has a handle near the top-right.
- **Alpha classes:** cutout keys are exactly 0/255 with RGB bled into transparent texels; water is α175 (all frames), ice α190, stained glass α150; crack overlays are black at α150 with α70 halos (not cutout); every other texture is opaque.
- **halfAnim:** water and lava get 8 frames **and half fps** (4 and 2), so a loop lasts as long; CORE-D must read `animated.get(k).fps` as well as `.frames` in that mode.
- **Iso icons** show a block's front on the left (south) face (state facing = 2); logs/hay upright.
- `icons.pixels16(key)` returns a fresh copy: the sprite for `sprite:`, the texture for `tex:`, and the front/south side texture for `iso:` items.
- `icons.style(key, px)` now also sets `imageRendering: 'pixelated'` (the `.bc-icon` class already does).
- Optional additions (allowed by §0.1): `textureSet.buildMs`, `icons.buildMs`; exports `PAINTERS`, `isCutoutKey`, `paintMissing`, `ICON_COLS`; `paintIconAtlas` in `icons.js`.
- Toolkit additions for MOBS/FX: `rgb`, `shade`, `mix`, `lum`, `ramp`, `tnoise` (anisotropic tiling noise), `tfbm`, `poissonSeeds`, and `PixelCanvas.{setRGB, blend, paintGrid, outlineShade, bleed, clone, flipX, opaqueCount}`. `PixelCanvas.set` now caches hex parsing (same output).

### Spec conflicts / interpretations (not silently resolved)

- §5.1 item 6 crack stages: "the first ceil(60·(s+1)/10) pixels of 3 random-walk crack paths" is read as a **combined** count across the three paths (interleaved, so all three grow each stage): stage 0 = 6 core pixels, stage 9 = 60.
- §5.1 item 8 mentions "palettes and recipes in the research notes"; no research notes are in the repo, so all palettes are original and live in the painter modules (wool, beds, dyes and stained glass derive from `COLOR_HEX`).
- §5.1 item 8 "4-6 palette colours per texture": base palettes are 4-6 colours; shading adds a few, and the unit test bounds each static texture at 28 unique colours (actual max 25, bookshelf).

### Remaining

- P0/P1/P2: none open for this lane. `terrain-render` is PENDING only because worldgen, world, lighting, mesher and renderer are still stubs here; re-check the in-world look (leaves at distance with mipmaps, water/lava animation) once CORE-C/D merge.
- Polish ideas if time allows: more distinct iron vs. gold armour silhouettes; per-flower leaf variety.

### Blockers

None.

### New events or API members

No events. API additions listed above.

### LEAD requests

- None required. Optional: `src/main.js installFavicon()` could use `game.icons` (e.g. the grass block icon) once it exists, instead of its hand-drawn 16 px grass.
- Tool files `tools/corea-preview.mjs`, `tools/corea-diorama.mjs`, `tools/corea-diorama-page.js` are lane-prefixed review aids outside §3.1's table; keep or drop them at integration.
