/* Normalization: one sample shape whatever the data came from.
 *
 * Input shapes:
 *   - live readings as produced by protocol.parseLive (and relayed by
 *     api/cube.js), one per second;
 *   - 5-minute history slots from the cube (avg/min/max per channel);
 *   - simulated readings from scenarios.js, which use the live shape.
 *
 * A channel is null when the device does not have it or did not vouch for the
 * value on this frame. Downstream code never has to ask "is 0 a reading or a
 * gap" again.
 */

/**
 * @typedef {Object} Sample
 * @property {number} t unix seconds
 * @property {'physical'|'simulated'|'replay'} source
 * @property {boolean} warmingUp  gas sensor still conditioning
 * @property {boolean} fault  firmware flagged a missing/failed sensor
 * @property {number} [span] seconds this sample summarises (300 for a slot)
 * @property {Object<string, number|null>} channels
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** @returns {Sample} */
export function normalizeReading(r) {
  const pmValid = r.pmValid === true && r.pmPresent !== false;
  const tempValid = r.tempValid !== false;
  const humValid = r.humValid !== false;
  const hasTrueCo2 = r.hasTrueCo2 === true || (r.hasTrueCo2 === undefined && r.isPro === true);
  const co2Valid = hasTrueCo2 && r.co2Valid !== false && finite(r.co2) && r.co2 > 300;
  const warmingUp = r.warmingUp === true || r.ensStatus === 'Warming Up';
  const etvocValid = r.etvocValid !== false && !warmingUp && finite(r.etvoc);
  return {
    t: r.timestamp,
    source: r.source === 'simulated' || r.source === 'replay' ? r.source : 'physical',
    warmingUp,
    fault: r.sensorMissing === true,
    channels: {
      pm1: pmValid && finite(r.pm1) ? r.pm1 : null,
      pm25: pmValid && finite(r.pm25) ? r.pm25 : null,
      pm4: pmValid && finite(r.pm4) ? r.pm4 : null,
      pm10: pmValid && finite(r.pm10) ? r.pm10 : null,
      tvoc: etvocValid ? Math.max(0, r.etvoc) : null,
      vocLevel: etvocValid && finite(r.vocLevel) ? r.vocLevel : null,
      eco2: etvocValid && finite(r.eco2) && r.eco2 >= 400 ? r.eco2 : null,
      co2: co2Valid ? r.co2 : null,
      temp: tempValid && finite(r.temperatureC) ? r.temperatureC : null,
      hum: humValid && finite(r.humidity) ? r.humidity : null,
      lux: (r.hasLux === true || r.isPro === true) && finite(r.lux) ? r.lux : null,
    },
  };
}

/**
 * A 5-minute slot becomes one sample at the window's midpoint. The cube's
 * co2 column is true CO2 on boards that measure it (SEN63C or SCD41) and eCO2
 * on legacy Base units, so the caller says which it is.
 * @returns {Sample}
 */
export function normalizeSlot(s, { trueCo2 = true, windowS = 300, source = 'physical' } = {}) {
  const v = (x) => (finite(x) ? x : null);
  const co2 = finite(s.co2Avg) && s.co2Avg > 300 ? s.co2Avg : null;
  return {
    t: s.timestamp - windowS / 2,
    source,
    warmingUp: false,
    fault: false,
    span: windowS,
    channels: {
      pm1: null,
      pm25: v(s.pm25Avg),
      pm4: null,
      pm10: null,
      tvoc: v(s.etvocAvg),
      vocLevel: v(s.vocAvg),
      eco2: trueCo2 ? null : co2,
      co2: trueCo2 ? co2 : null,
      temp: v(s.tempAvg),
      hum: v(s.humAvg),
      lux: null,
    },
    extremes: {
      pm25: [v(s.pm25Min), v(s.pm25Max)],
      tvoc: [v(s.etvocMin), v(s.etvocMax)],
      co2: trueCo2 ? [finite(s.co2Min) ? s.co2Min : null, finite(s.co2Max) ? s.co2Max : null] : [null, null],
      hum: [v(s.humMin), v(s.humMax)],
      temp: [v(s.tempMin), v(s.tempMax)],
    },
  };
}

/** Merge slot samples that precede the first live sample with the live samples. */
export function mergeSamples(slotSamples, liveSamples) {
  if (!liveSamples.length) return [...slotSamples].sort((a, b) => a.t - b.t);
  const firstLive = liveSamples[0].t;
  return [...slotSamples.filter((s) => s.t < firstLive - (s.span || 0) / 2), ...liveSamples].sort((a, b) => a.t - b.t);
}
