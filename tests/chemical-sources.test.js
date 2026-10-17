import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chemicalSources } from '../lib/air-intelligence/chemical-sources.js';
import { RoomEngine } from '../lib/air-intelligence/engine.js';
import { buildAirReport } from '../lib/air-intelligence/report.js';
const now = Date.parse('2026-10-16T23:00:00Z') / 1000;
const base = { now, roomId: 'room', source: 'physical', capabilities: { tvoc: true }, health: { state: 'online' }, timeZone: 'America/Los_Angeles', coverage: { from: now - 4 * 86400, to: now } };
const event = (id, day = 0, patch = {}) => ({ id, roomId: 'room', source: 'physical', category: 'voc', startedAt: now - day * 86400 - 7200, endedAt: now - day * 86400 - 5400, durationMinutes: 30, recoveryMinutes: 20, state: 'resolved', hypothesis: { source: 'cleaning', label: 'Cleaning product or fragrance', confidence: { level: 'medium', score: .6, evidence: [{ kind: 'derived', text: 'Gas rise without a particle rise' }] } }, ...patch });

test('chemical analytics reuse shared hypotheses and report recurring timing without claiming a source', () => {
  const result = chemicalSources({ ...base, events: [event('a'), event('b', 1), event('c', 2), event('d', 3)] });
  assert.equal(result.history.eventCount, 4);
  assert.equal(result.history.sourceBreakdown[0].kind, 'inferred');
  assert.equal(result.history.sourceBreakdown[0].count, 4);
  assert.match(result.history.summary, /not a confirmed source/);
  assert.equal(result.history.typicalTiming.label, 'Afternoons · noon–6 pm');
  assert.equal(result.history.medianDurationMinutes, 30);
  assert.equal(result.history.medianRecoveryMinutes, 20);
  assert.equal(result.current, null);
  assert.match(result.limitation, /not particles/);
});

test('low confidence, rejected guesses and missing hypotheses stay unexplained', () => {
  const result = chemicalSources({ ...base, events: [event('a', 0, { hypothesis: { source: 'cleaning', confidence: { level: 'low' } } }), event('b', 1, { feedback: { correct: false } }), event('c', 2, { hypothesis: null })] });
  assert.equal(result.history.unresolvedCount, 3);
  assert.deepEqual(result.history.sourceBreakdown, []);
  assert.match(result.history.summary, /unclear for 3/);
});

test('history is scoped by room, provenance, category and time; overlaps and notes do not inflate counts', () => {
  const a = event('a');
  const observation = { type: 'cleaning', roomId: 'room', readingSource: 'physical', occurredAt: a.startedAt, note: '' };
  const result = chemicalSources({ ...base,
    events: [a, { ...a, id: 'duplicate' }, event('wrong-room', 1, { roomId: 'other' }), event('fake', 1, { source: 'simulated' }), event('pm', 1, { category: 'particles' }), event('old', 31), event('future', -1)],
    observations: [observation, observation, { ...observation, type: 'cooking', roomId: 'other' }, { ...observation, type: 'candles', readingSource: 'simulated' }],
  });
  assert.equal(result.history.eventCount, 1);
  assert.equal(result.history.associations.length, 1);
  assert.equal(result.history.associations[0].count, 1);
  assert.equal(result.history.associations[0].recurring, false);
  assert.equal(result.history.typicalTiming, null);
});

test('offline and warm-up retain labeled history but cannot draw a current source conclusion', () => {
  const active = event('open', 0, { state: 'active', endedAt: null, durationMinutes: 120, recoveryMinutes: null });
  for (const state of ['offline', 'stale', 'warming_up', 'fault']) {
    const result = chemicalSources({ ...base, health: { state }, events: [active] });
    assert.equal(result.current, null); assert.equal(result.live, false);
    assert.equal(result.history.medianDurationMinutes, null); assert.equal(result.history.medianRecoveryMinutes, null);
  }
  assert.equal(chemicalSources({ ...base, events: [active] }).current.eventId, 'open');
});

test('shared room summary and contractor report include the same chemical evidence', () => {
  const engine = new RoomEngine({ deviceKey: 'real', roomId: 'room', timeZone: 'America/Los_Angeles' });
  engine.events = [event('a', 0, { channel: 'tvoc', peak: { v: 600, t: now - 6900 }, acknowledgedActions: [] })];
  engine.capabilities.tvoc = true;
  const summary = engine.assess({ now });
  assert.equal(summary.chemicalSources.history.eventCount, 1);
  assert.equal(summary.chemicalSources.current, null);
  const report = buildAirReport({ summaries: [summary], household: { id: 'home', equipment: [] }, now });
  assert.deepEqual(report.rooms[0].chemicalSources, summary.chemicalSources);
  assert.equal(summary.opportunitySignals.length, 0);
});
