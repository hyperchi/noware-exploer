// Inspect the already-running loopback collector without opening/resetting USB.
// Drives its genuine physical reading through this branch's authenticated API.
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createSession, sessionCookie } from '../lib/session.js';
import { HomeStore } from '../lib/home-store.js';

process.env.SESSION_SECRET = 'isolated-live-check-secret'.repeat(3);
process.env.NOWARE_DEMO = '0';
const token = 'isolated-live-check-gateway-token-0123456789';
process.env.GATEWAY_TOKENS = `${token}:live-check@noso.so`;
const health = process.env.GATEWAY_HEALTH_URL || 'http://127.0.0.1:8787/health';
const app = createApp({ homeStore: new HomeStore() });
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const snapshot = await fetch(health).then(r => r.json());
  assert.equal(snapshot.connected, true); assert.equal(snapshot.lastReading.source, 'physical');
  assert.ok(Date.now() / 1000 - snapshot.lastReading.timestamp < 20, 'physical reading must be fresh');
  const pub = await fetch(`${base}/api/cube/live`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ publisher: 'isolated-live-check', sentAt: Date.now() / 1000, readings: [snapshot.lastReading], meta: { deviceKey: 'live-check-device', source: 'physical', roomName: 'Live verification' } }) });
  assert.equal(pub.status, 200);
  const cookie = sessionCookie(await createSession({ email: 'live-check@noso.so', sub: 'live-check' }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' }));
  const get = path => fetch(base + path, { headers: { cookie } }).then(r => r.json());
  const me = await get('/api/home/me');
  const summary = await get(`/api/home/households/${me.households[0].id}/summary`);
  const room = summary.rooms[0];
  assert.equal(room.deviceHealth.state, 'online'); assert.equal(room.deviceHealth.simulated, false);
  for (const metric of ['pm1', 'pm25', 'pm4', 'pm10', 'co2']) assert.equal(room.measurements.find(m => m.channel === metric)?.value, snapshot.lastReading[metric]);
  assert.equal(room.opportunitySignals.length, 0);
  console.log(JSON.stringify({ firmware: snapshot.fwVersion, capabilities: snapshot.capabilities, health: room.deviceHealth.state, status: room.currentStatus.label, readings: room.measurements.map(m => ({ metric: m.technical, value: m.value, unit: m.unit })), source: room.source, opportunities: room.opportunitySignals.length }, null, 2));
} finally { app.locals.homeService.stopAll(); await new Promise(r => server.close(r)); }
