import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomEngine, SCENARIOS, generateReadings, generateHistorySlots, scenarioStartTime, scenarioServiceEvents,
  unavailableOutdoor, capabilitiesFromReading, buildContactPayload, buildAirReport, homeSummary, ESCALATION,
} from '../lib/air-intelligence/index.js';
import { cleanReading } from '../api/cube.js';

const TZ = 'America/Los_Angeles';
const NOW = 1792180000;
const CONTRACTOR = { id: 'c1', name: 'ABC Heating' };

/**
 * Drive a scenario through a RoomEngine the way the server does: history
 * slots first, then live readings in one-minute batches, assessing each time.
 */
function run(key, { minutes, history = true, days = 30, household: hh, outdoor, assessEvery = 60, onAssess } = {}) {
  const sc = SCENARIOS[key];
  const startT = scenarioStartTime(sc, NOW, TZ);
  const engine = new RoomEngine({ deviceKey: `sim-${key}`, roomId: 'room-1', roomName: 'Room', roomType: sc.roomType, householdId: 'h1', timeZone: TZ });
  const household = hh || { id: 'h1', name: 'Test home', profile: sc.profile ? { sensitivities: {}, pets: { hasPets: false, types: [] }, concerns: {}, ...sc.profile } : undefined, equipment: sc.equipment || [] };
  if (history) engine.ingestSlots(generateHistorySlots(sc, { endT: startT, days, timeZone: TZ }), { windowS: 300, trueCo2: sc.capabilities !== 'base' });
  const readings = generateReadings(sc, { startT, stepS: 5 });
  const out = outdoor || (sc.outdoor ? { ...unavailableOutdoor(), status: 'available', ...sc.outdoor } : unavailableOutdoor());
  const serviceEvents = scenarioServiceEvents(sc, { endT: startT, householdId: 'h1' });
  const untilS = (minutes ?? sc.durationS / 60) * 60;
  let i = 0;
  let summary = null;
  for (let t = 0; t <= untilS; t += assessEvery) {
    const batch = [];
    while (i < readings.length && readings[i].timestamp <= startT + t) batch.push(readings[i++]);
    if (batch.length) engine.ingestReadings(batch);
    summary = engine.assess({ now: startT + t, household, outdoor: out, serviceEvents, contractor: CONTRACTOR, debug: true });
    onAssess?.(summary, t, engine);
  }
  return { summary, engine, startT, household, serviceEvents };
}

const recIds = (s) => (s.homeownerRecommendations || []).map((r) => r.id);
const levels = (s) => new Set((s.homeownerRecommendations || []).map((r) => r.level));

test('1. clean stable air: no event, status good, numbers still visible, no contractor lead (flow A)', () => {
  const { summary } = run('healthy', { minutes: 40 });
  assert.equal(summary.currentStatus.status, 'good');
  assert.equal(summary.activeEvents.length, 0);
  assert.equal(summary.primaryIssue, null);
  assert.match(summary.currentStatus.explanation, /Nothing needs your attention/);
  const pm = summary.measurements.find((m) => m.channel === 'pm25');
  assert.ok(pm && typeof pm.value === 'number' && pm.text.includes('µg/m³'), 'PM2.5 number remains visible');
  assert.equal(pm.friendly, 'Fine particles');
  assert.equal(pm.baseline.kind, 'personal');
  assert.equal(summary.contractorInsights.length, 0);
  assert.equal(summary.opportunitySignals.length, 0);
});

test('2. gradual true-CO2 rise overnight: ventilation event, fresh-air recommendation, direct-measurement evidence', () => {
  const { summary } = run('poor_ventilation_overnight', { minutes: 75 });
  const event = summary.activeEvents.find((e) => e.category === 'ventilation');
  assert.ok(event, 'ventilation event detected');
  assert.equal(event.channel, 'co2');
  assert.equal(event.hypothesis.source, 'poor_ventilation');
  assert.ok(event.hypothesis.confidence.evidence.some((e) => /direct CO2 measurement/.test(e.text)));
  assert.ok(recIds(summary).includes('ventilate'));
  assert.match(summary.primaryIssue.explanation, /fresh air/i);
  assert.ok(summary.primaryIssue.measurement.text.includes('ppm'));
  assert.ok(summary.primaryIssue.measurement.baselineText.length > 0, 'personal/time-of-day baseline shown');
});

test('3. PM + VOC rapid rise: cooking hypothesis, exhaust first, no contractor step for an occasional event (flow B)', () => {
  const trace = [];
  const { summary, engine } = run('cooking', { minutes: 60, onAssess: (s, t) => trace.push([t, s.currentStatus.status, s.activeEvents.length]) });
  const atPeak = trace.find(([t]) => t === 15 * 60);
  assert.ok(atPeak[2] >= 1, 'event active at 15 min');
  const ev = engine.events.find((e) => e.category === 'particles' && !e.historical);
  assert.ok(ev);
  assert.equal(ev.hypothesis.source, 'cooking');
  assert.equal(ev.hypothesis.confidence.level, 'high');
  assert.ok(ev.hypothesis.confidence.evidence.some((x) => x.kind === 'measured'));
  assert.ok(ev.hypothesis.confidence.evidence.some((x) => x.kind === 'derived'));
  assert.ok(ev.recommendations.length && ev.recommendations[0].id === 'exhaust', 'kitchen exhaust is the first action');
  assert.ok(!ev.recommendations.some((r) => r.level === 'contractor'), 'no contractor escalation for an occasional cooking event');
  assert.equal(summary.contractorInsights.length, 0);
  // Measured vs inferred stay distinct on the card.
  assert.ok(summary.recentEvents.length >= 1 || summary.activeEvents.length >= 1);
  assert.ok(summary.timeline.some((i) => i.kind === 'event_start' && /Likely cooking/.test(i.detail)));
});

test('4. VOC-only spike: cleaning/fragrance hypothesis, ventilate recommendation', () => {
  const { summary } = run('cleaning', { minutes: 12 });
  const ev = summary.activeEvents.find((e) => e.category === 'voc');
  assert.ok(ev);
  assert.equal(ev.hypothesis.source, 'cleaning');
  assert.ok(ev.hypothesis.confidence.evidence.some((x) => /stable/.test(x.text)), 'particles stayed stable is cited');
  assert.ok(recIds(summary).includes('ventilate'));
  assert.ok(!summary.activeEvents.some((e) => e.category === 'particles'));
});

test('5. humidity-only spike: shower hypothesis, bathroom fan', () => {
  const { summary } = run('shower', { minutes: 14 });
  const ev = summary.activeEvents.find((e) => e.category === 'humidity');
  assert.ok(ev);
  assert.equal(ev.hypothesis.source, 'shower');
  assert.equal(recIds(summary)[0], 'bathroom_fan');
});

test('6. particle event without a signature: unknown source with listed possibilities and filtration for now', () => {
  const { summary } = run('unknown_mixed', { minutes: 45 });
  const ev = summary.activeEvents.find((e) => e.category === 'particles');
  assert.ok(ev);
  assert.equal(ev.hypothesis.source, 'unknown');
  assert.equal(ev.hypothesis.confidence.level, 'low');
  assert.ok(ev.hypothesis.confidence.alternatives.length >= 2, 'alternatives listed');
  assert.match(summary.primaryIssue.recommendations[0].description, /not sure/);
  assert.equal(summary.primaryIssue.headline, 'Fine particles elevated');
});

test('7. warm-up readings never become an incident', () => {
  let sawWarmup = false;
  let eventsDuringWarmup = 0;
  const { summary } = run('sensor_warming_up', {
    minutes: 10,
    assessEvery: 30,
    onAssess: (s, t) => {
      if (t > 0 && t <= 150) {
        sawWarmup = sawWarmup || s.deviceHealth.state === 'warming_up';
        eventsDuringWarmup += s.activeEvents.length;
        assert.equal(s.currentStatus.status, null, 'no air verdict while warming up');
        assert.match(s.currentStatus.label, /warming up/i);
      }
    },
  });
  assert.ok(sawWarmup, 'warm-up state reported');
  assert.equal(eventsDuringWarmup, 0);
  assert.equal(summary.activeEvents.length, 0, 'the warm-up VOC swing left no event behind');
  assert.equal(summary.currentStatus.status, 'good');
});

test('8 + 9. sensor offline / stale: no live air conclusion, stale is not presented as current, no contractor lead', () => {
  const states = [];
  const { summary } = run('sensor_offline', { minutes: 40, onAssess: (s, t) => states.push([t, s.deviceHealth.state, s.currentStatus.status]) });
  assert.ok(states.some(([, st]) => st === 'online'));
  const stale = states.find(([, st]) => st === 'stale');
  assert.ok(stale, 'stale state reached between 20 s and 15 min after the last reading');
  assert.equal(stale[2], null, 'no status while stale');
  assert.equal(summary.deviceHealth.state, 'offline');
  assert.equal(summary.currentStatus.status, null);
  assert.match(summary.currentStatus.label, /offline/i);
  assert.equal(summary.currentStatus.live, false);
  assert.equal(summary.contractorInsights.length, 0);
  assert.ok(summary.measurements.length > 0, 'last known numbers remain available, labelled by device state');
});

test('10. simulated and physical readings stay distinguishable end to end', () => {
  const sim = generateReadings('healthy', { startT: NOW, stepS: 60, untilS: 120 })[0];
  assert.equal(sim.source, 'simulated');
  const relayed = cleanReading(sim, 0);
  assert.equal(relayed.source, 'simulated');
  const physical = cleanReading({ ...sim, source: undefined }, 0);
  assert.equal(physical.source, 'physical');
  const { summary } = run('healthy', { minutes: 5 });
  assert.equal(summary.source, 'simulated');
  assert.equal(summary.deviceHealth.simulated, true);
  const e = new RoomEngine({ deviceKey: 'real', timeZone: TZ });
  e.ingestReadings([{ ...physical, timestamp: NOW }]);
  assert.equal(e.assess({ now: NOW + 1 }).deviceHealth.simulated, false);
});

test('capabilities come from the frames, not the model name', () => {
  const sen63c = capabilitiesFromReading({ pmPresent: true, pmValid: true, hasTrueCo2: true, isPro: false, etvocValid: true, tempValid: true, humValid: true, hasLux: false });
  assert.deepEqual([sen63c.pm25, sen63c.trueCo2, sen63c.illuminance, sen63c.co2Kind], [true, true, false, 'true']);
  const legacy = capabilitiesFromReading({ pmPresent: false, hasTrueCo2: false, isPro: false, etvoc: 120, tempValid: true, humValid: true });
  assert.deepEqual([legacy.pm25, legacy.trueCo2, legacy.eco2, legacy.co2Kind], [false, false, true, 'estimated']);
  const { summary } = run('legacy_base', { minutes: 30 });
  assert.ok(!summary.measurements.some((m) => m.channel.startsWith('pm')), 'no particle rows on a legacy base');
  const eco2 = summary.measurements.find((m) => m.channel === 'eco2');
  assert.ok(eco2 && eco2.kind === 'derived' && /estimate/i.test(eco2.note));
  const vent = summary.activeEvents.find((e) => e.category === 'ventilation');
  if (vent) {
    assert.equal(vent.channel, 'eco2');
    assert.notEqual(vent.hypothesis.confidence.level, 'high', 'eCO2 never yields a high-confidence ventilation claim');
  }
});

test('11. recurring slow-clearing particle events: filtration insight, contractor step, opportunity signal (flow C)', () => {
  const { summary } = run('cooking_repeated', { minutes: 25 });
  const p = summary.patterns.byCategory.particles;
  assert.ok(p.count >= ESCALATION.particlesEvents30d, `enough events (${p.count})`);
  assert.ok(p.medianRecoveryMin > ESCALATION.particlesMedianRecoveryMin);
  const insight = summary.contractorInsights.find((i) => i.category === 'filtration');
  assert.ok(insight, 'filtration insight');
  assert.equal(insight.requiresProfessionalDiagnosis, true);
  assert.ok(insight.evidence.some((e) => e.kind === 'measured'));
  assert.ok(insight.potentialSolutions.length >= 2);
  assert.ok(!/MERV\s*\d+/.test(insight.potentialSolutions.join(' ')) || /subject to/.test(insight.potentialSolutions.join(' ')), 'no MERV prescription without a caveat');
  assert.ok(levels(summary).has('diy'), 'DIY still comes first');
  const contractorRec = summary.homeownerRecommendations.find((r) => r.level === 'contractor');
  assert.ok(contractorRec && contractorRec.title.includes('ABC Heating'));
  assert.ok(summary.homeownerRecommendations.indexOf(contractorRec) > 0, 'contractor step is never the first recommendation');
  const signal = summary.opportunitySignals.find((s) => s.type === 'filtration');
  assert.ok(signal && signal.status === 'new' && signal.recurringEventCount >= 8);
});

test('12. true CO2 high most nights: ventilation insight for the contractor (flow D)', () => {
  const { summary } = run('poor_ventilation_overnight', { minutes: 10 });
  const n = summary.patterns.overnightVentilation;
  assert.ok(n.nightsObserved >= 20, `nights observed ${n.nightsObserved}`);
  assert.ok(n.share >= 0.5, `share ${n.share}`);
  const insight = summary.contractorInsights.find((i) => i.category === 'ventilation');
  assert.ok(insight);
  assert.match(insight.problem, /overnight/);
  assert.ok(insight.evidence.some((e) => /nights/.test(e.text)));
  assert.equal(insight.likelyNature, 'equipment');
});

test('13. pet + allergy context: no allergen detection claim, gentle note, pet activity only as a possible contributor (flow F)', () => {
  const { summary } = run('pet_allergy', { minutes: 22 });
  const ev = summary.activeEvents.find((e) => e.category === 'particles');
  assert.ok(ev);
  const everything = JSON.stringify(summary).toLowerCase();
  assert.ok(!/allergen detected|dander detected|cat hair detected|cat allergen/.test(everything));
  assert.notEqual(ev.hypothesis.source, 'pet_activity', 'pet activity never wins');
  assert.ok(ev.hypothesis.confidence.alternatives.some((a) => a.source === 'pet_activity'));
  assert.ok(ev.hypothesis.candidates.find((c) => c.source === 'pet_activity').score <= 0.3);
  assert.ok(summary.primaryIssue.personalNotes.some((n) => /allergies/.test(n)));
  assert.ok(summary.primaryIssue.personalNotes.some((n) => /pets/.test(n) && /possible contributor/.test(n)));
  assert.ok(!/at risk/i.test(everything), 'no fear-based language');
});

test('14. acknowledging an action drives the recovery wording; persistence after a failed action escalates', () => {
  let acked = false;
  const { summary, engine } = run('persistent_particles', {
    minutes: 80,
    onAssess: (s, t, eng) => {
      const ev = s.activeEvents.find((e) => e.category === 'particles');
      if (ev && t >= 12 * 60 && !acked) {
        eng.acknowledge(ev.id, 'purifier', { at: eng.lastReadingAt });
        acked = true;
      }
    },
  });
  assert.ok(acked);
  const ev = summary.activeEvents.find((e) => e.category === 'particles');
  assert.ok(ev);
  assert.ok(ev.acknowledgedActions.length === 1 && ev.acknowledgedActions[0].id === 'purifier');
  assert.ok(ev.recovery && /since you started the purifier/.test(ev.recovery.text), ev.recovery?.text);
  assert.equal(ev.recovery.state, 'not_improving');
  const contractorRec = ev.recommendations.find((r) => r.level === 'contractor');
  assert.ok(contractorRec, 'contractor step offered after the DIY action failed and the problem recurs');
  assert.ok(contractorRec.description.length > 0);
  assert.ok(ev.recommendations.some((r) => r.id === 'check_purifier'), 'level-2 check: is the purifier actually running');
  assert.ok(summary.timeline.some((i) => i.kind === 'action'));
  const fb = engine.recordFeedback(ev.id, { correct: false, actualSource: 'dust' });
  assert.equal(fb.predicted, ev.hypothesis.source);
  assert.equal(engine.feedback.length, 1);
});

test('15. contact payload packages the issue, numbers, baseline, actions tried and history (flow G); report summarises, not dumps', () => {
  let acked = false;
  const { summary, household, serviceEvents } = run('persistent_particles', {
    minutes: 60,
    onAssess: (s, t, eng) => {
      const ev = s.activeEvents.find((e) => e.category === 'particles');
      if (ev && t >= 10 * 60 && !acked) { eng.acknowledge(ev.id, 'purifier', { at: eng.lastReadingAt }); eng.acknowledge(ev.id, 'ventilate', { at: eng.lastReadingAt }); acked = true; }
    },
  });
  const payload = buildContactPayload({ type: 'request_service', summary, household, room: { name: 'Living room' }, homeowner: { name: 'Winston' }, contractor: CONTRACTOR, now: summary.generatedAt });
  assert.equal(payload.room, 'Living room');
  assert.match(payload.issue, /fine particles/);
  assert.match(payload.current, /PM2\.5 .*µg\/m³/);
  assert.match(payload.normal, /Normally in this room/);
  assert.deepEqual(payload.actionsTried.sort(), ['Open a window for 10–15 minutes', 'Run your air purifier']);
  assert.match(payload.supportingHistory, /\d+ similar events in the last 30 days/);
  assert.ok(payload.duration);
  assert.ok(payload.equipment.length >= 2);
  assert.ok(payload.insights.some((i) => i.category === 'filtration'));
  assert.equal(payload.simulated, true);
  const report = buildAirReport({ summaries: [summary], household, contractor: CONTRACTOR, serviceEvents, now: summary.generatedAt });
  const size = JSON.stringify(report).length;
  assert.ok(size < 20000, `report is a summary (${size} bytes)`);
  assert.ok(report.rooms[0].readings.every((r) => r.value && r.metric));
  assert.match(report.note, /not medical advice/);
});

test('16. before/after a recorded installation: recovery comparison, worded as "since", never fabricated', () => {
  const { summary } = run('equipment_improvement', { minutes: 5 });
  const cmp = summary.patterns.serviceComparisons[0];
  assert.ok(cmp && cmp.type === 'equipment_installation');
  const p = cmp.categories.particles;
  assert.ok(p.sufficient);
  assert.ok(p.after.medianRecoveryMin < p.before.medianRecoveryMin, `recovery improved ${p.before.medianRecoveryMin} -> ${p.after.medianRecoveryMin}`);
  assert.ok(p.recoveryChange < -0.2);
  const { summary: none } = run('healthy', { minutes: 5 });
  assert.equal(none.patterns.serviceComparisons.length, 0, 'no comparison without a service event');
});

test('17. a room that is stuffy every night is still told so: personal baseline cannot swallow the accepted bands', () => {
  const { summary, engine } = run('poor_ventilation_overnight', { minutes: 85 });
  const co2 = summary.measurements.find((m) => m.channel === 'co2');
  assert.ok(co2.value > 1000);
  assert.ok(co2.elevated, 'flagged elevated even though it is "usual" overnight here');
  assert.ok(engine.events.filter((e) => e.historical && e.category === 'ventilation').length >= 15, 'history back-fill found the recurring nights');
});

test('18. the home roll-up counts attention rooms and keeps offline rooms out of the verdict', () => {
  const a = run('cooking', { minutes: 15 }).summary;
  const b = run('healthy', { minutes: 15 }).summary;
  const c = run('sensor_offline', { minutes: 40 }).summary;
  const home = homeSummary([{ ...a, roomId: 'k', roomName: 'Kitchen' }, { ...b, roomId: 'l', roomName: 'Living room' }, { ...c, roomId: 'o', roomName: 'Office' }], { now: NOW });
  assert.equal(home.attentionCount, 1);
  assert.equal(home.offlineCount, 1);
  assert.equal(home.primaryRoomId, 'k');
  assert.match(home.label, /1 thing needs your attention/);
  assert.equal(home.rooms.find((r) => r.roomId === 'o').live, false);
});

test('19. outdoor data changes window advice; missing outdoor data is never read as good', () => {
  const withData = run('outdoor_pollution', { minutes: 50 }).summary;
  assert.ok(recIds(withData).includes('close_windows'));
  assert.ok(!recIds(withData).includes('ventilate'));
  const without = run('outdoor_pollution', { minutes: 50, outdoor: unavailableOutdoor() }).summary;
  const window = without.homeownerRecommendations.find((r) => r.id === 'ventilate');
  if (window) {
    assert.equal(window.condition, 'outdoor_unknown');
    assert.match(window.reason, /not connected/);
  }
  const ev = without.activeEvents.find((e) => e.category === 'particles');
  if (ev?.hypothesis.source === 'outdoor_pollution') assert.ok(ev.hypothesis.confidence.score <= 0.35, 'outdoor hypothesis capped without data');
});

test('20. engine state round-trips through JSON (persistence)', () => {
  const { engine } = run('cooking', { minutes: 20 });
  const json = JSON.parse(JSON.stringify(engine.toJSON()));
  const copy = RoomEngine.fromJSON(json);
  const a = engine.assess({ now: engine.lastReadingAt + 1 });
  const b = copy.assess({ now: engine.lastReadingAt + 1 });
  assert.equal(a.currentStatus.status, b.currentStatus.status);
  assert.equal(a.activeEvents.length, b.activeEvents.length);
  assert.equal(a.primaryIssue?.headline, b.primaryIssue?.headline);
});
