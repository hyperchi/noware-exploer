/* Event detection: turn per-channel features into explicit AirEvent objects
 * with a lifecycle (active -> improving -> resolved), carried across
 * successive assessments so an event keeps its identity and start time.
 */

import { STATUS } from './types.js';
import { CATEGORY_CHANNELS, CHANNEL_INFO, bandIndex } from './thresholds.js';
import { inferSource } from './infer-source.js';

const CONTINUITY_S = 15 * 60;
const RESOLVE_HOLD_S = 180;

function worstStatus(a, b) {
  return STATUS[Math.max(STATUS.indexOf(a), STATUS.indexOf(b))];
}

function severityFor(channel, value, f) {
  const band = bandIndex(channel, value);
  const absolute = band == null ? 'good' : STATUS[band];
  // Elevated against the household's own normal counts for attention even when
  // the accepted band still says "good".
  return f.elevated ? worstStatus(absolute, 'needs_attention') : absolute;
}

function relatedChanges(features, primary) {
  const out = {};
  for (const key of ['pm25', 'pm10', 'tvoc', 'co2', 'eco2', 'hum']) {
    const f = features[key];
    if (!f || f.current == null || key === primary) continue;
    out[key] = {
      ratio: Number.isFinite(f.ratio) ? Math.round(f.ratio * 100) / 100 : null,
      trend: f.trend,
      direction: f.elevated || f.ratio >= 1.3 ? (f.ratio >= 2 ? 'up_sharply' : 'up') : f.low ? 'down' : 'normal',
      value: f.current,
    };
  }
  return out;
}

export const eventId = (category, startedAt, deviceKey) => `${deviceKey || 'dev'}:${category}:${Math.round(startedAt)}`;

/**
 * @param {object} input
 * @param {Object<string, import('./features.js').ChannelFeatures>} input.features
 * @param {object} input.cross
 * @param {import('./types.js').DeviceCapabilities} input.capabilities
 * @param {import('./types.js').AirEvent[]} input.previous  events from the last assessment (any state)
 * @param {number} input.now
 * @param {object} [input.context]
 * @param {object} [input.outdoor]
 * @param {string} input.source
 * @param {string} input.deviceKey
 * @param {string} [input.roomId]
 * @param {string} [input.timeZone]
 * @param {boolean} [input.live]  false while warming up / offline: no new events, nothing resolves
 * @returns {import('./types.js').AirEvent[]} active and improving events plus any resolved just now
 */
export function detectEvents({ features, cross, capabilities, previous = [], now, context, outdoor, source, deviceKey, roomId, timeZone, live = true }) {
  const open = previous.filter((e) => e.state !== 'resolved');
  if (!live) return open;
  const result = [];
  const handled = new Set();

  for (const [category, channels] of Object.entries(CATEGORY_CHANNELS)) {
    const channel = channels.find((c) => features[c] && features[c].current != null);
    if (!channel) continue;
    const f = features[channel];
    const prior = open.find((e) => e.category === category);
    const isLow = f.low && (category === 'humidity' || category === 'temperature');
    const activeNow = f.elevated || isLow;
    // Temperature only becomes an event when it leaves comfort by a margin.
    if (category === 'temperature' && activeNow && (f.band ?? 0) < 3) continue;

    if (activeNow) {
      const startedAt = f.elevatedSince ?? (prior ? prior.startedAt : now);
      const continues = prior && (Math.abs(prior.startedAt - startedAt) < CONTINUITY_S || prior.state !== 'resolved');
      const event = continues ? { ...prior } : {
        id: eventId(category, startedAt, deviceKey),
        deviceKey,
        roomId,
        category,
        channel,
        startedAt,
        source,
        startValue: f.baseline.median,
        recommendations: [],
        acknowledgedActions: [],
        direction: isLow ? 'low' : 'high',
      };
      if (prior) handled.add(prior.id);
      const peak = f.peak || { v: f.current, t: now };
      const prevPeak = event.peak;
      event.peak = prevPeak && prevPeak.v >= peak.v && !isLow ? prevPeak : peak;
      event.currentValue = f.current;
      event.baseline = { low: f.baseline.low, high: f.baseline.high, median: f.baseline.median, kind: f.baseline.kind, bucketLabel: f.baseline.bucketLabel || null };
      event.elevatedLine = f.elevatedLine;
      event.severity = worstStatus(event.severity || 'good', severityFor(channel, f.current, f));
      event.peakSeverity = worstStatus(event.peakSeverity || 'good', severityFor(channel, event.peak.v, f));
      const excursion = event.peak ? event.peak.v - f.baseline.median : 0;
      event.recoveryPct = f.recoveryPct ?? (excursion > 0 && f.current != null ? Math.max(0, Math.min(1, (event.peak.v - f.current) / excursion)) : null);
      event.onsetMinutes = f.onsetMinutes ?? event.onsetMinutes ?? null;
      event.durationMinutes = (now - event.startedAt) / 60;
      event.related = relatedChanges(features, channel);
      // improving is sticky: a noisy decay must not flip back to active (and
      // re-judge the source from weak, fading signals) unless levels really
      // climb again.
      const wasImproving = continues && prior.state === 'improving';
      const improving = event.recoveryPct != null && ((event.recoveryPct >= 0.3 && f.trend !== 'rising') || (wasImproving && event.recoveryPct >= 0.15));
      event.state = improving ? 'improving' : 'active';
      // Infer the source afresh while the event is building, since the
      // picture is still developing. Once it is clearing, the decaying signals
      // say less than the peak did, so the hypothesis formed by then is kept
      // unless a clearly better one appears.
      const fresh = inferSource({ category, channel, features, cross, context, outdoor, now, timeZone });
      const current = event.hypothesis;
      if (!current || event.state === 'active' || fresh.confidence.score > current.confidence.score + 0.1) event.hypothesis = fresh;
      event.updatedAt = now;
      result.push(event);
    } else if (prior) {
      handled.add(prior.id);
      // Below the elevated line: resolved once it has also come back under the
      // recovered line, otherwise still improving.
      if (f.current <= f.recoveredLine || isLowResolved(prior, f)) {
        const sinceBelow = prior.belowSince ?? now;
        if (now - sinceBelow >= RESOLVE_HOLD_S || prior.state === 'improving') {
          result.push({ ...prior, state: 'resolved', endedAt: now, currentValue: f.current, durationMinutes: (now - prior.startedAt) / 60, recoveryMinutes: prior.peak ? Math.max(0, (now - prior.peak.t) / 60) : null, recoveryPct: 1, updatedAt: now });
        } else {
          result.push({ ...prior, state: 'improving', belowSince: sinceBelow, currentValue: f.current, recoveryPct: f.recoveryPct ?? prior.recoveryPct, updatedAt: now });
        }
      } else {
        result.push({ ...prior, state: 'improving', currentValue: f.current, recoveryPct: f.recoveryPct ?? prior.recoveryPct, durationMinutes: (now - prior.startedAt) / 60, updatedAt: now });
      }
    }
  }

  // Open events whose channel vanished (sensor withheld) stay as they were.
  for (const e of open) if (!handled.has(e.id)) result.push(e);
  return result;
}

function isLowResolved(prior, f) {
  return prior.direction === 'low' && !f.low;
}

/** Plain summary of what changed, for "WHAT'S HAPPENING". */
export function describeChanges(event, capabilities) {
  const rows = [];
  const label = (c) => CHANNEL_INFO[c]?.friendly || c;
  const arrow = (dir) => (dir === 'up_sharply' ? '↑ sharply' : dir === 'up' ? '↑' : dir === 'down' ? '↓' : 'normal');
  const primaryDir = event.direction === 'low' ? 'down' : (event.peak && event.baseline && event.peak.v >= event.baseline.median * 2 ? 'up_sharply' : 'up');
  rows.push({ channel: event.channel, label: label(event.channel), text: arrow(primaryDir), direction: primaryDir, primary: true });
  for (const [channel, r] of Object.entries(event.related || {})) {
    if (channel === 'eco2' && capabilities?.trueCo2) continue;
    rows.push({ channel, label: label(channel), text: arrow(r.direction), direction: r.direction, primary: false });
  }
  return rows;
}
