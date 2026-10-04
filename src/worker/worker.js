// OWNER LANE: CORE-C (worker offload; CORE-B's generateColumn runs here too).
// build.mjs bundles THIS file as a classic IIFE and injects it as WORKER_SRC (core/constants.js). The main
// thread (src/world/workers.js) creates it with new Worker(URL.createObjectURL(new Blob([WORKER_SRC]))) inside
// try/catch and falls back to main-thread work on any failure (module workers and importScripts fail from
// file://; a blob classic worker works from file:// and http(s)).
//
// Protocol (SPEC §5.3.5), every request answers {id, ok, ...} and uses transferables:
//   {id, op: 'init', layers: [[textureKey, layer], ...]}           -> {id, ok}
//   {id, op: 'generate', seed, cx, cz, preset}                     -> {id, ok, blocks: Uint16Array, biomes: Uint8Array}
//   {id, op: 'mesh', blocks, light, opts, version}                 -> {id, ok, mesh: SectionMesh|null, version}
//   anything else / any exception                                  -> {id, ok: false, error}

import { generateColumn } from '../world/worldgen.js';
import { meshSection } from '../world/mesher.js';
import { bindTextures, texturesBound } from '../core/registry.js';
import { COLUMN_VOLUME } from '../core/constants.js';

/* eslint-env worker */
function meshTransfer(mesh) {
  const t = [];
  if (!mesh) return t;
  for (const k of ['opaque', 'cutout', 'translucent']) {
    const m = mesh[k];
    if (m) t.push(m.position.buffer, m.tex.buffer, m.light.buffer, m.corner.buffer);
  }
  return t;
}

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.op === 'init') {
      const map = new Map(msg.layers || []);
      const missing = map.has('missing') ? map.get('missing') : 0;
      bindTextures({ layer: (k) => (map.has(k) ? map.get(k) : missing) });
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.op === 'generate') {
      const out = { blocks: new Uint16Array(COLUMN_VOLUME), biomes: new Uint8Array(256) };
      generateColumn(msg.seed >>> 0, msg.cx, msg.cz, msg.preset, out);
      self.postMessage({ id: msg.id, ok: true, cx: msg.cx, cz: msg.cz, blocks: out.blocks, biomes: out.biomes }, [out.blocks.buffer, out.biomes.buffer]);
    } else if (msg.op === 'mesh') {
      if (!texturesBound()) throw new Error('worker: textures not bound (init first)');
      const mesh = meshSection(msg.blocks, msg.light, msg.opts || {});
      self.postMessage({ id: msg.id, ok: true, mesh, version: msg.version }, meshTransfer(mesh));
    } else {
      self.postMessage({ id: msg.id, ok: false, error: 'unknown op ' + msg.op });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
