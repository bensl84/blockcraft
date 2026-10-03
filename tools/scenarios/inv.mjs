// OWNER: FEATURE-INV. Smoke scenarios for the HUD, creative picker, crafting (2x2, 3x3, recipe book), furnace,
// chest, slot click semantics and container drops (SPEC §8.2 acceptance). Real pointer input goes through
// Playwright's page.mouse at the slot rectangles reported by game.invui.slotRect / screen.tileRect.
// Scenarios that need another lane list it in `requires` so they report PENDING while that lane is a stub.

const FLAT = { preset: 'flat', seed: 7, mode: 'creative', difficulty: 'peaceful' };
const SURV = { preset: 'flat', seed: 7, mode: 'survival', difficulty: 'easy' };

const inv = (t) => t.eval(() => window.__game.game.inventory.slots.map((s) => (s ? { item: s.item, count: s.count, damage: s.damage || 0 } : null)));
const cursor = (t) => t.eval(() => { const c = window.__game.game.inventory.cursor; return c ? { item: c.item, count: c.count } : null; });
const countOf = async (t, item) => (await inv(t)).reduce((n, s) => n + (s && s.item === item ? s.count : 0), 0);
const getSlot = (t, sid) => t.eval((sid) => { const s = window.__game.game.invui.screen; const v = s && s.getSlot(sid); return v ? { item: v.item, count: v.count } : null; }, sid);

async function rectOf(t, sid) {
  const r = await t.eval((sid) => window.__game.game.invui.slotRect(sid), sid);
  t.assert(r, `slot ${sid} is on screen`);
  return r;
}
async function clickSid(t, sid, button = 'left', opts = {}) {
  const r = await rectOf(t, sid);
  if (t.args.touch && button === 'left' && !opts.shift) { await t.page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await t.call('waitFrames', 1); return; }
  if (opts.shift) await t.page.keyboard.down('Shift');
  await t.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, { button });
  if (opts.shift) await t.page.keyboard.up('Shift');
  await t.call('waitFrames', 1);
}
/** Real mouse (or touchscreen) tap on the centre of the visible top/front of block cell c. */
async function tapBlock(t, c) {
  const p = await t.call('pos');
  // aim at the face centre nearest the eye so the ray can't graze a neighbour
  const ex = p.x, ez = p.z;
  const tx = c.x + 0.5 + Math.max(-0.45, Math.min(0.45, (ex - (c.x + 0.5)) * 0.2));
  const tz = c.z + 0.5 + Math.max(-0.45, Math.min(0.45, (ez - (c.z + 0.5)) * 0.2));
  const n = await t.call('worldToNdc', tx, c.y + 0.6, tz);
  t.assert(n.onScreen, 'block is on screen');
  const vp = await t.eval(() => ({ w: innerWidth, h: innerHeight }));
  const px = ((n.x + 1) / 2) * vp.w, py = ((1 - n.y) / 2) * vp.h;
  if (t.args.touch) await t.page.touchscreen.tap(px, py);
  else { await t.page.mouse.move(px, py); await t.page.mouse.down(); await t.call('sleep', 60); await t.page.mouse.up(); }
  await t.call('waitTicks', 3);
}
/** Inventory index of the first stack of `item` (-1 if none). */
const indexOf = async (t, item) => (await inv(t)).findIndex((s) => s && s.item === item);
/** A free cell next to the player at feet level on the flat world. */
async function nearCell(t, dx = 2, dz = -2) {
  const p = await t.call('pos');
  return { x: Math.floor(p.x) + dx, y: 4, z: Math.floor(p.z) + dz };
}

export default [
  {
    name: 'inv-hud',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('waitFrames', 3);
      const hud = await t.eval(() => {
        const slots = [...document.querySelectorAll('#hud .inv-hotbar .inv-hb-slot')];
        const bp = document.querySelector('#hud .inv-backpack');
        const r = slots.map((s) => s.getBoundingClientRect());
        return {
          n: slots.length, w: r[0] && r[0].width, bottom: Math.max(...r.map((x) => x.bottom)), vh: innerHeight,
          selected: slots.findIndex((s) => s.classList.contains('inv-selected')),
          bp: bp && bp.getBoundingClientRect().width,
          icons: slots.filter((s) => s.querySelector('.bc-icon')).length,
          hearts: getComputedStyle(document.querySelector('#hud .inv-stats')).display,
        };
      });
      t.note('hud', hud);
      t.assert(hud.n === 9, '9 hotbar slots');
      t.assert(hud.w >= 64, `kid hotbar slot >= 64 px (${hud.w})`);
      t.assert(hud.vh - hud.bottom >= 16, 'hotbar at least 16 px above the bottom edge');
      t.assert(hud.selected === 0, 'slot 1 selected at start');
      t.assert(hud.bp >= 64, `backpack button >= 64 px (${hud.bp})`);
      t.assert(hud.icons === 9, 'kid creative hotbar shows 9 icons');
      t.assert(hud.hearts === 'none', 'no hearts in creative');
      // survival rows hidden in creative, and never a stray air bubble on dry land (children of a hidden row)
      t.assert(await t.eval(() => [...document.querySelectorAll('#hud .inv-stats .inv-sprite')].every((e) => !e.checkVisibility({ visibilityProperty: true }))), 'no hearts/bubbles visible in creative');
      // keys 1-9 and tapping a slot (pointerdown)
      await t.eval(() => window.__game.game.events.emit('input:action', { action: 'hotbar3', down: true, source: 'test' }));
      t.assert((await t.call('selected')).slot === 2, 'hotbar3 selects slot 3');
      const r = await t.eval(() => window.__game.game.hud.slotRect(6));
      await t.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
      await t.call('waitFrames', 2);
      t.assert((await t.call('selected')).slot === 6, 'tapping slot 7 selects it');
      const sel = await t.eval(() => document.querySelector('#hud .inv-hb-slot.inv-selected').dataset.slot);
      t.assert(sel === '6', 'yellow selection follows');
      const pop = await t.eval(() => { const n = document.querySelector('#hud .inv-name-pop'); return { text: n.textContent, show: n.classList.contains('inv-show') }; });
      t.assert(pop.show && pop.text === 'Oak Door', `name popup shows the selected item (${JSON.stringify(pop)})`);
      // counts + durability bars
      await t.eval(() => { const g = window.__game.game; g.inventory.set(8, { item: 'iron_pickaxe', count: 1, damage: 200 }); g.inventory.set(7, { item: 'cobblestone', count: 37 }); });
      await t.call('waitFrames', 2);
      const marks = await t.eval(() => {
        const s = document.querySelectorAll('#hud .inv-hb-slot');
        return { count: s[7].querySelector('.bc-count') && s[7].querySelector('.bc-count').textContent, dura: !!s[8].querySelector('.bc-durability'), w: s[8].querySelector('.bc-durability i') && s[8].querySelector('.bc-durability i').style.width };
      });
      t.assert(marks.count === '37', 'stack count drawn');
      t.assert(marks.dura && marks.w === '20%', `durability bar 20% (${marks.w})`);
      await t.shot('inv-hud-creative');
      // survival rows
      await t.call('setMode', 'survival');
      await t.eval(() => { const p = window.__game.game.player; p.health = 7; p.food = 13; p.eyeInWater = true; p.air = 150; p.xpLevel = 3; p.xpProgress = 0.4; });
      await t.call('waitFrames', 3);
      const rows = await t.eval(() => {
        const q = (n) => [...document.querySelectorAll(`#hud [data-hud="${n}"] .inv-sprite`)].map((s) => s.dataset.sprite);
        return { hearts: q('hearts'), food: q('food'), air: [...document.querySelectorAll('#hud [data-hud="air"] .inv-sprite')].filter((s) => s.style.visibility !== 'hidden').length, xp: document.querySelector('#hud .inv-xp-level').textContent, statsShown: getComputedStyle(document.querySelector('#hud .inv-stats')).display !== 'none' };
      });
      t.note('rows', { hearts: rows.hearts.join(','), air: rows.air });
      t.assert(rows.statsShown, 'survival rows shown');
      t.assert(rows.hearts.filter((s) => s === 'heart_full').length === 3 && rows.hearts[3] === 'heart_half', '7 HP = 3.5 hearts');
      t.assert(rows.food.filter((s) => s === 'food_full').length === 6 && rows.food[6] === 'food_half', '13 food = 6.5 shanks');
      t.assert(rows.air === 5, `150 air = 5 bubbles (${rows.air})`);
      t.assert(rows.xp === '3', 'xp level shown');
      await t.eval(() => { window.__game.game.player.eyeInWater = false; });
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => [...document.querySelectorAll('#hud [data-hud="air"] .inv-sprite')].every((e) => !e.checkVisibility({ visibilityProperty: true }))), 'air bubbles hidden once the eye leaves the water');
      await t.eval(() => { const g = window.__game.game; g.player.health = 3; g.events.emit('player:hurt', { amount: 4, cause: 'test', health: 3 }); });
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => document.querySelector('#hud [data-hud="hearts"]').classList.contains('inv-low')), 'hearts shake at <= 4 HP');
      await t.call('sleep', 500);
      await t.shot('inv-hud-survival');
      // toast + hidden while a container is open
      await t.eval(() => window.__game.game.events.emit('toast', { text: 'Respawn point set', icon: 'red_bed' }));
      await t.call('waitFrames', 2);
      t.assert(await t.eval(() => document.querySelector('.inv-toast').classList.contains('inv-show')), 'toast shown');
      await t.call('openInventory');
      t.assert(await t.eval(() => document.getElementById('hud').classList.contains('inv-off')), 'HUD hidden under a container screen');
      await t.call('closeUI');
      await t.call('waitFrames', 2);
      t.assert(!(await t.eval(() => document.getElementById('hud').classList.contains('inv-off'))), 'HUD back after closing');
      // classic scheme: crosshair
      await t.call('setSetting', 'controls', 'classic');
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => !!document.querySelector('#hud .inv-crosshair')), 'crosshair in the classic scheme');
      await t.call('setSetting', 'controls', 'kid');
      await t.call('waitFrames', 3);
      t.assert(await t.eval(() => !document.querySelector('#hud .inv-crosshair')), 'no crosshair in the kid scheme');
    },
  },
  {
    name: 'inv-creative-pick',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('selectSlot', 0);
      t.assert(await t.call('openInventory') === 'creative', 'E opens the picker in creative');
      const info = await t.eval(() => {
        const tabs = [...document.querySelectorAll('[data-screen="creative"] .inv-tab')].map((b) => b.getBoundingClientRect().width);
        const tiles = [...document.querySelectorAll('[data-screen="creative"] .inv-tile')].map((b) => b.getBoundingClientRect().width);
        return { tabs, minTile: Math.min(...tiles), n: tiles.length, state: window.__game.game.invui.screen.state() };
      });
      t.note('picker', { tabs: info.tabs.length, minTile: info.minTile, perPage: info.state.perPage, tab: info.state.tab });
      t.assert(info.tabs.length === 8 && Math.min(...info.tabs) >= 64, '8 picture tabs, >= 64 px');
      t.assert(info.minTile >= 72 && info.minTile <= 96, `tiles 72-96 px (${info.minTile})`);
      await t.shot('inv-picker');
      // Colours tab, then tap the red wool tile with the real mouse
      let r = await t.eval(() => window.__game.game.invui.screen.tabRect('colors'));
      await t.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
      await t.call('waitFrames', 2);
      r = await t.eval(() => window.__game.game.invui.screen.tileRect('red_wool'));
      t.assert(r, 'red wool tile on the Colours page');
      if (t.args.touch) await t.page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
      else await t.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
      await t.call('waitFrames', 2);
      const sel = await t.call('selected');
      t.assert(sel.slot === 0 && sel.item === 'red_wool' && sel.count === 64, `red wool in the selected slot (${JSON.stringify(sel)})`);
      t.assert(await t.call('eventCount', 'ui:click') >= 2, 'ui:click emitted');
      await t.shot('inv-picker-colors');
      // paging: Colours (wool, glass, carpet, dyes) has more than one page at 1280x720
      const p1 = await t.eval(() => window.__game.game.invui.screen.state());
      t.note('colors', { items: p1.items, pages: p1.pages });
      t.assert(p1.tab === 'colors' && p1.pages > 1, 'Colours tab pages');
      {
        const nb = await t.eval(() => { const b = document.querySelector('[data-screen="creative"] [data-action="next"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
        t.assert(nb.w >= 64, 'page arrow >= 64 px');
        await t.page.mouse.click(nb.x + nb.w / 2, nb.y + nb.h / 2);
        await t.call('waitFrames', 2);
        const p2 = await t.eval(() => window.__game.game.invui.screen.state());
        t.assert(p2.page === 1 && p2.visible[0] !== p1.visible[0], 'next page shows other items');
      }
      // trash the selected slot, pick an unstackable tool (count 1), every tab reachable and non-empty
      const ok = await t.eval(() => {
        const g = window.__game.game, s = g.invui.screen;
        g.inventory.selectSlot(3);
        s.setTab(4); s.pick('diamond_sword');
        const sword = g.inventory.get(3);
        document.querySelector('[data-screen="creative"] [data-action="trash"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const tabs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { s.setTab(i); return s.state().items; });
        return { sword, trashed: g.inventory.get(3), tabs };
      });
      t.assert(ok.sword && ok.sword.count === 1, 'unstackable item comes as 1');
      t.assert(ok.trashed === null, 'trash empties the selected slot');
      t.assert(ok.tabs.every((n) => n > 0), `every tab has items (${ok.tabs.join(',')})`);
      // grown-up toggle opens the survival-style inventory
      await t.eval(() => document.querySelector('[data-screen="creative"] [data-action="survival-inventory"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      await t.call('waitFrames', 2);
      t.assert(await t.call('uiOpen') === 'inventory', 'backpack toggle opens the inventory screen');
      await t.call('closeUI');
    },
  },
  {
    name: 'inv-craft-planks',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      await t.call('give', 'oak_log', 1);
      t.assert(await t.call('openInventory') === 'inventory', 'survival inventory opens');
      const i = await indexOf(t, 'oak_log');
      await clickSid(t, 'p' + i);
      t.assert((await cursor(t)).item === 'oak_log', 'log picked up onto the cursor');
      await clickSid(t, 'c0');
      const out = await getSlot(t, 'out');
      t.assert(out && out.item === 'oak_planks' && out.count === 4, `2x2 output shows 4 planks (${JSON.stringify(out)})`);
      await t.shot('inv-craft-planks');
      await clickSid(t, 'out');
      const c = await cursor(t);
      t.assert(c && c.item === 'oak_planks' && c.count === 4, 'planks taken onto the cursor');
      t.assert(await getSlot(t, 'c0') === null, 'log consumed');
      t.assert(await t.call('eventCount', 'craft') >= 1, 'craft event');
      await clickSid(t, 'p20');
      t.assert(await countOf(t, 'oak_planks') === 4, '4 planks in the inventory');
      // closing returns anything left in the grid
      await t.call('give', 'dirt', 3);
      const d = await indexOf(t, 'dirt');
      await clickSid(t, 'p' + d);
      await clickSid(t, 'c3');
      await t.call('closeUI');
      t.assert(await countOf(t, 'dirt') === 3, 'grid contents return to the inventory on close');
    },
  },
  {
    name: 'inv-slot-clicks',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      await t.eval(() => { const g = window.__game.game; g.inventory.clear(); g.inventory.set(9, { item: 'dirt', count: 10 }); g.inventory.set(0, { item: 'sand', count: 5 }); });
      await t.call('openInventory');
      await clickSid(t, 'p9', 'right');
      t.assert((await cursor(t)).count === 5 && (await getSlot(t, 'p9')).count === 5, 'right click takes half');
      // left-drag the 5 dirt across 3 empty slots: 1 each... (5/3 = 1 each, 2 stay held)
      const a = await rectOf(t, 'p10'), b = await rectOf(t, 'p11'), c = await rectOf(t, 'p12');
      await t.page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
      await t.page.mouse.down();
      await t.page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 4 });
      await t.page.mouse.move(c.x + c.w / 2, c.y + c.h / 2, { steps: 4 });
      await t.page.mouse.up();
      await t.call('waitFrames', 1);
      const after = await inv(t);
      t.assert(after[10].count === 1 && after[11].count === 1 && after[12].count === 1, `drag splits evenly (${[after[10], after[11], after[12]].map((s) => s && s.count)})`);
      t.assert((await cursor(t)).count === 2, 'remainder stays held');
      await clickSid(t, 'p13', 'right');
      t.assert((await getSlot(t, 'p13')).count === 1 && (await cursor(t)).count === 1, 'right click places one');
      await clickSid(t, 'p9');
      t.assert((await getSlot(t, 'p9')).count === 6 && !(await cursor(t)), 'left click merges the held stack');
      // shift-click: hotbar -> main and back
      await clickSid(t, 'p0', 'left', { shift: true });
      const s1 = await inv(t);
      t.assert(!s1[0] && s1.slice(9).some((s) => s && s.item === 'sand' && s.count === 5), 'shift-click moves hotbar -> main');
      const j = s1.findIndex((s, k) => k >= 9 && s && s.item === 'sand');
      await clickSid(t, 'p' + j, 'left', { shift: true });
      t.assert((await inv(t)).slice(0, 9).some((s) => s && s.item === 'sand'), 'shift-click moves main -> hotbar');
      // swap with a different item
      await t.eval(() => window.__game.game.inventory.set(14, { item: 'stone', count: 2 }));
      await clickSid(t, 'p9');
      await clickSid(t, 'p14');
      const sw = { slot: await getSlot(t, 'p14'), held: await cursor(t) };
      t.assert(sw.slot.item === 'dirt' && sw.slot.count === 6 && sw.held.item === 'stone' && sw.held.count === 2, `different stacks swap (${JSON.stringify(sw)})`);
      await clickSid(t, 'p9');
      t.assert((await getSlot(t, 'p9')).item === 'stone' && !(await cursor(t)), 'held stone placed into the empty slot');
      // keep something held, then close: it goes back into the inventory
      await clickSid(t, 'p14');
      await t.call('closeUI');
      t.assert(await t.call('uiOpen') === null && !(await cursor(t)), 'held stack returned on close');
    },
  },
  {
    name: 'inv-recipe-book',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      await t.call('give', 'oak_log', 3);
      await t.call('openInventory');
      const book = await t.eval(() => [...document.querySelectorAll('[data-panel="book"] .inv-recipe')].map((b) => ({ item: b.dataset.item, w: b.getBoundingClientRect().width, table: b.classList.contains('inv-needs-table') })));
      t.note('book', book.map((b) => b.item).join(','));
      t.assert(book.some((b) => b.item === 'oak_planks'), 'planks picture in the book');
      t.assert(book.every((b) => b.w >= 64), 'recipe pictures >= 64 px');
      await t.shot('inv-recipe-book');
      // tap the planks picture with the real mouse
      let r = await t.eval(() => { const b = document.querySelector('[data-panel="book"] [data-item="oak_planks"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      await t.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
      await t.call('waitFrames', 2);
      t.assert(await countOf(t, 'oak_planks') === 4 && await countOf(t, 'oak_log') === 2, 'tap = 1 log -> 4 planks');
      // now the crafting table and sticks are craftable in 2x2
      t.assert(await t.eval(() => window.__game.game.invui.recipeTap('crafting_table')), 'crafting table picture');
      t.assert(await countOf(t, 'crafting_table') === 1 && await countOf(t, 'oak_planks') === 0, 'table crafted from 4 planks');
      await t.eval(() => window.__game.game.invui.recipeTap('oak_planks'));
      await t.eval(() => window.__game.game.invui.recipeTap('oak_planks'));
      t.assert(await countOf(t, 'oak_planks') === 8, '8 planks');
      // a 3x3 recipe (chest) shows as "needs table" and is refused in the 2x2 grid
      const chest = await t.eval(() => { const b = document.querySelector('[data-panel="book"] [data-item="chest"]'); return b && b.classList.contains('inv-needs-table'); });
      t.assert(chest === true, 'chest shows the crafting-table badge');
      t.assert(!(await t.eval(() => window.__game.game.invui.recipeTap('chest'))), 'chest refused in 2x2');
      t.assert((await t.call('events', 'toast', 1))[0].payload.icon === 'crafting_table', 'toast tells (with a picture) that a table is needed');
      await t.shot('inv-recipe-book-after');
      await t.call('closeUI');
    },
  },
  {
    name: 'inv-table-3x3',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      const c = await nearCell(t);
      t.assert(await t.call('setBlock', c.x, c.y, c.z, 'crafting_table'), 'table placed');
      await t.call('give', 'cobblestone', 6);
      await t.call('give', 'stick', 4);
      t.assert(await t.call('openScreen', 'crafting', c) === 'crafting', 'crafting screen opens');
      const ids = await t.eval(() => window.__game.game.invui.screen.slotIds());
      t.assert(['c0', 'c8', 'out'].every((s) => ids.includes(s)), '3x3 grid + output');
      // mirrored stone axe by real clicks: cobble at c1,c2,c5 ; sticks at c4,c7
      const cob = await indexOf(t, 'cobblestone');
      await clickSid(t, 'p' + cob); // hold 6 cobble
      for (const s of ['c1', 'c2', 'c5']) await clickSid(t, s, 'right');
      await clickSid(t, 'p' + cob); // put the rest back
      const st = await indexOf(t, 'stick');
      await clickSid(t, 'p' + st);
      for (const s of ['c4', 'c7']) await clickSid(t, s, 'right');
      await clickSid(t, 'p' + st);
      const out = await getSlot(t, 'out');
      t.assert(out && out.item === 'stone_axe', `mirrored axe recognised (${JSON.stringify(out)})`);
      await t.shot('inv-table-3x3');
      await clickSid(t, 'out', 'left', { shift: true });
      t.assert(await countOf(t, 'stone_axe') === 1, 'shift-click output -> inventory');
      const grid = await t.eval(() => window.__game.game.invui.screen.craft.grid.filter(Boolean).length);
      t.assert(grid === 0 && await countOf(t, 'cobblestone') === 3 && await countOf(t, 'stick') === 2, 'shift-craft consumed the grid (no duplication)');
      // recipe book in 3x3: stone pickaxe
      t.assert(await t.eval(() => window.__game.game.invui.recipeTap('stone_pickaxe')), 'pickaxe picture');
      const after = (await inv(t)).filter(Boolean);
      t.assert(await countOf(t, 'stone_pickaxe') === 1 && await countOf(t, 'cobblestone') === 0, `pickaxe crafted (${JSON.stringify(after)})`);
      await t.call('closeUI');
    },
  },
  {
    name: 'inv-furnace',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      const c = await nearCell(t);
      t.assert(await t.call('setBlock', c.x, c.y, c.z, 'furnace', 1), 'furnace placed (facing east)');
      await t.call('give', 'sand', 2);
      // 2 coal: real-time ticks may light the furnace (eating one coal) before the assert below reads the fuel slot
      await t.call('give', 'coal', 2);
      t.assert(await t.call('openScreen', 'furnace', c) === 'furnace', 'furnace screen opens');
      await clickSid(t, 'p' + await indexOf(t, 'sand'), 'left', { shift: true });
      await clickSid(t, 'p' + await indexOf(t, 'coal'), 'left', { shift: true });
      t.assert((await getSlot(t, 'fi')).item === 'sand' && (await getSlot(t, 'ff')).item === 'coal', 'shift-click routes sand -> input, coal -> fuel');
      await t.call('runTicks', 1);
      t.assert(await t.call('getBlock', c.x, c.y, c.z) === 'furnace_lit', 'furnace lights');
      t.assert(await t.call('getState', c.x, c.y, c.z) === 1, 'facing kept');
      await t.call('runTicks', 100);
      await t.call('waitFrames', 2);
      const prog = await t.eval(() => { const s = window.__game.game.invui.screen; return { arrow: parseInt(s.arrowFill.style.width, 10), flame: parseInt(s.flameFill.style.height, 10) }; });
      t.note('progress', prog);
      t.assert(prog.arrow > 0, 'progress arrow grows');
      t.assert(prog.flame > 0, 'flame shows the fuel burning');
      await t.shot('inv-furnace');
      // finish synchronously so real-time ticks cannot interleave: glass appears exactly at cook tick 200
      const exact = await t.eval((c) => {
        const g = window.__game.game, be = g.world.getBlockEntity(c.x, c.y, c.z);
        g.stepTicks(199 - be.cookTicks);
        const before = be.output ? be.output.count : 0, cook = be.cookTicks;
        g.stepTicks(1);
        return { before, cook };
      }, c);
      t.assert(exact.before === 0 && exact.cook === 199, `no glass at cook tick 199 (${JSON.stringify(exact)})`);
      await t.call('waitFrames', 1);
      const fo = await getSlot(t, 'fo');
      t.assert(fo && fo.item === 'glass' && fo.count === 1, `glass after 200 ticks (${JSON.stringify(fo)})`);
      t.assert(await t.call('eventCount', 'smelt') >= 1, 'smelt event');
      await clickSid(t, 'fo');
      t.assert((await cursor(t)).item === 'glass', 'glass taken from the output');
      await t.call('closeUI');
      t.assert(await countOf(t, 'glass') === 1, 'held glass returns to the inventory');
      // keeps cooking with the screen closed
      await t.call('runTicks', 200);
      const be = await t.eval((c) => window.__game.game.world.getBlockEntity(c.x, c.y, c.z), c);
      t.assert(be && be.output && be.output.count === 1 && !be.input, `second sand smelted while closed (${JSON.stringify(be)})`);
    },
  },
  {
    name: 'inv-chest-unload',
    requires: [],
    async run(t) {
      await t.call('startWorld', SURV);
      const home = await t.call('pos');
      const c = await nearCell(t);
      await t.call('setBlock', c.x, c.y, c.z, 'chest');
      await t.call('give', 'diamond', 5);
      await t.call('openScreen', 'chest', c);
      await clickSid(t, 'p' + await indexOf(t, 'diamond'), 'left', { shift: true });
      t.assert((await getSlot(t, 'k0')).count === 5, 'shift-click into the chest');
      await t.shot('inv-chest');
      await t.call('closeUI');
      // unload the column (20 columns away) and come back: the chest contents come back with it
      const cx = c.x >> 4, cz = c.z >> 4;
      await t.call('teleport', home.x + 320, home.y, home.z);
      t.assert(await t.waitFor(([cx, cz]) => !window.__game.game.world.getColumn(cx, cz), [cx, cz], 10000), 'column unloaded');
      await t.call('teleport', home.x, home.y, home.z);
      t.assert(await t.waitFor(([cx, cz]) => window.__game.game.world.isColumnLoaded(cx, cz), [cx, cz], 10000), 'column back');
      await t.call('openScreen', 'chest', c);
      const k0 = await getSlot(t, 'k0');
      t.assert(k0 && k0.item === 'diamond' && k0.count === 5, `chest contents survive unload (${JSON.stringify(k0)})`);
      await t.call('closeUI');
    },
  },
  {
    name: 'inv-chest-persist',
    requires: ['save', 'menus'],
    async run(t) {
      await t.call('startWorld', SURV);
      const c = await nearCell(t);
      await t.call('setBlock', c.x, c.y, c.z, 'chest');
      await t.call('give', 'emerald', 7);
      await t.call('openScreen', 'chest', c);
      await clickSid(t, 'p' + await indexOf(t, 'emerald'), 'left', { shift: true });
      await t.call('closeUI');
      const meta = await t.call('meta');
      t.assert(await t.call('save'), 'saved');
      await t.call('exitToTitle');
      await t.eval(async (id) => { const g = window.__game.game; const d = await g.save.loadWorld(id); await g.startWorld(d); }, meta.id);
      await t.call('openScreen', 'chest', c);
      const k0 = await getSlot(t, 'k0');
      t.assert(k0 && k0.item === 'emerald' && k0.count === 7, 'chest contents survive save + load');
      await t.call('closeUI');
    },
  },
  {
    name: 'inv-container-drop',
    requires: [],
    async run(t) {
      await t.call('startWorld', FLAT);
      const c = await nearCell(t);
      await t.call('setBlock', c.x, c.y, c.z, 'chest');
      await t.eval((c) => {
        const g = window.__game.game;
        g.ui.open('chest', c);
        const be = g.world.getBlockEntity(c.x, c.y, c.z);
        be.items[0] = { item: 'apple', count: 3 }; be.items[26] = { item: 'stick', count: 9 };
        g.ui.close();
      }, c);
      const ok = await t.eval((c) => window.__game.game.interaction.breakBlock(c.x, c.y, c.z, { by: 'test' }), c);
      t.assert(ok, 'chest broken through interaction.breakBlock');
      const dropped = await t.eval(() => window.__game.game.invui.lastDropped);
      t.assert(dropped.length === 2 && dropped.some((s) => s.item === 'apple' && s.count === 3), `contents dropped in creative too (${JSON.stringify(dropped)})`);
      if (!t.stubs.includes('items')) {
        const items = (await t.call('entities')).filter((e) => e.type === 'item');
        t.assert(items.length >= 2, 'item entities spawned');
      }
      // furnace too
      await t.call('setBlock', c.x, c.y, c.z, 'furnace');
      await t.eval((c) => { const g = window.__game.game; g.ui.open('furnace', c); const be = g.world.getBlockEntity(c.x, c.y, c.z); be.input = { item: 'sand', count: 4 }; be.fuel = { item: 'coal', count: 2 }; be.output = { item: 'glass', count: 1 }; g.ui.close(); }, c);
      await t.eval((c) => window.__game.game.interaction.breakBlock(c.x, c.y, c.z, { by: 'test' }), c);
      t.assert((await t.eval(() => window.__game.game.invui.lastDropped)).length === 3, 'furnace input, fuel and output dropped');
    },
  },
  {
    name: 'inv-blockuse',
    requires: ['input', 'player', 'raycast', 'interaction'],
    async run(t) {
      // Kid survival: a real mouse tap on the crafting table opens the 3x3 screen; the big red close button closes it.
      await t.call('startWorld', SURV);
      const c = await nearCell(t, 0, -2);
      await t.call('setBlock', c.x, c.y, c.z, 'crafting_table');
      await t.call('setLook', 0, -25);
      await tapBlock(t, c);
      t.assert(await t.waitFor(() => window.__game.uiOpen() === 'crafting', null, 3000), 'tapping a crafting table opens the 3x3 screen');
      await t.shot('inv-blockuse-table');
      const cb = await t.eval(() => { const r = document.querySelector('.inv-close').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await t.page.mouse.click(cb.x, cb.y);
      t.assert(await t.waitFor(() => window.__game.uiOpen() == null, null, 2000), 'red close button closes the screen');
      // the close tap must not reach the world (no block broken / placed behind the button)
      t.assert(await t.call('getBlock', c.x, c.y, c.z) === 'crafting_table', 'table still there after closing');
      // Kid creative: tapping a chest with an empty hand opens it instead of breaking it
      await t.call('setMode', 'creative');
      await t.eval(() => window.__game.game.inventory.set(window.__game.game.inventory.selected, null));
      await t.call('setBlock', c.x, c.y, c.z, 'chest');
      await tapBlock(t, c);
      t.assert(await t.waitFor(() => window.__game.uiOpen() === 'chest', null, 3000), 'kid creative tap opens a chest');
      t.assert(await t.call('getBlock', c.x, c.y, c.z) === 'chest', 'the chest was not broken by the tap');
      await t.call('closeUI');
      // Classic: right click (pointer lock aims at the crosshair) opens a furnace
      await t.call('setSetting', 'controls', 'classic');
      try {
        await t.call('setBlock', c.x, c.y, c.z, 'furnace');
        await t.call('lookAt', c.x + 0.5, c.y + 0.5, c.z + 0.5);
        await t.page.mouse.click(640, 360);
        await t.call('sleep', 300);
        const locked = await t.eval(() => window.__game.game.input.pointerLocked);
        if (locked) await t.page.mouse.click(640, 360, { button: 'right' });
        else await t.call('press', 'use');
        t.note('classicLocked', locked);
        t.assert(await t.waitFor(() => window.__game.uiOpen() === 'furnace', null, 3000), 'classic use opens the furnace');
        await t.page.keyboard.press('Escape');
        t.assert(await t.waitFor(() => window.__game.uiOpen() == null, null, 2000), 'Esc closes the furnace');
      } finally {
        await t.call('setSetting', 'controls', 'kid');
      }
    },
  },
  {
    name: 'inv-q-drop',
    requires: ['items', 'input'],
    async run(t) {
      await t.call('startWorld', SURV);
      await t.call('setSetting', 'controls', 'classic');
      await t.call('setSlot', 0, 'cobblestone', 10);
      await t.call('selectSlot', 0);
      await t.call('press', 'drop');
      await t.call('waitTicks', 3);
      t.assert((await t.call('selected')).count === 9, 'Q drops one');
      t.assert((await t.call('entities')).some((e) => e.type === 'item'), 'item entity in the world');
      await t.call('setSetting', 'controls', 'kid');
    },
  },
];
