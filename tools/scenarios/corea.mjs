// OWNER LANE: CORE-A. Smoke scenarios for textures and item icons (SPEC §5.1, §13.2).
// Screenshots: .tmp/smoke-<tag>-icons.png (whole icon atlas as the UI shows it) and
// .tmp/smoke-<tag>-textures.png (every texture layer, frame 0, at 3x).
import { ITEM_LIST } from '../../src/data/items.js';
import { REQUIRED_TEXTURE_KEYS } from '../../src/core/registry.js';
import { buildTextures } from '../../src/textures/textures.js';

function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export default [
  {
    name: 'corea-icons', requires: ['textures', 'icons'],
    async run(t) {
      const keys = ITEM_LIST.map((d) => d.key);
      const r = await t.eval((keys) => {
        const g = window.__game.game;
        const ic = g.icons;
        const ctx = ic.canvas.getContext('2d');
        const thin = [];
        const missing = [];
        for (const k of keys) {
          if (!ic.has(k)) { missing.push(k); continue; }
          const rc = ic.rect(k);
          const d = ctx.getImageData(rc.x, rc.y, rc.w, rc.h).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
          if (n < 40) thin.push(`${k}:${n}`);
        }
        const el = ic.element('diamond_pickaxe', 64);
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const crisp = cs.imageRendering;
        const sized = el.getBoundingClientRect().width;
        el.remove();
        const p16 = ic.pixels16('apple');
        // review sheet: every icon at 48 px on inventory-grey slots (UI style)
        const sheet = document.createElement('div');
        sheet.id = 'corea-sheet';
        Object.assign(sheet.style, { position: 'fixed', inset: '0', zIndex: 99999, background: '#c6c6c6', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: '2px', padding: '4px', overflow: 'hidden' });
        for (const k of keys) {
          const slot = document.createElement('div');
          Object.assign(slot.style, { width: '52px', height: '52px', background: '#8b8b8b', boxShadow: 'inset 2px 2px #373737, inset -2px -2px #ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' });
          slot.appendChild(ic.element(k, 48));
          sheet.appendChild(slot);
        }
        document.body.appendChild(sheet);
        return { count: ic.index.size, thin, missing, crisp, sized, p16: p16.length, texMs: g.textures.buildMs, iconMs: ic.buildMs, cols: ic.cols, rows: ic.rows, urlLen: ic.url.length };
      }, keys);
      t.note('textureBuildMs', Math.round(r.texMs * 10) / 10);
      t.note('iconBuildMs', Math.round(r.iconMs * 10) / 10);
      t.note('atlasKB', Math.round(r.urlLen / 1024));
      await t.call('waitFrames', 2);
      await t.shot('icons');
      await t.eval(() => document.getElementById('corea-sheet').remove());
      t.assert(r.missing.length === 0, `items without an icon: ${r.missing.join(', ')}`);
      t.assert(r.count === keys.length, `icon index covers every item (${r.count} / ${keys.length})`);
      t.assert(r.thin.length === 0, `near-empty icon cells: ${r.thin.join(', ')}`);
      t.assert(r.crisp === 'pixelated', `icons render pixelated (got ${r.crisp})`);
      t.assert(r.sized === 64, `element(key, 64) is 64 px (got ${r.sized})`);
      t.assert(r.p16 === 16 * 16 * 4, 'pixels16 gives a 16x16 RGBA sprite');
      t.assert(r.iconMs < 400, `buildItemIcons fast enough (${r.iconMs.toFixed(1)} ms; budget 150 ms on a mid laptop)`);
      t.assert(r.texMs < 300, `buildTextures fast enough (${r.texMs.toFixed(1)} ms; budget 60 ms on a mid laptop)`);
    },
  },
  {
    name: 'corea-textures', requires: ['textures'],
    async run(t) {
      const r = await t.eval(() => {
        const ts = window.__game.game.textures;
        const keys = [...ts.index.keys()];
        const cols = 20, s = 3, cell = 16 * s + 2;
        const c = document.createElement('canvas');
        c.width = cols * cell; c.height = Math.ceil(keys.length / cols) * cell;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.fillStyle = '#4a6a9a'; x.fillRect(0, 0, c.width, c.height);
        const tile = document.createElement('canvas'); tile.width = 16; tile.height = 16;
        const tx = tile.getContext('2d');
        keys.forEach((k, i) => {
          const L = ts.layer(k);
          tx.putImageData(new ImageData(new Uint8ClampedArray(ts.data.subarray(L * 1024, L * 1024 + 1024)), 16, 16), 0, 0);
          x.drawImage(tile, (i % cols) * cell + 1, Math.floor(i / cols) * cell + 1, 16 * s, 16 * s);
        });
        Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, imageRendering: 'pixelated' });
        c.id = 'corea-tex';
        document.body.appendChild(c);
        return { keys, count: ts.count, anim: [...ts.animated.entries()], missingLayer: ts.layer('no_such_key') === ts.layer('missing') };
      });
      await t.call('waitFrames', 2);
      await t.shot('textures');
      await t.eval(() => document.getElementById('corea-tex').remove());
      t.assert(JSON.stringify(r.keys) === JSON.stringify([...REQUIRED_TEXTURE_KEYS]), 'layer keys are exactly REQUIRED_TEXTURE_KEYS in sorted order');
      t.assert(r.count <= 256, `layer count within WebGL2 minimum (${r.count})`);
      t.assert(r.missingLayer, 'unknown keys map to the missing layer');
      t.note('layers', r.count);
    },
  },
  {
    name: 'corea-determinism', requires: ['textures'],
    async run(t) {
      const page = await t.eval(() => {
        const g = window.__game.game;
        const d = g.textures.data;
        let h = 0x811c9dc5;
        for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
        // the low device preset (SwiftShader, Intel HD) binds fast leaves without changing the saved setting
        const q = g.renderer && g.renderer.quality;
        return { hash: h >>> 0, fast: q && typeof q.fastLeaves === 'boolean' ? q.fastLeaves : !g.settings.fancyLeaves };
      });
      const node = buildTextures({ fastLeaves: page.fast });
      const nh = fnv(node.data);
      t.note('hash', page.hash.toString(16));
      t.assert(page.hash === nh, `browser and Node textures are byte-identical (${page.hash.toString(16)} vs ${nh.toString(16)})`);
    },
  },
];
