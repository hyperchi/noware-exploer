import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DashboardUpdates, canReloadDashboard } from '../public/dashboard/js/updates.js';

const CURRENT = 'a'.repeat(64);
const NEXT = 'b'.repeat(64);
const CHECK_MS = 5 * 60 * 1000;

/** Install deterministic browser boundaries without a real timer or navigation. */
function browser(t) {
  const document = new EventTarget();
  document.hidden = false;
  document.querySelector = () => null;
  document.activeElement = null;
  let now = 100000;
  const reload = t.mock.fn();
  for (const [name, value] of Object.entries({ document, location: { reload } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const timers = [];
  t.mock.method(globalThis, 'setInterval', (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ version: CURRENT }));
  const notice = t.mock.fn();
  const updates = new DashboardUpdates({ version: CURRENT, canReload: () => true, onUpdate: notice });
  return { document, fetch, notice, reload, timers, updates, advance: (ms) => { now += ms; } };
}

/** Drain the fetch and response-body promises without advancing the clock. */
async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

test('one checker limits focus and timer requests to five minutes and pauses hidden', async (t) => {
  const env = browser(t);
  env.updates.start();
  env.updates.start();
  await settle();
  assert.equal(env.timers.length, 1);
  assert.equal(env.timers[0].delay, CHECK_MS);
  assert.equal(env.fetch.mock.callCount(), 1);
  assert.equal(env.fetch.mock.calls[0].arguments[1].cache, 'no-store');
  env.document.dispatchEvent(new Event('visibilitychange'));
  await env.updates.check();
  assert.equal(env.fetch.mock.callCount(), 1);
  env.document.hidden = true;
  env.advance(CHECK_MS);
  await env.updates.check();
  assert.equal(env.fetch.mock.callCount(), 1);
  env.document.hidden = false;
  env.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(env.fetch.mock.callCount(), 2);
  assert.equal(env.reload.mock.callCount(), 0);
  env.updates.stop();
  env.advance(CHECK_MS);
  env.document.dispatchEvent(new Event('visibilitychange'));
  await env.updates.check();
  assert.equal(env.fetch.mock.callCount(), 2);
});

test('a new release reloads an idle viewer immediately', async (t) => {
  const env = browser(t);
  env.fetch.mock.mockImplementation(async () => Response.json({ version: NEXT }));
  await env.updates.check();
  assert.equal(env.notice.mock.callCount(), 1);
  assert.equal(env.reload.mock.callCount(), 1);
});

test('device work defers reload and is retried without another request', async (t) => {
  const env = browser(t);
  env.updates.canReload = () => false;
  env.fetch.mock.mockImplementation(async () => Response.json({ version: NEXT }));
  await env.updates.check();
  await env.updates.check();
  assert.equal(env.notice.mock.callCount(), 1);
  assert.equal(env.reload.mock.callCount(), 0);
  env.updates.canReload = () => true;
  await env.updates.check();
  assert.equal(env.reload.mock.callCount(), 1);
  assert.equal(env.fetch.mock.callCount(), 1);
});

test('edited forms stay protected even after focus leaves the field', async (t) => {
  const env = browser(t);
  env.updates.start();
  await settle();
  env.document.dispatchEvent(new Event('input'));
  env.fetch.mock.mockImplementation(async () => Response.json({ version: NEXT }));
  env.advance(CHECK_MS);
  await env.updates.check();
  await env.updates.check();
  assert.equal(env.notice.mock.callCount(), 1);
  assert.equal(env.reload.mock.callCount(), 0);
});

test('reload safety protects USB, firmware, syncing, dialogs and focused editors', (t) => {
  const env = browser(t);
  assert.equal(canReloadDashboard({ devices: [] }), true);
  for (const flag of ['isConnected', 'isSyncing', 'heldForFlash', 'inFlashGrace']) {
    assert.equal(canReloadDashboard({ devices: [{ [flag]: true }] }), false);
    assert.equal(canReloadDashboard({ devices: [{ isRemote: true, [flag]: true }] }), true);
  }
  env.document.querySelector = () => ({});
  assert.equal(canReloadDashboard({ devices: [] }), false);
  env.document.querySelector = () => null;
  env.document.activeElement = { matches: () => true };
  assert.equal(canReloadDashboard({ devices: [] }), false);
});

test('offline, login, server errors and malformed release markers cannot trigger reloads', async (t) => {
  const env = browser(t);
  const warning = t.mock.method(console, 'warn', () => {});
  for (const response of [
    () => { throw new TypeError('offline'); },
    () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
    () => Response.json({ version: NEXT }, { status: 503 }),
    () => Response.json({ version: 'invalid' }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    env.fetch.mock.mockImplementation(async () => response());
    env.advance(CHECK_MS);
    await env.updates.check();
    assert.equal(env.updates.checking, false);
  }
  assert.equal(env.notice.mock.callCount(), 0);
  assert.equal(env.reload.mock.callCount(), 0);
  assert.equal(warning.mock.callCount(), 2);
});

test('in-flight checks cannot overlap or reload after stop', async (t) => {
  const env = browser(t);
  let complete;
  env.fetch.mock.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const first = env.updates.check();
  env.advance(CHECK_MS);
  await env.updates.check();
  assert.equal(env.fetch.mock.callCount(), 1);
  env.updates.stop();
  complete(Response.json({ version: NEXT }));
  await first;
  assert.equal(env.notice.mock.callCount(), 0);
  assert.equal(env.reload.mock.callCount(), 0);
});

test('development builds do not create version requests or timers', async (t) => {
  const env = browser(t);
  env.updates.version = null;
  env.updates.start();
  await env.updates.check();
  assert.equal(env.timers.length, 0);
  assert.equal(env.fetch.mock.callCount(), 0);
});

test('production marker and loaded JS share the hash of the shipped dashboard', async () => {
  const dashboard = new URL('../dist/dashboard/', import.meta.url);
  const marker = JSON.parse(fs.readFileSync(new URL('version.json', dashboard), 'utf8'));
  const { DASHBOARD_VERSION } = await import(new URL('js/release.js', dashboard));
  assert.match(marker.version, /^[a-f0-9]{64}$/);
  assert.equal(marker.version, DASHBOARD_VERSION);
  const hash = createHash('sha256');
  for (const name of fs.readdirSync(dashboard, { recursive: true }).sort()) {
    if (name === 'js/release.js' || name === 'version.json') continue;
    const file = path.join(dashboard.pathname, name);
    if (fs.statSync(file).isFile()) hash.update(name).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  assert.equal(marker.version, hash.digest('hex'));
});
