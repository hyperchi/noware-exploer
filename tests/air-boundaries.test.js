import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { createSession, sessionCookie } from '../lib/session.js';
import { HomeStore } from '../lib/home-store.js';
import { HomeService } from '../lib/home-service.js';
import { demoEnabled } from '../lib/demo-seed.js';
import { cleanReading } from '../api/cube.js';
import { RoomEngine, normalizeReading, capabilitiesFromReading, notificationIntents } from '../lib/air-intelligence/index.js';

const reading = t => ({ timestamp: t, source: 'physical', temperatureC: 22, humidity: 45, etvoc: 20, eco2: 400, pmPresent: true, pmValid: true, pm25: 4, pm10: 5, pm1: 2, pm4: 4, hasTrueCo2: true, co2: 600 });

test('missing and invalid measurements are withheld; no capabilities invented from an empty frame', () => {
  const r = cleanReading({ timestamp: 100, pmPresent: true, pmValid: true, pm25: null, humidity: 150 });
  assert.equal(r.pm25, null); assert.equal(r.pmValid, false);
  const s = normalizeReading(r);
  assert.equal(s.channels.hum, null); assert.equal(s.channels.tvoc, null); assert.equal(s.channels.temp, null);
  assert.equal(capabilitiesFromReading({}).temperature, false);
  const e = new RoomEngine(); e.ingestReadings([{ timestamp: 100 }]);
  assert.equal(e.assess({ now: 100 }).currentStatus.status, null);
});

test('rollups survive raw retention and restart; invalid latest channels cannot reuse old values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noware-store-'));
  try {
    const e = new RoomEngine({ deviceKey: 'cube' });
    e.ingestReadings(Array.from({ length: 300 }, (_, i) => reading(100000 + i * 300)));
    assert.ok(e.archive.length > 280); assert.ok(e.samples.length < 30);
    const store = new HomeStore({ persistPath: path.join(dir, 'store.json') });
    store.saveEngine('cube', e.toJSON()); store.flush();
    const restored = new HomeService({ store: new HomeStore({ persistPath: path.join(dir, 'store.json') }) }).engineFor('cube');
    assert.ok(restored.allSamples().length >= 299);
    const t = e.lastReadingAt + 1;
    restored.ingestReadings([{ ...reading(t), etvocValid: false, etvoc: 0 }]);
    const summary = restored.assess({ now: t });
    assert.equal(summary.measurements.find(m => m.channel === 'tvoc').value, null);
    restored.lastReading.sensorMissing = true;
    assert.equal(restored.assess({ now: t }).currentStatus.status, null);
    assert.deepEqual(notificationIntents(restored.assess({ now: t + 1000 })), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('production cannot enable demo seeds through an environment override', () => {
  assert.equal(demoEnabled({ NODE_ENV: 'production', NOWARE_DEMO: '1' }), false);
});

test('relay isolates owners; device keys cannot steal a home; providers require consent and staff authorization', async () => {
  process.env.SESSION_SECRET = 'boundary-test-secret'.repeat(4);
  process.env.NOWARE_DEMO = '0';
  process.env.ADMIN_EMAILS = 'admin@noso.so';
  const store = new HomeStore();
  const service = new HomeService({ store });
  const app = createApp({ homeStore: store, homeService: service });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = async email => {
    const cookie = sessionCookie(await createSession({ email, sub: email }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' }));
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
  };
  try {
    const owner = await client('owner@noso.so'), other = await client('other@noso.so'), admin = await client('admin@noso.so'), tech = await client('tech@noso.so'), techB = await client('tech-b@noso.so');
    const t = Date.now() / 1000;
    const body = { publisher: 'publisher-owner', sentAt: t, readings: [reading(t)], meta: { deviceKey: 'physical-unique', roomName: 'Office' } };
    assert.equal((await owner('POST', '/api/cube/live', body)).status, 200);
    assert.equal((await other('GET', '/api/cube')).body.active, false);
    assert.equal((await other('POST', '/api/cube/live', body)).status, 403);
    const hid = store.householdsForMember('owner@noso.so')[0].id;
    assert.equal((await other('GET', `/api/home/households/${hid}/report`)).status, 403);
    assert.equal((await owner('POST', '/api/home/providers', { name: 'Fake', members: ['owner@noso.so'] })).status, 403);
    const provider = (await admin('POST', '/api/home/providers', { name: 'Actual HVAC', members: ['tech@noso.so'] })).body.contractor;
    await admin('POST', '/api/home/providers', { name: 'Other HVAC', members: ['tech-b@noso.so'] });
    assert.equal((await owner('POST', `/api/home/households/${hid}/provider`, { contractorId: provider.id })).body.relationship.shareInsights, false);
    assert.equal((await tech('GET', `/api/contractor/customers/${hid}`)).status, 403);
    await owner('PATCH', `/api/home/households/${hid}`, { shareInsights: true });
    assert.equal((await tech('GET', `/api/contractor/customers/${hid}`)).status, 200);
    assert.equal((await techB('GET', `/api/contractor/customers/${hid}`)).status, 403);
    assert.equal((await tech('GET', '/api/cube')).body.active, false);
    assert.equal((await tech('GET', `/api/home/households/${hid}/rooms/${store.getHousehold(hid).rooms[0].id}/series`)).status, 403);
    await owner('PATCH', `/api/home/households/${hid}`, { shareInsights: false });
    assert.equal((await tech('GET', `/api/contractor/customers/${hid}`)).status, 403);
  } finally {
    service.stopAll(); await new Promise(r => server.close(r));
    delete process.env.SESSION_SECRET; delete process.env.NOWARE_DEMO; delete process.env.ADMIN_EMAILS;
  }
});

test('cloud snapshots reload on restart and reject concurrent writers without overwriting', async () => {
  const { CloudHomeStore } = await import('../lib/cloud-home-store.js');
  let generation = 0, saved;
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      if (Number(new URL(url).searchParams.get('ifGenerationMatch')) !== generation) return new Response('', { status: 412 });
      saved = opts.body; generation++;
      return Response.json({ generation: String(generation) });
    }
    if (!saved) return new Response('', { status: 404 });
    return new URL(url).searchParams.has('alt') ? new Response(saved) : Response.json({ generation: String(generation) });
  };
  const args = { bucket: 'test-private', fetchImpl, tokenProvider: async () => 'test-token' };
  const store = new CloudHomeStore(args); await store.ready;
  store.upsertHousehold({ id: 'home', name: 'Persisted', members: ['owner@noso.so'] });
  await store.flush();
  const restored = new CloudHomeStore(args); await restored.ready;
  assert.equal(restored.getHousehold('home').name, 'Persisted');
  await store.flush();
  await assert.rejects(restored.flush(), /Concurrent store writer/);
  clearTimeout(store._timer); clearTimeout(restored._timer);
});

test('live numbers use the latest sample while inference smoothing uses recent live spacing', () => {
  const e = new RoomEngine();
  e.ingestSlots(Array.from({ length: 300 }, (_, i) => ({ timestamp: 100000 + i * 300, sequence: i, pm25Avg: 4 })), { trueCo2: true });
  const start = 190000;
  e.ingestReadings(Array.from({ length: 600 }, (_, i) => ({ ...reading(start + i), pm25: i < 500 ? 4 : 40, pm1: i < 500 ? 2 : 30 })));
  const s = e.assess({ now: start + 599, debug: true });
  assert.equal(s.debug.features.pm25.current, 40);
  assert.equal(s.measurements.find(m => m.channel === 'pm25').value, 40);
  assert.ok(s.debug.features.pm1.current <= s.debug.features.pm25.current);
});

test('offline scenarios do not retimestamp old samples as live; warm-up demo starts warming', () => {
  let now = 200000;
  const store = new HomeStore(), service = new HomeService({ store, clock: () => now });
  const h = store.upsertHousehold({ id: 'test', members: [], rooms: [{ id: 'room', name: 'Room', deviceKeys: [] }], equipment: [] });
  try {
    service.startScenario(h, h.rooms[0], 'sensor_offline', { withHistory: false, offsetS: 900 });
    const offline = service.engineFor('sim:test:room').assess({ now });
    assert.equal(offline.deviceHealth.state, 'offline'); assert.equal(offline.primaryIssue, null);
    service.startScenario(h, h.rooms[0], 'sensor_warming_up', { withHistory: false });
    const warm = service.engineFor('sim:test:room').assess({ now });
    assert.equal(warm.deviceHealth.state, 'warming_up'); assert.equal(warm.activeEvents.length, 0);
  } finally { service.stopAll(); }
});
