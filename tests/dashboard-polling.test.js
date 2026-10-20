import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HomeFeed } from '../public/dashboard/js/home-api.js';
import { ShareFeed, SharePublisher, RemoteDevice } from '../public/dashboard/js/share.js';

/** Install browser boundaries with a deterministic clock and captured timers. */
function browser(t, respond) {
  const document = new EventTarget();
  document.hidden = false;
  const timers = [];
  const requests = [];
  let now = 100000;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = document;
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json(respond(url), { status: url.includes('/missing') ? 404 : 200 });
  });
  return { document, timers, requests, advance: (ms) => { now += ms; } };
}

/** Wait for fetch and JSON promises to settle without advancing the clock. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

/** Build an active relay response without requiring hardware. */
function sharedCube() {
  return { active: true, online: true, publisher: 'other', serverNow: Date.now() / 1000,
    meta: {}, live: [{ timestamp: Date.now() / 1000 }], historyVersion: 1 };
}

/** Build the registry boundary consumed by the shared feed. */
function registry() {
  return { addRemote() {}, removeRemote() {} };
}

test('home feed polls at ten seconds and skips hidden tabs', async (t) => {
  const env = browser(t, (url) => url.endsWith('/me') ? { households: [{ id: 'home' }] } : {});
  const feed = new HomeFeed();
  await feed.start();
  assert.equal(env.timers[0].delay, 10000);
  assert.equal(env.requests.length, 3);
  env.document.hidden = true;
  env.advance(10000);
  await env.timers[0].callback();
  assert.equal(env.requests.length, 3);
  env.document.hidden = false;
  env.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(env.requests.length, 4);
  env.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(env.requests.length, 4);
});

test('missing household is replaced once, or polling stops without a replacement', async (t) => {
  const env = browser(t, (url) => url.endsWith('/me') ? { households: [{ id: 'live' }] } : {});
  const feed = new HomeFeed();
  feed.available = true;
  feed.householdId = 'missing';
  await feed.refresh();
  assert.equal(feed.householdId, 'live');
  await feed.refresh();
  assert.ok(env.requests.some(({ url }) => url.endsWith('/live')));
  feed.householdId = 'missing';
  t.mock.method(globalThis, 'fetch', async (url) => Response.json(
    url.endsWith('/me') ? { households: [] } : {}, { status: url.endsWith('/me') ? 200 : 404 }));
  await feed.refresh();
  assert.equal(feed.householdId, null);
  const fetchCount = fetch.mock.callCount();
  await feed.refresh();
  assert.equal(fetch.mock.callCount(), fetchCount);
});

test('failed household recovery cannot cycle through stale household IDs', async (t) => {
  browser(t, () => ({}));
  const feed = new HomeFeed();
  feed.available = true;
  feed.householdId = 'missing';
  feed.me = { households: [{ id: 'missing' }, { id: 'also-deleted' }] };
  t.mock.method(globalThis, 'fetch', async (url) => Response.json({ error: 'Unavailable' },
    { status: url.endsWith('/me') ? 503 : 404 }));
  await feed.refresh();
  assert.equal(feed.householdId, null);
  assert.equal(feed.error, 'Unavailable');
});

test('idle shared feed polls once per thirty seconds despite focus events or repeated start', async (t) => {
  const env = browser(t, () => ({ active: false }));
  const feed = new ShareFeed(registry());
  feed.start();
  feed.start();
  await settle();
  assert.equal(env.timers.length, 1);
  assert.equal(env.requests.length, 1);
  for (let i = 0; i < 2; i++) {
    env.advance(10000);
    env.document.dispatchEvent(new Event('visibilitychange'));
    await env.timers[0].callback();
  }
  assert.equal(env.requests.length, 1);
  env.advance(10000);
  await env.timers[0].callback();
  assert.equal(env.requests.length, 2);
});

test('active shared feed uses ten seconds, pauses hidden, and permits explicit sync', async (t) => {
  const env = browser(t, sharedCube);
  const feed = new ShareFeed(registry());
  await feed.poll();
  env.advance(9999);
  await feed.poll();
  assert.equal(env.requests.length, 1);
  env.advance(1);
  await feed.poll();
  assert.equal(env.requests.length, 2);
  await feed.remote.syncHistory();
  assert.equal(env.requests.length, 3);
  assert.ok(env.requests[2].url.includes('history_version=-1'));
  env.document.hidden = true;
  env.advance(10000);
  await feed.poll();
  assert.equal(env.requests.length, 3);
});

test('publisher batches for ten seconds and remote status tolerates that cadence', async (t) => {
  const env = browser(t, () => ({}));
  const device = new EventTarget();
  device.isConnected = true;
  const publisher = new SharePublisher(device);
  assert.equal(env.timers[0].delay, 10000);
  device.dispatchEvent(new CustomEvent('reading', { detail: { timestamp: 100 } }));
  device.dispatchEvent(new CustomEvent('reading', { detail: { timestamp: 101 } }));
  await env.timers[0].callback();
  assert.equal(env.requests.length, 1);
  assert.equal(JSON.parse(env.requests[0].options.body).readings.length, 2);
  const remote = new RemoteDevice();
  remote.online = true;
  remote.lastReading = { timestamp: 100 };
  env.advance(25000);
  assert.equal(remote.isOnline, true);
  env.advance(5000);
  assert.equal(remote.isOnline, false);
  publisher.stop();
});
