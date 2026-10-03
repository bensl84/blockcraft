// OWNER LANE: CORE-C (P1 worker offload; CORE-B's generateColumn runs here too). STUB written by LEAD.
// build.mjs bundles THIS file as a classic IIFE and injects it as WORKER_SRC (core/constants.js). The main
// thread creates it with new Worker(URL.createObjectURL(new Blob([WORKER_SRC]))) inside try/catch and falls
// back to main-thread work on any failure (module workers and importScripts fail from file://).
// Protocol (SPEC §5.3.5): request {id, op: 'generate'|'mesh', ...} -> response {id, ok, ...} with transferables.
//
// Stub behaviour: answers every request with {ok: false} so callers fall back to the main thread.

/* eslint-env worker */
self.onmessage = (e) => {
  const msg = e.data || {};
  self.postMessage({ id: msg.id, ok: false, error: 'worker not implemented' });
};
