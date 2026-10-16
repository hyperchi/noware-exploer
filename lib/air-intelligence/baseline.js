/* Personal baselines: what "normal" looks like for this room, this device and
 * this time of day.
 *
 * The baseline is the 10th to 80th percentile of the channel over the lookback
 * (up to 7 days of history plus the live hour), excluding the most recent
 * half hour so an event in progress cannot become its own normal. Using the
 * 80th rather than the 90th percentile keeps a daily cooking spike from
 * widening the range. When fewer samples exist than make a trustworthy range
 * the reference band from thresholds.js is used and labelled as such; the UI
 * must never present a reference range as "your normal".
 *
 * Time-of-day buckets (night, morning, afternoon, evening) get their own range
 * once enough samples from at least two different days exist, which is what
 * lets the bedroom say "typical at this time: 650-850 ppm".
 */

import { CHANNEL_INFO, goodTop, goodBottom, attentionTop, attentionBottom } from './thresholds.js';
import { channelSeries, between, stats, sortedValues, percentile } from './series.js';

export const BUCKETS = Object.freeze([
  { id: 0, label: 'overnight', from: 0, to: 6 },
  { id: 1, label: 'in the morning', from: 6, to: 12 },
  { id: 2, label: 'in the afternoon', from: 12, to: 18 },
  { id: 3, label: 'in the evening', from: 18, to: 24 },
]);

const MIN_PERSONAL_SAMPLES = 40;
const MIN_PERSONAL_SPAN_S = 2 * 3600;
const MIN_BUCKET_SAMPLES = 24;
const EXCLUDE_RECENT_S = 1800;
const LOOKBACK_S = 7 * 86400;

const formatters = new Map();
const offsetCache = new Map();

function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/**
 * Seconds to add to a UTC timestamp to get wall-clock time in `timeZone`.
 * Intl is slow, so the offset is resolved once per 15-minute block and cached;
 * zone transitions are only ever off by that block.
 */
export function tzOffsetSeconds(t, timeZone) {
  if (!timeZone) return -new Date(t * 1000).getTimezoneOffset() * 60;
  const block = Math.floor(t / 900);
  const key = `${timeZone}|${block}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  let offset = 0;
  try {
    const parts = formatter(timeZone).formatToParts(new Date(block * 900 * 1000));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) / 1000;
    offset = Math.round(asUtc - block * 900);
  } catch {
    offset = -new Date(t * 1000).getTimezoneOffset() * 60;
  }
  if (offsetCache.size > 50000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** Hour of day (0-23, fractional) in the household's time zone. */
export function localHour(t, timeZone) {
  const local = t + tzOffsetSeconds(t, timeZone);
  return (((local % 86400) + 86400) % 86400) / 3600;
}

/** Calendar day key in the household's time zone, for "different days" checks. */
export function localDayKey(t, timeZone) {
  const local = t + tzOffsetSeconds(t, timeZone);
  return Math.floor(local / 86400);
}

export const bucketOf = (t, timeZone) => BUCKETS[Math.min(3, Math.floor(localHour(t, timeZone) / 6))];

function referenceBaseline(channel) {
  const info = CHANNEL_INFO[channel];
  const top = goodTop(channel);
  const bottom = goodBottom(channel);
  const typical = info?.refTypical ?? 0;
  return {
    kind: 'reference',
    median: typical,
    low: Number.isFinite(bottom) ? bottom : Math.max(0, typical * 0.6),
    high: Number.isFinite(top) ? top : typical * 1.5,
    n: 0,
    days: 0,
  };
}

const SESSION_MIN_SPAN_S = 10 * 60;
const SESSION_EXCLUDE_RECENT_S = 5 * 60;

function sessionBaseline(series, now, channel) {
  if (!series.length) return null;
  const first = series[0].t;
  const span = now - first;
  if (span < SESSION_MIN_SPAN_S + SESSION_EXCLUDE_RECENT_S) return null;
  const windowEnd = Math.min(now - SESSION_EXCLUDE_RECENT_S, first + Math.max(SESSION_MIN_SPAN_S, span * 0.3));
  const pts = between(series, first, windowEnd);
  if (pts.length < 10) return null;
  // The session may already contain the rise we are trying to judge, so the
  // quiet part of it is taken from the low side of the distribution.
  const sorted = sortedValues(pts);
  const info = CHANNEL_INFO[channel];
  const median = percentile(sorted, 0.3);
  const pad = Math.max(Math.abs(median) * 0.12, (info?.minDelta ?? 1) * 0.3);
  return { median, low: Math.max(info?.floor ?? -Infinity, Math.min(percentile(sorted, 0.1), median - pad)), high: Math.max(percentile(sorted, 0.45), median + pad), n: sorted.length, kind: 'session', days: 1 };
}

function rangeFrom(points, channel) {
  const s = stats(points);
  const info = CHANNEL_INFO[channel];
  // A very steady room still gets a range with some width, so "normal" reads
  // as a band rather than a single number.
  const pad = Math.max(Math.abs(s.median) * 0.12, (info?.minDelta ?? 1) * 0.3);
  // Events are a minority of the time, so the upper edge stops at the 65th
  // percentile: a daily cooking spike does not stretch "normal".
  const sorted = sortedValues(points);
  const p65 = percentile(sorted, 0.65);
  const high = Math.max(p65, s.median + pad);
  const low = Math.max(info?.floor ?? -Infinity, Math.min(s.p10, s.median - pad));
  return { median: s.median, low, high, n: s.n };
}

/**
 * @param {import('./normalize.js').Sample[]} samples sorted by t
 * @param {string[]} channels
 * @param {number} now
 * @param {{timeZone?: string}} [options]
 */
export function computeBaselines(samples, channels, now, { timeZone } = {}) {
  const out = {};
  for (const channel of channels) {
    const series = channelSeries(samples, channel);
    const eligible = between(series, now - LOOKBACK_S, now - EXCLUDE_RECENT_S);
    const span = eligible.length ? eligible[eligible.length - 1].t - eligible[0].t : 0;
    const days = new Set(eligible.map((p) => localDayKey(p.t, timeZone)));
    const reference = referenceBaseline(channel);
    if (eligible.length < MIN_PERSONAL_SAMPLES || span < MIN_PERSONAL_SPAN_S) {
      // No history yet (a cube plugged in minutes ago, or a fresh simulation):
      // use the first stretch of this session as a provisional "earlier today"
      // level, so a rise can at least be compared with where it started.
      const session = sessionBaseline(series, now, channel);
      out[channel] = session ? { ...session, all: null, byBucket: {}, timeZone, reference } : { ...reference, all: null, byBucket: {}, timeZone };
      continue;
    }
    const all = { ...rangeFrom(eligible, channel), kind: 'personal', days: days.size };
    const byBucket = {};
    const bucketIds = eligible.map((p) => bucketOf(p.t, timeZone).id);
    for (const bucket of BUCKETS) {
      const pts = eligible.filter((p, i) => bucketIds[i] === bucket.id);
      const bucketDays = new Set(pts.map((p) => localDayKey(p.t, timeZone)));
      if (pts.length >= MIN_BUCKET_SAMPLES && bucketDays.size >= 2) {
        byBucket[bucket.id] = { ...rangeFrom(pts, channel), kind: 'personal', days: bucketDays.size, bucketLabel: bucket.label };
      }
    }
    out[channel] = { ...all, all, byBucket, timeZone, reference };
  }
  return out;
}

/** The baseline that applies at time t: time-of-day bucket when known, else overall. */
export function baselineAt(baselines, channel, t) {
  const b = baselines[channel];
  if (!b) return referenceBaseline(channel);
  const bucket = bucketOf(t, b.timeZone);
  const scoped = b.byBucket?.[bucket.id];
  if (scoped) return { ...scoped, bucketLabel: bucket.label, reference: b.reference };
  return { kind: b.kind, median: b.median, low: b.low, high: b.high, n: b.n, days: b.days, bucketLabel: null, reference: b.reference };
}

/**
 * The line above which a value counts as elevated for this room. It is the
 * larger of the accepted "good" ceiling and a margin over the personal range,
 * so a very clean room is not alarmed by tiny changes and a normally busy
 * room is not nagged about its everyday level.
 */
export function elevatedLine(channel, baseline) {
  const info = CHANNEL_INFO[channel];
  const top = goodTop(channel);
  // The household's own range can raise the line above the accepted "good"
  // ceiling, but never past the point where the accepted bands say the air is
  // poor: a bedroom that is stuffy every night must not learn that as normal.
  // ...and in fact stops halfway into the "needs attention" band, so a room
  // that is usually stuffy still gets told when it is.
  const capTop = attentionTop(channel);
  const cap = Number.isFinite(capTop) && Number.isFinite(top) ? top + (capTop - top) * 0.5 : capTop;
  const personalRaw = baseline.kind !== 'reference' ? Math.max(baseline.high * 1.4, baseline.median + info.minDelta) : -Infinity;
  const personal = Math.min(personalRaw, Number.isFinite(cap) ? cap : personalRaw);
  const line = Math.max(Number.isFinite(top) ? top : -Infinity, personal, Math.min(baseline.median + info.minDelta, Number.isFinite(cap) ? cap : Infinity));
  return Number.isFinite(line) ? line : Infinity;
}

/** Below this the room is back to normal after an event. */
export function recoveredLine(channel, baseline) {
  const line = elevatedLine(channel, baseline);
  return baseline.median + (line - baseline.median) * 0.5;
}

/** For two-sided channels (humidity, temperature) a low side also exists. */
export function lowLine(channel, baseline) {
  const info = CHANNEL_INFO[channel];
  const bottom = goodBottom(channel);
  if (!Number.isFinite(bottom)) return -Infinity;
  const capBottom = attentionBottom(channel);
  const cap = Number.isFinite(capBottom) && Number.isFinite(bottom) ? bottom - (bottom - capBottom) * 0.5 : capBottom;
  const personalRaw = baseline.kind !== 'reference' ? Math.min(baseline.low * 0.8, baseline.median - info.minDelta) : Infinity;
  const personal = Math.max(personalRaw, Number.isFinite(cap) ? cap : personalRaw);
  return Math.min(bottom, personal);
}

export function describeRange(channel, baseline, format) {
  const lo = format(baseline.low);
  const hi = format(baseline.high);
  return `${lo.replace(/\s*\S+$/, '')}–${hi}`.replace(/^–/, '');
}
