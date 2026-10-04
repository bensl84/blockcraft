// OWNER LANE: FEATURE-MENUS. 'settings' (pausesGame, parent area behind the gate; text is fine here). SPEC
// §8.4.1 / §8.4.5. Every change goes through game.setSetting / game.setRule / game.setMode / game.setDifficulty.
// Tabs: Controls, World (only with a world open), Video, Sound, Helpers, Saves (backups, export, import), Tips.

import { el } from '../core/dom.js';
import { DEFAULT_RULES, RENDER } from '../core/constants.js';
import { iconImg } from './menu_art.js';
import { actionButton, choice, iconButton, onPress, row, slider, toggle } from './menu_widgets.js';
import { confirmBox } from './menu_worlds.js';
import { agoLabel } from './menu_logic.js';

const pct = (v) => `${Math.round(v * 100)}%`;

/** Rule toggles shown in the World tab: [key, label, hint]. */
const RULE_ROWS = [
  ['daylightCycle', 'Day and night', 'Off keeps it sunny at 9 in the morning.'],
  ['tntExplodes', 'TNT explodes', 'Blasts can always be undone with U.'],
  ['hostileMobs', 'Monsters', 'Always off on Peaceful.'],
  ['passiveMobs', 'Animals', ''],
  ['animalsCanDie', 'Animals can be hurt', 'Off: a hit animal just hops away.'],
  ['fallDamage', 'Fall damage', ''],
  ['drowningDamage', 'Drowning', ''],
  ['fireDamage', 'Fire and lava hurt', ''],
  ['hunger', 'Hunger', ''],
  ['keepInventory', 'Keep items after dying', ''],
  ['immediateRespawn', 'Respawn right away', 'Off shows a big Respawn button.'],
  ['dropItemsOnBreak', 'Broken blocks drop items', ''],
  ['mobGriefing', 'Creepers break blocks', ''],
  ['voidRescue', 'Rescue from falling out of the world', ''],
  ['weatherCycle', 'Weather', ''],
  ['fireSpread', 'Fire spreads', ''],
];

export const PARENT_TIPS = [
  ['Sticky Keys', 'Turn off the Windows Sticky Keys shortcut: Settings > Accessibility > Keyboard > Sticky keys > "Keyboard shortcut for Sticky keys" off. Blockcraft never uses Shift in the kid controls, but a child may still mash it and the Windows pop-up drops full screen.'],
  ['Two separate save places', 'Worlds saved while Blockcraft is opened from a file on this computer and worlds saved on the website are kept apart by the browser. Use Saves > Export and Import to move a world between them.'],
  ['Creative is the default', 'Survival is for grown-ups or older kids: the recipe book shows pictures, but survival still means gathering and crafting. Creative is the default for a reason.'],
  ['TNT', 'TNT is on by default and every blast can be undone with U (or the undo button). You can turn it off under World > TNT explodes.'],
  ['Getting back', 'H (or the house button) always brings your child home. Falling out of the world puts them safely back on the ground.'],
  ['Saving', 'Blockcraft saves by itself a few seconds after building, every 30 seconds while playing, and whenever the game is paused, hidden or closed. Up to 3 recent copies and one copy per day can be restored under Saves.'],
  ['Controls', 'Kid controls: arrows or W A S D walk and turn, tap to place, hold to break, drag to look, Space jumps, F flies, C goes down, E opens the block picker. Classic controls use mouse look with WASD strafing.'],
];

export function registerSettingsScreen(ctx) {
  const { game } = ctx;
  let node = null, opts = {}, tab = 'controls', content = null, syncers = [];

  const screen = {
    owner: 'menus', pausesGame: true, escClose: false,
    open(o = {}) {
      opts = o;
      tab = o.tab || (o.from === 'pause' && game.meta ? 'world' : 'controls');
      node = el('div', { class: `bc-screen bc-settings ${game.meta ? 'bc-dim' : 'bc-mscreen'}`, 'data-screen': 'settings' });
      build();
      if (!game.meta) ctx.attachBackdrop(node);
      ctx.show(node);
    },
    close() { ctx.hide(node); node = null; syncers = []; },
    get tab() { return tab; },
    setTab(t) { tab = t; build(); },
  };
  game.ui.register('settings', screen);

  function back() {
    if (opts.from === 'pause' && game.meta) game.ui.open('pause');
    else if (game.meta) game.ui.close('settings');
    else game.ui.open('title');
  }

  function tabs() {
    const list = [['controls', 'Controls', 'mouse'], ['world', 'World', 'house'], ['video', 'Video', 'sun'], ['sound', 'Sound', 'heart'],
      ['helpers', 'Helpers', 'star'], ['saves', 'Saves', 'worlds'], ['tips', 'Tips', 'lock']];
    return list.filter(([k]) => k !== 'world' || game.meta);
  }

  function build() {
    if (!node) return;
    if (tab === 'world' && !game.meta) tab = 'controls';
    syncers = [];
    const keepBg = node.querySelector('.bc-menu-panorama');
    node.textContent = '';
    if (keepBg) node.appendChild(keepBg);
    const tabBar = el('div', { class: 'bc-set-tabs', role: 'tablist' }, tabs().map(([k, label, icon]) => {
      const b = el('button', { class: `bc-btn bc-set-tab${k === tab ? ' bc-selected' : ''}`, type: 'button', role: 'tab', 'data-tab': k, 'aria-selected': String(k === tab) }, [iconImg(icon, 24), el('span', { text: label })]);
      return onPress(game, b, () => { tab = k; build(); });
    }));
    content = el('div', { class: 'bc-set-content', 'data-tab-content': tab });
    const body = { controls, world, video, sound, helpers, saves, tips }[tab];
    body(content);
    node.appendChild(el('div', { class: 'bc-panel bc-set-panel' }, [
      el('div', { class: 'bc-set-head' }, [
        iconButton(game, { icon: 'back', px: 40, cls: 'bc-set-back', action: 'back', label: 'Back', onPress: back }),
        el('div', { class: 'bc-set-title', text: 'Grown-ups' }),
        el('div', { class: 'bc-set-ver', text: `v${game.version}` }),
      ]),
      el('div', { class: 'bc-set-main' }, [tabBar, content]),
    ]));
  }

  const S = (key) => () => game.settings[key];
  const setS = (key) => (v) => game.setSetting(key, v);
  const keep = (n) => { if (n && n._sync) syncers.push(n._sync); return n; };
  const section = (parent, title) => parent.appendChild(el('h3', { class: 'bc-set-section', text: title }));

  function controls(c) {
    section(c, 'Controls');
    c.append(
      row('Control scheme', keep(choice(game, 'controls', [{ value: 'kid', label: 'Kid' }, { value: 'classic', label: 'Classic' }], S('controls'), setS('controls'))),
        'Kid: free cursor, tap to place, hold to break, arrows turn. Classic: mouse look, WASD strafe.'),
      row('Turn speed (keys)', keep(slider(game, 'turnSpeed', 0, 1, 0.05, S('turnSpeed'), setS('turnSpeed'), pct))),
      row('Look sensitivity', keep(slider(game, 'lookSensitivity', 0, 1, 0.05, S('lookSensitivity'), setS('lookSensitivity'), pct))),
      row('Invert up/down look', keep(toggle(game, 'invertY', S('invertY'), setS('invertY')))),
      row('Auto-jump', keep(toggle(game, 'autoJump', S('autoJump'), setS('autoJump'))), 'Walk into a one-block step to hop up.'),
      row('Gently look down while walking', keep(toggle(game, 'autoPitch', S('autoPitch'), setS('autoPitch')))),
    );
    section(c, 'Touch screen');
    c.append(
      row('Touch buttons', keep(choice(game, 'touchControls', [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], S('touchControls'), setS('touchControls')))),
      row('Button size', keep(choice(game, 'buttonSize', [{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'L' }], S('buttonSize'), setS('buttonSize')))),
      row('Button opacity', keep(slider(game, 'touchOpacity', 0.3, 1, 0.05, S('touchOpacity'), setS('touchOpacity'), pct))),
      row('Left-handed layout', keep(toggle(game, 'leftHanded', S('leftHanded'), setS('leftHanded')))),
    );
  }

  function world(c) {
    const m = game.meta;
    if (!m) return;
    section(c, 'This world');
    const name = el('input', { class: 'bc-set-text', type: 'text', maxlength: '32', value: m.name, 'data-setting': 'worldName', 'aria-label': 'World name' });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('change', async () => { const n = await game.save.renameWorld(m.id, name.value); if (n) name.value = n; });
    c.append(
      row('Name', name),
      row('Game mode', keep(choice(game, 'mode', [{ value: 'creative', label: 'Creative' }, { value: 'survival', label: 'Survival' }], () => game.meta && game.meta.mode, (v) => { game.setMode(v); syncAll(); }))),
      row('Difficulty', keep(choice(game, 'difficulty', [{ value: 'peaceful', label: 'Peaceful' }, { value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }], () => game.meta && game.meta.difficulty, (v) => { game.setDifficulty(v); syncAll(); }))),
      row('Home', actionButton(game, 'Set home here', () => {
        if (game.kid && game.kid.setHome) game.kid.setHome();
        game.events.emit('toast', { text: 'Home set' });
        homeInfo.textContent = homeText();
      }, '', 'set-home'), 'The house button and H bring your child back here.'),
    );
    const homeText = () => (game.meta && game.meta.home ? `Home: ${Math.round(game.meta.home.x)}, ${Math.round(game.meta.home.y)}, ${Math.round(game.meta.home.z)}` : 'Home: the world spawn');
    const homeInfo = el('div', { class: 'bc-set-note', text: homeText() });
    c.append(homeInfo);
    section(c, 'World rules');
    for (const [key, label, hint] of RULE_ROWS) {
      if (!(key in DEFAULT_RULES)) continue;
      c.append(row(label, keep(toggle(game, 'rule:' + key, () => !!(game.meta && game.meta.rules[key]), (v) => game.setRule(key, v),
        { disabled: () => key === 'hostileMobs' && game.meta && game.meta.difficulty === 'peaceful' })), hint));
    }
    c.append(row('Soft world border', keep(choice(game, 'rule:worldBorder', [256, 512, 1024, 2048].map((v) => ({ value: v, label: String(v) })),
      () => game.meta && game.meta.rules.worldBorder, (v) => game.setRule('worldBorder', v))), 'Blocks from spawn before thick fog gently turns your child around.'));
  }

  function video(c) {
    section(c, 'Video');
    c.append(
      row('Render distance', keep(slider(game, 'renderDistance', RENDER.MIN_DISTANCE - 1, RENDER.MAX_DISTANCE, 1,
        () => game.settings.renderDistance || RENDER.MIN_DISTANCE - 1, (v) => game.setSetting('renderDistance', v < RENDER.MIN_DISTANCE ? 0 : v),
        (v) => (v < RENDER.MIN_DISTANCE ? 'Auto' : `${v} chunks`))), 'Auto picks a distance that runs smoothly on this computer.'),
      row('Automatic quality', keep(toggle(game, 'dynamicQuality', S('dynamicQuality'), setS('dynamicQuality')))),
      row('Brightness', keep(slider(game, 'brightness', 0, 1, 0.05, S('brightness'), setS('brightness'), pct)), 'Caves are never pitch black.'),
      row('Field of view', keep(slider(game, 'fov', 50, 110, 1, S('fov'), setS('fov'), (v) => `${v}`))),
      row('Fancy leaves', keep(toggle(game, 'fancyLeaves', S('fancyLeaves'), setS('fancyLeaves')))),
      row('Clouds', keep(toggle(game, 'clouds', S('clouds'), setS('clouds')))),
      row('Waving plants and water', keep(toggle(game, 'waving', S('waving'), setS('waving')))),
      row('Smooth lighting', keep(toggle(game, 'smoothLighting', S('smoothLighting'), setS('smoothLighting')))),
      row('View bobbing', keep(toggle(game, 'viewBobbing', S('viewBobbing'), setS('viewBobbing')))),
      row('Hotbar and inventory size', keep(choice(game, 'guiScale', [0, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: v ? String(v) : 'Auto' })), S('guiScale'), setS('guiScale'))), 'The big menu buttons always stay big.'),
      row('Sharpness limit', keep(choice(game, 'pixelRatioCap', [0, 0.75, 1, 1.5, 2].map((v) => ({ value: v, label: v ? `${v}x` : 'Auto' })), S('pixelRatioCap'), setS('pixelRatioCap'))), 'Lower is faster on weak laptops.'),
      row('Show FPS', keep(toggle(game, 'showFps', S('showFps'), setS('showFps')))),
    );
  }

  function sound(c) {
    section(c, 'Sound');
    c.append(
      row('Master volume', keep(slider(game, 'masterVolume', 0, 1, 0.05, S('masterVolume'), setS('masterVolume'), pct))),
      row('Music', keep(slider(game, 'musicVolume', 0, 1, 0.05, S('musicVolume'), setS('musicVolume'), pct))),
      row('Effects', keep(slider(game, 'sfxVolume', 0, 1, 0.05, S('sfxVolume'), setS('sfxVolume'), pct))),
      row('Mute everything', keep(toggle(game, 'muted', S('muted'), setS('muted')))),
    );
  }

  function helpers(c) {
    section(c, 'Kid helpers');
    c.append(
      row('Picture hints', keep(toggle(game, 'hints', S('hints'), setS('hints'))), 'Animated hints after a few seconds of standing still.'),
      row('Say block names out loud', keep(toggle(game, 'speakNames', S('speakNames'), setS('speakNames'))), 'Uses the voices built into this computer.'),
    );
  }

  function saves(c) {
    const sv = game.save;
    section(c, 'Saving');
    c.append(el('div', { class: 'bc-set-note', text: sv.available
      ? `Worlds are saved in this browser (${location.protocol === 'file:' ? 'opened from a file' : 'website'}). Last save: ${sv.lastSaveAt ? agoLabel(sv.lastSaveAt) : 'not yet'}.`
      : 'This browser does not allow saving here. Worlds last until the page is closed. Use Export to keep a world.' }));
    if (game.meta) {
      c.append(row('Save now', actionButton(game, 'Save now', async () => {
        const ok = await sv.saveNow('manual');
        game.events.emit('toast', { text: ok ? 'Saved' : 'Could not save' });
        build();
      }, '', 'save-now')));
    }
    const worldId = game.meta ? game.meta.id : game.settings.lastWorldId;
    section(c, 'Backups');
    const list = el('div', { class: 'bc-set-backups', 'data-list': 'backups' }, [el('div', { class: 'bc-set-note', text: worldId ? 'Looking for backups...' : 'Play a world first.' })]);
    c.append(list);
    if (worldId && sv.listBackups) {
      sv.listBackups(worldId).then((bs) => {
        list.textContent = '';
        if (!bs.length) { list.appendChild(el('div', { class: 'bc-set-note', text: 'No backups yet. One is made when you pause or leave a world.' })); return; }
        for (const b of bs) {
          const label = b.kind === 'daily' ? `Daily copy (${b.day}) - blocks and items` : `Recent copy, ${agoLabel(b.at)} - items, position and time`;
          list.appendChild(row(label, actionButton(game, 'Restore', async () => {
            if (!(await confirmBox(ctx, 'respawn', 'Restore this copy?'))) return;
            await sv.restoreBackup(worldId, b.id);
            game.events.emit('toast', { text: 'Restored' });
            if (game.ui.current === 'settings') build();
          }, '', 'restore-backup')));
        }
      }).catch((err) => game.reportError(err, 'menus listBackups'));
    }
    section(c, 'Move worlds');
    const file = el('input', { type: 'file', accept: '.json,application/json', class: 'bc-hidden', 'data-input': 'import' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const meta = await sv.importWorld(f);
      game.events.emit('toast', { text: meta ? `Imported ${meta.name}` : 'That file is not a Blockcraft world' });
      file.value = '';
    });
    c.append(file);
    if (worldId) {
      c.append(row('Export this world', actionButton(game, 'Export', async () => {
        const blob = await sv.exportWorld(worldId);
        if (!blob) { game.events.emit('toast', { text: 'Nothing to export yet' }); return; }
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: blob.filename || 'blockcraft-world.json' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, '', 'export-world'), 'Downloads a file you can import on another computer or in the other save place.'));
    }
    c.append(row('Import a world', actionButton(game, 'Import', () => file.click(), '', 'import-world')));
  }

  function tips(c) {
    section(c, 'Tips for grown-ups');
    for (const [title, text] of PARENT_TIPS) c.append(el('div', { class: 'bc-tip' }, [el('h4', { text: title }), el('p', { text })]));
  }

  function syncAll() { for (const f of syncers) { try { f(); } catch { /* ignore */ } } }
  game.events.on('settings:changed', () => { if (game.ui.current === 'settings') syncAll(); });
  game.events.on('rules:changed', () => { if (game.ui.current === 'settings') syncAll(); });
  game.events.on('input:action', (e) => {
    if (!e.down || e.action !== 'pause' || game.ui.current !== 'settings') return;
    if (ctx.modal) ctx.modal.cancel(); else back();
  });
  return screen;
}
