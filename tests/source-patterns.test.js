import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourcePatterns } from '../lib/air-intelligence/source-patterns.js';
import { RoomEngine } from '../lib/air-intelligence/engine.js';

const now = 1800000000;
const features = { pm25: { current: 18, elevated: true, baseline: { median: 5 } }, pm10: { current: 85, elevated: true, baseline: { median: 8 } } };
const event = { id: 'e1', roomId: 'room', startedAt: now - 600, source: 'physical', category: 'particles', state: 'active' };
const note = { id: 'n1', roomId: 'room', readingSource: 'physical', type: 'pet_activity', occurredAt: now - 650 };
const base = { features, health: { state: 'online' }, events: [event], observations: [note], now, roomId: 'room' };
const pet = result => result.cards.find(c => c.id === 'pets_dust');
const smoke = result => result.cards.find(c => c.id === 'outdoor_smoke');

test('pet clues need a coarse-particle change AND a contemporaneous observation; profile alone proves nothing', () => {
  const matching = sourcePatterns(base);
  assert.equal(pet(matching).state, 'possible');
  assert.equal(pet(matching).confidence.level, 'low');
  assert.equal(matching.associations[0].eventCount, 1);
  assert.equal(matching.associations[0].recurring, false);
  assert.equal(pet(sourcePatterns({ ...base, observations: [], profile: { pets: { hasPets: true } } })).state, 'clue');
  assert.equal(pet(sourcePatterns({ ...base, features: { pm25: features.pm25 } })).state, 'learning');
  assert.equal(pet(sourcePatterns({ ...base, observations: [{ ...note, occurredAt: now - 7200 }] })).state, 'clue');
});

test('associations isolate rooms and physical/simulated readings; duplicate notes do not inflate event counts', () => {
  const all = sourcePatterns({ ...base, observations: [note, { ...note, id: 'dup' }, { ...note, id: 'elsewhere', roomId: 'other' }, { ...note, id: 'sim', readingSource: 'simulated' }], events: [event, { ...event, id: 'sim-event', source: 'simulated' }] });
  assert.equal(all.associations[0].eventCount, 1);
  assert.equal(all.associations[0].observationCount, 2);
  assert.equal(all.recentObservations.length, 2);
  assert.equal(pet(sourcePatterns({ ...base, observations: [{ ...note, readingSource: 'simulated' }] })).state, 'clue');
});

test('three separate recorded event matches expose recurrence without claiming causality', () => {
  const events = [0, 1, 2].map(i => ({ ...event, id: `event-${i}`, startedAt: now - 600 - i * 86400 }));
  const observations = events.map((e, i) => ({ ...note, id: `note-${i}`, occurredAt: e.startedAt }));
  const a = sourcePatterns({ ...base, events, observations }).associations[0];
  assert.equal(a.recurring, true);
  assert.equal(a.eventCount, 3);
  assert.match(a.text, /does not establish the cause/);
});

test('wildfire clue needs fresh outdoor smoke context, never PM alone or stale outdoor data', () => {
  assert.equal(smoke(sourcePatterns(base)).label, 'Outdoor conditions unknown');
  const outdoor = { status: 'available', fetchedAt: now, wildfireSmoke: true, pm25: 80, provider: 'verified-test-provider' };
  assert.equal(smoke(sourcePatterns({ ...base, outdoor })).confidence.level, 'medium');
  assert.equal(smoke(sourcePatterns({ ...base, outdoor })).state, 'possible');
  assert.equal(smoke(sourcePatterns({ ...base, outdoor: { ...outdoor, fetchedAt: now - 7200 } })).label, 'Outdoor conditions unknown');
  assert.equal(smoke(sourcePatterns({ ...base, outdoor: { ...outdoor, wildfireSmoke: null } })).state, 'clue');
  const userSmoke = sourcePatterns({ ...base, observations: [{ ...note, type: 'outdoor_smoke' }] });
  assert.equal(smoke(userSmoke).confidence.level, 'low');
  assert.equal(smoke(userSmoke).state, 'possible');
  assert.ok(smoke(userSmoke).missing.includes('No current wildfire report from an outdoor provider.'));
});

test('offline, stale, fault and warm-up suppress current source conclusions', () => {
  for (const state of ['offline', 'stale', 'fault', 'warming_up']) {
    const out = sourcePatterns({ ...base, health: { state }, outdoor: { status: 'available', wildfireSmoke: true, pm25: 80, fetchedAt: now } });
    assert.equal(out.live, false);
    assert.ok(out.cards.every(c => c.state === 'unavailable'));
    assert.equal(out.associations[0].eventCount, 1, 'recorded history remains distinct from current air');
  }
});

test('shared engine summary always includes source clues without generating an opportunity from notes', () => {
  const engine = new RoomEngine({ deviceKey: 'test', roomId: 'room' });
  const out = engine.assess({ now, observations: [note] });
  assert.equal(out.sourcePatterns.cards.length, 2);
  assert.equal(out.sourcePatterns.live, false);
  assert.equal(out.opportunitySignals.length, 0);
});

test('tiny changes against a near-zero median do not become alarming baseline copy', async () => {
  const { measurementRows } = await import('../lib/air-intelligence/summary.js');
  const row = measurementRows({ pm25: { channel: 'pm25', current: 2.1, latestValue: 2.1, band: 0, baseline: { median: 0.1, low: 0, high: 3, kind: 'personal' } } }, { pm25: true })[0];
  assert.equal(row.value, 2.1);
  assert.equal(row.ratio, 21, 'exact arithmetic is retained for APIs');
  assert.equal(row.ratioText, 'Within your usual range');
});

test('activity observations survive a local store restart', async () => {
  const { HomeStore } = await import('../lib/home-store.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noware-observations-'));
  const store = new HomeStore({ persistPath: path.join(dir, 'home.json') });
  try {
    const saved = store.addObservation({ householdId: 'home', roomId: 'room', type: 'pet_activity', occurredAt: Date.now() / 1000, note: 'Recorded by homeowner', readingSource: 'physical' });
    store.flush();
    const restored = new HomeStore({ persistPath: store.persistPath });
    assert.deepEqual(restored.observationsFor('home'), [saved]);
  } finally { clearTimeout(store._timer); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('coarse particles alone do not support smoke, and coincident particle/VOC events count once', () => {
  const outdoor = { status: 'available', fetchedAt: now, wildfireSmoke: true, pm25: 80 };
  const result = sourcePatterns({ ...base, features: { ...features, pm25: { ...features.pm25, elevated: false } }, outdoor });
  assert.notEqual(smoke(result).state, 'possible');
  const associated = sourcePatterns({ ...base, observations: [{ ...note, type: 'cleaning' }], events: [event, { ...event, id: 'voc-event', category: 'voc' }, { ...event, id: 'other-room', roomId: 'other' }] });
  assert.equal(associated.associations[0].eventCount, 1);
});
