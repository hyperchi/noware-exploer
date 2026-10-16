/* Small numeric helpers over time series of {t, v}. Deterministic, no state. */

export function sortedValues(points) {
  return points.map((p) => p.v).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const median = (sorted) => percentile(sorted, 0.5);

export function mean(values) {
  if (!values.length) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Points with from <= t <= to. */
export function between(points, from, to) {
  return points.filter((p) => p.t >= from && p.t <= to && Number.isFinite(p.v));
}

/** Least-squares slope in value per minute. */
export function slopePerMinute(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  let st = 0, sv = 0;
  for (const p of points) { st += p.t; sv += p.v; }
  const mt = st / n, mv = sv / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  return den ? (num / den) * 60 : 0;
}

/** Summary statistics for a run of points. */
export function stats(points) {
  const sorted = sortedValues(points);
  if (!sorted.length) return { n: 0, mean: NaN, median: NaN, min: NaN, max: NaN, p10: NaN, p25: NaN, p75: NaN, p90: NaN, first: NaN, last: NaN, slope: 0 };
  return {
    n: sorted.length,
    mean: mean(sorted),
    median: median(sorted),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    first: points[0].v,
    last: points[points.length - 1].v,
    slope: slopePerMinute(points),
  };
}

/** Typical spacing between consecutive points, in seconds. */
export function typicalSpacing(points) {
  if (points.length < 2) return 1;
  const gaps = [];
  for (let i = 1; i < points.length && gaps.length < 200; i++) gaps.push(points[i].t - points[i - 1].t);
  gaps.sort((a, b) => a - b);
  return Math.max(1, median(gaps));
}

/** Channel series {t, v} from normalized samples, skipping nulls. */
export function channelSeries(samples, channel) {
  const out = [];
  for (const s of samples) {
    const v = s.channels[channel];
    if (v != null && Number.isFinite(v)) out.push({ t: s.t, v, span: s.span || 0 });
  }
  return out;
}
