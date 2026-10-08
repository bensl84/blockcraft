import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldLock, PING_MS } from '../src/save/worldlock.js';

// Queue delivery explicitly: all contenders send before any peer receives.
function broadcastHarness() {
  const peers = [], messages = [];
  class Channel {
    constructor() { this.listeners = new Set(); peers.push(this); }
    postMessage(data) { for (const peer of peers) if (peer !== this) messages.push(() => {
      peer.onmessage?.({ data });
      for (const listener of peer.listeners) listener({ data });
    }); }
    addEventListener(_, listener) { this.listeners.add(listener); }
    removeEventListener(_, listener) { this.listeners.delete(listener); }
  }
  return {
    create: () => createWorldLock({ locks: null, BroadcastChannel: Channel }),
    flush(reverse = false) { while (messages.length) (reverse ? messages.pop() : messages.shift())(); },
    peers,
  };
}

for (const reverse of [false, true]) test(`simultaneous broadcast contenders elect one owner (${reverse ? 'reverse' : 'FIFO'} delivery)`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let nonce = 0;
  t.mock.method(globalThis.crypto, 'randomUUID', () => String(nonce++).padStart(8, '0'));
  const h = broadcastHarness();
  const peers = Array.from({ length: 8 }, h.create);
  for (let round = 0; round < 20; round++) {
    const pending = peers.map(peer => peer.claim('world'));
    h.flush(reverse);
    t.mock.timers.tick(PING_MS);
    const results = await Promise.all(pending);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(peers.filter(peer => peer.heldId === 'world').length, 1);
    peers.forEach(peer => peer.release());
  }
});

test('release cancels a pending claim and permits an immediate same-world retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = broadcastHarness(), peer = h.create();
  const old = peer.claim('world');
  peer.release();
  const retry = peer.claim('world');
  assert.notEqual(old, retry);
  t.mock.timers.tick(PING_MS);
  assert.equal(await old, false);
  assert.equal(await retry, true);
  assert.equal(peer.heldId, 'world');
  assert.equal(h.peers[0].listeners.size, 0);
});

test('superseding a claim cannot report stale success or overwrite the newer world', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const peer = broadcastHarness().create();
  const old = peer.claim('old');
  const next = peer.claim('next');
  assert.equal(peer.claim('next'), next);
  t.mock.timers.tick(PING_MS);
  assert.equal(await old, false);
  assert.equal(await next, true);
  assert.equal(peer.heldId, 'next');
});

test('established broadcast owner wins; release allows a sequential reclaim', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = broadcastHarness(), a = h.create(), b = h.create();
  async function claim(peer) {
    const p = peer.claim('world'); h.flush(); t.mock.timers.tick(PING_MS); return p;
  }
  assert.equal(await claim(a), true);
  assert.equal(await claim(b), false);
  a.release();
  assert.equal(await claim(b), true);
  assert.equal(a.heldId, null);
});

test('release before an asynchronous Web Locks grant prevents ownership', async () => {
  const callbacks = [];
  const peer = createWorldLock({ locks: { request(_, __, callback) { callbacks.push(callback); return Promise.resolve(); } }, BroadcastChannel: null });
  const old = peer.claim('world');
  peer.release();
  const next = peer.claim('world');
  callbacks[0]({});
  assert.equal(await old, false);
  callbacks[1]({});
  assert.equal(await next, true);
  peer.release();
});

for (const failure of ['throw', 'reject']) test(`Web Locks ${failure} does not report unowned success`, async () => {
  const peer = createWorldLock({ locks: { request() {
    if (failure === 'throw') throw new Error('unavailable');
    return Promise.reject(new Error('unavailable'));
  } }, BroadcastChannel: null });
  assert.equal(await peer.claim('world'), false);
  assert.equal(peer.heldId, null);
});

test('no-API fallback preserves compatibility but release before settlement cancels success', async () => {
  const peer = createWorldLock({ locks: null, BroadcastChannel: null });
  const pending = peer.claim('world');
  peer.release();
  assert.equal(await pending, false);
  assert.equal(peer.heldId, null);
  assert.equal(await peer.claim('world'), true);
  assert.equal(peer.heldId, 'world');
});

test('equal contention nonces fail closed, and different worlds remain independent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis.crypto, 'randomUUID', () => 'collision');
  const h = broadcastHarness(), a = h.create(), b = h.create();
  let pending = [a.claim('same'), b.claim('same')];
  h.flush(); t.mock.timers.tick(PING_MS);
  assert.deepEqual(await Promise.all(pending), [false, false]);
  pending = [a.claim('one'), b.claim('two')];
  h.flush(); t.mock.timers.tick(PING_MS);
  assert.deepEqual(await Promise.all(pending), [true, true]);
});

test('a failed broadcast send cannot establish ownership', async () => {
  class BrokenChannel {
    postMessage() { throw new Error('closed'); }
    addEventListener() {}
    removeEventListener() {}
  }
  const peer = createWorldLock({ locks: null, BroadcastChannel: BrokenChannel });
  assert.equal(await peer.claim('world'), false);
  assert.equal(peer.heldId, null);
});

test('release after the probe timer but before claim settlement rejects stale success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const peer = broadcastHarness().create();
  const pending = peer.claim('world');
  t.mock.timers.tick(PING_MS);
  peer.release();
  assert.equal(await pending, false);
  assert.equal(peer.heldId, null);
});
