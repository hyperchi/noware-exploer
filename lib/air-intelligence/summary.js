/* Presentation-neutral pieces of the AirIntelligenceSummary: measurement rows
 * (meaning -> number -> context), recovery state, the air story timeline and
 * the home-level roll-up. The homeowner UI, contractor UI and reports all
 * read these; none of them re-derive anything.
 */

import { STATUS, STATUS_SHORT } from './types.js';
import { CHANNEL_INFO, formatValue, bandLabel, bandIndex, bandStatus } from './thresholds.js';
import { availableChannels } from './capabilities.js';
import { formatDuration } from './status.js';
import { localHour } from './baseline.js';

const DISPLAY_ORDER = ['pm25', 'tvoc', 'co2', 'eco2', 'hum', 'temp', 'pm10', 'pm1', 'pm4', 'lux'];

function ratioText(f) {
  if (!Number.isFinite(f.ratio) || f.current == null) return '';
  if (f.baseline.kind === 'reference') return (f.band ?? 0) >= 2 ? 'Outside the recommended range' : '';
  const normal = f.baseline.kind === 'session' ? 'earlier today' : 'your normal';
  if (f.ratio >= 1.3) return `↑ ${f.ratio >= 10 ? Math.round(f.ratio) : f.ratio.toFixed(1)}× ${normal}`;
  if (f.ratio <= 0.7 && f.channel !== 'co2') return `↓ below your normal`;
  if ((f.band ?? 0) >= 2) return 'Usual for this room, but outside the recommended range';
  return 'Normal for this room';
}

function baselineText(channel, baseline, fahrenheit = false) {
  const info = CHANNEL_INFO[channel];
  const hi = formatValue(channel, baseline.high, { fahrenheit });
  const unitSuffix = hi.replace(/^[\d.,]+/, '');
  const lo = formatValue(channel, baseline.low, { fahrenheit }).replace(unitSuffix, '');
  const range = `${lo}–${hi}`;
  if (baseline.kind === 'personal') return baseline.bucketLabel ? `Typical ${baseline.bucketLabel}: ${range}` : `Normally in this room: ${range}`;
  if (baseline.kind === 'session') return `Earlier today: ${range}`;
  return `Recommended range: up to ${hi}`;
}

/**
 * One row per available channel, friendly label first, number always present.
 * @returns {object[]}
 */
export function measurementRows(features, capabilities, { fahrenheit = false } = {}) {
  const rows = [];
  const channels = availableChannels(capabilities);
  for (const channel of DISPLAY_ORDER) {
    if (!channels.includes(channel)) continue;
    if (channel === 'eco2' && capabilities.trueCo2) continue;
    const info = CHANNEL_INFO[channel];
    const f = features[channel];
    const value = f?.latestValue ?? null;
    const displayFeature = f ? { ...f, current: value, ratio: value != null && f.baseline.median > 0 ? value / f.baseline.median : NaN } : null;
    const row = {
      channel,
      friendly: info.friendly,
      technical: info.technical,
      value,
      recentMedian: f?.current ?? null,
      measuredAt: f?.currentT || null,
      unit: info.unit,
      decimals: info.decimals,
      text: value == null ? '--' : formatValue(channel, value, { fahrenheit }),
      band: bandIndex(channel, value),
      bandLabel: value == null ? (f ? 'Withheld' : 'No data') : bandLabel(channel, value),
      status: bandStatus(channel, value),
      elevated: Boolean(f?.elevated),
      low: Boolean(f?.low),
      trend: f?.trend || 'steady',
      baseline: f ? { low: f.baseline.low, high: f.baseline.high, median: f.baseline.median, kind: f.baseline.kind, bucketLabel: f.baseline.bucketLabel || null, text: baselineText(channel, f.baseline, fahrenheit) } : null,
      ratio: displayFeature && Number.isFinite(displayFeature.ratio) ? Math.round(displayFeature.ratio * 100) / 100 : null,
      ratioText: displayFeature ? ratioText(displayFeature) : '',
      tooltip: info.tooltip,
      kind: channel === 'eco2' || channel === 'vocLevel' || channel === 'tvoc' ? 'derived' : 'measured',
      note: channel === 'eco2' ? 'Estimated from VOCs, not a direct CO2 measurement.' : channel === 'co2' ? 'Direct CO2 measurement.' : '',
      peakLastHour: f?.maxLastHour ?? null,
    };
    rows.push(row);
  }
  return rows;
}

/**
 * Did it work? Only claims an action when the homeowner acknowledged one.
 */
const SUBJECT = { pm25: ['fine particles', true], pm10: ['coarse particles', true], pm1: ['small particles', true], tvoc: ['chemical levels', true], co2: ['CO2 levels', true], eco2: ['estimated CO2 levels', true], hum: ['humidity', false], temp: ['temperature', false] };

export function recoveryState(event, now) {
  if (!event) return null;
  const [unit, plural] = SUBJECT[event.channel] || [CHANNEL_INFO[event.channel].friendly.toLowerCase(), true];
  const are = plural ? 'are' : 'is';
  const have = plural ? 'have' : 'has';
  const acks = (event.acknowledgedActions || []).filter((a) => a.level === 'diy');
  const lastAck = acks.length ? acks.reduce((a, b) => (b.at > a.at ? b : a)) : null;
  if (event.state === 'resolved') {
    return {
      state: 'resolved',
      pct: 100,
      text: event.recoveryMinutes != null ? `Back to normal. ${capitalize(unit)} cleared in ${formatDuration(event.recoveryMinutes * 60)} after the peak.` : 'Back to normal.',
      sinceAction: lastAck ? lastAck.title : null,
    };
  }
  const peak = event.peak?.v;
  const current = event.currentValue;
  const base = event.baseline?.median ?? 0;
  const excursion = peak != null ? peak - base : 0;
  let pct = excursion > 0 && current != null ? Math.round(Math.max(0, Math.min(1, (peak - current) / excursion)) * 100) : 0;
  let text;
  const minutes = Math.round(event.durationMinutes || 0);
  if (lastAck && lastAck.valueAt != null && current != null && lastAck.valueAt > 0) {
    const drop = Math.round(((lastAck.valueAt - current) / lastAck.valueAt) * 100);
    const since = formatDuration(now - lastAck.at);
    if (drop >= 10) {
      return { state: 'improving', pct, text: `${capitalize(unit)} ${are} down ${drop}% since you ${pastTense(lastAck)} ${since} ago.`, sinceAction: lastAck.title };
    }
    if (now - lastAck.at < 8 * 60) {
      return { state: 'watching', pct, text: `Too early to tell. Give it a few more minutes since you ${pastTense(lastAck)}.`, sinceAction: lastAck.title };
    }
    return { state: 'not_improving', pct, text: `Not improving yet. ${capitalize(unit)} ${have} stayed high for ${since} since you ${pastTense(lastAck)}.`, sinceAction: lastAck.title };
  }
  if (event.state === 'improving' || pct >= 25) text = `Improving. ${capitalize(unit)} ${are} down ${pct}% from the peak.`;
  else if (minutes >= 15) text = `Not improving yet. ${capitalize(unit)} ${have} stayed ${event.direction === 'low' ? 'low' : 'high'} for ${formatDuration(minutes * 60)}.`;
  else text = `Started ${minutes <= 1 ? 'just now' : `${minutes} min ago`}. Watching for improvement.`;
  return { state: event.state === 'improving' || pct >= 25 ? 'improving' : minutes >= 15 ? 'not_improving' : 'watching', pct, text, sinceAction: null };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pastTense = (ack) => ({ exhaust: 'turned on the exhaust', ventilate: 'opened a window', close_windows: 'closed the windows', purifier: 'started the purifier', bathroom_fan: 'ran the fan', wait: 'let it settle', reduce_source: 'removed the source' })[ack.actionType] || `did "${ack.title}"`;

/**
 * The air story: events, acknowledged actions, recoveries and service visits
 * as one chronological list. Causality is only stated when the engine
 * measured it; otherwise the wording is "since".
 */
export function buildTimeline({ events = [], serviceEvents = [], now, timeZone, from = now - 86400, to = now }) {
  const items = [];
  const title = (e) => {
    const info = CHANNEL_INFO[e.channel];
    if (e.category === 'ventilation') return 'Fresh air ran low';
    if (e.category === 'humidity') return e.direction === 'low' ? 'Air turned dry' : e.onsetMinutes != null && e.onsetMinutes <= 10 ? 'Humidity spiked' : 'Humidity rose';
    const verb = e.direction === 'low' ? 'dropped' : e.onsetMinutes != null && e.onsetMinutes <= 10 ? 'spiked' : 'rose';
    return `${info.friendly} ${verb}`;
  };
  for (const e of events) {
    if (e.startedAt < from || e.startedAt > to) continue;
    const hyp = e.hypothesis;
    items.push({ t: e.startedAt, kind: 'event_start', eventId: e.id, category: e.category, title: title(e), detail: hyp && hyp.source !== 'unknown' ? `Likely ${hyp.label.toLowerCase()} · ${hyp.confidence.level} confidence` : 'Cause unclear', value: e.peak ? formatValue(e.channel, e.peak.v) : null, severity: e.severity });
    for (const a of e.acknowledgedActions || []) {
      items.push({ t: a.at, kind: 'action', eventId: e.id, category: e.category, title: a.title, detail: 'You marked this done', severity: null });
    }
    if (e.endedAt) {
      items.push({ t: e.endedAt, kind: 'event_end', eventId: e.id, category: e.category, title: 'Air returned to normal', detail: e.recoveryMinutes != null ? `${formatDuration(e.recoveryMinutes * 60)} recovery` : '', severity: 'good' });
    }
  }
  for (const s of serviceEvents) {
    if (s.occurredAt < from || s.occurredAt > to) continue;
    items.push({ t: s.occurredAt, kind: 'service', title: s.title || serviceTitle(s), detail: s.contractorName ? `By ${s.contractorName}` : '', severity: null, serviceEventId: s.id });
  }
  items.sort((a, b) => a.t - b.t);
  return items.map((i) => ({ ...i, hour: localHour(i.t, timeZone) }));
}

export function serviceTitle(s) {
  return ({ maintenance: 'HVAC maintenance visit', repair: 'Repair visit', filter_change: 'HVAC filter replaced', equipment_installation: `${s.equipment?.label || 'Equipment'} installed`, inspection: 'Inspection' })[s.type] || 'Service visit';
}

/** Roll several room summaries up to the home. */
export function homeSummary(roomSummaries, { now } = {}) {
  const live = roomSummaries.filter((r) => r.currentStatus.live && r.currentStatus.status);
  let worst = live.length ? 'excellent' : null;
  for (const r of live) if (STATUS.indexOf(r.currentStatus.status) > STATUS.indexOf(worst)) worst = r.currentStatus.status;
  const attention = roomSummaries.filter((r) => r.currentStatus.live && r.currentStatus.status && STATUS.indexOf(r.currentStatus.status) >= 2);
  const offline = roomSummaries.filter((r) => !r.currentStatus.live);
  return {
    generatedAt: now,
    status: worst,
    label: worst ? (attention.length ? `${attention.length === 1 ? '1 thing needs' : `${attention.length} things need`} your attention` : 'Air is good') : offline.length === roomSummaries.length && roomSummaries.length ? 'No live readings' : 'No rooms yet',
    short: worst ? STATUS_SHORT[worst] : offline.length ? 'Offline' : '--',
    attentionCount: attention.length,
    offlineCount: offline.length,
    rooms: roomSummaries.map((r) => ({ roomId: r.roomId, roomName: r.roomName, deviceKey: r.deviceKey, status: r.currentStatus.status, live: r.currentStatus.live, short: r.currentStatus.live ? (r.currentStatus.status ? STATUS_SHORT[r.currentStatus.status] : r.currentStatus.short) : r.deviceHealth.label, headline: r.primaryIssue ? r.primaryIssue.headline : r.currentStatus.explanation, simulated: r.deviceHealth.simulated, source: r.deviceHealth.source })),
    primaryRoomId: attention.sort((a, b) => STATUS.indexOf(b.currentStatus.status) - STATUS.indexOf(a.currentStatus.status))[0]?.roomId || null,
  };
}
