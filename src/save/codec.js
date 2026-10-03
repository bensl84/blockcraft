// OWNER LANE: FEATURE-MENUS (save/load). Foundation written by LEAD: this is the ON-DISK FORMAT (SPEC §8.4.3) -
// changing it requires a new version byte and a migration. Pure; unit-tested in test/foundation.test.mjs.
//
// Column block data (Uint16Array(32768), packed id | state<<8) -> run-length bytes:
//   [0x42 'B', 0x43 'C', version=1] then repeated runs: varint(runLength >= 1) u16le(value)
// A plain-grass flat column compresses to ~20 bytes; a typical natural column to 1-4 KB.

import { COLUMN_VOLUME } from '../core/constants.js';

export const CODEC_VERSION = 1;

/** @param {Uint16Array} blocks length 32768 @returns {Uint8Array} */
export function encodeColumn(blocks) {
  if (blocks.length !== COLUMN_VOLUME) throw new Error('encodeColumn: expected 32768 values');
  const out = [0x42, 0x43, CODEC_VERSION];
  let i = 0;
  while (i < blocks.length) {
    const v = blocks[i];
    let run = 1;
    while (i + run < blocks.length && blocks[i + run] === v) run++;
    let r = run;
    while (r >= 0x80) { out.push((r & 0x7f) | 0x80); r >>>= 7; }
    out.push(r);
    out.push(v & 0xff, v >>> 8);
    i += run;
  }
  return Uint8Array.from(out);
}

/** @param {Uint8Array} bytes @returns {Uint16Array} length 32768. Throws on corrupt/unknown data. */
export function decodeColumn(bytes) {
  if (bytes.length < 3 || bytes[0] !== 0x42 || bytes[1] !== 0x43) throw new Error('decodeColumn: bad magic');
  if (bytes[2] !== CODEC_VERSION) throw new Error(`decodeColumn: unsupported version ${bytes[2]}`);
  const out = new Uint16Array(COLUMN_VOLUME);
  let p = 3, o = 0;
  while (p < bytes.length) {
    let run = 0, shift = 0, b;
    do { b = bytes[p++]; run |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && p < bytes.length);
    if (p + 2 > bytes.length) throw new Error('decodeColumn: truncated');
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    if (o + run > COLUMN_VOLUME) throw new Error('decodeColumn: overflow');
    out.fill(v, o, o + run);
    o += run;
  }
  if (o !== COLUMN_VOLUME) throw new Error(`decodeColumn: short (${o})`);
  return out;
}
