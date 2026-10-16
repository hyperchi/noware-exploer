/* Accepted environmental bands, human names and copy for every channel.
 *
 * These are the generic reference thresholds. The engine always pairs them
 * with the household's own baseline (baseline.js) and never confuses the two:
 * "elevated for this room" and "above the recommended range" are reported
 * separately.
 *
 * Sources: PM2.5 / PM10 follow the US EPA 2024 NAAQS breakpoints (9 / 35.4 /
 * 55.4 µg/m³ for PM2.5, 54 / 154 / 254 for PM10). TVOC follows the ENS161
 * indoor-air bands used by the AirCube firmware (65 / 220 / 650 / 2200 ppb).
 * CO2 bands are the usual ventilation guidance (800 / 1200 / 2000 ppm).
 * Humidity comfort 30-60 %, temperature comfort 18-26 °C.
 */

import { STATUS } from './types.js';

/**
 * Each channel: ordered upper edges for the first four status bands (the
 * fifth is everything above), or for two-sided channels an explicit band list.
 * `floor` is the smallest value treated as a real measurement.
 */
export const CHANNEL_INFO = Object.freeze({
  pm25: {
    key: 'pm25', friendly: 'Fine particles', technical: 'PM2.5', unit: 'µg/m³', decimals: 1, floor: 0,
    edges: [5, 9, 35.4, 55.4], minDelta: 5, refTypical: 5,
    tooltip: 'PM2.5 means very small airborne particles, under 2.5 microns, that can travel deep into the lungs. Cooking, candles, smoke, dust and outdoor pollution all raise it.',
    bandLabels: ['Very low', 'Low', 'Elevated', 'High', 'Very high'],
  },
  pm10: {
    key: 'pm10', friendly: 'Coarse particles', technical: 'PM10', unit: 'µg/m³', decimals: 1, floor: 0,
    edges: [15, 54, 154, 254], minDelta: 10, refTypical: 10,
    tooltip: 'PM10 counts larger airborne particles such as dust and pollen. When PM10 rises much more than PM2.5, something is stirring up dust.',
    bandLabels: ['Very low', 'Low', 'Elevated', 'High', 'Very high'],
  },
  pm1: {
    key: 'pm1', friendly: 'Ultrafine particles', technical: 'PM1', unit: 'µg/m³', decimals: 1, floor: 0,
    edges: [4, 8, 30, 50], minDelta: 4, refTypical: 4,
    tooltip: 'PM1 counts the smallest particles, typical of combustion: cooking, candles and smoke.',
    bandLabels: ['Very low', 'Low', 'Elevated', 'High', 'Very high'],
  },
  pm4: {
    key: 'pm4', friendly: 'Particles up to 4 µm', technical: 'PM4', unit: 'µg/m³', decimals: 1, floor: 0,
    edges: [8, 20, 60, 100], minDelta: 8, refTypical: 8,
    tooltip: 'PM4 sits between fine and coarse particles. It is reported for completeness; PM2.5 and PM10 carry the interpretation.',
    bandLabels: ['Very low', 'Low', 'Elevated', 'High', 'Very high'],
  },
  tvoc: {
    key: 'tvoc', friendly: 'Chemicals & odors', technical: 'TVOC', unit: 'ppb', decimals: 0, floor: 0,
    edges: [65, 220, 660, 2200], minDelta: 100, refTypical: 80,
    tooltip: 'TVOC measures gases commonly released by cooking, cleaning products, paint, fragrances, new furniture and other materials. It is a total, so it cannot say which chemical.',
    bandLabels: ['Very low', 'Low', 'Moderate', 'Elevated', 'High'],
  },
  vocLevel: {
    key: 'vocLevel', friendly: 'VOC level', technical: 'VOC Level (0-500)', unit: '', decimals: 0, floor: 0,
    edges: [15, 50, 100, 200], minDelta: 20, refTypical: 10,
    tooltip: 'The firmware maps TVOC onto a fixed 0-500 indoor-air scale. The LED colour follows it.',
    bandLabels: ['Excellent', 'Good', 'Moderate', 'Poor', 'Unhealthy'],
  },
  co2: {
    key: 'co2', friendly: 'Fresh air', technical: 'CO2', unit: 'ppm', decimals: 0, floor: 300,
    edges: [600, 800, 1200, 2000], minDelta: 150, refTypical: 550,
    tooltip: 'CO2 is a useful proxy for how well a room is ventilated. People breathe it out; it only falls when fresh air replaces stale air. This is a direct (NDIR) measurement.',
    bandLabels: ['Very fresh', 'Fresh', 'Stuffy', 'High', 'Very high'],
  },
  eco2: {
    key: 'eco2', friendly: 'Fresh air (estimated)', technical: 'eCO2', unit: 'ppm', decimals: 0, floor: 300,
    edges: [600, 800, 1200, 2000], minDelta: 200, refTypical: 500,
    tooltip: 'eCO2 is an estimate derived from detected VOCs by the gas sensor, not a direct CO2 measurement. It tracks odours and fumes as much as ventilation, so it is treated with less confidence.',
    bandLabels: ['Very fresh', 'Fresh', 'Stuffy', 'High', 'Very high'],
  },
  hum: {
    key: 'hum', friendly: 'Humidity', technical: 'RH', unit: '%', decimals: 0, floor: 0,
    bands: [[40, 50, 0], [30, 60, 1], [25, 70, 2], [20, 80, 3]], minDelta: 8, refTypical: 45,
    tooltip: 'Relative humidity. Between 30 and 60 % is comfortable; sustained levels above 60 % encourage mould and dust mites, and dry air below 30 % irritates skin and airways.',
    bandLabels: ['Ideal', 'Comfortable', 'Outside comfort range', 'Very humid or very dry', 'Extreme'],
    lowLabel: 'Dry', highLabel: 'Humid',
  },
  temp: {
    key: 'temp', friendly: 'Room temperature', technical: 'Temperature', unit: '°C', decimals: 1, floor: -40,
    bands: [[20, 24, 0], [18, 26, 1], [16, 30, 2], [10, 35, 3]], minDelta: 2, refTypical: 22,
    tooltip: 'Air temperature at the device. Shown for comfort context; it does not drive the air verdict.',
    bandLabels: ['Ideal', 'Comfortable', 'Cool or warm', 'Cold or hot', 'Extreme'],
    lowLabel: 'Cool', highLabel: 'Warm',
  },
  lux: {
    key: 'lux', friendly: 'Light', technical: 'Illuminance', unit: 'lx', decimals: 0, floor: 0,
    edges: [Infinity, Infinity, Infinity, Infinity], minDelta: Infinity, refTypical: 100,
    tooltip: 'Ambient light at the device, used to dim the LED at night.',
    bandLabels: ['', '', '', '', ''],
  },
});

/** Which channel represents each event category, in order of preference. */
export const CATEGORY_CHANNELS = Object.freeze({
  particles: ['pm25', 'pm10', 'pm1'],
  voc: ['tvoc'],
  ventilation: ['co2', 'eco2'],
  humidity: ['hum'],
  temperature: ['temp'],
});

/** Band index 0..4 for a value, or null when the channel has no bands. */
export function bandIndex(channel, value) {
  const info = CHANNEL_INFO[channel];
  if (!info || !Number.isFinite(value)) return null;
  if (info.bands) {
    for (const [lo, hi, idx] of info.bands) if (value >= lo && value <= hi) return idx;
    return 4;
  }
  for (let i = 0; i < info.edges.length; i++) if (value <= info.edges[i]) return i;
  return 4;
}

export const bandStatus = (channel, value) => {
  const i = bandIndex(channel, value);
  return i == null ? null : STATUS[i];
};

export function bandLabel(channel, value) {
  const info = CHANNEL_INFO[channel];
  const i = bandIndex(channel, value);
  if (i == null || !info) return '';
  if (info.bands && i >= 2) {
    const comfort = info.bands[1];
    return value < comfort[0] ? info.lowLabel : info.highLabel;
  }
  return info.bandLabels[i];
}

/** Upper edge of the "good" band: above it a value is outside the recommended range. */
export function goodTop(channel) {
  const info = CHANNEL_INFO[channel];
  if (!info) return Infinity;
  return info.bands ? info.bands[1][1] : info.edges[1];
}

/** Lower edge of the comfort band for two-sided channels. */
export function goodBottom(channel) {
  const info = CHANNEL_INFO[channel];
  return info?.bands ? info.bands[1][0] : -Infinity;
}

/** Upper edge of the "needs attention" band: above it the accepted bands say poor. */
export function attentionTop(channel) {
  const info = CHANNEL_INFO[channel];
  if (!info) return Infinity;
  return info.bands ? info.bands[2][1] : info.edges[2];
}

export function attentionBottom(channel) {
  const info = CHANNEL_INFO[channel];
  return info?.bands ? info.bands[2][0] : -Infinity;
}

export function formatValue(channel, value, { fahrenheit = false } = {}) {
  const info = CHANNEL_INFO[channel];
  if (!info || !Number.isFinite(value)) return '--';
  if (channel === 'temp' && fahrenheit) return `${((value * 9) / 5 + 32).toFixed(1)}°F`;
  const text = value.toLocaleString(undefined, { minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals });
  if (!info.unit) return text;
  return info.unit === '%' || info.unit.startsWith('°') ? `${text}${info.unit}` : `${text} ${info.unit}`;
}
