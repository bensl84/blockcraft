// OWNER: LEAD (shared, frozen). Stub registry.
//
// Every STUB module calls registerStub('<name>') at import time. When a lane finishes a module it
// DELETES that call. tools/smoke.mjs marks scenarios "pending" while any of their required stub
// names are still registered, and `--strict` turns pending into failure (integration phase).
//
// Stub names (SPEC §3.3): textures icons worldgen world lighting mesher renderer sky input player
// physics raycast interaction mobs items survival invui hud crafting furnace audio music menus save
// font touch kid mechanics fx

const STUBS = new Set();

export function registerStub(name) { STUBS.add(name); }
export function isStub(name) { return STUBS.has(name); }
export function listStubs() { return [...STUBS].sort(); }
