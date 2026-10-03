// OWNER LANE: FEATURE-MENUS. STUB written by LEAD - keep signatures. SPEC §9.1.
// Generate an ORIGINAL 5x7 pixel font at runtime (glyph bitmaps for ASCII 32-126 written in code), build a
// TrueType font in memory (each lit pixel = one square contour) and register it with
// `new FontFace(FONT_NAME, arrayBuffer)` + document.fonts.add(). No network, no font files.
// CSS everywhere uses var(--font) = '"BlockcraftPixel", "Lucida Console", "Courier New", monospace', so the
// game still reads fine before/without it.
//
// Stub behaviour: resolves false (fallback fonts are used).

import { registerStub } from '../core/stubs.js';

registerStub('font');

export const FONT_NAME = 'BlockcraftPixel';

/** Build + register the pixel font. Resolves true when document.fonts has it. Never throws. */
export function installPixelFont() { return Promise.resolve(false); }
