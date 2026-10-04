// OWNER LANE: FEATURE-MENUS (save). World export / import file (P2, SPEC §8.4.3): plain JSON so a parent can
// move a world between the file:// copy and the website (they have separate storage).
//   { format: 'blockcraft-world', version: 1, exportedAt, meta: WorldMeta, columns: [{cx, cz, data: base64 codec bytes, blockEntities}] }
// Pure (no DOM); unit-tested.

import { decodeColumn } from './codec.js';

export const WORLD_FILE_FORMAT = 'blockcraft-world';
export const WORLD_FILE_VERSION = 1;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();

/** Uint8Array -> base64 string. */
export function toBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) { const n = bytes[i] << 16; out += B64[n >> 18] + B64[(n >> 12) & 63] + '=='; }
  else if (rest === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='; }
  return out;
}

/** base64 string -> Uint8Array. Throws on bad characters. */
export function fromBase64(s) {
  const clean = String(s).replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, o);
}

/** Build the export JSON text for a meta and its stored column records. */
export function encodeWorldFile(meta, columns) {
  const m = JSON.parse(JSON.stringify(meta));
  return JSON.stringify({
    format: WORLD_FILE_FORMAT,
    version: WORLD_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    meta: m,
    columns: columns.map((c) => ({ cx: c.cx, cz: c.cz, data: toBase64(c.data), blockEntities: c.blockEntities || [] })),
  });
}

/**
 * Parse and validate an export. Every column must decode with the save codec.
 * @returns {{meta: object, columns: Array<{cx, cz, data: Uint8Array, blockEntities}>}}
 */
export function decodeWorldFile(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('not a Blockcraft world file'); }
  if (!o || o.format !== WORLD_FILE_FORMAT) throw new Error('not a Blockcraft world file');
  if (o.version !== WORLD_FILE_VERSION) throw new Error(`unsupported world file version ${o.version}`);
  const meta = o.meta;
  if (!meta || typeof meta !== 'object' || !Number.isFinite(meta.seed)) throw new Error('world file has no valid world');
  if (!Array.isArray(o.columns)) throw new Error('world file has no columns');
  const columns = o.columns.map((c) => {
    if (!Number.isInteger(c.cx) || !Number.isInteger(c.cz)) throw new Error('bad column position');
    const data = fromBase64(c.data);
    decodeColumn(data); // validates (throws on corrupt data)
    return { cx: c.cx, cz: c.cz, data, blockEntities: Array.isArray(c.blockEntities) ? c.blockEntities : [] };
  });
  return { meta, columns };
}

/** A file name for an export: blockcraft-<name>-<yyyy-mm-dd>.json */
export function worldFileName(meta, now = new Date()) {
  const slug = String(meta && meta.name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
  const d = now.toISOString().slice(0, 10);
  return `blockcraft-${slug}-${d}.json`;
}
