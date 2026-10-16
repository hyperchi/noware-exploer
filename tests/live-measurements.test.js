import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMeasurementWindows, measurementIsLive } from '../lib/air-intelligence/live-measurements.js';
import { RoomEngine } from '../lib/air-intelligence/engine.js';

const sample = (t, value, extra = {}) => ({ t, source: 'physical', channels: { pm25: value }, ...extra });
const average = (samples, now = 1000) => liveMeasurementWindows(samples, ['pm25'], { now, source: 'physical' }).pm25;

test('rolling five-minute mean weights elapsed time, not a burst of samples', () => {
  const samples = [];
  for (let t = 700; t < 850; t += 10) samples.push(sample(t, 10));
  for (let t = 850; t <= 1000; t++) samples.push(sample(t, 30));
  const a = average(samples);
  assert.equal(a.value, 20);
  assert.equal(a.coverageSeconds, 300);
  assert.equal(a.complete, true);
  assert.equal(a.kind, 'derived');
  assert.equal(average([...samples, sample(1001, 999)]).value, 20, 'future readings do not enter the window');
  assert.equal(average([...samples, sample(1010, 30)], 1010).value, 20 + 2 / 3, 'old readings roll out continuously');
});

test('partial windows expose gaps and exclude history, invalid values, warm-up, fault and other provenance', () => {
  const a = average([
    sample(650, 999), sample(700, 10), sample(710, 999, { span: 300 }),
    sample(800, 999, { source: 'simulated' }), sample(820, 999, { source: 'replay' }),
    sample(840, 999, { warmingUp: true }), sample(860, 999, { fault: true }),
    sample(880, null), sample(900, 30), sample(920, NaN), sample(990, 10),
  ]);
  assert.equal(a.coverageSeconds, 50);
  assert.equal(a.value, 18);
  assert.equal(a.complete, false);
  assert.equal(a.source, 'physical');
  assert.equal(average([sample(1000, 10)]).value, null);
  assert.equal(average([sample(500, 10)]).value, null);
});

test('summary preserves latest raw values beside derived averages and converts units consistently', () => {
  const e = new RoomEngine({ deviceKey: 'physical-test' });
  e.ingestReadings(Array.from({ length: 301 }, (_, i) => ({ timestamp: 700 + i, temperatureC: 20, humidity: 45, pmPresent: true, pmValid: true, pm25: i < 300 ? 4 : 40 })));
  const summary = e.assess({ now: 1000, fahrenheit: true });
  const pm = summary.measurements.find(m => m.channel === 'pm25');
  assert.equal(pm.value, 40);
  assert.equal(pm.measuredAt, 1000);
  assert.equal(pm.average5m.value, 4);
  assert.equal(pm.average5m.text, '4.0 µg/m³');
  assert.equal(pm.average5m.complete, true);
  assert.equal(summary.measurements.find(m => m.channel === 'temp').average5m.text, '68.0°F');
  assert.equal(e.assess({ now: 1021 }).measurements.find(m => m.channel === 'pm25').average5m, null);
  e.ingestReadings([{ timestamp: 1022, warmingUp: true, temperatureC: 25 }]);
  assert.ok(e.assess({ now: 1022 }).measurements.every(m => m.average5m === null));
});

test('live indication expires without another API response and never marks warm-up or faults live', () => {
  assert.equal(measurementIsLive({ state: 'online', measuredAt: 1000, now: 1004 }), true);
  assert.equal(measurementIsLive({ state: 'online', measuredAt: 1000, now: 1021 }), false);
  for (const state of ['warming_up', 'offline', 'stale', 'fault']) assert.equal(measurementIsLive({ state, measuredAt: 1000, now: 1001 }), false);
  assert.equal(measurementIsLive({ state: 'online', measuredAt: null, now: 1001 }), false);
  assert.equal(measurementIsLive({ state: 'online', measuredAt: 1100, now: 1001 }), false);
});
