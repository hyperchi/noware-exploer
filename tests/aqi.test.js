import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pm25Aqi, pm25NowCast, roomHourlyPm25, aqiComparison } from '../lib/air-intelligence/aqi.js';
import { OpenMeteoOutdoorProvider, coarseLocation } from '../lib/outdoor-provider.js';
const now = 1800000000;
const through = Math.floor(now / 3600) * 3600;
const hours = values => values.map((value, i) => ({ t: through - (i + 1) * 3600, value }));
const sample = (t, value, span = 300) => ({ t, channels: { pm25: value }, span, source: 'physical', warmingUp: false, fault: false });
const history = values => values.flatMap((value, age) => Array.from({ length: 12 }, (_, i) => sample(through - (age + 1) * 3600 + i * 300 + 150, value)));

test('EPA 2024 PM2.5 AQI boundaries, truncation, missing data and above-scale values', () => {
  for (const [pm, aqi] of [[0, 0], [9, 50], [9.099, 50], [9.1, 51], [35.4, 100], [35.5, 101], [55.4, 150], [55.5, 151], [125.4, 200], [125.5, 201], [225.4, 300], [225.5, 301], [325.4, 500]]) assert.equal(pm25Aqi(pm).value, aqi, String(pm));
  assert.equal(pm25Aqi(400).text, '500+');
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(pm25Aqi(value), null);
});

test('NowCast reproduces EPA example including missing-hour exponent and truncation', () => {
  const result = pm25NowCast(hours([21, null, 35, 49.2, 48.6, 53.7, 66.2, 69.2, 64.9, 50, 43, 34.9]), { now });
  assert.equal(result.pm25, 28.4); assert.equal(result.value, 87); assert.equal(result.weight, 0.5); assert.equal(result.hoursUsed, 11);
  assert.equal(pm25NowCast(hours(Array(12).fill(0)), { now }).value, 0);
  assert.equal(pm25NowCast(hours([0, null, 0]), { now }).state, 'available');
  assert.equal(pm25NowCast(hours([null, null, 12, 20, 30]), { now }).state, 'unavailable');
  assert.equal(pm25NowCast([{ t: through, value: 400 }, ...hours([null, null, 12])], { now }).state, 'unavailable', 'future/incomplete hour never fills a gap');
});

test('room hourly averages require coverage and exclude warm-up, wrong provenance and gaps', () => {
  const points = history([12]);
  assert.equal(roomHourlyPm25(points, { now, source: 'physical' })[0].value, 12);
  assert.equal(roomHourlyPm25(points.slice(0, 8), { now, source: 'physical' })[0].value, null);
  assert.equal(roomHourlyPm25(points.slice(0, 9), { now, source: 'physical' })[0].value, 12);
  assert.equal(roomHourlyPm25([...points, ...points], { now, source: 'physical' })[0].coverageSeconds, 3600);
  assert.equal(roomHourlyPm25(points.map(p => ({ ...p, warmingUp: true })), { now, source: 'physical' }).length, 0);
  assert.equal(roomHourlyPm25(points, { now, source: 'simulated' }).length, 0);
  const gap = [sample(through - 3600, 50, 0), sample(through - 1, 50, 0)];
  assert.equal(roomHourlyPm25(gap, { now, source: 'physical' })[0].value, null, 'two live points cannot fill an hour-long outage');
});

test('identical room and outdoor PM history gives identical AQI, regardless of foreign provider index', () => {
  const values = [20, 10, 5, 3, 2, 2, 1, 1, 1, 1, 1, 1];
  const input = { samples: history(values), health: { state: 'online' }, capabilities: { pm25: true }, source: 'physical', outdoor: { status: 'available', fetchedAt: now, hourlyPm25: hours(values), aqi: 999, kind: 'modeled' }, now };
  const out = aqiComparison(input);
  assert.equal(out.indoor.value, out.outdoor.value);
  assert.equal(out.indoor.pm25, out.outdoor.pm25);
  assert.equal(out.indoor.through, out.outdoor.through);
  assert.equal(out.indoor.standard, out.outdoor.standard);
  assert.equal(out.indoor.method, out.outdoor.method);
  assert.equal(out.comparable, true);
  for (const state of ['warming_up', 'stale', 'offline', 'fault']) assert.equal(aqiComparison({ ...input, health: { state } }).comparable, false);
  assert.equal(aqiComparison({ ...input, outdoor: { ...input.outdoor, fetchedAt: now - 7200 } }).outdoor.state, 'unavailable');
});

const fixture = () => ({ current: { time: through, pm2_5: 10 }, hourly_units: { pm2_5: 'μg/m³' }, hourly: { time: hours(Array(24).fill(10)).map(p => p.t), pm2_5: Array(24).fill(10) } });
test('outdoor provider fetches no location until selected, rounds coordinates and coalesces requests', async () => {
  let calls = 0, url;
  const p = new OpenMeteoOutdoorProvider({ clock: () => now, production: false, apiKey: null, fetchImpl: async u => { calls++; url = u; return Response.json(fixture()); } });
  assert.equal((await p.getOutdoor({ location: null })).status, 'unavailable'); assert.equal(calls, 0);
  const location = { latitude: 40.71288, longitude: -74.00591, enabled: true };
  const [a, b] = await Promise.all([p.getOutdoor({ location }), p.getOutdoor({ location })]);
  assert.equal(calls, 1); assert.equal(a.status, 'available'); assert.equal(a, b);
  assert.equal(url.searchParams.get('latitude'), '40.7'); assert.equal(url.searchParams.get('longitude'), '-74');
  assert.equal(url.searchParams.get('hourly'), 'pm2_5'); assert.equal(a.aqi, null, 'upstream index cannot leak into comparison');
  assert.equal(a.kind, 'modeled'); assert.equal(a.wildfireSmoke, null);
  assert.equal(coarseLocation({ latitude: null, longitude: 0 }), null);
  assert.equal(coarseLocation({ latitude: 91, longitude: 0 }), null);
});

test('failed, outdated and malformed outdoor responses stay unavailable; production requires service configuration', async () => {
  const location = { latitude: 40.7, longitude: -74, enabled: true };
  for (const value of [new Response('', { status: 500 }), Response.json({ ...fixture(), current: { time: now - 86400 } }), Response.json({ ...fixture(), hourly: { time: [through - 3600], pm2_5: [null] } })]) {
    const p = new OpenMeteoOutdoorProvider({ clock: () => now, production: false, apiKey: null, fetchImpl: async () => value });
    assert.equal((await p.getOutdoor({ location })).status, 'unavailable');
  }
  const production = new OpenMeteoOutdoorProvider({ production: true, apiKey: null, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal((await production.getOutdoor({ location })).status, 'unavailable');
});

test('city search returns only bounded approximate locations and caches results', async () => {
  let calls = 0;
  const p = new OpenMeteoOutdoorProvider({ production: false, apiKey: null, fetchImpl: async () => { calls++; return Response.json({ results: [{ latitude: 40.7128, longitude: -74.006, name: 'New York', admin1: 'New York', country: 'United States' }] }); } });
  const a = await p.searchLocations('New York'); await p.searchLocations('New York');
  assert.equal(calls, 1); assert.equal(a[0].latitude, 40.7); assert.equal(a[0].label, 'New York, United States');
});

test('sparse archived live readings cannot pretend to cover a full hour', async () => {
  const { RoomEngine } = await import('../lib/air-intelligence/engine.js');
  const engine = new RoomEngine({ deviceKey: 'sparse' });
  for (let t = through - 3 * 3600; t <= through; t += 300) engine.archiveSample(sample(t, 12, 0));
  const hourly = roomHourlyPm25(engine.allSamples(), { now, source: 'physical' });
  assert.ok(hourly.every(h => h.value === null));
  assert.equal(engine.archive[0].coverageSeconds.pm25, 30);
  const full = new RoomEngine({ deviceKey: 'full' });
  for (let t = through - 3600; t <= through; t += 10) full.archiveSample(sample(t, 12, 0));
  assert.equal(roomHourlyPm25(full.allSamples(), { now, source: 'physical' })[0].value, 12);
  full.archive.forEach(s => { delete s.coverageSeconds; });
  assert.equal(roomHourlyPm25(full.allSamples(), { now, source: 'physical' }).length, 0, 'legacy local rollups with unknown coverage are excluded');
});
