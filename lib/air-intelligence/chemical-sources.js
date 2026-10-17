/* Explain VOC history using the existing event hypotheses. No chemical
 * fingerprinting: a broadband gas sensor cannot identify a product or gas.
 * Common source examples: EPA, Volatile Organic Compounds' Impact on IAQ.
 */
import { localHour, localDayKey } from './baseline.js';

export const COMMON_CHEMICAL_SOURCES = Object.freeze([
  { id: 'products', title: 'Products & fragrance', examples: 'Cleaning sprays, scented products, perfumes and alcohol-based products.', clue: 'A quick gas-sensor rise with little particle change can fit this pattern.', action: 'Think about products used nearby. Close containers and follow their ventilation instructions.' },
  { id: 'cooking', title: 'Cooking & burning', examples: 'Cooking fumes, candles, incense and tobacco smoke.', clue: 'Gases and fine particles rising together can fit cooking or combustion.', action: 'Check for an active source and use an exhaust fan that vents outdoors.' },
  { id: 'materials', title: 'Materials & ongoing emissions', examples: 'Fresh paint, adhesives, new furniture and stored chemicals.', clue: 'Repeated or long-lasting gas changes can warrant checking these sources; they do not identify a material.', action: 'Look for recent changes in the room. Check ventilation if the pattern persists.' },
]);
const DAY = 86400;
const median = list => { const a = list.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
const NOTE_TYPES = { cleaning: 'Cleaning or fragrance', cooking: 'Cooking', candles: 'Candles or incense', paint_materials: 'Paint or new materials' };

export function chemicalSources({ events = [], observations = [], health, capabilities = {}, now, roomId, source = 'physical', timeZone, coverage }) {
  const eligible = events.filter(e => e.roomId === roomId && e.source === source && e.category === 'voc' && e.startedAt <= now && e.startedAt >= now - 30 * DAY).sort((a, b) => a.startedAt - b.startedAt);
  // Merge overlapping duplicate records (e.g. history plus live detection),
  // but never merge separate events merely because they occurred the same day.
  const episodes = [];
  for (const e of eligible) {
    const last = episodes.at(-1);
    if (last && (e.id === last.id || e.startedAt < (last.endedAt ?? now))) continue;
    episodes.push(e);
  }
  const live = health?.state === 'online';
  const currentEvent = live ? episodes.findLast(e => e.state !== 'resolved') : null;
  const described = e => e.feedback?.correct !== false && e.hypothesis?.source !== 'unknown' && ['medium', 'high'].includes(e.hypothesis?.confidence?.level);
  const grouped = new Map();
  for (const e of episodes.filter(described)) {
    const hypothesis = e.hypothesis;
    const item = grouped.get(hypothesis.source) || { source: hypothesis.source, label: hypothesis.label, count: 0, kind: 'inferred' };
    item.count++; grouped.set(hypothesis.source, item);
  }
  const sourceBreakdown = [...grouped.values()].sort((a, b) => b.count - a.count);
  const notes = observations.filter(o => o.roomId === roomId && o.readingSource === source && o.occurredAt <= now && o.occurredAt >= now - 30 * DAY);
  const associations = Object.entries(NOTE_TYPES).map(([type, label]) => {
    const recorded = notes.filter(o => o.type === type);
    const count = episodes.filter(e => recorded.some(o => Math.abs(e.startedAt - o.occurredAt) <= 1200)).length;
    return { type, label, count, observationCount: recorded.length, kind: 'derived', recurring: count >= 3 };
  }).filter(a => a.observationCount).sort((a, b) => b.count - a.count);
  const times = [[], [], [], []];
  for (const e of episodes) times[Math.floor(localHour(e.startedAt, timeZone) / 6)].push(e);
  const frequent = times.map((e, i) => ({ count: e.length, i })).sort((a, b) => b.count - a.count)[0];
  // Only call out a time pattern after three distinct days and a majority.
  const days = new Set((times[frequent.i] || []).map(e => localDayKey(e.startedAt, timeZone)));
  const typicalTiming = frequent.count >= 3 && frequent.count > episodes.length / 2 && days.size >= 3
    ? { label: ['Overnight · midnight–6 am', 'Mornings · 6 am–noon', 'Afternoons · noon–6 pm', 'Evenings · 6 pm–midnight'][frequent.i], count: frequent.count, total: episodes.length, kind: 'derived' } : null;
  const resolved = episodes.filter(e => e.state === 'resolved' && Number.isFinite(e.endedAt));
  const duration = median(resolved.map(e => e.durationMinutes));
  const recovery = median(resolved.map(e => e.recoveryMinutes));
  const unresolvedCount = episodes.length - sourceBreakdown.reduce((sum, p) => sum + p.count, 0);
  const leading = sourceBreakdown[0];
  const summary = !episodes.length ? 'No chemical or odor events recorded in the available history.'
    : leading && leading.count >= 3 && leading.count > episodes.length / 2
      ? `${leading.count} of ${episodes.length} events fit ${leading.label.toLowerCase()}. This is a recurring sensor pattern, not a confirmed source.`
      : `${episodes.length} ${episodes.length === 1 ? 'event recorded' : 'events recorded'}. ${unresolvedCount ? `The source is still unclear for ${unresolvedCount}.` : 'The patterns suggest possible sources; none are chemically identified.'}`;
  return {
    available: Boolean(capabilities.tvoc), live, source,
    current: currentEvent ? { eventId: currentEvent.id, startedAt: currentEvent.startedAt, peak: currentEvent.peak?.v, baseline: currentEvent.baseline?.median, hypothesis: currentEvent.hypothesis, feedback: currentEvent.feedback || null } : null,
    history: { eventCount: episodes.length, daysObserved: coverage?.from ? Math.min(30, Math.max(0, (Math.min(now, coverage.to ?? now) - coverage.from) / DAY)) : null, sourceBreakdown, unresolvedCount, typicalTiming, medianDurationMinutes: duration, medianRecoveryMinutes: recovery, resolvedCount: resolved.length, associations, summary },
    commonSources: COMMON_CHEMICAL_SOURCES,
    limitation: 'This sensor estimates a mixture of gases (TVOC), not particles. It cannot identify a specific chemical, product, odor, or its health risk. Activity notes help explain timing; they do not prove a cause.',
    referenceUrl: 'https://www.epa.gov/indoor-air-quality-iaq/volatile-organic-compounds-impact-indoor-air-quality',
  };
}
