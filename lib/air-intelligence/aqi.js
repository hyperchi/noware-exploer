/* One standard on both sides: US EPA 2024 PM2.5 breakpoints and PM NowCast.
 * Room sensor estimates and outdoor model estimates retain their provenance.
 * Sources: EPA AQS AQI breakpoints; AirNow's PM NowCast calculation guidance.
 */
const BANDS = [
  [0, 9, 0, 50, 'Good', 'good'], [9.1, 35.4, 51, 100, 'Moderate', 'moderate'],
  [35.5, 55.4, 101, 150, 'Unhealthy for sensitive groups', 'sensitive'],
  [55.5, 125.4, 151, 200, 'Unhealthy', 'unhealthy'],
  [125.5, 225.4, 201, 300, 'Very unhealthy', 'very_unhealthy'],
  [225.5, 325.4, 301, 500, 'Hazardous', 'hazardous'],
];
export const AQI_STANDARD = 'US EPA PM2.5 · 2024';
const valid = v => Number.isFinite(v) && v >= 0;
const truncate = v => Math.floor((v + 1e-9) * 10) / 10;

export function pm25Aqi(concentration) {
  if (!valid(concentration)) return null;
  const pm25 = truncate(concentration);
  if (pm25 > 325.4) return { value: 500, text: '500+', label: 'Beyond the AQI scale', band: 'hazardous', pm25, beyondScale: true };
  const [lo, hi, lowIndex, highIndex, label, band] = BANDS.find(b => pm25 >= b[0] && pm25 <= b[1]);
  const value = Math.round((highIndex - lowIndex) / (hi - lo) * (pm25 - lo) + lowIndex);
  return { value, text: String(value), label, band, pm25, beyondScale: false };
}

/** hourly points have UTC hour-start t. Both sources use the same end hour.
 * Missing hours retain their position in the exponent; never compress gaps.
 */
export function pm25NowCast(hourly, { now }) {
  const through = Math.floor(now / 3600) * 3600;
  const values = Array(12).fill(null);
  for (const p of hourly || []) {
    if (!Number.isFinite(p.t) || p.t % 3600 !== 0 || !valid(p.value)) continue;
    const index = (through - 3600 - p.t) / 3600;
    if (Number.isInteger(index) && index >= 0 && index < 12) values[index] = p.value;
  }
  const present = values.filter(valid);
  if (values.slice(0, 3).filter(valid).length < 2) return { state: 'unavailable', reason: 'Building AQI history: at least 2 of the last 3 complete hours are needed.', through, hoursUsed: present.length, standard: AQI_STANDARD, method: 'PM NowCast' };
  const maximum = Math.max(...present), minimum = Math.min(...present);
  const weight = maximum === 0 ? 1 : Math.max(0.5, minimum / maximum);
  let numerator = 0, denominator = 0;
  values.forEach((v, i) => { if (valid(v)) { const w = weight ** i; numerator += v * w; denominator += w; } });
  return { state: 'available', ...pm25Aqi(numerator / denominator), through, hoursUsed: present.length, standard: AQI_STANDARD, method: 'PM NowCast', weight };
}

/** Time-weighted sensor hourly means. Require >=45 minutes of valid coverage.
 * Live samples cover at most 30 seconds, never bridge an outage. History
 * samples describe their full aggregate window. Ignore wrong provenance.
 */
export function roomHourlyPm25(samples, { now, source }) {
  const through = Math.floor(now / 3600) * 3600, from = through - 12 * 3600;
  const buckets = new Map();
  const sorted = samples.filter(s => s.source === source && s.t >= from - 3600 && s.t <= through + 3600).slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.warmingUp || s.fault || !valid(s.channels?.pm25)) continue;
    const span = Number.isFinite(s.span) && s.span > 0 ? s.span : 0;
    const fraction = span && s.coverageSeconds ? Math.max(0, Math.min(1, (s.coverageSeconds.pm25 || 0) / span)) : 1;
    if (!fraction) continue;
    const start = Math.max(from, span ? s.t - span / 2 : s.t);
    const end = Math.min(through, span ? s.t + span / 2 : s.t + Math.min(30, Math.max(0, (sorted[i + 1]?.t ?? s.t) - s.t)));
    for (let hour = Math.floor(start / 3600) * 3600; hour < end; hour += 3600) {
      const b = buckets.get(hour) || { seconds: 0, sum: 0, until: hour };
      const a = Math.max(start, hour, b.until), z = Math.min(end, hour + 3600);
      if (z > a) { const seconds = (z - a) * fraction; b.seconds += seconds; b.sum += s.channels.pm25 * seconds; b.until = z; }
      buckets.set(hour, b);
    }
  }
  return [...buckets].map(([t, b]) => ({ t, value: b.seconds >= 2700 ? b.sum / b.seconds : null, coverageSeconds: b.seconds }));
}

export function aqiComparison({ samples, health, capabilities, source, outdoor, now }) {
  const indoor = health.state === 'online' && capabilities.pm25
    ? { ...pm25NowCast(roomHourlyPm25(samples, { now, source }), { now }), kind: 'derived', source }
    : { state: 'unavailable', reason: !capabilities.pm25 ? 'A physical PM2.5 sensor is needed.' : 'Waiting for usable live sensor readings.', source };
  const fresh = outdoor?.status === 'available' && Number.isFinite(outdoor.fetchedAt) && now - outdoor.fetchedAt <= 1800 && now - outdoor.fetchedAt >= -60;
  const outside = fresh ? { ...pm25NowCast(outdoor.hourlyPm25 || [], { now }), kind: 'derived', source: outdoor.kind || 'modeled', provider: outdoor.provider }
    : { state: 'unavailable', reason: outdoor?.reason || 'Outdoor data is unavailable.', source: 'modeled' };
  const comparable = indoor.state === 'available' && outside.state === 'available';
  let explanation = 'Both values use the same US EPA PM2.5 scale and NowCast calculation.';
  if (comparable) {
    const delta = indoor.value - outside.value;
    explanation = Math.abs(delta) <= 5 ? 'The room and outdoor particle AQI estimates are close.' : delta < 0 ? 'The room’s particle AQI estimate is lower than outdoors.' : 'The room’s particle AQI estimate is higher than outdoors.';
  }
  return { standard: AQI_STANDARD, pollutant: 'PM2.5', method: 'PM NowCast', indoor, outdoor: outside, comparable, explanation,
    note: 'Both use up to 12 complete hours, with more weight on recent changes. Room values come from AirCube; outdoor values come from a regional model. These are PM2.5 estimates, not an official all-pollutant AQI or an allergy score.' };
}
