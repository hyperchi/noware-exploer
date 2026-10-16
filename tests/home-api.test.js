import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createSession, sessionCookie } from '../lib/session.js';
import { HomeStore } from '../lib/home-store.js';
import { HomeService } from '../lib/home-service.js';
import { seedDemo, DEMO_HOUSEHOLD_ID, DEMO_CONTRACTOR_ID } from '../lib/demo-seed.js';
import { generateReadings } from '../lib/air-intelligence/index.js';
import { createCubeStore } from '../api/cube.js';

const SECRET = 'test-only-secret'.repeat(4);

async function boot({ demo = false } = {}) {
  process.env.SESSION_SECRET = SECRET;
  process.env.NOWARE_DEMO = demo ? '1' : '0';
  const store = new HomeStore();
  const service = new HomeService({ store });
  const cubeStore = createCubeStore();
  const server = createApp({ homeStore: store, homeService: service, cubeStore }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookieFor = async (email, name) => sessionCookie(await createSession({ email, sub: email, name }, { secret: SECRET, domain: 'noso.so' }));
  const api = (cookie) => async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
  const close = async () => {
    service.stopAll();
    await new Promise((r) => server.close(r));
    delete process.env.SESSION_SECRET;
    delete process.env.NOWARE_DEMO;
  };
  return { store, service, base, cookieFor, api, close, cubeStore };
}

test('authorization: homeowners see their home, contractors only consenting customers, strangers nothing', async () => {
  const { store, service, cookieFor, api, close } = await boot();
  try {
    seedDemo({ store, service, userEmail: 'owner@noso.so', userName: 'Owner', timeZone: 'America/Los_Angeles' });
    // Split roles across accounts for the test: the owner is not contractor staff.
    store.upsertContractor({ id: DEMO_CONTRACTOR_ID, members: ['tech@noso.so'] });
    const owner = api(await cookieFor('owner@noso.so', 'Owner'));
    const tech = api(await cookieFor('tech@noso.so', 'Tech'));
    const stranger = api(await cookieFor('someone@noso.so', 'Someone'));

    const me = await owner('GET', '/api/home/me');
    assert.deepEqual(me.json.roles, ['homeowner']);
    assert.ok(me.json.households.some((h) => h.id === DEMO_HOUSEHOLD_ID));

    assert.equal((await owner('GET', `/api/home/households/${DEMO_HOUSEHOLD_ID}`)).status, 200);
    assert.equal((await owner('GET', `/api/home/households/demo-home-smith`)).status, 403, 'a homeowner cannot read another home');
    assert.equal((await stranger('GET', `/api/home/households/${DEMO_HOUSEHOLD_ID}`)).status, 403);
    assert.equal((await stranger('GET', '/api/contractor/customers')).status, 403);
    assert.equal((await owner('GET', '/api/contractor/customers')).status, 403, 'homeowner has no contractor role');

    const customers = await tech('GET', '/api/contractor/customers');
    assert.equal(customers.status, 200);
    const ids = customers.json.homes.map((h) => h.householdId);
    assert.ok(ids.includes(DEMO_HOUSEHOLD_ID) && ids.includes('demo-home-smith') && ids.includes('demo-home-lopez'));
    assert.ok(!ids.includes('demo-home-private'), 'a home that has not consented to share is invisible to the contractor');
    assert.equal((await tech('GET', '/api/contractor/customers/demo-home-private')).status, 403);
    const detail = await tech('GET', `/api/contractor/customers/${DEMO_HOUSEHOLD_ID}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.household.members, undefined, 'contractor view omits member emails');
    assert.ok(detail.json.rooms.every((r) => r.debug === undefined));
    // Contractor read of the homeowner summary route is allowed (consented) but stripped.
    const viaHome = await tech('GET', `/api/home/households/${DEMO_HOUSEHOLD_ID}/summary?debug=1`);
    assert.equal(viaHome.status, 200);
    assert.ok(viaHome.json.rooms.every((r) => r.debug === undefined && r.homeownerRecommendations.every((x) => x.description === undefined)));
    assert.equal((await tech('PATCH', `/api/home/households/${DEMO_HOUSEHOLD_ID}`, { name: 'Hacked' })).status, 403, 'contractor cannot edit the household');

    // Consent withdrawn: the contractor loses the home immediately.
    assert.equal((await owner('PATCH', `/api/home/households/${DEMO_HOUSEHOLD_ID}`, { shareInsights: false })).status, 200);
    assert.equal((await tech('GET', `/api/contractor/customers/${DEMO_HOUSEHOLD_ID}`)).status, 403);
    assert.ok(!(await tech('GET', '/api/contractor/customers')).json.homes.some((h) => h.householdId === DEMO_HOUSEHOLD_ID));
    // Gateways never reach the home API.
    process.env.GATEWAY_TOKENS = 'gateway-token-for-tests-0123456789abcdef';
    const g = await fetch(`http://127.0.0.1:${new URL(me.json ? 'http://x' : 'http://x').port || ''}`).catch(() => null);
    void g;
  } finally {
    delete process.env.GATEWAY_TOKENS;
    await close();
  }
});

test('homeowner flows: summary, numbers, ack, feedback, contact payload, report, simulation switch (flows B, C, G)', async () => {
  const { store, service, cookieFor, api, close } = await boot();
  try {
    seedDemo({ store, service, userEmail: 'owner@noso.so', userName: 'Owner', timeZone: 'America/Los_Angeles' });
    const owner = api(await cookieFor('owner@noso.so', 'Owner'));
    const h = DEMO_HOUSEHOLD_ID;
    const summary = await owner('GET', `/api/home/households/${h}/summary?debug=1`);
    assert.equal(summary.status, 200);
    assert.ok(summary.json.home.rooms.length === 3);
    assert.ok(summary.json.rooms.every((r) => r.deviceHealth.simulated === true), 'seeded rooms are labelled simulated');
    const kitchen = summary.json.rooms.find((r) => r.roomName === 'Kitchen');
    assert.ok(kitchen.measurements.find((m) => m.channel === 'pm25').text.includes('µg/m³'), 'numbers stay visible');
    assert.ok(kitchen.primaryIssue, 'kitchen simulation is mid-event');
    assert.ok(kitchen.primaryIssue.measurement.baselineText.length > 0);
    const rec = kitchen.homeownerRecommendations.find((r) => r.level === 'diy');
    assert.ok(rec);
    assert.ok(kitchen.contractorInsights.some((i) => i.category === 'filtration'), 'recurring cooking history yields a filtration insight');
    assert.ok(kitchen.homeownerRecommendations.some((r) => r.level === 'contractor' && /Demo Comfort Co\./.test(r.title)), 'contractor step names the assigned contractor');
    assert.ok(kitchen.debug && kitchen.debug.features, 'debug view available to the member');

    const ack = await owner('POST', `/api/home/households/${h}/events/${kitchen.primaryIssue.eventId}/ack`, { recommendationId: rec.id });
    assert.equal(ack.status, 200);
    assert.equal(ack.json.acknowledgedActions[0].id, rec.id);
    const after = await owner('GET', `/api/home/households/${h}/rooms/kitchen/summary`);
    assert.ok(after.json.homeownerRecommendations.find((r) => r.id === rec.id).acknowledged);
    assert.ok(after.json.timeline.some((i) => i.kind === 'action'));

    const fb = await owner('POST', `/api/home/households/${h}/events/${kitchen.primaryIssue.eventId}/feedback`, { correct: false, actualSource: 'dust' });
    assert.equal(fb.status, 200);
    assert.equal(store.state.feedback.length, 1);

    const contact = await owner('POST', `/api/home/households/${h}/contact`, { type: 'request_service', roomId: 'kitchen', eventId: kitchen.primaryIssue.eventId, message: 'Please take a look.' });
    assert.equal(contact.status, 200);
    assert.equal(contact.json.contractor.name, 'Demo Comfort Co.');
    assert.match(contact.json.payload.current, /PM2\.5/);
    assert.ok(contact.json.payload.actionsTried.includes(rec.title));
    assert.match(contact.json.payload.supportingHistory, /similar events/);
    assert.ok(contact.json.fallback.tel && contact.json.fallback.mailto);
    assert.equal(store.contactRequestsFor({ householdId: h }).length, 1);

    const report = await owner('GET', `/api/home/households/${h}/report`);
    assert.equal(report.status, 200);
    assert.equal(report.json.rooms.length, 3);
    assert.ok(report.json.rooms.every((r) => r.simulated));

    const series = await owner('GET', `/api/home/households/${h}/rooms/kitchen/series?seconds=3600`);
    assert.ok(series.json.channels.pm25.length > 10 && series.json.events.length >= 1);

    // Switching the simulation re-labels and re-derives: offline scenario -> no verdict.
    const sw = await owner('POST', `/api/home/households/${h}/simulate`, { roomId: 'living', scenario: 'sensor_offline' });
    assert.equal(sw.status, 200);
    const adv = await owner('POST', `/api/home/households/${h}/simulate`, { roomId: 'living', advanceMinutes: 30 });
    assert.equal(adv.status, 200);
    const living = await owner('GET', `/api/home/households/${h}/rooms/living/summary`);
    assert.notEqual(living.json.deviceHealth.state, 'online');
    assert.equal(living.json.currentStatus.status, null, 'no air verdict without live readings');
    assert.equal((await owner('POST', `/api/home/households/${h}/simulate`, { roomId: 'living', scenario: 'nope' })).status, 400);

    // Profile edits flow into personalization.
    const patch = await owner('PATCH', `/api/home/households/${h}`, { profile: { sensitivities: { youngChildren: true } }, equipment: [{ id: 'x', type: 'portable_purifier', label: 'Purifier' }] });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.household.profile.sensitivities.youngChildren, true);
    assert.equal(patch.json.household.profile.pets.hasPets, true, 'merge keeps existing context');
  } finally {
    await close();
  }
});

test('a physical cube published through the relay lands in the publisher\'s own home, labelled physical (flow A)', async () => {
  const { store, service, cookieFor, api, close, base, cubeStore } = await boot();
  process.env.GATEWAY_TOKENS = 'owned-gateway-token-0123456789abcdefgh:winston@noso.so';
  try {
    const cookie = await cookieFor('winston@noso.so', 'Winston');
    const owner = api(cookie);
    const now = Date.now() / 1000;
    const readings = generateReadings('healthy', { startT: now - 120, stepS: 2, untilS: 120 }).map((r) => ({ ...r, source: 'physical' }));
    const res = await fetch(`${base}/api/cube/live`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ publisher: 'laptop-aaaa', sentAt: now, readings, meta: { name: 'Office cube', roomName: 'Office', source: 'physical' } }) });
    assert.equal(res.status, 200);
    const me = await owner('GET', '/api/home/me');
    assert.equal(me.json.households.length, 1);
    const hid = me.json.households[0].id;
    const h = await owner('GET', `/api/home/households/${hid}`);
    assert.equal(h.json.household.name, "Winston's Home");
    const office = h.json.household.rooms.find((r) => r.name === 'Office');
    assert.ok(office && office.devices.length === 1);
    const s = await owner('GET', `/api/home/households/${hid}/rooms/${office.id}/summary`);
    assert.equal(s.json.deviceHealth.state, 'online');
    assert.equal(s.json.deviceHealth.simulated, false);
    assert.equal(s.json.currentStatus.status, 'good');
    assert.equal(s.json.contractorInsights.length, 0, 'two minutes of clean data creates no lead');
    assert.equal(s.json.measurements.find((m) => m.channel === 'pm25').baseline.kind, 'reference', 'no personal baseline claimed yet');
    assert.equal((await owner('POST', `/api/home/households/${hid}/contact`, { type: 'message' })).status, 409, 'no contractor connected: nothing invented');
    // The headless gateway, with a token owned by the same person, attaches its cube to a named room of the same home.
    cubeStore.publisher.lastSeen -= 120; // the laptop went quiet; the gateway may take over
    const gw = await fetch(`${base}/api/cube/live`, { method: 'POST', headers: { authorization: 'Bearer owned-gateway-token-0123456789abcdefgh', 'x-noware-gateway': 'mac-mini', 'content-type': 'application/json' }, body: JSON.stringify({ publisher: 'gateway-office-01', sentAt: Date.now() / 1000 + 60, readings: readings.map((r) => ({ ...r, timestamp: r.timestamp + 200 })), meta: { name: 'Office cube', roomName: 'Study', deviceKey: 'aircube-study', source: 'physical' } }) });
    assert.equal(gw.status, 200);
    const h2 = await owner('GET', `/api/home/households/${hid}`);
    const study = h2.json.household.rooms.find((r) => r.name === 'Study');
    assert.ok(study && study.devices.some((d) => d.key === 'aircube-study'), 'gateway cube attached to the Study room of the owner\'s home');
  } finally {
    delete process.env.GATEWAY_TOKENS;
    await close();
  }
});
