/* Overall air status for a room: the worst important active risk wins, with
 * an explanation of why. Nothing is averaged across unrelated pollutants.
 */

import { STATUS, STATUS_LABEL, STATUS_SHORT } from './types.js';
import { CHANNEL_INFO } from './thresholds.js';

const INTERPRETED = ['pm25', 'tvoc', 'co2', 'eco2', 'hum', 'pm10'];

/**
 * @param {object} input
 * @param {Object<string, import('./features.js').ChannelFeatures>} input.features
 * @param {import('./types.js').AirEvent[]} input.events  open events
 * @param {object} input.health  from deviceHealth()
 * @param {number} [input.stableSinceS]  seconds since the last event ended / data began
 */
export function overallStatus({ features, events, health, stableSinceS }) {
  if (!health.live) {
    const offline = health.state === 'no_device' ? 'No device connected' : health.state === 'stale' ? 'Sensor not updating' : 'Sensor offline';
    return {
      status: null,
      label: offline,
      short: offline,
      explanation: health.state === 'stale'
        ? `The last reading is from ${health.detail.replace('last reading ', '')}, so this is not the current state of the air.`
        : 'No live reading right now, so we cannot say what the air is like.',
      primaryChannel: null,
      primaryEventId: null,
      live: false,
    };
  }
  if (health.state === 'fault') return { status: null, label: 'Sensor fault', short: 'Sensor fault', explanation: health.detail, primaryChannel: null, primaryEventId: null, live: false };
  if (health.state === 'warming_up') {
    return {
      status: null,
      label: 'AirCube is warming up',
      short: 'Warming up',
      explanation: health.detail,
      primaryChannel: null,
      primaryEventId: null,
      live: true,
      warmingUp: true,
    };
  }

  if (!INTERPRETED.some(c => features[c]?.current != null)) return { status: null, label: 'Waiting for valid readings', short: 'Waiting', explanation: 'No valid air measurements are available.', primaryChannel: null, primaryEventId: null, live: false };
  let worst = 'excellent';
  let primaryChannel = null;
  for (const channel of INTERPRETED) {
    const f = features[channel];
    if (!f || f.current == null || f.status == null) continue;
    if (channel === 'eco2' && features.co2?.current != null) continue;
    let status = f.status;
    if (f.elevated && STATUS.indexOf(status) < 2) status = 'needs_attention';
    if (f.low && STATUS.indexOf(status) < 2) status = 'needs_attention';
    if (STATUS.indexOf(status) > STATUS.indexOf(worst)) {
      worst = status;
      primaryChannel = channel;
    }
  }
  const open = (events || []).filter((e) => e.state !== 'resolved');
  const primaryEvent = open
    .slice()
    .sort((a, b) => STATUS.indexOf(b.severity) - STATUS.indexOf(a.severity) || a.startedAt - b.startedAt)[0] || null;
  if (primaryEvent && STATUS.indexOf(primaryEvent.severity) > STATUS.indexOf(worst)) {
    worst = primaryEvent.severity;
    primaryChannel = primaryEvent.channel;
  }
  if (primaryEvent && !primaryChannel) primaryChannel = primaryEvent.channel;

  let explanation;
  if (STATUS.indexOf(worst) >= 2 && primaryChannel) {
    const plural = primaryChannel === 'pm25' || primaryChannel === 'pm10' || primaryChannel === 'pm1' || primaryChannel === 'tvoc';
    explanation = `${CHANNEL_INFO[primaryChannel].friendly} ${plural ? 'are' : 'is'} currently the main issue.`;
    if (primaryChannel === 'hum' && features.hum?.low) explanation = 'Dry air is currently the main issue.';
    if (primaryChannel === 'co2' || primaryChannel === 'eco2') explanation = 'Fresh air is currently the main issue.';
  } else if (open.length) {
    explanation = 'Levels are coming back toward normal.';
  } else {
    explanation = stableSinceS != null && stableSinceS >= 600
      ? `Nothing needs your attention. Air has been stable for ${formatDuration(stableSinceS)}.`
      : 'Nothing needs your attention.';
  }
  return {
    status: worst,
    label: STATUS_LABEL[worst],
    short: STATUS_SHORT[worst],
    explanation,
    primaryChannel,
    primaryEventId: primaryEvent ? primaryEvent.id : null,
    live: true,
  };
}

export function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}
