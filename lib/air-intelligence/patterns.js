/* Recurring patterns over an event log: counts, durations, recovery times,
 * time-of-day distribution, overnight ventilation nights, and before/after
 * comparisons around service events. This is the evidence layer behind both
 * homeowner escalation and contractor insights; both read the same numbers.
 */

import { localHour, localDayKey } from './baseline.js';
import { median, percentile } from './series.js';

const DAY_S = 86400;
const NIGHT_START = 22;
const NIGHT_END = 7;
const LONG_EVENT_MIN = 30;
const NIGHT_MIN_OVERLAP_S = 3600;

const sortedNums = (arr) => arr.filter(Number.isFinite).sort((a, b) => a - b);

export function eventRecoveryMinutes(e) {
  if (e.recoveryMinutes != null) return e.recoveryMinutes;
  if (e.endedAt && e.peak) return Math.max(0, (e.endedAt - e.peak.t) / 60);
  return null;
}

export function eventDurationMinutes(e, now) {
  const end = e.endedAt ?? now;
  return Math.max(0, (end - e.startedAt) / 60);
}

function categoryStats(events, now, timeZone) {
  const recoveries = sortedNums(events.map(eventRecoveryMinutes));
  const durations = sortedNums(events.map((e) => eventDurationMinutes(e, now)));
  const byHour = new Array(24).fill(0);
  const bySource = {};
  const byRoom = {};
  let peakMax = 0;
  for (const e of events) {
    byHour[Math.floor(localHour(e.startedAt, timeZone)) % 24]++;
    const src = e.hypothesis?.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
    if (e.roomId) byRoom[e.roomId] = (byRoom[e.roomId] || 0) + 1;
    if (e.peak?.v > peakMax) peakMax = e.peak.v;
  }
  return {
    count: events.length,
    longCount: durations.filter((d) => d > LONG_EVENT_MIN).length,
    medianRecoveryMin: recoveries.length ? median(recoveries) : null,
    p75RecoveryMin: recoveries.length ? percentile(recoveries, 0.75) : null,
    medianDurationMin: durations.length ? median(durations) : null,
    totalMinutes: durations.reduce((a, b) => a + b, 0),
    byHour,
    bySource,
    byRoom,
    peakMax,
    lastAt: events.length ? Math.max(...events.map((e) => e.startedAt)) : null,
    unknownShare: events.length ? (bySource.unknown || 0) / events.length : 0,
  };
}

/** Night windows (22:00 -> 07:00 local) inside coverage, as [start, end] pairs. */
function nightWindows(from, to, timeZone) {
  const nights = [];
  // Walk day by day using local midnight offsets derived from localHour.
  let t = from;
  while (t < to + DAY_S) {
    const h = localHour(t, timeZone);
    const dayStart = t - h * 3600;
    const nightStart = dayStart + NIGHT_START * 3600;
    const nightEnd = dayStart + DAY_S + NIGHT_END * 3600;
    if (nightStart >= from && nightEnd <= to) nights.push([nightStart, nightEnd, localDayKey(nightEnd, timeZone)]);
    t = dayStart + DAY_S + 3600;
    if (nights.length > 400) break;
  }
  return nights;
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * @param {object} input
 * @param {import('./types.js').AirEvent[]} input.events  any state
 * @param {number} input.now
 * @param {number} [input.days]  lookback window
 * @param {string} [input.timeZone]
 * @param {{from:number,to:number}|null} [input.coverage]  span of data actually recorded
 * @param {object[]} [input.serviceEvents]  HomeServiceEvent[]
 * @param {{t:number, hum:number|null}[]} [input.humiditySamples]  optional coarse samples for sustained humidity
 */
export function analyzePatterns({ events, now, days = 30, timeZone, coverage = null, serviceEvents = [], humiditySamples = [] }) {
  const from = now - days * DAY_S;
  const inWindow = events.filter((e) => (e.endedAt ?? now) >= from && e.startedAt <= now);
  const resolved = inWindow.filter((e) => e.state === 'resolved' || e.endedAt);
  const categories = {};
  for (const category of ['particles', 'voc', 'ventilation', 'humidity', 'temperature']) {
    categories[category] = categoryStats(inWindow.filter((e) => e.category === category), now, timeZone);
  }

  const cov = coverage || (inWindow.length ? { from: Math.min(from, ...inWindow.map((e) => e.startedAt)), to: now } : null);
  const covFrom = cov ? Math.max(cov.from, from) : from;
  const covTo = cov ? Math.min(cov.to, now) : now;
  const coverageDays = cov ? Math.max(0, (covTo - covFrom) / DAY_S) : 0;

  const nights = cov ? nightWindows(covFrom, covTo, timeZone) : [];
  const ventilation = inWindow.filter((e) => e.category === 'ventilation');
  const elevatedNights = [];
  for (const [start, end, key] of nights) {
    let overlapS = 0;
    let peak = 0;
    for (const e of ventilation) {
      const o = overlap(start, end, e.startedAt, e.endedAt ?? now);
      if (o > 0) {
        overlapS += o;
        if (e.peak?.v > peak) peak = e.peak.v;
      }
    }
    if (overlapS >= NIGHT_MIN_OVERLAP_S) elevatedNights.push({ key, minutes: overlapS / 60, peak });
  }
  const overnightVentilation = {
    nightsObserved: nights.length,
    nightsElevated: elevatedNights.length,
    share: nights.length ? elevatedNights.length / nights.length : 0,
    avgDurationMin: elevatedNights.length ? elevatedNights.reduce((a, n) => a + n.minutes, 0) / elevatedNights.length : 0,
    avgPeak: elevatedNights.length ? elevatedNights.reduce((a, n) => a + n.peak, 0) / elevatedNights.length : 0,
    recentNights: elevatedNights.slice(-10).map((n) => n.key),
  };

  let humidity = { hoursAbove60: 0, hoursAbove70: 0, hoursBelow30: 0, shareAbove60: 0, shareBelow30: 0, samples: 0 };
  const hs = humiditySamples.filter((s) => s.t >= from && s.hum != null);
  if (hs.length > 1) {
    const spacing = (hs[hs.length - 1].t - hs[0].t) / (hs.length - 1) / 3600;
    const above60 = hs.filter((s) => s.hum > 60).length;
    const above70 = hs.filter((s) => s.hum > 70).length;
    const below30 = hs.filter((s) => s.hum < 30).length;
    humidity = {
      hoursAbove60: above60 * spacing, hoursAbove70: above70 * spacing, hoursBelow30: below30 * spacing,
      shareAbove60: above60 / hs.length, shareBelow30: below30 / hs.length, samples: hs.length,
    };
  } else {
    const h = categories.humidity;
    humidity.hoursAbove60 = h.totalMinutes / 60;
    humidity.shareAbove60 = coverageDays ? h.totalMinutes / 60 / (coverageDays * 24) : 0;
  }

  const serviceComparisons = serviceEvents
    .filter((s) => s.occurredAt >= from - 30 * DAY_S && s.occurredAt <= now)
    .map((s) => compareAroundService(s, events, now, timeZone))
    .filter(Boolean);

  return {
    windowDays: days,
    from,
    to: now,
    coverage: { from: covFrom, to: covTo, days: Math.round(coverageDays * 10) / 10 },
    totalEvents: inWindow.length,
    resolvedEvents: resolved.length,
    byCategory: categories,
    overnightVentilation,
    humidity,
    serviceComparisons,
  };
}

/** Before/after a service event, per category: counts and median recovery. */
export function compareAroundService(service, events, now, timeZone, days = 30) {
  const before = events.filter((e) => e.startedAt < service.occurredAt && e.startedAt >= service.occurredAt - days * DAY_S);
  const after = events.filter((e) => e.startedAt >= service.occurredAt && e.startedAt <= now);
  const afterDays = Math.max(0, (Math.min(now, service.occurredAt + days * DAY_S) - service.occurredAt) / DAY_S);
  if (afterDays < 3) return null;
  const categoriesTouched = service.type === 'filter_change' || service.type === 'equipment_installation' || service.type === 'maintenance' || service.type === 'repair' ? ['particles', 'ventilation', 'humidity'] : ['particles', 'ventilation', 'humidity'];
  const per = {};
  for (const category of categoriesTouched) {
    const b = categoryStats(before.filter((e) => e.category === category), now, timeZone);
    const a = categoryStats(after.filter((e) => e.category === category), now, timeZone);
    if (!b.count && !a.count) continue;
    const change = b.medianRecoveryMin && a.medianRecoveryMin ? (a.medianRecoveryMin - b.medianRecoveryMin) / b.medianRecoveryMin : null;
    per[category] = {
      before: { count: b.count, perDay: b.count / days, medianRecoveryMin: b.medianRecoveryMin, peakMax: b.peakMax },
      after: { count: a.count, perDay: afterDays ? a.count / afterDays : 0, medianRecoveryMin: a.medianRecoveryMin, peakMax: a.peakMax },
      recoveryChange: change,
      sufficient: b.count >= 3 && a.count >= 3,
    };
  }
  return { serviceEventId: service.id, type: service.type, occurredAt: service.occurredAt, equipment: service.equipment || null, notes: service.notes || '', afterDays: Math.round(afterDays), categories: per };
}
