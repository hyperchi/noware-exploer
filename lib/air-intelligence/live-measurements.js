/* Trailing averages from raw sensor samples only. Never blend firmware
 * rollups, provenance, warm-up values or gaps into a live five-minute mean. */
import { ONLINE_WINDOW_S } from './health.js';

export function liveMeasurementWindows(samples, channels, { now, source = 'physical' }) {
  const from = now - 300;
  const raw = [...new Map(samples.filter(s => !s.span && s.t >= from - ONLINE_WINDOW_S && s.t <= now).map(s => [s.t, s])).values()].sort((a, b) => a.t - b.t);
  return Object.fromEntries(channels.map(channel => {
    let weighted = 0, coverageSeconds = 0, sampleCount = 0;
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i], value = s.channels[channel];
      if (s.source !== source || s.warmingUp || s.fault || !Number.isFinite(value)) continue;
      // A sample represents the time until the next frame, capped at the
      // freshness limit. Missing frames therefore leave real gaps.
      const seconds = Math.max(0, Math.min(now, raw[i + 1]?.t ?? now, s.t + ONLINE_WINDOW_S) - Math.max(from, s.t));
      if (!seconds) continue;
      weighted += value * seconds;
      coverageSeconds += seconds;
      sampleCount++;
    }
    return [channel, {
      value: coverageSeconds ? weighted / coverageSeconds : null,
      kind: 'derived', method: 'time_weighted', windowSeconds: 300,
      coverageSeconds, sampleCount, complete: coverageSeconds >= 270,
      from, through: now, source,
    }];
  }));
}

/** Also used by the browser so a stalled API response cannot stay "Live". */
export function measurementIsLive({ state, measuredAt, now }) {
  return state === 'online' && Number.isFinite(measuredAt) && now >= measuredAt && now - measuredAt <= ONLINE_WINDOW_S;
}
