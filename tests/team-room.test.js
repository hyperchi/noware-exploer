import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createHomeStore } from '../lib/home-store.js';
import { HomeService } from '../lib/home-service.js';
import { createSession, sessionCookie } from '../lib/session.js';

process.env.SESSION_SECRET ||= 'team-room-test-secret-team-room-test-secret';
process.env.NOWARE_DEMO = '0';
const reading = t => ({ timestamp: t, temperatureC: 22, humidity: 50, co2: 500, pm25: 3, pm1: 2, pm4: 4, pm10: 5, etvoc: 100, hasTrueCo2: true, pmPresent: true, pmValid: true });

test('the office room is readable by every Noso account and nothing else is', async () => {
  const store = createHomeStore({ env: {} });
  const app = createApp({ homeStore: store, homeService: new HomeService({ store }) });
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
    const owner = await client('owner@noso.so'), teammate = await client('teammate@noso.so'), guest = await client('shanshan0343@gmail.com');
    const t = Date.now() / 1000;
    const publish = (who, publisher, deviceKey, at = t) => who('POST', '/api/cube/live', { publisher, sentAt: at, readings: [reading(at)], meta: { deviceKey, roomName: 'Office' } });

    assert.equal((await publish(owner, 'publisher-private', 'owner-private-home')).status, 200);
    const privateId = store.householdOfDevice('owner-private-home').id;
    assert.deepEqual((await teammate('GET', '/api/home/me')).body.households, []);

    const office = store.upsertHousehold({ name: 'Noso Office', members: ['owner@noso.so'], rooms: [], equipment: [], profile: { concerns: {} }, location: { latitude: 37.8, longitude: -122.4, label: 'San Francisco', enabled: true } });
    const room = store.addRoom(office.id, { name: 'Office', type: 'office' });
    store.attachDevice('aircube-office', { householdId: office.id, roomId: room.id, name: 'Office cube', source: 'physical' });

    const me = (await teammate('GET', '/api/home/me')).body;
    assert.deepEqual(me.households.map(h => [h.id, h.shared]), [[office.id, true]]);
    const summary = await teammate('GET', `/api/home/households/${office.id}/summary`);
    assert.equal(summary.status, 200);
    assert.ok(Array.isArray(summary.body.rooms[0].measurements));
    const view = (await teammate('GET', `/api/home/households/${office.id}`)).body;
    assert.equal(view.isMember, false);
    assert.equal(view.household.location.label, 'San Francisco');
    assert.equal(view.household.members, undefined);
    assert.equal((await teammate('GET', `/api/home/households/${office.id}/rooms/${room.id}/series`)).status, 200);

    // Read-only for the team.
    assert.equal((await teammate('PATCH', `/api/home/households/${office.id}`, { name: 'Mine' })).status, 403);
    assert.equal((await teammate('PUT', `/api/home/households/${office.id}/location`, { enabled: false })).status, 403);
    assert.equal((await teammate('POST', `/api/home/households/${office.id}/observations`, { roomId: room.id, type: 'cooking' })).status, 403);
    // Other homes stay private, guests get nothing.
    assert.equal((await teammate('GET', `/api/home/households/${privateId}/summary`)).status, 403);
    assert.equal((await guest('GET', `/api/home/households/${office.id}/summary`)).status, 403);
    assert.deepEqual((await guest('GET', '/api/home/me')).body.households, []);
    assert.equal((await teammate('POST', '/api/cube/live', { publisher: 'publisher-x', sentAt: t, readings: [], meta: { deviceKey: 'owner-private-home' } })).status, 403);
    assert.equal((await guest('POST', '/api/cube/live', { publisher: 'publisher-g', sentAt: t, readings: [], meta: { deviceKey: 'aircube-office' } })).status, 403);
  } finally {
    server.close();
  }
});

test('a teammate can publish the office cube into the shared room after the relay is free', async () => {
  const store = createHomeStore({ env: {} });
  const app = createApp({ homeStore: store, homeService: new HomeService({ store }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = sessionCookie(await createSession({ email: 'teammate@noso.so', sub: 'x' }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' }));
  try {
    const office = store.upsertHousehold({ name: 'Noso Office', members: ['owner@noso.so'], rooms: [], equipment: [], profile: {} });
    const room = store.addRoom(office.id, { name: 'Office', type: 'office' });
    store.attachDevice('aircube-office', { householdId: office.id, roomId: room.id, name: 'Office cube', source: 'physical' });
    const t = Date.now() / 1000;
    const res = await fetch(base + '/api/cube/live', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ publisher: 'publisher-teammate', sentAt: t, readings: [reading(t)], meta: { deviceKey: 'aircube-office', roomName: 'Office' } }) });
    assert.equal(res.status, 200);
    assert.equal(store.householdOfDevice('aircube-office').id, office.id);
    assert.deepEqual(store.getHousehold(office.id).members, ['owner@noso.so']);
    assert.equal(store.householdsForMember('teammate@noso.so').length, 0);
  } finally {
    server.close();
  }
});
