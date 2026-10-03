// OWNER LANE: FEATURE-TOUCH (touch + kid controls). STUB written by LEAD - keep signature. SPEC §8.5.
// On-screen controls in uiLayer(game, 'touch', Z.TOUCH), shown when settings.touchControls === 'on' or
// ('auto' and input.lastPointerType === 'touch'): left D-pad (default) or fixed joystick, Jump/Up (112 px),
// Down (while flying), Fly toggle, Inventory button at the end of the hotbar, Pause, Home. Buttons drive
// game.input.setVirtual / setMoveVector / addLook only - world-area tap/hold/drag gestures are CORE-E's
// (input.js pointer events). Track pointers by id, ignore palms (> 40 px contact), react on pointerdown.
//
// Stub behaviour: nothing shown.

import { registerStub } from '../core/stubs.js';

registerStub('touch');

/** @returns {object} Touch system (game.touch) */
export function createTouchSystem(game) {
  return {
    name: 'touch',
    stub: true,
    /** true while the on-screen controls are visible */
    visible: false,
    init() {},
    frame() {},
    /** Force show/hide (tests: --touch scenario). */
    setVisible(v) {},
  };
}
