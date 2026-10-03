// OWNER LANE: KID. Accidental-exit guards (SPEC §8.5.2 "Exit guards", §13.1 item 10).
//
//  - enterFullscreen(): requestFullscreen({navigationUI: 'hide'}) then navigator.keyboard.lock() (Esc must then
//    be HELD for 2 s to leave fullscreen - the browser's own rule). Called synchronously from the Play click.
//  - fullscreen lost while a world is open: autosave, then a big pulsing ▶ "keep playing" overlay that
//    re-enters fullscreen on click (plus a small 48 px "stay in a window" button for grown-ups).
//  - after the first interaction: beforeunload -> preventDefault + returnValue (and an autosave attempt).
//  - while a world is open, keydown blocks F5, Ctrl/Cmd+R, Ctrl+(+/-/0), F1, F3, F6, F7, Alt+Left/Right,
//    browser-back/refresh keys and a few dialogs a masher hits (Ctrl+P/S/O/F/U/D/H/J/G). preventDefault only,
//    never stopPropagation, so the game's own bindings (classic F5 = camera view) keep working.
//  - history.pushState({bc: 1}, '', location.href) after the first interaction (exactly this: changing the
//    path throws on file://), re-pushed on popstate while a world is open so a back swipe lands in the game.

import { el, uiLayer } from '../core/dom.js';
import { Z } from '../core/constants.js';
import { ICONS } from './pixelicons.js';

const BLOCK_PLAIN = new Set(['F5', 'F1', 'F3', 'F6', 'F7', 'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserHome', 'BrowserSearch']);
const BLOCK_CTRL = new Set(['KeyR', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'Numpad0',
  'KeyP', 'KeyS', 'KeyO', 'KeyF', 'KeyU', 'KeyD', 'KeyH', 'KeyJ', 'KeyG']);

/** Pure: should this keydown be blocked while a world is open? (unit-tested) */
export function isBlockedKey(e) {
  if (!e) return false;
  const code = e.code || '';
  if (BLOCK_PLAIN.has(code)) return true;
  if ((e.ctrlKey || e.metaKey) && BLOCK_CTRL.has(code)) return true;
  if (e.altKey && (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Home')) return true;
  return false;
}

export function createGuards(game) {
  let interacted = false;
  /** we asked for fullscreen (Play): losing it while playing shows the keep-playing overlay */
  let wantFullscreen = false;
  let overlay = null;
  const g = {
    get interacted() { return interacted; },
    get wantFullscreen() { return wantFullscreen; },
    overlayVisible: false,
    blockedKeys: 0,

    install() {
      const first = () => { if (!interacted) { interacted = true; g.pushHistory(); } };
      window.addEventListener('pointerdown', first, true);
      window.addEventListener('keydown', first, true);
      window.addEventListener('keydown', (e) => {
        if (!game.meta) return;
        if (isBlockedKey(e)) { e.preventDefault(); g.blockedKeys++; }
      }, true);
      window.addEventListener('beforeunload', (e) => {
        if (!interacted || !game.meta) return undefined;
        g.autosave('unload');
        e.preventDefault();
        e.returnValue = '';
        return '';
      });
      window.addEventListener('popstate', () => { if (game.meta) g.pushHistory(true); });
      document.addEventListener('fullscreenchange', () => g.onFullscreenChange());
      game.events.on('world:exit', () => g.hideOverlay());
      game.events.on('world:ready', () => { if (interacted) g.pushHistory(); });
    },

    /** history.pushState({bc: 1}, '', location.href) unless the current entry already is ours. */
    pushHistory(force = false) {
      try {
        if (!force && history.state && history.state.bc === 1) return false;
        history.pushState({ bc: 1 }, '', location.href);
        return true;
      } catch { return false; }
    },

    /** Save through the save lane when it is live (never throws). */
    autosave(reason) {
      try {
        if (game.save && !game.save.stub && game.meta && game.save.saveNow) {
          const p = game.save.saveNow(reason);
          if (p && p.catch) p.catch((err) => game.reportError(err, `kid autosave ${reason}`));
        }
      } catch (err) { game.reportError(err, `kid autosave ${reason}`); }
    },

    /** MUST run inside a user-gesture handler. Resolves true when fullscreen was entered. */
    enterFullscreen() {
      wantFullscreen = true;
      const root = document.documentElement;
      if (document.fullscreenElement) { g.lockKeyboard(); return Promise.resolve(true); }
      if (!root.requestFullscreen) return Promise.resolve(false);
      let p;
      try { p = root.requestFullscreen({ navigationUI: 'hide' }); } catch { return Promise.resolve(false); }
      return Promise.resolve(p).then(() => { g.lockKeyboard(); return true; }, () => false);
    },

    lockKeyboard() {
      try {
        const kb = navigator.keyboard;
        if (kb && kb.lock) { const r = kb.lock(); if (r && r.catch) r.catch(() => {}); }
      } catch { /* not supported */ }
    },

    onFullscreenChange() {
      if (document.fullscreenElement) { g.hideOverlay(); return; }
      if (!wantFullscreen || !game.meta) return;
      g.autosave('fullscreen');
      g.showOverlay();
    },

    showOverlay() {
      if (!overlay) {
        const layer = uiLayer(game, 'kid-guard', Z.TOAST);
        const play = el('div', {
          class: 'bc-btn bc-btn-play kid-keep-play', role: 'button', 'aria-label': 'Keep playing', 'data-interactive': '',
          'data-kid': 'keep-playing',
          onpointerdown: (e) => { e.preventDefault(); game.events.emit('ui:click', {}); },
          // click (not pointerdown) carries user activation for requestFullscreen on touch too
          onclick: (e) => { e.preventDefault(); g.keepPlaying(); },
        }, [el('span', { class: 'bc-play-glyph', text: '▶' })]);
        const windowed = el('div', {
          class: 'kid-guard-window', role: 'button', 'aria-label': 'Stay in a window', 'data-interactive': '', 'data-kid': 'stay-windowed',
          onclick: (e) => { e.preventDefault(); wantFullscreen = false; g.hideOverlay(); },
          html: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="3" width="12" height="10" fill="none" stroke="#fff" stroke-width="2"/><rect x="2" y="3" width="12" height="3" fill="#fff"/></svg>',
        });
        overlay = el('div', { class: 'kid-guard bc-hidden', 'data-kid': 'guard' }, [
          el('div', { class: 'kid-guard-dim' }),
          el('div', { class: 'kid-guard-center' }, [play, el('div', { class: 'kid-guard-sparkles', html: ICONS.star() + ICONS.star() })]),
          windowed,
        ]);
        layer.appendChild(overlay);
      }
      overlay.classList.remove('bc-hidden');
      g.overlayVisible = true;
    },

    hideOverlay() {
      if (overlay) overlay.classList.add('bc-hidden');
      g.overlayVisible = false;
    },

    keepPlaying() {
      g.hideOverlay();
      if (game.ui && game.ui.current === 'pause') game.ui.close('pause');
      return g.enterFullscreen();
    },
  };
  return g;
}
