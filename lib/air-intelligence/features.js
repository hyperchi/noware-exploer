/* Feature extraction: per channel, how the present compares with normal and
 * how it got here. Everything here is DERIVED from measurements; nothing is
 * yet a claim about the world.
 */

import { CHANNEL_INFO, bandIndex, bandLabel, bandStatus } from './thresholds.js';
import { baselineAt, elevatedLine, recoveredLine, lowLine } from './baseline.js';
import { channelSeries, between, stats, median, sortedValues, typicalSpacing } from './series.js';

/**
 * @typedef {Object} ChannelFeatures
 * @property {string} channel
 * @property {number|null} current  robust current value (median of the last minute)
 * @property {number} currentT
 * @property {object} baseline  from baselineAt()
 * @property {number} ratio  current / baseline median
 * @property {number} delta  current - baseline median
 * @property {number|null} band  0..4 reference band
 * @property {string} bandLabel
 * @property {string|null} status
 * @property {number} slope5m  units per minute over the last 5 minutes
 * @property {number} slope15m
 * @property {'rising'|'falling'|'steady'} trend
 * @property {number} elevatedLine
 * @property {boolean} elevated  current above the elevated line
 * @property {boolean} low  current below the comfort floor (humidity, temperature)
 * @property {number|null} elevatedSince  start of the current elevated run
 * @property {number} elevatedMinutes
 * @property {{v:number,t:number}|null} peak  within the elevated run
 * @property {number|null} onsetMinutes  minutes from leaving normal to 80 % of the peak
 * @property {number|null} recoveryPct  share of the excursion already recovered
 * @property {number} maxLastHour
 */

const RECENT_S = 60;

function robustCurrent(series, now) {
  if (!series.length) return { v: null, t: now };
  const spacing = typicalSpacing(series);
  const window = Math.max(RECENT_S, spacing * 1.5);
  const recent = between(series, now - window, now + 1);
  if (!recent.length) {
    const last = series[series.length - 1];
    return { v: last.v, t: last.t };
  }
  return { v: median(sortedValues(recent)), t: recent[recent.length - 1].t };
}

function trendOf(series, now, info) {
  const recent = between(series, now - 120, now + 1);
  const earlier = between(series, now - 480, now - 300);
  if (recent.length < 1 || earlier.length < 1) return 'steady';
  const a = median(sortedValues(recent));
  const b = median(sortedValues(earlier));
  const diff = a - b;
  const threshold = Math.max(Math.abs(b) * 0.05, info.minDelta * 0.2);
  if (diff > threshold) return 'rising';
  if (diff < -threshold) return 'falling';
  return 'steady';
}

/**
 * Walk back from now through the run of samples above the recovered line to
 * find where the current excursion began. Short dips below the line (under
 * three minutes) do not end the run.
 */
function elevatedRun(series, now, line, recovered, current) {
  const last = series[series.length - 1];
  // Entry is judged on the robust current value, not the very last sample, so
  // one noisy dip below the line does not erase the run (and its peak).
  if (!last || current == null || current <= line) return null;
  let start = last.t;
  let dipSince = null;
  let peak = { v: last.v, t: last.t };
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i];
    if (now - p.t > 36 * 3600) break;
    if (p.v > recovered) {
      start = p.t;
      dipSince = null;
      if (p.v > peak.v) peak = { v: p.v, t: p.t };
    } else {
      if (dipSince == null) dipSince = p.t;
      if (dipSince - p.t > 180) break;
    }
  }
  return { start, peak };
}

function onsetMinutes(series, run, baselineMedian) {
  if (!run) return null;
  const target = baselineMedian + 0.8 * (run.peak.v - baselineMedian);
  const pts = between(series, run.start, run.peak.t);
  const reach = pts.find((p) => p.v >= target);
  if (!reach) return null;
  return Math.max(0, (reach.t - run.start) / 60);
}

/**
 * @param {import('./normalize.js').Sample[]} samples sorted by time
 * @param {string[]} channels
 * @param {object} baselines  from computeBaselines
 * @param {number} now
 * @returns {Object<string, ChannelFeatures>}
 */
export function extractFeatures(samples, channels, baselines, now) {
  const out = {};
  for (const channel of channels) {
    const info = CHANNEL_INFO[channel];
    if (!info) continue;
    const series = channelSeries(samples, channel);
    const baseline = baselineAt(baselines, channel, now);
    const { v, t: currentT } = robustCurrent(series, now);
    const latest = samples.findLast(s => s.t <= now + 1);
    const current = latest && latest.channels[channel] == null ? null : v;
    const line = elevatedLine(channel, baseline);
    const recovered = recoveredLine(channel, baseline);
    const floor = lowLine(channel, baseline);
    const s5 = stats(between(series, now - 300, now + 1));
    const s15 = stats(between(series, now - 900, now + 1));
    const hour = stats(between(series, now - 3600, now + 1));
    const run = current != null && current > line ? elevatedRun(series, now, line, recovered, current) : null;
    const peak = run ? run.peak : null;
    const excursion = peak ? peak.v - baseline.median : 0;
    const recoveryPct = peak && excursion > 0 ? Math.max(0, Math.min(1, (peak.v - current) / excursion)) : null;
    out[channel] = {
      channel,
      current,
      currentT,
      n: series.length,
      baseline,
      ratio: current != null && baseline.median > 0 ? current / baseline.median : current != null ? 1 : NaN,
      delta: current != null ? current - baseline.median : NaN,
      band: bandIndex(channel, current),
      bandLabel: bandLabel(channel, current),
      status: bandStatus(channel, current),
      slope5m: s5.n >= 2 ? s5.slope : 0,
      slope15m: s15.n >= 2 ? s15.slope : 0,
      trend: trendOf(series, now, info),
      elevatedLine: line,
      recoveredLine: recovered,
      elevated: current != null && current > line,
      low: current != null && current < floor,
      elevatedSince: run ? run.start : null,
      elevatedMinutes: run ? (now - run.start) / 60 : 0,
      peak,
      onsetMinutes: onsetMinutes(series, run, baseline.median),
      recoveryPct,
      maxLastHour: hour.max,
      minLastHour: hour.min,
    };
  }
  return out;
}

/** Relationships between channels that single-channel features cannot see. */
export function crossFeatures(features) {
  const f = features;
  const ratio = (a, b) => (f[a]?.current != null && f[b]?.current > 0 ? f[a].current / f[b].current : null);
  const baseRatio = (a, b) => (f[a]?.baseline?.median > 0 && f[b]?.baseline?.median > 0 ? f[a].baseline.median / f[b].baseline.median : null);
  const rising = (c) => Boolean(f[c] && (f[c].elevated || f[c].trend === 'rising') && f[c].ratio > 1.3);
  return {
    pm10to25: ratio('pm10', 'pm25'),
    pm10to25Baseline: baseRatio('pm10', 'pm25'),
    pm1to25: ratio('pm1', 'pm25'),
    pmAndVocRising: rising('pm25') && rising('tvoc'),
    vocOnly: rising('tvoc') && !rising('pm25') && !rising('co2') && !rising('hum'),
    humOnly: rising('hum') && !rising('pm25') && !rising('tvoc'),
    co2Only: (rising('co2') || rising('eco2')) && !rising('pm25') && !rising('tvoc'),
  };
}
