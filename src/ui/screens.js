// OWNER: LEAD (shared, frozen). Screen manager = game.ui. One full-screen UI at a time (inventory, chest,
// crafting, furnace, creative picker, pause, settings, title, world list, death...). FEATURE-INV and
// FEATURE-MENUS register their screens here; nobody else shows modal screens. SPEC §9.3.
//
//   game.ui.register('chest', { open(opts) {...build DOM...}, close() {...remove DOM...}, pausesGame: false, owner: 'invui' });
//   game.ui.open('chest', { x, y, z });   game.ui.close();   game.ui.current  // 'chest' | null
//
// While any screen is open: game.input.setCaptured('ui', true) (movement stops, pointer lock released),
// and 'ui:open' {screen, opts} / 'ui:close' {screen} are emitted.
// Screens with pausesGame: true (pause, settings, title, worlds, death) set game.state = 'paused' when the
// world is playing; closing them resumes.
//
// Built-in key routing (from 'input:action' events, press only):
//   'pause'     -> if a screen is open: close it (unless it has escClose: false); else if playing: open 'pause'
//   'inventory' -> if current is inventory/creative/crafting/furnace/chest: close; else open game.isCreative() ? 'creative' : 'inventory'

export function createScreenManager(game) {
  /** @type {Map<string, {open:(opts:object)=>void, close:()=>void, pausesGame?:boolean, escClose?:boolean, owner?:string}>} */
  const screens = new Map();
  const CONTAINERS = new Set(['inventory', 'creative', 'crafting', 'furnace', 'chest']);

  const ui = {
    name: 'ui',
    /** @type {string|null} */
    current: null,
    currentOpts: null,
    screens,

    register(name, def) { screens.set(name, def); },
    has(name) { return screens.has(name); },
    isOpen(name) { return name ? ui.current === name : ui.current !== null; },

    /** Open a registered screen (closing the current one). Returns false if unknown. */
    open(name, opts = {}) {
      const def = screens.get(name);
      if (!def) { console.warn(`[ui] no screen registered: ${name}`); return false; }
      if (ui.current) ui.close();
      ui.current = name;
      ui.currentOpts = opts;
      if (game.input && game.input.setCaptured) game.input.setCaptured('ui', true);
      if (def.pausesGame && game.state === 'playing') game.setState('paused');
      try { def.open(opts); } catch (err) { game.reportError(err, `ui open ${name}`); }
      game.events.emit('ui:open', { screen: name, opts });
      return true;
    },

    /** Close the current screen (or only if it is `name`). */
    close(name) {
      if (!ui.current || (name && ui.current !== name)) return;
      const was = ui.current;
      const def = screens.get(was);
      ui.current = null;
      ui.currentOpts = null;
      try { def && def.close(); } catch (err) { game.reportError(err, `ui close ${was}`); }
      if (game.input && game.input.setCaptured) game.input.setCaptured('ui', false);
      if (def && def.pausesGame && game.state === 'paused') game.setState('playing');
      game.events.emit('ui:close', { screen: was });
    },

    init() {
      game.events.on('input:action', (e) => {
        if (!e.down) return;
        if (e.action === 'pause') {
          if (ui.current) {
            const def = screens.get(ui.current);
            if (!def || def.escClose !== false) ui.close();
          } else if (game.state === 'playing') {
            if (screens.has('pause')) ui.open('pause');
          }
        } else if (e.action === 'inventory') {
          if (ui.current && CONTAINERS.has(ui.current)) ui.close();
          else if (!ui.current && game.state === 'playing') ui.open(game.isCreative() ? 'creative' : 'inventory');
        }
      });
    },
  };
  return ui;
}
