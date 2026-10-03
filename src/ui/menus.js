// OWNER LANE: FEATURE-MENUS (menus + title + save/load + settings). STUB written by LEAD - keep signature.
// Registers screens with game.ui: 'title' (huge pulsing Play = resume last world, original logo, animated
// scenery), 'worlds' (picture cards + big "+"), 'newWorld' (picture presets: Flat / Hills & trees / Snowy,
// mode cards Creative / Survival Easy / Survival Normal), 'loading' (progress from 'world:progress'),
// 'pause' (big Resume, Home, Settings gear behind the parent gate, Save & Quit), 'settings' (parent area),
// 'death' (P0: "Respawn" big button; skipped when rules.immediateRespawn). SPEC §8.4.
//
// Stub behaviour: placeholder title (Play -> new creative world) and pause (Resume / Title) screens.

import { registerStub } from '../core/stubs.js';
import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';

registerStub('menus');

/** @returns {object} Menus system (game.menus) */
export function createMenusSystem(game) {
  let root = null, panel = null;
  const show = (node) => { hide(); panel = node; root.appendChild(node); };
  const hide = () => { if (panel) panel.remove(); panel = null; };
  return {
    name: 'menus',
    stub: true,
    init() {
      root = uiLayer(game, 'screens', Z.SCREENS);
      game.ui.register('title', {
        owner: 'menus', escClose: false, pausesGame: false,
        open() {
          show(el('div', { class: 'bc-screen bc-title-screen', 'data-screen': 'title' }, [
            el('div', { class: 'bc-logo', text: 'Blockcraft' }),
            el('button', {
              class: 'bc-btn bc-btn-play', 'aria-label': 'Play', 'data-action': 'play',
              onclick: () => {
                if (game.audio) game.audio.unlock();
                if (game.kid && game.kid.enterFullscreen) game.kid.enterFullscreen();
                game.startWorld({ preset: 'default', mode: 'creative', difficulty: 'peaceful' });
              },
            }, [el('span', { class: 'bc-play-glyph', text: '▶' })]),
          ]));
        },
        close: hide,
      });
      game.ui.register('pause', {
        owner: 'menus', pausesGame: true,
        open() {
          show(el('div', { class: 'bc-screen bc-dim', 'data-screen': 'pause' }, [
            el('div', { class: 'bc-panel bc-center bc-stack' }, [
              el('button', { class: 'bc-btn bc-btn-big', 'data-action': 'resume', onclick: () => game.ui.close('pause') }, ['▶']),
              el('button', { class: 'bc-btn', 'data-action': 'quit', onclick: () => game.exitToTitle() }, ['Save & Quit']),
            ]),
          ]));
        },
        close: hide,
      });
      game.events.on('game:ready', () => game.ui.open('title'));
      game.events.on('world:exit', () => game.ui.open('title'));
    },
    frame() {},
  };
}
