import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createHomeStore } from '../lib/home-store.js';
import { HomeService } from '../lib/home-service.js';
import { OpenMeteoOutdoorProvider } from '../lib/outdoor-provider.js';
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
    assert.equal((await teammate('PUT', `/api/home/households/${office.id}/location`, { latitude: 37.7, longitude: -122.4, label: 'San Francisco, CA 94110', enabled: true })).status, 200);
    assert.equal((await teammate('PUT', `/api/home/households/${privateId}/location`, { latitude: 37.7, longitude: -122.4, enabled: true })).status, 403);
    assert.equal((await guest('PUT', `/api/home/households/${office.id}/location`, { latitude: 37.7, longitude: -122.4, enabled: true })).status, 403);
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

test('a Noso browser publishing without a device key feeds the shared office room', async () => {
  const store = createHomeStore({ env: {} });
  const app = createApp({ homeStore: store, homeService: new HomeService({ store }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = async email => {
    const cookie = sessionCookie(await createSession({ email, sub: email }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' }));
    return (method, url, body) => fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  };
  try {
    const publisher = await client('publisher@noso.so'), teammate = await client('teammate@noso.so');
    const t = Date.now() / 1000;
    assert.equal((await publisher('POST', '/api/cube/live', { publisher: 'browser-publisher', sentAt: t, readings: [reading(t)], meta: { name: 'Noware' } })).status, 200);
    const office = store.householdOfDevice('aircube-office');
    assert.equal(office.name, 'Noso Office');
    assert.equal(office.location.label, 'San Francisco, CA 94107');
    assert.deepEqual(office.rooms.map(r => r.name), ['Office']);
    store.upsertHousehold({ ...office, location: null });
    assert.equal((await publisher('POST', '/api/cube/live', { publisher: 'browser-publisher', sentAt: t + 1, readings: [reading(t + 1)], meta: { name: 'Noware' } })).status, 200);
    assert.equal(store.householdOfDevice('aircube-office').location, null);
    store.upsertHousehold({ ...store.householdOfDevice('aircube-office'), location: { ...office.location } });
    const me = await (await teammate('GET', '/api/home/me')).json();
    assert.deepEqual(me.households.map(h => [h.id, h.shared]), [[office.id, true]]);
    assert.equal((await teammate('GET', `/api/home/households/${office.id}/summary`)).status, 200);
  } finally {
    server.close();
  }
});

test('a US ZIP code finds an area without an Open-Meteo key, and city search explains itself', async () => {
  const urls = [];
  const provider = new OpenMeteoOutdoorProvider({ production: true, apiKey: '', fetchImpl: async url => { urls.push(String(url)); return String(url).endsWith('/00000') ? new Response('{}', { status: 404 }) : Response.json({ places: [{ 'place name': 'San Francisco', 'state abbreviation': 'CA', latitude: '37.7509', longitude: '-122.4153' }] }); } });
  assert.deepEqual(await provider.searchLocations('94110'), [{ latitude: 37.8, longitude: -122.4, label: 'San Francisco, CA 94110', precision: 'area', enabled: true }]);
  assert.deepEqual(await provider.searchLocations('00000'), []);
  await assert.rejects(provider.searchLocations('San Francisco'), /ZIP code/);
  assert.equal(urls.length, 2);
});

test('without an Open-Meteo key, production uses the nearest AirNow monitor', async () => {
  const now = Date.UTC(2026, 9, 30, 22, 30) / 1000;
  const sites = ['840060750005|PM2.5|0005|Far Away|Active|||R9|40.0|-120.0|', '060750005|PM2.5|0005|San Francisco|Active|||R9|37.7658|-122.3978|', '060010011|PM2.5|0011|Oakland West|Active|||R9|37.8148|-122.2823|'].join('\n');
  const fetchImpl = async url => {
    const u = String(url);
    if (u.endsWith('monitoring_site_locations.dat')) return new Response(sites);
    const hour = u.match(/_(\d{10})\.dat$/)[1];
    if (hour === '2026103021') return new Response('', { status: 404 });
    return new Response(`10/30/26|20:00|060750005|San Francisco|-8|PM2.5|UG/M3|4|BAAD\n10/30/26|20:00|060010011|Oakland West|-8|PM2.5|UG/M3|7|BAAD\n10/30/26|20:00|060750005|San Francisco|-8|OZONE|PPB|23|BAAD`);
  };
  const provider = new OpenMeteoOutdoorProvider({ production: true, apiKey: '', fetchImpl, clock: () => now });
  const outdoor = await provider.getOutdoor({ location: { latitude: 37.8, longitude: -122.4, enabled: true } });
  assert.equal(outdoor.status, 'available');
  assert.match(outdoor.provider, /San Francisco monitor/);
  assert.equal(outdoor.pm25, 4);
  assert.equal(outdoor.hourlyPm25.length, 11);
  const nowhere = await provider.getOutdoor({ location: { latitude: 10, longitude: 10, enabled: true } });
  assert.equal(nowhere.status, 'unavailable');
});
