import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLive, parseHistorySlot } from '../public/dashboard/js/protocol.js';
import { liveMetricValue, slotValues, metricFloor, pm25Quality, pm25TileStatus, tileStatus, readingQuality, airScore, chartZones } from '../public/dashboard/js/quality.js';

/** Firmware-shaped fixture with independent PM and CO2 validity flags. */
function sensorFrame(overrides = {}) {
  return {
    model: 'base', fw: '2.1.0',
    ens210: { temperature_c: 23.5, humidity: 45 },
    ens16x: { etvoc: 100, eco2: 450, aqi: 35, aqi_uba: 1 },
    scd41: { co2: 0 },
    sen63c: { present: true, valid: true, pm1_0: 1.2, pm2_5: 2.3, pm4_0: 3.4, pm10_0: 4.5, co2: 1400, co2_valid: true },
    ...overrides,
  };
}

test('SEN63C Base uses measured CO2 and all four particulate channels', () => {
  const reading = parseLive(sensorFrame());
  assert.equal(reading.isPro, false);
  assert.equal(reading.hasTrueCo2, true);
  assert.equal(reading.co2, 1400);
  assert.equal(reading.temperatureC, 23.5);
  assert.equal(reading.humidity, 45);
  assert.deepEqual([reading.pm1, reading.pm25, reading.pm4, reading.pm10], [1.2, 2.3, 3.4, 4.5]);
  assert.equal(reading.pmValid, true);
  assert.equal(liveMetricValue('co2', reading), 1400);
  assert.equal(liveMetricValue('pm25', reading), 2.3);
  assert.equal(readingQuality(reading), 2);
  assert.ok(airScore(reading) > 50);
});

test('warm-up and malformed PM do not create zero-valued chart points', () => {
  const frame = sensorFrame();
  const warming = parseLive({ ...frame, sen63c: { ...frame.sen63c, valid: false, co2_valid: false } });
  assert.equal(warming.pmPresent, true);
  assert.equal(warming.pmValid, false);
  assert.equal(warming.hasTrueCo2, false);
  assert.ok(Number.isNaN(liveMetricValue('pm25', warming)));
  assert.ok(Number.isNaN(liveMetricValue('co2', warming)));
  for (const invalid of [null, undefined, '2.3', -1, Infinity]) {
    const reading = parseLive({ ...frame, sen63c: { ...frame.sen63c, pm2_5: invalid } });
    assert.equal(reading.pmValid, false);
  }
});

test('legacy Base and Pro keep their CO2 sources and hide PM', () => {
  const base = parseLive(sensorFrame({ sen63c: undefined }));
  const pro = parseLive(sensorFrame({ sen63c: undefined, model: 'pro', scd41: { co2: 900 } }));
  const legacy = parseLive(sensorFrame({ sen63c: undefined, model: undefined, scd41: { co2: 850 } }));
  assert.equal(base.pmPresent, false);
  assert.equal(liveMetricValue('co2', base), 450);
  assert.equal(liveMetricValue('co2', pro), 900);
  assert.equal(liveMetricValue('co2', legacy), 850);
});

test('PM history decodes tenths, retains zero and rejects missing sentinels', () => {
  const slot = parseHistorySlot({ seq: 1, p_a: 23, p_n: 0, p_x: 41 });
  assert.deepEqual(slotValues('pm25', slot), [2.3, 0, 4.1]);
  assert.ok(0 > metricFloor('pm25'));
  const missing = parseHistorySlot({ seq: 2, p_a: 65535, t_a: -32768, c_a: 65535 });
  for (const key of ['pm25Avg', 'pm25Min', 'tempAvg', 'co2Avg']) assert.ok(Number.isNaN(missing[key]));
});

test('PM2.5 statuses and chart shading use the reference dashboard bands', () => {
  for (const [value, quality, text] of [[0, 0, 'Low'], [9, 0, 'Low'], [10, 1, 'Moderate'], [35.4, 1, 'Moderate'], [40, 2, 'High'], [55.4, 2, 'High'], [60, 3, 'Very high']]) {
    assert.equal(pm25Quality(value), quality);
    assert.equal(pm25TileStatus(value), text);
    assert.deepEqual(tileStatus('pm25', value), { quality, text });
  }
  assert.equal(chartZones('pm25').length, 3);
});
