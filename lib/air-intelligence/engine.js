/* RoomEngine: the stateful heart of air intelligence for one device in one
 * room. Feed it readings (live) and slots (the cube's 5-minute history); ask
 * it for an AirIntelligenceSummary at any moment.
 *
 * sensor readings -> normalize -> baselines -> features -> events ->
 * source inference -> recommendations -> summary
 *
 * The same class runs on the server (one per attached device, persisted by
 * lib/home-store.js) and in the browser (for a cube on this machine's USB or a
 * simulation). Nothing in here touches the DOM or the network.
 */

import { normalizeReading, normalizeSlot, mergeSamples } from './normalize.js';
import { capabilitiesFromReadings, capabilitiesFromReading, availableChannels, emptyCapabilities } from './capabilities.js';
import { computeBaselines, baselineAt, elevatedLine, recoveredLine, lowLine } from './baseline.js';
import { extractFeatures, crossFeatures } from './features.js';
import { detectEvents, eventId, describeChanges } from './events.js';
import { inferSource } from './infer-source.js';
import { recommend } from './recommendations.js';
import { overallStatus, formatDuration } from './status.js';
import { deviceHealth } from './health.js';
import { analyzePatterns } from './patterns.js';
import { contractorInsights, opportunitySignals } from './contractor.js';
import { measurementRows, recoveryState, buildTimeline } from './summary.js';
import { CHANNEL_INFO, formatValue, bandIndex } from './thresholds.js';
import { personalNotes } from './household.js';
import { unavailableOutdoor } from './outdoor.js';
import { sourcePatterns } from './source-patterns.js';
import { channelSeries } from './series.js';

const LIVE_KEEP_S = 2 * 3600;
const EVENT_LOG_KEEP_S = 45 * 86400;
const CATEGORY_FOR = { pm25: 'particles', pm10: 'particles', pm1: 'particles', tvoc: 'voc', co2: 'ventilation', eco2: 'ventilation', hum: 'humidity', temp: 'temperature' };

export class RoomEngine {
  /**
   * @param {object} o
   * @param {string} o.deviceKey
   * @param {string} [o.roomId]
   * @param {string} [o.roomName]
   * @param {string} [o.roomType]
   * @param {string} [o.householdId]
   * @param {string} [o.timeZone]
   */
  constructor({ deviceKey, roomId = null, roomName = '', roomType = 'other', householdId = null, timeZone } = {}) {
    this.deviceKey = deviceKey;
    this.roomId = roomId;
    this.roomName = roomName;
    this.roomType = roomType;
    this.householdId = householdId;
    this.timeZone = timeZone;
    this.samples = [];
    this.slotSamples = [];
    this.archive = [];
    this.aggregate = null;
    this.slotCoverage = null;
    this.events = [];
    this.feedback = [];
    this.capabilities = emptyCapabilities();
    this.lastReading = null;
    this.lastReadingAt = 0;
    this.lastHeartbeatAt = 0;
    this.connected = undefined;
    this.source = 'physical';
    this.firstSampleAt = 0;
    this.deviceName = '';
    this.fwVersion = '';
    this.model = '';
  }

  // ---------------------------------------------------------------- ingest

  /** Live readings in protocol.parseLive shape (also what the relay stores). */
  ingestReadings(readings, { heartbeatAt } = {}) {
    for (const r of readings) {
      if (!r || !Number.isFinite(r.timestamp)) continue;
      if (this.lastReadingAt && r.timestamp <= this.lastReadingAt) continue;
      const sample = normalizeReading(r);
      this.samples.push(sample);
      this.archiveSample(sample);
      this.lastReading = r;
      this.lastReadingAt = r.timestamp;
      this.source = sample.source;
      if (!this.firstSampleAt) this.firstSampleAt = r.timestamp;
      if (r.fwVersion) this.fwVersion = r.fwVersion;
      this.model = r.isPro ? 'pro' : 'base';
    }
    if (heartbeatAt) this.lastHeartbeatAt = heartbeatAt;
    else if (readings.length) this.lastHeartbeatAt = this.lastReadingAt;
    const cutoff = this.lastReadingAt - LIVE_KEEP_S;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
    const recent = readings.slice(-120);
    if (recent.length) {
      const caps = capabilitiesFromReadings(recent);
      for (const key of Object.keys(caps)) if (key !== 'co2Kind' && caps[key]) this.capabilities[key] = true;
      this.capabilities.co2Kind = this.capabilities.trueCo2 ? 'true' : this.capabilities.eco2 ? 'estimated' : 'none';
    }
  }

  /** The cube's 5-minute history, dashboard slot shape with timestamps anchored. */
  ingestSlots(slots, { windowS = 300, trueCo2 = this.capabilities.trueCo2, source = this.source } = {}) {
    const samples = slots.map((s) => normalizeSlot(s, { windowS, trueCo2, source })).sort((a, b) => a.t - b.t);
    const prior = this.slotSamples.filter(s => s.t < (samples[0]?.t ?? Infinity));
    this.slotSamples = [...prior, ...samples].filter(s => s.t >= (samples.at(-1)?.t ?? 0) - 31 * 86400);
    this.slotCoverage = samples.length ? { from: samples[0].t - windowS / 2, to: samples[samples.length - 1].t + windowS / 2 } : null;
    if (samples.length && !this.capabilities.pm25 && samples.some((s) => s.channels.pm25 != null)) this.capabilities.pm25 = true;
    if (samples.length && !this.capabilities.tvoc && samples.some((s) => s.channels.tvoc != null)) this.capabilities.tvoc = true;
    if (samples.length && !this.capabilities.humidity && samples.some((s) => s.channels.hum != null)) this.capabilities.humidity = true;
    if (samples.length && !this.capabilities.temperature && samples.some((s) => s.channels.temp != null)) this.capabilities.temperature = true;
    if (samples.length && trueCo2 && !this.capabilities.trueCo2 && samples.some((s) => s.channels.co2 != null)) this.capabilities.trueCo2 = true;
    this.capabilities.co2Kind = this.capabilities.trueCo2 ? 'true' : this.capabilities.eco2 ? 'estimated' : 'none';
    this.backfillEventsFromHistory();
  }

  setConnection({ connected, heartbeatAt } = {}) {
    if (connected !== undefined) this.connected = connected;
    if (heartbeatAt) this.lastHeartbeatAt = heartbeatAt;
  }

  // Five-minute rollups preserve 30 days even when no browser is open.
  archiveSample(sample) {
    const bucket = Math.floor(sample.t / 300) * 300;
    if (this.aggregate && this.aggregate.start !== bucket) {
      const a = this.aggregate;
      this.archive.push({ t: a.start + 150, span: 300, source: a.source,
        warmingUp: false, fault: false,
        channels: Object.fromEntries(Object.keys(a.sum).map(k => [k, a.count[k] ? a.sum[k] / a.count[k] : null])) });
      this.aggregate = null;
    }
    if (!this.aggregate) this.aggregate = { start: bucket, source: sample.source, sum: {}, count: {} };
    if (!sample.warmingUp && !sample.fault) for (const [k, v] of Object.entries(sample.channels)) {
      this.aggregate.sum[k] ??= 0;
      this.aggregate.count[k] ??= 0;
      if (Number.isFinite(v)) { this.aggregate.sum[k] += v; this.aggregate.count[k]++; }
    }
    const cutoff = sample.t - 31 * 86400;
    while (this.archive.length && this.archive[0].t < cutoff) this.archive.shift();
    this.slotSamples = this.slotSamples.filter(s => s.t >= cutoff);
  }

  // -------------------------------------------------------------- feedback

  /** Homeowner marked a recommendation done ("I did this"). */
  acknowledge(eventId_, recommendationId, { at, title, actionType, level = 'diy' } = {}) {
    const event = this.events.find((e) => e.id === eventId_);
    if (!event || !(event.recommendations || []).some(r => r.id === recommendationId)) return null;
    event.acknowledgedActions = event.acknowledgedActions || [];
    if (event.acknowledgedActions.some((a) => a.id === recommendationId)) return event;
    const rec = (event.recommendations || []).find((r) => r.id === recommendationId);
    event.acknowledgedActions.push({ id: recommendationId, at: at ?? this.lastReadingAt, title: title || rec?.title || recommendationId, actionType: actionType || rec?.actionType || recommendationId, level: rec?.level || level, valueAt: event.currentValue ?? null });
    return event;
  }

  /** "That's right" / "Not this" on an inferred source. */
  recordFeedback(eventId_, { correct, actualSource = null, note = '', at, by = '' }) {
    const event = this.events.find((e) => e.id === eventId_);
    const entry = { eventId: eventId_, deviceKey: this.deviceKey, roomId: this.roomId, at: at ?? this.lastReadingAt, correct: Boolean(correct), predicted: event?.hypothesis?.source || null, actualSource, note, by, source: this.source };
    this.feedback.push(entry);
    if (event) event.feedback = { correct: entry.correct, actualSource, at: entry.at };
    return entry;
  }

  // ---------------------------------------------------------------- assess

  allSamples() {
    const buckets = new Map(this.archive.map(s => [Math.floor(s.t / 300), s]));
    for (const s of this.slotSamples) buckets.set(Math.floor(s.t / 300), s);
    return mergeSamples([...buckets.values()], this.samples);
  }

  /**
   * Scan the cube's history once for past events, so the timeline and the
   * 30-day patterns exist before the live engine has seen anything. Uses the
   * same lines and the same source inference as the live path, on 5-minute
   * averages.
   */
  backfillEventsFromHistory() {
    const samples = this.slotSamples;
    if (samples.length < 12) return;
    const channels = availableChannels(this.capabilities).filter((c) => CATEGORY_FOR[c]);
    const end = samples[samples.length - 1].t;
    const baselines = computeBaselines(samples, channels, end + 1800, { timeZone: this.timeZone });
    const found = [];
    const seenCategory = {};
    for (const channel of channels) {
      const category = CATEGORY_FOR[channel];
      if (seenCategory[category]) continue;
      const series = channelSeries(samples, channel);
      if (series.length < 12) continue;
      seenCategory[category] = true;
      let run = null;
      for (let i = 0; i < series.length; i++) {
        const p = series[i];
        const b = baselineAt(baselines, channel, p.t);
        const line = elevatedLine(channel, b);
        const recovered = recoveredLine(channel, b);
        const floor = lowLine(channel, b);
        const high = p.v > line;
        const low = (category === 'humidity') && p.v < floor;
        if (!run) {
          if (high || low) run = { start: p.t, startIdx: i, peak: { v: p.v, t: p.t }, baseline: b, direction: low ? 'low' : 'high', lastAbove: p.t };
        } else {
          const still = run.direction === 'low' ? p.v < floor : p.v > recovered;
          if (still) {
            run.lastAbove = p.t;
            if (run.direction === 'high' ? p.v > run.peak.v : p.v < run.peak.v) run.peak = { v: p.v, t: p.t };
          } else if (p.t - run.lastAbove > 600) {
            found.push(this._historicalEvent(run, p.t, channel, category, samples, baselines));
            run = null;
            if (high || low) run = { start: p.t, startIdx: i, peak: { v: p.v, t: p.t }, baseline: b, direction: low ? 'low' : 'high', lastAbove: p.t };
          }
        }
      }
      if (run && end - run.lastAbove > 900) found.push(this._historicalEvent(run, run.lastAbove + 300, channel, category, samples, baselines));
    }
    // Keep live-detected events; add historical ones that do not overlap them.
    const keep = this.events.filter((e) => !e.historical);
    const merged = [...keep];
    for (const h of found) {
      if (h.category === 'temperature' && bandIndex('temp', h.peak.v) < 3) continue;
      if (h.durationMinutes < 10) continue;
      const overlaps = keep.some((e) => e.category === h.category && e.startedAt < (h.endedAt ?? end) && (e.endedAt ?? end) > h.startedAt);
      if (!overlaps) merged.push(h);
    }
    merged.sort((a, b) => a.startedAt - b.startedAt);
    this.events = merged;
  }

  _historicalEvent(run, endT, channel, category, samples, baselines) {
    const at = run.peak.t;
    const window = samples.filter((s) => s.t >= run.start - 3600 && s.t <= at + 600);
    const features = extractFeatures(window, availableChannels(this.capabilities), baselines, at + 1);
    const f = features[channel];
    const synthetic = { ...f, current: run.peak.v, peak: run.peak, elevated: true, elevatedSince: run.start, elevatedMinutes: (at - run.start) / 60, onsetMinutes: Math.max(2.5, (at - run.start) / 60), ratio: run.baseline.median > 0 ? run.peak.v / run.baseline.median : 1, delta: run.peak.v - run.baseline.median, trend: 'rising', baseline: run.baseline };
    const feats = { ...features, [channel]: synthetic };
    const cross = crossFeatures(feats);
    const hypothesis = inferSource({ category, channel, features: feats, cross, context: this._context(), outdoor: this.outdoor || unavailableOutdoor(), now: at, timeZone: this.timeZone });
    const startValue = run.baseline.median;
    const severity = (() => {
      const band = bandIndex(channel, run.peak.v);
      const s = ['excellent', 'good', 'needs_attention', 'poor', 'unhealthy'][Math.max(2, band ?? 2)];
      return s;
    })();
    return {
      id: eventId(category, run.start, this.deviceKey),
      deviceKey: this.deviceKey,
      roomId: this.roomId,
      category,
      channel,
      startedAt: run.start,
      endedAt: endT,
      state: 'resolved',
      source: this.source,
      historical: true,
      direction: run.direction,
      startValue,
      currentValue: null,
      peak: run.peak,
      baseline: { low: run.baseline.low, high: run.baseline.high, median: run.baseline.median, kind: run.baseline.kind, bucketLabel: run.baseline.bucketLabel || null },
      severity,
      peakSeverity: severity,
      onsetMinutes: synthetic.onsetMinutes,
      durationMinutes: (endT - run.start) / 60,
      recoveryMinutes: Math.max(0, (endT - run.peak.t) / 60),
      recoveryPct: 1,
      hypothesis,
      recommendations: [],
      acknowledgedActions: [],
      related: {},
    };
  }

  _context() {
    return { household: this.household || null, profile: this.household?.profile || this.profile || null, roomType: this.roomType, equipment: this.household?.equipment || [] };
  }

  /**
   * @param {object} [o]
   * @param {number} [o.now]
   * @param {object} [o.household]  Household (profile, equipment, rooms)
   * @param {object} [o.contractor]  assigned Contractor
   * @param {object} [o.outdoor]  OutdoorAir
   * @param {object[]} [o.serviceEvents]
   * @param {object[]} [o.existingSignals]
   * @param {boolean} [o.fahrenheit]
   * @param {boolean} [o.debug]
   * @returns {object} AirIntelligenceSummary
   */
  assess({ now = this.lastReadingAt || Date.now() / 1000, household = this.household, contractor = null, outdoor = this.outdoor || unavailableOutdoor(), serviceEvents = [], existingSignals = [], fahrenheit = false, debug = false, includeContractor = true, observations = [] } = {}) {
    this.household = household || this.household;
    this.outdoor = outdoor;
    const samples = this.allSamples();
    const channels = availableChannels(this.capabilities);
    const health = deviceHealth({
      lastReadingAt: this.lastReadingAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      connected: this.connected,
      warmingUp: Boolean(this.lastReading?.warmingUp) || (this.samples.length > 0 && this.samples[this.samples.length - 1].warmingUp),
      fault: Boolean(this.lastReading?.sensorMissing),
      source: this.source,
      uptimeMs: this.lastReading?.uptimeMs || 0,
      now,
    });
    const baselines = computeBaselines(samples, channels, now, { timeZone: this.timeZone });
    const features = extractFeatures(samples, channels, baselines, now);
    const cross = crossFeatures(features);
    const context = this._context();

    const previous = this.events.filter((e) => e.state !== 'resolved');
    const liveForEvents = health.state === 'online';
    const updated = detectEvents({ features, cross, capabilities: this.capabilities, previous, now, context, outdoor, source: this.source, deviceKey: this.deviceKey, roomId: this.roomId, timeZone: this.timeZone, live: liveForEvents });
    const resolvedIds = new Set(previous.map((e) => e.id));
    this.events = [...this.events.filter((e) => !resolvedIds.has(e.id)), ...updated].sort((a, b) => a.startedAt - b.startedAt);
    const cutoff = now - EVENT_LOG_KEEP_S;
    this.events = this.events.filter((e) => (e.endedAt ?? now) >= cutoff);

    const coverage = this._coverage(now);
    const patterns = analyzePatterns({ events: this.events, now, days: 30, timeZone: this.timeZone, coverage, serviceEvents, humiditySamples: samples.filter(s => s.span).map((s) => ({ t: s.t, hum: s.channels.hum })) });

    const open = this.events.filter((e) => e.state !== 'resolved');
    for (const e of open) {
      e.recommendations = recommend({ event: e, features, context, outdoor, patterns, contractor, now });
      e.changes = describeChanges(e, this.capabilities);
      e.headline = this._headline(e);
      e.explanation = this._explanation(e, features);
      e.recovery = recoveryState(e, now);
      e.measurement = this._measurement(e, features, fahrenheit);
      e.personalNotes = personalNotes(context.profile, e.category);
    }

    const lastResolved = this.events.filter((e) => e.state === 'resolved').sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
    const stableSinceS = open.length ? null : Math.max(0, now - Math.max(lastResolved?.endedAt || 0, this.firstSampleAt || this.slotCoverage?.from || now));
    const status = overallStatus({ features, events: open, health, stableSinceS });
    const primary = !liveForEvents ? null : status.primaryEventId ? open.find((e) => e.id === status.primaryEventId) : open[0] || null;

    const homeownerActions = this._actionCounts(now);
    const insights = includeContractor && liveForEvents ? contractorInsights({ patterns, household: this.household, capabilities: this.capabilities, homeownerActions, now }) : [];
    const signals = includeContractor ? opportunitySignals(insights, { householdId: this.householdId || this.household?.id || 'home', now, existing: existingSignals }) : [];

    const dayStart = now - 86400;
    const summary = {
      householdId: this.householdId || this.household?.id || null,
      roomId: this.roomId,
      roomName: this.roomName,
      roomType: this.roomType,
      deviceKey: this.deviceKey,
      deviceName: this.deviceName,
      generatedAt: now,
      source: this.source,
      capabilities: { ...this.capabilities },
      currentStatus: status,
      primaryIssue: primary ? issueCard(primary) : null,
      measurements: measurementRows(features, this.capabilities, { fahrenheit }),
      activeEvents: open.map(publicEvent),
      recentEvents: this.events.filter((e) => e.state === 'resolved' && (e.endedAt ?? 0) >= dayStart).map(publicEvent),
      homeownerRecommendations: primary ? primary.recommendations : [],
      recovery: !liveForEvents ? null : primary ? primary.recovery : (lastResolved && now - (lastResolved.endedAt || 0) < 1800 ? recoveryState(lastResolved, now) : null),
      timeline: buildTimeline({ events: this.events, serviceEvents, now, timeZone: this.timeZone, from: dayStart, to: now }),
      patterns,
      sourcePatterns: sourcePatterns({ features, health, events: this.events, observations, outdoor, profile: context.profile || {}, now, roomId: this.roomId, source: this.source }),
      contractorInsights: insights,
      opportunitySignals: signals,
      deviceHealth: { ...health, deviceName: this.deviceName, fwVersion: this.fwVersion, model: this.model, capabilities: { ...this.capabilities } },
      outdoor,
      stableSinceS,
      coverage,
    };
    if (debug) {
      summary.debug = {
        baselines: Object.fromEntries(channels.map((c) => [c, baselineAt(baselines, c, now)])),
        features,
        cross,
        candidates: Object.fromEntries(open.map((e) => [e.id, e.hypothesis?.candidates || []])),
        sampleCounts: { live: this.samples.length, slots: this.slotSamples.length, events: this.events.length },
        lastReading: this.lastReading,
      };
    }
    return summary;
  }

  _coverage(now) {
    const from = Math.min(this.slotCoverage?.from ?? Infinity, this.firstSampleAt || Infinity);
    if (!Number.isFinite(from)) return null;
    return { from, to: Math.max(this.lastReadingAt || 0, this.slotCoverage?.to || 0) || now };
  }

  _actionCounts(now) {
    const counts = { purifierUses: 0, exhaustUses: 0, ventilateUses: 0 };
    for (const e of this.events) {
      if (e.startedAt < now - 30 * 86400) continue;
      for (const a of e.acknowledgedActions || []) {
        if (a.actionType === 'purifier') counts.purifierUses++;
        if (a.actionType === 'exhaust') counts.exhaustUses++;
        if (a.actionType === 'ventilate') counts.ventilateUses++;
      }
    }
    return counts;
  }

  _headline(e) {
    const info = CHANNEL_INFO[e.channel];
    const hyp = e.hypothesis;
    if (hyp && hyp.source !== 'unknown') {
      const likely = hyp.confidence.level === 'high' ? 'Likely' : 'Possibly';
      return `${likely} ${hyp.label.toLowerCase()}`;
    }
    if (e.direction === 'low') return e.channel === 'hum' ? 'Air is dry' : `${info.friendly} low`;
    return `${info.friendly} ${e.category === 'ventilation' ? 'running low' : 'elevated'}`;
  }

  _explanation(e, features) {
    const info = CHANNEL_INFO[e.channel];
    const ratio = e.baseline?.median > 0 && e.peak ? e.peak.v / e.baseline.median : null;
    const parts = [];
    const fast = e.onsetMinutes != null && e.onsetMinutes <= 10;
    if (e.category === 'particles') parts.push(`Fine particles ${fast ? 'increased quickly' : 'have risen'}${ratio && ratio >= 1.5 && e.baseline.kind !== 'reference' ? ` to ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${e.baseline.kind === 'session' ? 'the earlier level' : 'your normal level'}` : ''}.`);
    else if (e.category === 'voc') parts.push(`Chemical pollutants are higher than usual${e.related?.pm25?.direction === 'normal' ? ' while particle levels stayed stable' : ''}.`);
    else if (e.category === 'ventilation') parts.push(`${e.channel === 'co2' ? 'CO2' : 'Estimated CO2'} has been climbing for ${Math.round(e.durationMinutes)} minutes, which usually means the room isn't getting enough fresh air.`);
    else if (e.category === 'humidity') parts.push(e.direction === 'low' ? 'The air is drier than the comfort range.' : e.durationMinutes >= 60 ? `Humidity has stayed around ${formatValue('hum', e.currentValue ?? e.peak.v)} for ${formatDuration(e.durationMinutes * 60)}, above the comfort range.` : `Humidity ${fast ? 'jumped' : 'has risen'} to ${formatValue('hum', e.currentValue ?? e.peak.v)}.`);
    else parts.push(`${info.friendly} is outside the comfort range.`);
    for (const [channel, r] of Object.entries(e.related || {})) {
      if (channel === 'tvoc' && r.direction.startsWith('up') && e.category === 'particles') parts.push(`Chemicals & odors are ${r.ratio}× your normal level.`);
      if ((channel === 'co2') && r.direction === 'normal' && e.category === 'particles') parts.push('Fresh air is unchanged.');
    }
    return parts.join(' ');
  }

  _measurement(e, features, fahrenheit) {
    const f = features[e.channel];
    const info = CHANNEL_INFO[e.channel];
    const value = f ? f.latestValue : e.currentValue;
    return {
      channel: e.channel,
      friendly: info.friendly,
      technical: info.technical,
      value,
      text: formatValue(e.channel, value, { fahrenheit }),
      peakText: e.peak ? formatValue(e.channel, e.peak.v, { fahrenheit }) : null,
      baseline: e.baseline,
      baselineText: e.baseline?.kind === 'personal' ? `Normally in this room: ${formatValue(e.channel, e.baseline.low).replace(` ${info.unit}`, '')}–${formatValue(e.channel, e.baseline.high)}` : e.baseline?.kind === 'session' ? `Earlier today: ${formatValue(e.channel, e.baseline.low).replace(` ${info.unit}`, '')}–${formatValue(e.channel, e.baseline.high)}` : `Recommended: up to ${formatValue(e.channel, e.baseline.high)}`,
      ratioText: e.baseline?.kind !== 'reference' && e.baseline?.median > 0 && value != null ? `↑ ${(value / e.baseline.median) >= 10 ? Math.round(value / e.baseline.median) : (value / e.baseline.median).toFixed(1)}× ${e.baseline.kind === 'session' ? 'earlier today' : 'baseline'}` : '',
      startedAt: e.startedAt,
      durationText: formatDuration((e.durationMinutes || 0) * 60),
    };
  }

  // ------------------------------------------------------------ persistence

  toJSON() {
    return {
      deviceKey: this.deviceKey, roomId: this.roomId, roomName: this.roomName, roomType: this.roomType, householdId: this.householdId, timeZone: this.timeZone,
      events: this.events, feedback: this.feedback, capabilities: this.capabilities, lastReadingAt: this.lastReadingAt, lastHeartbeatAt: this.lastHeartbeatAt,
      source: this.source, firstSampleAt: this.firstSampleAt, deviceName: this.deviceName, fwVersion: this.fwVersion, model: this.model,
      archive: this.archive, aggregate: this.aggregate,
      samples: this.samples.slice(-LIVE_KEEP_S), slotSamples: this.slotSamples, slotCoverage: this.slotCoverage, lastReading: this.lastReading,
    };
  }

  static fromJSON(json) {
    const engine = new RoomEngine(json);
    Object.assign(engine, {
      archive: json.archive || [], aggregate: json.aggregate || null,
      events: json.events || [], feedback: json.feedback || [], capabilities: { ...emptyCapabilities(), ...(json.capabilities || {}) },
      lastReadingAt: json.lastReadingAt || 0, lastHeartbeatAt: json.lastHeartbeatAt || 0, source: json.source || 'physical', firstSampleAt: json.firstSampleAt || 0,
      deviceName: json.deviceName || '', fwVersion: json.fwVersion || '', model: json.model || '', samples: json.samples || [], slotSamples: json.slotSamples || [], slotCoverage: json.slotCoverage || null, lastReading: json.lastReading || null,
    });
    return engine;
  }
}

/** Event fields safe and useful for clients. */
export function publicEvent(e) {
  const { belowSince, ...rest } = e;
  return rest;
}

/** The "most important issue" card: meaning -> number -> context -> action. */
export function issueCard(e) {
  return {
    eventId: e.id,
    category: e.category,
    channel: e.channel,
    headline: e.headline,
    explanation: e.explanation,
    confidence: e.hypothesis ? e.hypothesis.confidence.level : null,
    confidenceScore: e.hypothesis ? e.hypothesis.confidence.score : null,
    source: e.hypothesis?.source || 'unknown',
    sourceLabel: e.hypothesis?.label || '',
    alternatives: e.hypothesis?.confidence?.alternatives || [],
    evidence: e.hypothesis?.confidence?.evidence || [],
    measurement: e.measurement,
    changes: e.changes,
    severity: e.severity,
    state: e.state,
    startedAt: e.startedAt,
    durationMinutes: e.durationMinutes,
    recovery: e.recovery,
    recommendations: e.recommendations,
    personalNotes: e.personalNotes,
    feedback: e.feedback || null,
  };
}

export { capabilitiesFromReading };
