/* Sensor capability model.
 *
 * Nothing is assumed from a model name. A channel exists when the device has
 * actually reported it: the SEN63C announces itself with `pmPresent`, true
 * CO2 is whatever the firmware flagged valid (SEN63C or Pro SCD41), and a
 * Base unit without either only has the ENS161 estimate. Capabilities are
 * accumulated over the readings seen, so a channel that was valid once stays
 * declared even while it is temporarily withheld.
 */

/** @returns {import('./types.js').DeviceCapabilities} */
export function emptyCapabilities() {
  return {
    pm1: false, pm25: false, pm4: false, pm10: false,
    tvoc: false, vocLevel: false, eco2: false, trueCo2: false,
    temperature: false, humidity: false, illuminance: false,
    co2Kind: 'none',
  };
}

/** Capabilities visible in one reading (protocol.parseLive shape). */
export function capabilitiesFromReading(r) {
  const caps = emptyCapabilities();
  if (!r) return caps;
  const pm = r.pmPresent === true || r.pmValid === true;
  caps.pm1 = caps.pm25 = caps.pm4 = caps.pm10 = pm;
  caps.tvoc = caps.vocLevel = caps.eco2 = r.etvocValid !== false || r.warmingUp === true || Number.isFinite(r.etvoc);
  caps.trueCo2 = r.hasTrueCo2 === true || (r.hasTrueCo2 === undefined && r.isPro === true);
  caps.temperature = r.tempValid !== false;
  caps.humidity = r.humValid !== false;
  caps.illuminance = r.hasLux === true || (r.hasLux === undefined && r.isPro === true);
  caps.co2Kind = caps.trueCo2 ? 'true' : caps.eco2 ? 'estimated' : 'none';
  return caps;
}

/** Union over many readings (most recent last). */
export function capabilitiesFromReadings(readings) {
  const caps = emptyCapabilities();
  for (const r of readings) {
    const c = capabilitiesFromReading(r);
    for (const key of Object.keys(caps)) if (key !== 'co2Kind' && c[key]) caps[key] = true;
  }
  caps.co2Kind = caps.trueCo2 ? 'true' : caps.eco2 ? 'estimated' : 'none';
  return caps;
}

/** Channels that may be interpreted, in display order, given capabilities. */
export function availableChannels(caps) {
  const out = [];
  if (caps.pm25) out.push('pm25');
  if (caps.tvoc) out.push('tvoc');
  if (caps.trueCo2) out.push('co2');
  else if (caps.eco2) out.push('eco2');
  if (caps.humidity) out.push('hum');
  if (caps.temperature) out.push('temp');
  if (caps.pm10) out.push('pm10');
  if (caps.pm1) out.push('pm1');
  if (caps.pm4) out.push('pm4');
  if (caps.illuminance) out.push('lux');
  return out;
}

/** Short human description, e.g. "particles, chemicals, true CO2, temperature, humidity". */
export function describeCapabilities(caps) {
  const parts = [];
  if (caps.pm25) parts.push('fine and coarse particles');
  if (caps.tvoc) parts.push('chemicals & odors');
  if (caps.trueCo2) parts.push('true CO2');
  else if (caps.eco2) parts.push('estimated CO2');
  if (caps.temperature) parts.push('temperature');
  if (caps.humidity) parts.push('humidity');
  if (caps.illuminance) parts.push('light');
  return parts.join(', ');
}
