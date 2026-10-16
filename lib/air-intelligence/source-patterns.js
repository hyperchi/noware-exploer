/* Explainable source clues. Associations use homeowner observations, never
 * pretend that particle size identifies a chemical, animal or fire source.
 * These supplement the shared event inference; they do not create sales leads.
 */
export const OBSERVATION_TYPES = Object.freeze({
  pet_activity: 'Pet activity', cooking: 'Cooking', cleaning: 'Cleaning or fragrance',
  windows_open: 'Windows opened', outdoor_smoke: 'Smoke noticed outside',
  dust_activity: 'Dusting or vacuuming',
});
const WINDOW = 20 * 60;
const month = 30 * 86400;
const evidence = (kind, text) => ({ kind, text });

export function sourcePatterns({ features = {}, health, events = [], observations = [], outdoor, profile = {}, now, roomId, source = 'physical' }) {
  const live = health?.state === 'online';
  const notes = observations.filter(o => o.roomId === roomId && o.readingSource === source && o.occurredAt <= now && o.occurredAt >= now - month);
  const eligible = events.filter(e => e.roomId === roomId && e.source === source && e.startedAt >= now - month && e.startedAt <= now && ['particles', 'voc'].includes(e.category));
  const particleEvents = eligible.filter(e => e.category === 'particles');
  const overlaps = (e, o) => Math.abs(e.startedAt - o.occurredAt) <= WINDOW;
  const associations = Object.entries(OBSERVATION_TYPES).map(([type, label]) => {
    const recorded = notes.filter(o => o.type === type);
    const relevant = type === 'cleaning' ? eligible : particleEvents;
    const matches = relevant.filter(e => recorded.some(o => overlaps(e, o))).sort((a, b) => a.startedAt - b.startedAt);
    const matched = [];
    for (const e of matches) if (!matched.some(m => m.id === e.id || Math.abs(m.startedAt - e.startedAt) <= WINDOW)) matched.push(e);
    // Count distinct measured events, not repeat taps or duplicate notes.
    return { type, label, eventCount: matched.length, observationCount: recorded.length,
      recurring: matched.length >= 3, windowMinutes: 20, kind: 'derived',
      text: `${matched.length} air ${matched.length === 1 ? 'change' : 'changes'} within 20 minutes of your ${label.toLowerCase()} notes. Timing alone does not establish the cause.` };
  }).filter(a => a.observationCount > 0);
  const active = live ? particleEvents.filter(e => e.state !== 'resolved') : [];
  const currentNote = type => active.some(e => notes.some(o => o.type === type && overlaps(e, o)));
  const pm = features.pm25;
  const pm10 = features.pm10;
  const particleRise = live && Boolean(pm?.elevated || pm10?.elevated);
  const fineParticleRise = live && Boolean(pm?.elevated);
  const fineRise = pm?.current != null && pm?.baseline ? Math.max(0, pm.current - pm.baseline.median) : null;
  const coarseRise = pm10?.current != null && pm?.current != null && pm10?.baseline && pm?.baseline
    ? Math.max(0, (pm10.current - pm.current) - (pm10.baseline.median - pm.baseline.median)) : null;
  const coarse = particleRise && coarseRise != null && coarseRise > 5 && coarseRise > Math.max(0, fineRise) * 1.5;
  const outdoorFresh = outdoor?.status === 'available' && Number.isFinite(outdoor.fetchedAt) && now - outdoor.fetchedAt >= -60 && now - outdoor.fetchedAt <= 3600;
  const wildfire = outdoorFresh && outdoor.wildfireSmoke === true;
  const outsideParticles = outdoorFresh && Number.isFinite(outdoor.pm25) && outdoor.pm25 >= 12 && fineParticleRise;
  const petMatch = particleRise && coarse && currentNote('pet_activity');
  const smokeNote = fineParticleRise && currentNote('outdoor_smoke');
  const petEvidence = [];
  if (coarse) petEvidence.push(evidence('derived', 'Larger particles rose more than fine particles compared with this room’s baseline.'));
  if (currentNote('pet_activity')) petEvidence.push(evidence('context', 'You recorded pet activity close to the start of this particle rise.'));
  if (profile.pets?.hasPets) petEvidence.push(evidence('context', 'Your household profile includes pets. This alone does not identify the source.'));
  const smokeEvidence = [];
  if (fineParticleRise) smokeEvidence.push(evidence('derived', 'Indoor particle levels are elevated.'));
  if (wildfire) smokeEvidence.push(evidence('context', 'The outdoor provider reports wildfire smoke nearby; this does not prove it reached this room.'));
  if (outsideParticles) smokeEvidence.push(evidence('context', `Outdoor PM2.5 is ${outdoor.pm25} µg/m³ from ${outdoor.provider || 'the outdoor provider'}.`));
  if (smokeNote) smokeEvidence.push(evidence('context', 'You recorded smoke outside close to the start of this particle rise.'));
  const cards = [
    { id: 'pets_dust', title: 'Pets & everyday dust',
      state: !live ? 'unavailable' : petMatch ? 'possible' : coarse ? 'clue' : 'learning',
      label: !live ? 'Waiting for live readings' : petMatch ? 'Activity may be stirring up dust' : coarse ? 'A larger-particle pattern' : 'No clear link yet',
      explanation: petMatch ? 'The particle pattern and your activity note line up. Walking, vacuuming and other movement can look similar.' : coarse ? 'Movement can lift settled dust into the air. A note about what was happening helps narrow it down.' : 'We can compare particle changes with times you record pet activity. AirCube cannot identify pet hair, dander or an allergen.',
      confidence: { level: 'low', evidence: petEvidence },
      missing: ['Particle size cannot identify an allergen or a particular animal.', ...(!currentNote('pet_activity') ? ['An activity note near a particle rise.'] : [])],
      nextStep: 'Record pet activity when it happens. Repeated timing matches are more useful than a single spike.',
    },
    { id: 'outdoor_smoke', title: 'Outdoor smoke',
      state: !live ? 'unavailable' : fineParticleRise && (wildfire || smokeNote) ? 'possible' : outsideParticles ? 'clue' : 'learning',
      label: !live ? 'Waiting for live readings' : fineParticleRise && (wildfire || smokeNote) ? 'Outdoor smoke may be contributing' : outsideParticles ? 'Indoor and outdoor particles are elevated' : !outdoorFresh ? 'Outdoor conditions unknown' : 'No clear smoke pattern',
      explanation: fineParticleRise && (wildfire || smokeNote) ? 'Fine particles have several possible sources, including cooking, candles and smoke. Outdoor context helps, but is not proof.' : 'Wildfire smoke can raise fine particles indoors. To distinguish it from cooking or candles, we need nearby outdoor measurements and smoke information.',
      confidence: { level: fineParticleRise && wildfire && outsideParticles ? 'medium' : 'low', evidence: smokeEvidence },
      missing: [...(!outdoorFresh ? ['Recent nearby outdoor measurements are not connected.'] : []), ...(!wildfire ? ['No current wildfire report from an outdoor provider.'] : []), 'Indoor particles alone cannot identify wildfire smoke.'],
      nextStep: 'Check the local smoke map before opening windows. You can also record smoke you notice outside.',
      externalUrl: 'https://fire.airnow.gov/', externalLabel: 'Check local smoke conditions',
    },
  ];
  return { live, source, cards, associations, recentObservations: notes.slice().sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 8).map(({ id, type, occurredAt, note }) => ({ id, type, label: OBSERVATION_TYPES[type], occurredAt, note, kind: 'context' })) };
}
