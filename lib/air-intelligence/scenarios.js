/* Scenario generator: realistic-enough multivariate curves for testing and
 * demonstrating the whole loop without recreating every physical event.
 *
 * Every reading produced here carries source: "simulated" and the UI labels
 * it as such. Scenarios drive the live engine (readings), the history
 * (5-minute slots over N days) and, where relevant, service events and
 * household context, so the homeowner and contractor views can be validated
 * end to end from one switch.
 */

import { localHour } from './baseline.js';

// ----------------------------------------------------------------- utilities

/** Deterministic PRNG (mulberry32) so fixtures are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Firmware VOC Level (0-500) from TVOC ppb, same ramp as src/simulation.js. */
export function vocLevelFromTvoc(tvoc) {
  const edges = [0, 65, 220, 650, 2200, 5500];
  const bands = [0, 15, 50, 100, 200, 500];
  if (tvoc <= 0) return 0;
  for (let i = 1; i < edges.length; i++) if (tvoc < edges[i]) return bands[i - 1] + Math.floor(((tvoc - edges[i - 1]) / (edges[i] - edges[i - 1])) * (bands[i] - bands[i - 1]));
  return 500;
}

/**
 * A segment adds `delta` to one channel: linear rise over `rise` seconds from
 * `at`, held for `hold` seconds, then exponential decay with time constant
 * `decay` seconds. Negative deltas work for dips.
 */
export function segmentValue(seg, t) {
  const dt = t - seg.at;
  if (dt < 0) return 0;
  if (dt < seg.rise) return seg.delta * (dt / Math.max(1, seg.rise));
  const afterRise = dt - seg.rise;
  if (afterRise < (seg.hold || 0)) return seg.delta;
  const afterHold = afterRise - (seg.hold || 0);
  if (!seg.decay) return 0;
  return seg.delta * Math.exp(-afterHold / seg.decay);
}

export const CAPABILITY_PRESETS = Object.freeze({
  sen63c: { label: 'AirCube with SEN63C (particles + true CO2)', pm: true, trueCo2: true, lux: false, isPro: false },
  base: { label: 'AirCube Base (legacy, no particles)', pm: false, trueCo2: false, lux: false, isPro: false },
  pro: { label: 'AirCube Pro (true CO2 + light, no particles)', pm: false, trueCo2: true, lux: true, isPro: true },
});

const ROOM_BASE = Object.freeze({
  living: { pm25: 5, pm1: 3, pm4: 6, pm10: 8, tvoc: 90, co2: 560, hum: 44, temp: 22.5, lux: 120 },
  kitchen: { pm25: 6, pm1: 4, pm4: 7, pm10: 9, tvoc: 120, co2: 600, hum: 46, temp: 23, lux: 150 },
  bedroom: { pm25: 4, pm1: 2.5, pm4: 5, pm10: 6, tvoc: 80, co2: 640, hum: 45, temp: 21.5, lux: 20 },
  bathroom: { pm25: 4, pm1: 2.5, pm4: 5, pm10: 6, tvoc: 110, co2: 600, hum: 52, temp: 22, lux: 60 },
  basement: { pm25: 5, pm1: 3, pm4: 6, pm10: 9, tvoc: 100, co2: 650, hum: 58, temp: 19, lux: 10 },
  nursery: { pm25: 4, pm1: 2.5, pm4: 5, pm10: 6, tvoc: 85, co2: 620, hum: 45, temp: 22, lux: 40 },
  office: { pm25: 5, pm1: 3, pm4: 6, pm10: 7, tvoc: 95, co2: 580, hum: 45, temp: 22.5, lux: 200 },
  other: { pm25: 5, pm1: 3, pm4: 6, pm10: 8, tvoc: 90, co2: 580, hum: 45, temp: 22, lux: 100 },
});

const spikePm = (at, { pm25, rise = 240, hold = 0, decay = 900, coarse = 1.2, fine = 0.75 }) => [
  { channel: 'pm25', at, rise, hold, decay, delta: pm25 },
  { channel: 'pm1', at, rise, hold, decay, delta: pm25 * fine },
  { channel: 'pm4', at, rise, hold, decay, delta: pm25 * 1.08 },
  { channel: 'pm10', at, rise, hold, decay, delta: pm25 * coarse },
];

// ---------------------------------------------------------------- scenarios

/**
 * @typedef {Object} Scenario
 * @property {string} key
 * @property {string} label
 * @property {string} description  what the UI should show
 * @property {string} roomType
 * @property {string} capabilities  CAPABILITY_PRESETS key
 * @property {number} durationS  live portion
 * @property {number} [startHourLocal]  local hour the live portion starts (default now)
 * @property {object[]} segments  live segments (seconds relative to start)
 * @property {object} [device]  {offlineAfterS, warmupS}
 * @property {object} [profile]  household profile overrides
 * @property {object[]} [equipment]
 * @property {object} [history]  how to generate the past N days
 * @property {object} [outdoor]  static outdoor air
 * @property {string} [expect]  what the engine should conclude
 */
export const SCENARIOS = Object.freeze({
  healthy: {
    key: 'healthy', label: 'Healthy home', description: 'Clean, stable air. Nothing needs attention; numbers stay visible.',
    roomType: 'living', capabilities: 'sen63c', durationS: 3600, segments: [], history: { kind: 'calm' }, expect: 'no event',
  },
  cooking: {
    key: 'cooking', label: 'Cooking event', description: 'Fine particles and VOCs rise together within minutes, then clear with the exhaust.',
    roomType: 'kitchen', capabilities: 'sen63c', durationS: 3600, startHourLocal: 18.5,
    segments: [...spikePm(300, { pm25: 58, rise: 240, decay: 900 }), { channel: 'tvoc', at: 300, rise: 240, decay: 700, delta: 380 }, { channel: 'co2', at: 300, rise: 900, decay: 1500, delta: 40 }],
    history: { kind: 'calm' }, expect: 'particles event, likely cooking, no contractor lead',
  },
  cooking_repeated: {
    key: 'cooking_repeated', label: 'Repeated cooking events', description: 'Twice-daily cooking spikes for a month, each slow to clear. Filtration becomes a fair question.',
    roomType: 'kitchen', capabilities: 'sen63c', durationS: 3600, startHourLocal: 18.5,
    segments: [...spikePm(300, { pm25: 52, rise: 240, decay: 2400 }), { channel: 'tvoc', at: 300, rise: 240, decay: 900, delta: 320 }],
    equipment: [{ id: 'hvac', type: 'hvac', label: 'Central forced-air HVAC' }, { id: 'filter', type: 'hvac_filter', label: '1" fiberglass filter' }],
    history: { kind: 'cooking', perDay: 2, recoveryS: 2700, pm25: 45 }, expect: 'filtration insight',
  },
  cleaning: {
    key: 'cleaning', label: 'Cleaning VOC event', description: 'Chemicals jump sharply while particles and fresh air stay flat.',
    roomType: 'living', capabilities: 'sen63c', durationS: 2700,
    segments: [{ channel: 'tvoc', at: 240, rise: 120, decay: 600, delta: 950 }, { channel: 'pm25', at: 240, rise: 120, decay: 600, delta: 1 }],
    history: { kind: 'calm' }, expect: 'voc event, likely cleaning',
  },
  dust: {
    key: 'dust', label: 'Dust event', description: 'Coarse particles rise far more than fine ones, briefly.',
    roomType: 'living', capabilities: 'sen63c', durationS: 2400,
    segments: [{ channel: 'pm10', at: 240, rise: 180, decay: 420, delta: 95 }, { channel: 'pm4', at: 240, rise: 180, decay: 420, delta: 30 }, { channel: 'pm25', at: 240, rise: 180, decay: 420, delta: 14 }, { channel: 'pm1', at: 240, rise: 180, decay: 420, delta: 3 }],
    profile: { concerns: { dust: true } }, history: { kind: 'calm' }, expect: 'particles event, likely dust',
  },
  outdoor_pollution: {
    key: 'outdoor_pollution', label: 'Outdoor pollution event', description: 'Particles drift up slowly with no indoor signature; outdoor data (connected in this scenario) confirms it.',
    roomType: 'living', capabilities: 'sen63c', durationS: 5400,
    segments: [...spikePm(300, { pm25: 32, rise: 2400, hold: 2400, decay: 3000, coarse: 1.4 })],
    outdoor: { pm25: 52, aqi: 138, wildfireSmoke: false }, history: { kind: 'calm' }, expect: 'particles event, outdoor pollution, close windows',
  },
  poor_ventilation_overnight: {
    key: 'poor_ventilation_overnight', label: 'Poor overnight ventilation', description: 'True CO2 climbs steadily through the night in the bedroom, as it has most nights this month.',
    roomType: 'bedroom', capabilities: 'sen63c', durationS: 5400, startHourLocal: 23.5,
    segments: [{ channel: 'co2', at: 120, rise: 3600, hold: 7200, decay: 1800, delta: 720 }, { channel: 'hum', at: 120, rise: 3600, hold: 7200, decay: 1800, delta: 5 }],
    history: { kind: 'overnight_co2', nightsShare: 0.73, peak: 1450 }, expect: 'ventilation event + ventilation insight',
  },
  persistent_particles: {
    key: 'persistent_particles', label: 'Persistent particle issue', description: 'Particles stay elevated for an hour despite action; a month of long, slow events. Contractor escalation is justified.',
    roomType: 'living', capabilities: 'sen63c', durationS: 5400, startHourLocal: 14,
    segments: [...spikePm(240, { pm25: 34, rise: 600, hold: 4200, decay: 3000, coarse: 1.3 })],
    equipment: [{ id: 'hvac', type: 'hvac', label: 'Central forced-air HVAC' }, { id: 'filter', type: 'hvac_filter', label: '1" pleated filter' }, { id: 'pur', type: 'portable_purifier', label: 'Portable HEPA purifier (living room)' }],
    history: { kind: 'cooking', perDay: 0.6, recoveryS: 2820, pm25: 38, longShare: 0.6 }, expect: 'filtration insight, contractor step',
  },
  shower: {
    key: 'shower', label: 'Shower humidity spike', description: 'Humidity jumps quickly with no other change, then clears with the fan.',
    roomType: 'bathroom', capabilities: 'sen63c', durationS: 3000,
    segments: [{ channel: 'hum', at: 240, rise: 300, hold: 300, decay: 900, delta: 28 }, { channel: 'temp', at: 240, rise: 300, decay: 900, delta: 1.5 }],
    history: { kind: 'calm' }, expect: 'humidity event, likely shower',
  },
  high_humidity: {
    key: 'high_humidity', label: 'High humidity (basement)', description: 'Humidity sits above the comfort range for most of the month and is not clearing.',
    roomType: 'basement', capabilities: 'sen63c', durationS: 5400,
    segments: [{ channel: 'hum', at: 0, rise: 1, hold: 7200, decay: 0, delta: 14 }],
    profile: { concerns: { mold: true } }, history: { kind: 'humid', level: 68 }, expect: 'humidity event + humidity insight',
  },
  pet_allergy: {
    key: 'pet_allergy', label: 'Pet / allergy context', description: 'Household has a cat and allergies. Particle activity is elevated with an ambiguous signature; the product must not claim an allergen was detected.',
    roomType: 'living', capabilities: 'sen63c', durationS: 3600,
    segments: [...spikePm(300, { pm25: 16, rise: 600, hold: 900, decay: 1500, coarse: 2.6, fine: 0.5 })],
    profile: { sensitivities: { allergies: true }, pets: { hasPets: true, types: ['cat'] }, concerns: { petAllergens: true, dust: true } },
    history: { kind: 'calm' }, expect: 'particles event, unknown/alternatives include pet activity, allergy note',
  },
  sensor_offline: {
    key: 'sensor_offline', label: 'Sensor disconnected', description: 'Readings stop after ten minutes. The dashboard must say offline, not show stale air as current.',
    roomType: 'living', capabilities: 'sen63c', durationS: 3600, segments: [], device: { offlineAfterS: 600 }, history: { kind: 'calm' }, expect: 'offline, no air verdict',
  },
  sensor_warming_up: {
    key: 'sensor_warming_up', label: 'Sensor warming up', description: 'The gas sensor conditions for three minutes with wild VOC numbers; no incident may be declared.',
    roomType: 'living', capabilities: 'sen63c', durationS: 1200, segments: [{ channel: 'tvoc', at: 0, rise: 1, hold: 60, decay: 30, delta: 1800 }], device: { warmupS: 180 }, history: { kind: 'calm' }, expect: 'warming up, no event',
  },
  equipment_improvement: {
    key: 'equipment_improvement', label: 'Equipment improvement (before/after)', description: 'Daily cooking events; a whole-home air cleaner was installed 15 days ago and recovery got much faster since.',
    roomType: 'kitchen', capabilities: 'sen63c', durationS: 3600, startHourLocal: 18.5,
    segments: [...spikePm(300, { pm25: 50, rise: 240, decay: 700 }), { channel: 'tvoc', at: 300, rise: 240, decay: 600, delta: 300 }],
    equipment: [{ id: 'hvac', type: 'hvac', label: 'Central forced-air HVAC' }, { id: 'cleaner', type: 'whole_home_air_cleaner', label: 'Whole-home media air cleaner' }],
    history: { kind: 'cooking', perDay: 1.2, recoveryS: 3600, afterDay: 15, recoveryAfterS: 600, pm25: 48 },
    serviceEvents: [{ type: 'equipment_installation', daysAgo: 15, equipment: { type: 'whole_home_air_cleaner', label: 'Whole-home media air cleaner' }, notes: 'Installed MERV-13 media cabinet on return.' }],
    expect: 'before/after comparison shows faster recovery',
  },
  unknown_mixed: {
    key: 'unknown_mixed', label: 'Unknown mixed event', description: 'Particles, chemicals and CO2 all creep up slowly. The honest answer is "we are not sure".',
    roomType: 'other', capabilities: 'sen63c', durationS: 6000, startHourLocal: 15,
    segments: [...spikePm(300, { pm25: 22, rise: 2400, hold: 1200, decay: 1800, coarse: 1.6, fine: 0.5 }), { channel: 'tvoc', at: 300, rise: 2400, hold: 1200, decay: 1500, delta: 260 }, { channel: 'co2', at: 300, rise: 2400, hold: 1200, decay: 1500, delta: 180 }],
    history: { kind: 'calm' }, expect: 'event with unknown source and listed possibilities',
  },
  legacy_base: {
    key: 'legacy_base', label: 'Legacy Base cube (no particles, eCO2 only)', description: 'Capability detection: no particle channels, CO2 is only an estimate, confidence is reduced accordingly.',
    roomType: 'bedroom', capabilities: 'base', durationS: 3600, startHourLocal: 23,
    segments: [{ channel: 'tvoc', at: 300, rise: 1800, hold: 1200, decay: 1800, delta: 400 }],
    history: { kind: 'calm' }, expect: 'eCO2-based ventilation with low confidence',
  },
});

export const SCENARIO_KEYS = Object.keys(SCENARIOS);

// ------------------------------------------------------------- live readings

function baseFor(scenario) {
  return ROOM_BASE[scenario.roomType] || ROOM_BASE.other;
}

/** Raw channel values at relative time t, before noise. */
export function channelValues(scenario, t) {
  const base = { ...baseFor(scenario) };
  for (const seg of scenario.segments || []) base[seg.channel] = (base[seg.channel] ?? 0) + segmentValue(seg, t);
  return base;
}

/** One reading in protocol.parseLive shape. */
export function readingAt(scenario, tRel, startT, random = rng(7)) {
  const preset = CAPABILITY_PRESETS[scenario.capabilities] || CAPABILITY_PRESETS.sen63c;
  const v = channelValues(scenario, tRel);
  const n = (scale) => (random() - 0.5) * 2 * scale;
  const warmup = scenario.device?.warmupS && tRel < scenario.device.warmupS;
  const tvoc = Math.max(0, v.tvoc + n(8));
  const pm25 = Math.max(0, v.pm25 + n(0.4));
  return {
    timestamp: startT + tRel,
    uptimeMs: Math.round((tRel + 5) * 1000),
    source: 'simulated',
    temperatureC: Math.round((v.temp + n(0.05)) * 100) / 100,
    humidity: Math.round((v.hum + n(0.3)) * 100) / 100,
    vocLevel: vocLevelFromTvoc(tvoc),
    eco2: Math.round(400 + tvoc * 1.1),
    etvoc: Math.round(tvoc),
    co2: preset.trueCo2 ? Math.round(v.co2 + n(6)) : 0,
    lux: preset.lux ? Math.round(v.lux + n(5)) : 0,
    aqiUba: tvoc < 65 ? 1 : tvoc < 220 ? 2 : tvoc < 650 ? 3 : tvoc < 2200 ? 4 : 5,
    pmPresent: preset.pm,
    pmValid: preset.pm,
    pm1: preset.pm ? Math.round(Math.max(0, v.pm1 + n(0.3)) * 10) / 10 : 0,
    pm25: preset.pm ? Math.round(pm25 * 10) / 10 : 0,
    pm4: preset.pm ? Math.round(Math.max(0, v.pm4 + n(0.4)) * 10) / 10 : 0,
    pm10: preset.pm ? Math.round(Math.max(0, v.pm10 + n(0.6)) * 10) / 10 : 0,
    isPro: preset.isPro,
    hasTrueCo2: preset.trueCo2,
    hasLux: preset.lux,
    ensStatus: warmup ? 'Warming Up' : 'OK',
    warmingUp: Boolean(warmup),
    tempValid: true,
    humValid: true,
    co2Valid: preset.trueCo2,
    etvocValid: !warmup,
    sensorMissing: false,
    fwVersion: 'sim',
    frcNeeded: false,
  };
}

/**
 * All live readings for a scenario.
 * @param {Scenario|string} scenarioOrKey
 * @param {{startT:number, stepS?:number, untilS?:number, seed?:number}} o
 */
export function generateReadings(scenarioOrKey, { startT, stepS = 1, untilS, seed = 7 }) {
  const scenario = typeof scenarioOrKey === 'string' ? SCENARIOS[scenarioOrKey] : scenarioOrKey;
  const random = rng(seed);
  const end = Math.min(untilS ?? scenario.durationS, scenario.device?.offlineAfterS ?? Infinity);
  const out = [];
  for (let t = 0; t <= end; t += stepS) out.push(readingAt(scenario, t, startT, random));
  return out;
}

/** Start time so the live portion begins at the scenario's local hour, ending at `endT`. */
export function scenarioStartTime(scenario, endT, timeZone) {
  if (scenario.startHourLocal == null) return endT - scenario.durationS;
  const start = endT - scenario.durationS;
  const h = localHour(start, timeZone);
  let shift = (scenario.startHourLocal - h) * 3600;
  if (shift > 12 * 3600) shift -= 86400;
  return start + shift;
}

// ------------------------------------------------------------ history slots

function dayStart(t, timeZone) {
  return t - localHour(t, timeZone) * 3600;
}

/** Build absolute-time segments for the past `days` days according to the scenario's history kind. */
export function historyProgram(scenario, { endT, days = 30, timeZone, seed = 11 }) {
  const random = rng(seed);
  const h = scenario.history || { kind: 'calm' };
  const segments = [];
  const serviceAt = h.afterDay != null ? dayStart(endT - h.afterDay * 86400, timeZone) : null;
  for (let d = days; d >= 0; d--) {
    const day0 = dayStart(endT - d * 86400, timeZone);
    if (h.kind === 'cooking') {
      const count = h.perDay >= 1 ? Math.round(h.perDay + (random() - 0.5)) : random() < h.perDay ? 1 : 0;
      const hours = [[7, 8.5], [12, 13.5], [18, 20]];
      for (let i = 0; i < count; i++) {
        const [lo, hi] = hours[(i + Math.floor(random() * 3)) % 3];
        const at = day0 + (lo + random() * (hi - lo)) * 3600;
        const long = h.longShare != null ? random() < h.longShare : random() < 0.45;
        const baseRecovery = serviceAt && at > serviceAt ? h.recoveryAfterS : h.recoveryS;
        const decay = (long ? baseRecovery : baseRecovery * 0.55) / 3;
        const delta = h.pm25 * (0.6 + random() * 0.8);
        segments.push(...spikePm(at, { pm25: delta, rise: 240, hold: long ? 600 : 0, decay }));
        segments.push({ channel: 'tvoc', at, rise: 240, decay: decay * 0.8, delta: delta * 5 });
      }
    }
    if (h.kind === 'overnight_co2' && random() < h.nightsShare) {
      const at = day0 - 86400 + (22.5 + random()) * 3600; // the night leading into this day
      segments.push({ channel: 'co2', at, rise: 4 * 3600, hold: 2 * 3600, decay: 1800, delta: (h.peak || 1400) - ROOM_BASE.bedroom.co2 + (random() - 0.5) * 200 });
      segments.push({ channel: 'hum', at, rise: 4 * 3600, hold: 2 * 3600, decay: 1800, delta: 4 });
    }
    if (h.kind === 'humid') {
      // Sustained: a long plateau every day with slow variation.
      segments.push({ channel: 'hum', at: day0, rise: 1, hold: 86400, decay: 1, delta: (h.level || 66) - baseFor(scenario).hum + (random() - 0.5) * 4 });
    }
    if (h.kind === 'calm' && random() < 0.25) {
      // The occasional small cooking blip so "calm" is not sterile.
      const at = day0 + (18 + random() * 2) * 3600;
      segments.push(...spikePm(at, { pm25: 12 + random() * 8, rise: 240, decay: 500 }));
      segments.push({ channel: 'tvoc', at, rise: 240, decay: 400, delta: 150 });
    }
  }
  segments.sort((a, b) => a.at - b.at);
  return segments;
}

/**
 * 5-minute slots in the dashboard's slot shape for the past `days` days.
 * Values are evaluated once a minute, so min/max are meaningful.
 */
export function generateHistorySlots(scenario, { endT, days = 30, timeZone, seed = 11, windowS = 300 }) {
  const segments = historyProgram(scenario, { endT, days, timeZone, seed });
  const base = baseFor(scenario);
  const preset = CAPABILITY_PRESETS[scenario.capabilities] || CAPABILITY_PRESETS.sen63c;
  const random = rng(seed + 1);
  const slots = [];
  const from = endT - days * 86400;
  let active = [];
  let segIdx = 0;
  let sequence = 1;
  const diurnal = (t) => {
    const h = localHour(t, timeZone);
    const night = h >= 23 || h < 6;
    return { co2: scenario.roomType === 'bedroom' ? (night ? 90 : 0) : (h >= 9 && h <= 22 ? 40 : 0), temp: Math.sin(((h - 9) / 24) * Math.PI * 2) * 1.2, hum: Math.cos(((h - 4) / 24) * Math.PI * 2) * 2 };
  };
  for (let wStart = from; wStart + windowS <= endT; wStart += windowS) {
    const acc = {};
    for (let m = 0; m < windowS; m += 60) {
      const t = wStart + m;
      while (segIdx < segments.length && segments[segIdx].at <= t) active.push(segments[segIdx++]);
      active = active.filter((s) => t - s.at < s.rise + (s.hold || 0) + 6 * (s.decay || 0) + 60);
      const d = diurnal(t);
      const v = { pm25: base.pm25, tvoc: base.tvoc, co2: base.co2 + d.co2, hum: base.hum + d.hum, temp: base.temp + d.temp };
      for (const s of active) if (v[s.channel] != null) v[s.channel] += segmentValue(s, t);
      v.pm25 = Math.max(0, v.pm25 + (random() - 0.5) * 0.8);
      v.tvoc = Math.max(0, v.tvoc + (random() - 0.5) * 16);
      v.co2 += (random() - 0.5) * 12;
      v.hum += (random() - 0.5) * 0.6;
      v.temp += (random() - 0.5) * 0.1;
      for (const [k, val] of Object.entries(v)) {
        const a = acc[k] || (acc[k] = { sum: 0, n: 0, min: Infinity, max: -Infinity });
        a.sum += val; a.n++; a.min = Math.min(a.min, val); a.max = Math.max(a.max, val);
      }
    }
    const r = (k, scale = 1) => ({ avg: Math.round((acc[k].sum / acc[k].n) * scale) / scale, min: Math.round(acc[k].min * scale) / scale, max: Math.round(acc[k].max * scale) / scale });
    const pm = r('pm25', 10), tv = r('tvoc'), c = r('co2'), hu = r('hum', 100), te = r('temp', 100);
    slots.push({
      sequence: sequence++,
      timestamp: wStart + windowS,
      tempAvg: te.avg, tempMin: te.min, tempMax: te.max,
      humAvg: hu.avg, humMin: hu.min, humMax: hu.max,
      vocAvg: vocLevelFromTvoc(tv.avg), vocMin: vocLevelFromTvoc(tv.min), vocMax: vocLevelFromTvoc(tv.max),
      co2Avg: preset.trueCo2 ? Math.round(c.avg) : Math.round(400 + tv.avg * 1.1), co2Min: preset.trueCo2 ? Math.round(c.min) : Math.round(400 + tv.min * 1.1), co2Max: preset.trueCo2 ? Math.round(c.max) : Math.round(400 + tv.max * 1.1),
      etvocAvg: Math.round(tv.avg), etvocMin: Math.round(tv.min), etvocMax: Math.round(tv.max),
      pm25Avg: preset.pm ? pm.avg : NaN, pm25Min: preset.pm ? pm.min : NaN, pm25Max: preset.pm ? pm.max : NaN,
    });
  }
  return slots;
}

export function scenarioServiceEvents(scenario, { endT, householdId, contractorId }) {
  return (scenario.serviceEvents || []).map((s, i) => ({ id: `svc-${scenario.key}-${i}`, householdId, contractorId: contractorId || null, type: s.type, occurredAt: endT - s.daysAgo * 86400, equipment: s.equipment || null, notes: s.notes || '' }));
}
