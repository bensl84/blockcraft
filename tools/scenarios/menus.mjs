// OWNER LANE: FEATURE-MENUS. Smoke scenarios for the menus lane (SPEC §8.4 acceptance). Real Chrome, real clicks
// (page.mouse / page.keyboard) wherever a child would click. Scenarios that need real CORE lanes (thumbnails of a
// rendered world, player position persistence) list those lanes in `requires`, so they report PENDING until the
// core lanes are merged.

const FLAT = { preset: 'flat', seed: 21, mode: 'creative', difficulty: 'peaceful' };

/** Centre of the first element matching sel (throws when missing). */
async function centre(t, sel) {
  const loc = t.page.locator(sel).first();
  await loc.evaluate((e) => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }), null, { timeout: 5000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no visible element ${sel}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
async function clickSel(t, sel) { const c = await centre(t, sel); await t.page.mouse.click(c.x, c.y); }
const ui = (t) => t.call('uiOpen');

/** Pass the parent gate the way a grown-up does: hold 3 s, read the sum, tap the digits, tap the check. */
async function passGate(t) {
  t.assert(await t.waitFor(() => !!document.querySelector('[data-screen=gate]'), null, 3000), 'gate shows');
  const c = await centre(t, '[data-action=gate-hold]');
  await t.page.mouse.move(c.x, c.y);
  await t.page.mouse.down();
  await t.page.waitForTimeout(3250);
  await t.page.mouse.up();
  t.assert(await t.waitFor(() => document.querySelector('[data-screen=gate]')?.dataset.stage === 'answer', null, 2000), 'gate asks the sum after the hold');
  const q = await t.eval(() => document.querySelector('[data-gate=question]').textContent);
  const m = /(\d+)\s*\+\s*(\d+)/.exec(q);
  t.assert(m, `question readable (${q})`);
  for (const d of String(Number(m[1]) + Number(m[2]))) await clickSel(t, `[data-key="${d}"]`);
  await clickSel(t, '[data-key=ok]');
  t.assert(await t.waitFor(() => !document.querySelector('[data-screen=gate]'), null, 2000), 'gate closes after the right answer');
}

/** Every visible interactive element in #ui-root: [{sel, w, h, x, y, right, bottom}] */
async function targets(t) {
  return t.eval(() => {
    const out = [];
    for (const e of document.querySelectorAll('#ui-root button, #ui-root [role=button], #ui-root [role=radio], #ui-root input')) {
      if (e.type === 'file' || e.closest('.bc-hidden')) continue;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      // only things inside the visible part of a scrolling container count for edge checks
      out.push({ sel: e.dataset.action || e.dataset.key || e.dataset.value || e.dataset.setting || e.dataset.tab || e.className, w: r.width, h: r.height, x: r.left, y: r.top, right: r.right, bottom: r.bottom, scroll: !!e.closest('.bc-set-content') });
    }
    return out;
  });
}

/** Fresh title screen with a known lastWorldId. */
async function toTitle(t, lastWorldId = null) {
  if (await t.call('worldReadyNow')) await t.call('exitToTitle');
  await t.call('setSetting', 'lastWorldId', lastWorldId);
  t.assert(await t.call('waitFor', "api.uiOpen() === 'title'", 3000), 'title screen open');
}

export default [
  {
    name: 'menus-title',
    requires: ['menus', 'font'],
    async run(t) {
      await toTitle(t);
      const s = await t.eval(() => {
        const play = document.querySelector('[data-screen=title] [data-action=play]').getBoundingClientRect();
        const logo = document.querySelector('.bc-logo-img');
        return { play: { w: play.width, h: play.height }, logo: !!(logo && logo.naturalWidth > 100), font: document.fonts.check('16px BlockcraftPixel'), canvas: !!document.querySelector('[data-screen=title] .bc-menu-panorama') };
      });
      t.note('play', s.play);
      t.assert(s.play.w >= 200 && s.play.h >= 120, `Play is at least 200x120 (${JSON.stringify(s.play)})`);
      t.assert(s.logo, 'original logo drawn');
      t.assert(s.font, 'pixel font installed (document.fonts.check)');
      t.assert(s.canvas, 'animated scenery behind the title');
      // the scenery moves
      const sample = () => t.eval(() => { const c = document.querySelector('.bc-menu-panorama'); const x = c.getContext('2d'); return Array.from(x.getImageData(0, Math.floor(c.height * 0.55), c.width, 1).data.filter((_, i) => i % 16 === 0)).join(','); });
      const a = await sample();
      await t.page.waitForTimeout(700);
      t.assert(a !== await sample(), 'scenery animates');
      await t.shot('menus-title');
    },
  },
  {
    // SPEC §8.4 acceptance: title Play -> playing -> Esc/pause -> Save & Title -> the title lists the world
    name: 'menus-flow',
    requires: ['menus', 'save'],
    async run(t) {
      await toTitle(t, null);
      const before = (await t.call('listWorlds')).length;
      await clickSel(t, '[data-screen=title] [data-action=play]');
      t.assert(await t.call('waitFor', "api.state() === 'playing' && api.worldReady", 15000), 'Play starts a world');
      const meta = await t.call('meta');
      t.assert(meta.mode === 'creative' && meta.difficulty === 'peaceful', `kid default world (${meta.mode}/${meta.difficulty})`);
      await t.page.keyboard.press('Escape');
      t.assert(await t.call('waitFor', "api.uiOpen() === 'pause' && api.state() === 'paused'", 3000), 'Esc opens pause and pauses');
      await t.shot('menus-pause');
      await clickSel(t, '[data-screen=pause] [data-action=quit]');
      t.assert(await t.call('waitFor', "api.state() === 'title' && api.uiOpen() === 'title'", 8000), 'Save & Title goes back to the title');
      const after = await t.call('listWorlds');
      t.assert(after.length === before + 1 && after[0].id === meta.id, `the new world is listed first (${before} -> ${after.length})`);
      await clickSel(t, '[data-screen=title] [data-action=worlds]');
      t.assert(await t.waitFor(() => document.querySelector('[data-screen=worlds]')?.dataset.loaded === '1', null, 3000), 'worlds screen loads');
      t.assert(await t.eval((id) => !!document.querySelector(`[data-world-id="${id}"]`), meta.id), 'the world has a picture card');
      await t.shot('menus-worlds');
      // Play again resumes the same world
      await clickSel(t, '[data-screen=worlds] [data-action=back]');
      t.assert(await t.call('waitFor', "api.uiOpen() === 'title'", 3000), 'back to title');
      await clickSel(t, '[data-screen=title] [data-action=play]');
      t.assert(await t.call('waitFor', "api.state() === 'playing' && api.worldReady", 15000), 'Play resumes');
      t.assert((await t.call('meta')).id === meta.id, 'Play resumes settings.lastWorldId');
      t.assert((await t.call('listWorlds')).length === before + 1, 'no extra world created');
    },
  },
  {
    // SPEC §8.4 acceptance: a block:changed followed by 3 s puts save:done in the events
    name: 'menus-autosave',
    requires: ['menus', 'save'],
    async run(t) {
      // MECH random ticks change blocks in the background (grass under the gold block turns to dirt), which
      // re-dirties columns right after a save: switch them off while this checks the save cadence (LEAD integration)
      await t.eval(() => { const m = window.__game.game.mechanics; if (m && m.setRandomTicks) m.setRandomTicks(false); });
      try {
      await t.call('startWorld', FLAT);
      const p = await t.call('pos');
      const n0 = await t.call('eventCount', 'save:done');
      t.assert(await t.call('setBlock', Math.floor(p.x) + 2, 4, Math.floor(p.z) + 1, 'gold_block'), 'block set');
      await t.page.waitForTimeout(3000);
      const ev = await t.call('events', 'save:done', 5);
      t.note('saves', ev.map((e) => e.payload));
      t.assert(await t.call('eventCount', 'save:done') > n0 && ev.some((e) => e.payload.reason === 'auto' && e.payload.ok), 'autosave ran within 3 s');
      t.assert(await t.eval(() => window.__game.game.world.getDirtyColumns().length === 0), 'dirty columns written');
      // the pause screen saves immediately
      const n1 = await t.call('eventCount', 'save:done');
      await t.call('openScreen', 'pause');
      t.assert(await t.call('waitFor', `api.eventCount('save:done') > ${n1}`, 2000), 'pause saves');
      await t.call('closeUI');
      // hiding the tab saves immediately
      const n2 = await t.call('eventCount', 'save:start');
      await t.eval(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; });
      t.assert(await t.call('eventCount', 'save:start') > n2, 'visibilitychange(hidden) saves');
      await t.call('waitFor', "!api.game.save.saving", 2000);
      } finally {
        await t.eval(() => { const m = window.__game.game.mechanics; if (m && m.setRandomTicks) m.setRandomTicks(true); });
      }
    },
  },
  {
    // SPEC §8.4.4: 3 random taps without the hold never pass; the full hold + sum passes
    name: 'menus-gate',
    requires: ['gate'],
    async run(t) {
      await toTitle(t);
      await t.eval(() => { window.__gateResult = undefined; window.__game.game.menus.gate().then((r) => { window.__gateResult = r; }); });
      t.assert(await t.waitFor(() => !!document.querySelector('[data-screen=gate]'), null, 2000), 'gate open');
      const panel = await centre(t, '.bc-gate-panel');
      const hold = await centre(t, '[data-action=gate-hold]');
      const taps = [[hold.x, hold.y], [panel.box.x + 30, panel.box.y + panel.box.height - 30], [hold.x + 10, hold.y - 10]];
      for (const [x, y] of taps) { await t.page.mouse.click(x, y); await t.page.waitForTimeout(120); }
      const st = await t.eval(() => ({ stage: document.querySelector('[data-screen=gate]')?.dataset.stage, result: window.__gateResult }));
      t.assert(st.stage === 'hold' && st.result === undefined, `3 taps do not pass (${JSON.stringify(st)})`);
      await t.page.keyboard.press('Digit5');
      await t.page.keyboard.press('Enter');
      t.assert(await t.eval(() => document.querySelector('[data-screen=gate]')?.dataset.stage) === 'hold', 'typing does nothing before the hold');
      await t.page.keyboard.press('Escape');
      t.assert(await t.waitFor(() => window.__gateResult === false, null, 2000), 'Esc cancels (false)');
      t.assert(await ui(t) === 'title', 'Esc on the gate does not close the screen underneath');
      await t.eval(() => { window.__gateResult = undefined; window.__game.game.menus.gate().then((r) => { window.__gateResult = r; }); });
      const c = await centre(t, '[data-action=gate-hold]');
      await t.page.mouse.move(c.x, c.y);
      await t.page.mouse.down();
      await t.page.waitForTimeout(1500);
      await t.shot('menus-gate-hold');
      await t.page.mouse.up();
      t.assert(await t.eval(() => document.querySelector('[data-screen=gate]')?.dataset.stage) === 'hold', 'letting go after 1.5 s does not pass');
      // full gate
      const p = t.eval(() => new Promise((r) => { const iv = setInterval(() => { if (window.__gateResult !== undefined) { clearInterval(iv); r(window.__gateResult); } }, 50); }));
      await passGate(t);
      t.assert(await p === true, 'hold + right sum passes');
    },
  },
  {
    name: 'menus-sizes',
    requires: ['menus', 'gate'],
    async run(t) {
      // laptop, short laptop browser window, phone portrait, phone landscape
      const sizes = [[1280, 720], [1366, 600], [375, 667], [812, 375]];
      const bad = [];
      // enough worlds for several pages of cards
      for (let i = (await t.call('listWorlds')).length; i < 8; i++) { await t.call('startWorld', { ...FLAT, seed: 100 + i }); await t.call('exitToTitle'); }
      for (const [w, h] of sizes) {
        await t.page.setViewportSize({ width: w, height: h });
        await t.page.waitForTimeout(150);
        const check = async (name) => {
          await t.page.waitForTimeout(200);
          for (const e of await targets(t)) {
            if (Math.min(e.w, e.h) < 47.5) bad.push(`${w}px ${name}: ${e.sel} ${Math.round(e.w)}x${Math.round(e.h)}`);
            if (!e.scroll && (e.x < -1 || e.right > w + 1)) bad.push(`${w}px ${name}: ${e.sel} off screen (${Math.round(e.x)}..${Math.round(e.right)})`);
            if (!e.scroll && (e.y < -1 || e.bottom > h + 1)) bad.push(`${w}x${h} ${name}: ${e.sel} off screen (y ${Math.round(e.y)}..${Math.round(e.bottom)})`);
          }
        };
        await toTitle(t);
        const play = await centre(t, '[data-screen=title] [data-action=play]');
        if (play.box.width < 200 || play.box.height < 120) bad.push(`${w}px Play ${Math.round(play.box.width)}x${Math.round(play.box.height)}`);
        await check('title');
        await t.shot(`menus-title-${w}x${h}`);
        await t.call('openScreen', 'worlds');
        await t.waitFor(() => document.querySelector('[data-screen=worlds]')?.dataset.loaded === '1', null, 3000);
        await check('worlds');
        await t.shot(`menus-worlds-${w}x${h}`);
        await t.call('openScreen', 'newWorld');
        await check('newWorld');
        await t.shot(`menus-newworld-${w}x${h}`);
        await t.eval(() => { window.__game.game.menus.gate(); });
        await check('gate');
        await t.page.keyboard.press('Escape');
        await t.call('startWorld', FLAT);
        await t.call('openScreen', 'pause');
        await check('pause');
        await t.shot(`menus-pause-${w}x${h}`);
        await t.call('openScreen', 'settings', { from: 'pause' });
        await check('settings');
        await t.shot(`menus-settings-${w}x${h}`);
        await t.call('openScreen', 'death');
        await check('death');
        await t.shot(`menus-death-${w}x${h}`);
        await t.call('closeUI');
        await t.call('exitToTitle');
      }
      await t.page.setViewportSize({ width: 1280, height: 720 });
      t.note('problems', bad.slice(0, 20));
      t.assert(bad.length === 0, `touch targets: ${bad.slice(0, 8).join('; ')}`);
    },
  },
  {
    name: 'menus-newworld',
    requires: ['menus', 'save'],
    async run(t) {
      await toTitle(t);
      await clickSel(t, '[data-screen=title] [data-action=worlds]');
      t.assert(await t.waitFor(() => document.querySelector('[data-screen=worlds]')?.dataset.loaded === '1', null, 3000), 'worlds loads');
      await clickSel(t, '[data-screen=worlds] [data-action=new-world]');
      t.assert(await ui(t) === 'newWorld', 'the big + opens the new-world pictures');
      await clickSel(t, '[data-choice=preset][data-value=flat]');
      await clickSel(t, '[data-choice=mode][data-value=easy]');
      const sel = await t.eval(() => [...document.querySelectorAll('.bc-nw-card.bc-selected')].map((c) => c.dataset.value).sort());
      t.assert(JSON.stringify(sel) === '["easy","flat"]', `one tap each selects (${sel})`);
      await t.shot('menus-newworld');
      await clickSel(t, '[data-action=create-world]');
      t.assert(await t.call('waitFor', "api.state() === 'playing' && api.worldReady", 15000), 'the big Play creates the world');
      const m = await t.call('meta');
      t.assert(m.preset === 'flat' && m.mode === 'survival' && m.difficulty === 'easy', `preset/mode from the cards (${m.preset} ${m.mode} ${m.difficulty})`);
      t.assert(typeof m.name === 'string' && m.name.length > 3, `automatic name (${m.name})`);
      t.assert(m.rules.hunger === true && m.rules.fallDamage === true, 'survival rules applied');
    },
  },
  {
    name: 'menus-edit-worlds',
    requires: ['menus', 'save', 'gate'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, name: 'Delete Me 1' });
      const id = (await t.call('meta')).id;
      await t.call('exitToTitle');
      await toTitle(t, id);
      await t.call('openScreen', 'worlds');
      t.assert(await t.waitFor((wid) => !!document.querySelector(`[data-world-id="${wid}"]`), id, 3000), 'card shown');
      // rename
      await clickSel(t, '[data-screen=worlds] [data-action=edit-worlds]');
      await passGate(t);
      t.assert(await t.eval(() => document.querySelector('[data-screen=worlds]').dataset.edit) === '1', 'edit mode after the gate');
      await clickSel(t, `[data-world-id="${id}"] [data-action=rename-world]`);
      await t.page.locator('[data-input=rename]').fill('Castle Hill');
      await clickSel(t, '[data-screen=rename] [data-action=confirm-yes]');
      t.assert(await t.waitFor((wid) => !!document.querySelector(`[data-world-id="${wid}"] .bc-wcard-name`) && document.querySelector(`[data-world-id="${wid}"] .bc-wcard-name`).textContent === 'Castle Hill', id, 3000), 'renamed');
      // delete: cross keeps it, check deletes it
      await clickSel(t, `[data-world-id="${id}"] [data-action=delete-world]`);
      await t.shot('menus-delete-confirm');
      await clickSel(t, '[data-screen=confirm] [data-action=confirm-no]');
      t.assert((await t.call('listWorlds')).some((w) => w.id === id), 'cross keeps the world');
      await clickSel(t, `[data-world-id="${id}"] [data-action=delete-world]`);
      await clickSel(t, '[data-screen=confirm] [data-action=confirm-yes]');
      t.assert(await t.waitFor((wid) => !document.querySelector(`[data-world-id="${wid}"]`), id, 3000), 'card gone');
      t.assert(!(await t.call('listWorlds')).some((w) => w.id === id), 'world deleted from storage');
      t.assert((await t.call('settings')).lastWorldId === null, 'Play no longer points at it');
    },
  },
  {
    name: 'menus-settings',
    requires: ['menus', 'gate'],
    async run(t) {
      await t.call('startWorld', FLAT);
      await t.call('openScreen', 'pause');
      await clickSel(t, '[data-screen=pause] [data-action=settings]');
      await passGate(t);
      t.assert(await t.call('waitFor', "api.uiOpen() === 'settings'", 2000), 'settings open after the gate');
      t.assert(await t.call('state') === 'paused', 'settings pause the game');
      await t.shot('menus-settings-world');
      const day = (await t.call('meta')).rules.daylightCycle;
      await clickSel(t, '[data-setting="rule:daylightCycle"]');
      t.assert((await t.call('meta')).rules.daylightCycle === !day, 'rule toggles through setRule');
      t.assert(await t.call('eventCount', 'rules:changed') >= 1, 'rules:changed emitted');
      await clickSel(t, '[data-tab=video]');
      const fps = (await t.call('settings')).showFps;
      await clickSel(t, '[data-setting=showFps]');
      t.assert((await t.call('settings')).showFps === !fps, 'setting toggles through setSetting');
      await clickSel(t, '[data-tab=sound]');
      await t.eval(() => { const s = document.querySelector('input[data-setting=musicVolume]'); s.value = '0.2'; s.dispatchEvent(new Event('input', { bubbles: true })); });
      t.assert(Math.abs((await t.call('settings')).musicVolume - 0.2) < 1e-6, 'slider sets musicVolume');
      await clickSel(t, '[data-tab=tips]');
      t.assert(await t.eval(() => document.querySelector('[data-tab-content=tips]').textContent.includes('Sticky')), 'parent tips page');
      await t.shot('menus-settings-tips');
      await t.page.keyboard.press('Escape');
      t.assert(await ui(t) === 'pause', 'Esc in settings goes back to pause');
      await t.call('setSetting', 'musicVolume', 0.35);
      await t.call('setSetting', 'showFps', false);
    },
  },
  {
    name: 'menus-death',
    requires: ['menus'],
    async run(t) {
      await t.call('startWorld', { ...FLAT, mode: 'survival', difficulty: 'easy' });
      await t.call('setRule', 'immediateRespawn', false);
      await t.eval(() => window.__game.game.events.emit('player:death', { cause: 'test' }));
      t.assert(await ui(t) === 'death', 'death screen');
      await t.page.keyboard.press('Escape');
      t.assert(await ui(t) === 'death', 'Esc does not close the death screen');
      await t.shot('menus-death');
      const n = await t.call('eventCount', 'player:respawn');
      await clickSel(t, '[data-screen=death] [data-action=respawn]');
      t.assert(await t.call('waitFor', "api.uiOpen() === null && api.state() === 'playing'", 2000), 'respawn closes it and play resumes');
      t.assert(await t.call('eventCount', 'player:respawn') === n + 1, 'survival.respawn() ran');
      await t.call('setRule', 'immediateRespawn', true);
      await t.eval(() => window.__game.game.events.emit('player:death', { cause: 'test' }));
      t.assert(await ui(t) === null, 'no death screen with immediateRespawn');
    },
  },
  {
    name: 'menus-loading',
    requires: ['menus'],
    async run(t) {
      await t.eval(() => {
        const g = window.__game.game;
        window.__load = { shown: false, progress: [] };
        const off1 = g.events.on('world:starting', () => setTimeout(() => { window.__load.shown = !document.querySelector('[data-screen=loading]').classList.contains('bc-hidden'); }, 0));
        const off2 = g.events.on('world:progress', (e) => window.__load.progress.push(e.done / e.total));
        g.events.once('world:ready', () => { off1(); off2(); });
      });
      await t.call('startWorld', { preset: 'default', seed: 99, mode: 'creative' });
      const l = await t.eval(() => ({ ...window.__load, hidden: document.querySelector('[data-screen=loading]').classList.contains('bc-hidden'), p: window.__game.game.menus.loadingProgress }));
      t.note('progressEvents', l.progress.length);
      t.assert(l.shown, 'loading screen shown on world:starting');
      t.assert(l.progress.length >= 1 && l.progress[l.progress.length - 1] === 1, 'progress from world:progress');
      t.assert(l.hidden && l.p === 1, 'hidden on world:ready');
      await t.eval(() => { const g = window.__game.game; g.events.emit('world:starting', { meta: { preset: 'snowy' }, isNew: true }); g.events.emit('world:progress', { done: 6, total: 10 }); });
      await t.page.waitForTimeout(150);
      await t.shot('menus-loading');
      await t.eval(() => window.__game.game.events.emit('world:ready', {}));
    },
  },
  {
    name: 'menus-classic-pause',
    requires: ['menus'],
    async run(t) {
      await t.call('setSetting', 'controls', 'classic');
      try {
        await t.call('startWorld', FLAT);
        await t.call('waitFrames', 3);
        t.assert(await t.eval(() => !document.querySelector('[data-screen=click-to-play]').classList.contains('bc-hidden')), 'click-to-play hint while unlocked');
        await t.eval(() => window.__game.game.events.emit('input:pointerLock', { locked: false }));
        t.assert(await ui(t) === 'pause', 'losing pointer lock opens pause (classic)');
        await t.call('closeUI');
      } finally {
        await t.call('setSetting', 'controls', 'kid');
      }
      await t.eval(() => window.__game.game.events.emit('input:pointerLock', { locked: false }));
      t.assert(await ui(t) === null, 'kid scheme ignores pointer lock');
    },
  },
  {
    name: 'menus-backups',
    requires: ['menus', 'save'],
    async run(t) {
      await t.call('startWorld', FLAT);
      const meta = await t.call('meta');
      const p = await t.call('pos');
      const bx = Math.floor(p.x) + 3, bz = Math.floor(p.z) + 3;
      await t.call('setBlock', bx, 4, bz, 'gold_block');
      await t.call('openScreen', 'pause');
      await t.eval(() => new Promise((r) => setTimeout(r, 100)).then(() => window.__game.game.save.backupsIdle));
      await t.call('closeUI');
      const bs = await t.eval((id) => window.__game.game.save.listBackups(id), meta.id);
      t.assert(bs.some((b) => b.kind === 'daily') && bs.some((b) => b.kind === 'meta'), `backups made (${JSON.stringify(bs)})`);
      await t.call('setBlock', bx, 4, bz, 'diamond_block');
      await t.call('save');
      const daily = bs.find((b) => b.kind === 'daily');
      await t.eval(([id, b]) => window.__game.game.save.restoreBackup(id, b), [meta.id, daily.id]);
      t.assert(await t.call('waitFor', 'api.worldReady', 10000), 'world reopened');
      t.assert(await t.call('getBlock', bx, 4, bz) === 'gold_block', 'daily backup restored the block');
    },
  },
  {
    name: 'menus-export-import',
    requires: ['menus', 'save'],
    async run(t) {
      await t.call('startWorld', FLAT);
      const meta = await t.call('meta');
      const p = await t.call('pos');
      await t.call('setBlock', Math.floor(p.x) - 2, 4, Math.floor(p.z), 'red_wool');
      await t.call('save');
      const r = await t.eval(async (id) => {
        const s = window.__game.game.save;
        const blob = await s.exportWorld(id);
        const m = await s.importWorld(await blob.text());
        return { size: blob.size, name: blob.filename, id: m && m.id, newName: m && m.name };
      }, meta.id);
      t.note('export', r);
      t.assert(r.size > 100 && /\.json$/.test(r.name), 'export file');
      t.assert(r.id && r.id !== meta.id, 'import made a new world');
      await t.eval(async (id) => { const g = window.__game.game; await g.startWorld(await g.save.loadWorld(id)); }, r.id);
      t.assert(await t.call('getBlock', Math.floor(p.x) - 2, 4, Math.floor(p.z)) === 'red_wool', 'imported world has the block');
    },
  },
  {
    // touchscreen: taps act on touch *end* (a real user gesture for fullscreen/audio); cards and Play work by tap
    name: 'menus-touch',
    requires: ['menus', 'save'],
    touchOnly: true,
    async run(t) {
      await toTitle(t, null);
      const tap = async (sel) => { const c = await centre(t, sel); await t.page.touchscreen.tap(c.x, c.y); };
      await tap('[data-screen=title] [data-action=worlds]');
      t.assert(await t.call('waitFor', "api.uiOpen() === 'worlds'", 3000), 'tap opens worlds');
      // the world cards load from storage after the screen opens and move the + (many saved worlds after a full run)
      t.assert(await t.waitFor(() => document.querySelector('[data-screen=worlds]')?.dataset.loaded === '1', null, 3000), 'worlds loads');
      await tap('[data-screen=worlds] [data-action=new-world]');
      t.assert(await t.call('waitFor', "api.uiOpen() === 'newWorld'", 3000), 'tap on + opens new world');
      await tap('[data-choice=preset][data-value=snowy]');
      t.assert(await t.eval(() => document.querySelector('[data-choice=preset][data-value=snowy]').classList.contains('bc-selected')), 'tap selects a picture');
      await tap('[data-action=create-world]');
      t.assert(await t.call('waitFor', "api.state() === 'playing' && api.worldReady", 15000), 'tap Play starts the world');
      t.assert((await t.call('meta')).preset === 'snowy', 'snowy preset');
    },
  },
  {
    // needs the real player (serialize position/inventory) and world: PENDING until CORE lanes merge
    name: 'menus-reload-persist',
    requires: ['menus', 'save', 'world', 'player', 'physics'],
    async run(t) {
      await t.call('startWorld', FLAT);
      const meta = await t.call('meta');
      const p = await t.call('pos');
      const bx = Math.floor(p.x) + 2, bz = Math.floor(p.z) - 2;
      await t.call('setBlock', bx, 4, bz, 'emerald_block');
      await t.call('teleport', p.x + 5, 4, p.z + 3);
      await t.call('setSlot', 8, 'diamond', 7);
      await t.call('waitTicks', 2);
      const before = await t.call('pos');
      await t.call('save');
      await t.page.reload();
      await t.page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 30000 });
      t.assert((await t.call('settings')).lastWorldId === meta.id, 'lastWorldId survives the reload');
      await clickSel(t, '[data-screen=title] [data-action=play]');
      t.assert(await t.call('waitFor', "api.state() === 'playing' && api.worldReady", 15000), 'Play resumes after reload');
      t.assert((await t.call('meta')).id === meta.id, 'same world');
      t.assert(await t.call('getBlock', bx, 4, bz) === 'emerald_block', 'block restored');
      const q = await t.call('pos');
      t.assert(Math.hypot(q.x - before.x, q.z - before.z) < 0.6, `position restored (${JSON.stringify([before.x, before.z])} -> ${JSON.stringify([q.x, q.z])})`);
      t.assert((await t.call('inventory'))[8]?.item === 'diamond', 'inventory restored');
    },
  },
  {
    // thumbnails from the real renderer: PENDING until CORE-D (and the world it draws) merge
    name: 'menus-thumbnail',
    requires: ['menus', 'save', 'renderer', 'world', 'textures', 'mesher'],
    async run(t) {
      await t.call('startWorld', { preset: 'default', seed: 12345, mode: 'creative' });
      await t.call('setLook', 30, -15);
      await t.call('waitFrames', 20);
      await t.call('openScreen', 'pause');
      await t.call('waitFor', "!api.game.save.saving", 3000);
      const thumb = await t.eval(() => window.__game.game.meta.thumbnail);
      t.assert(typeof thumb === 'string' && thumb.startsWith('data:image/jpeg'), 'pause captured a thumbnail');
      const colors = await t.eval(async (url) => {
        const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; const s = new Set();
        for (let i = 0; i < d.length; i += 4) s.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
        return s.size;
      }, thumb);
      t.assert(colors > 30, `thumbnail shows the world (${colors} colours)`);
      await t.call('closeUI');
      await t.call('exitToTitle');
      await t.call('openScreen', 'worlds');
      await t.page.waitForTimeout(300);
      await t.shot('menus-worlds-thumbnails');
    },
  },
];
