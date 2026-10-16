/* Development / demo seed: a household with context, a contractor, two more
 * customers, 30 days of history per room and live simulations, so the whole
 * loop (homeowner -> contractor) can be iterated on without hardware.
 *
 * Only runs when demo mode is on (see demoEnabled). Production never seeds.
 * Everything seeded is simulated and labelled as such; the signed-in user is
 * added as a member of the demo household AND of the demo contractor so both
 * views can be opened from one account.
 */

import { generateHistorySlots, SCENARIOS } from './air-intelligence/index.js';

export const DEMO_HOUSEHOLD_ID = 'demo-home-winston';
export const DEMO_CONTRACTOR_ID = 'demo-contractor';

export function demoEnabled(env = process.env) {
  if (env.NOWARE_DEMO === '0' || env.NOWARE_DEMO === 'false') return false;
  if (env.NOWARE_DEMO === '1' || env.NOWARE_DEMO === 'true') return true;
  return env.NODE_ENV !== 'production';
}

/**
 * Idempotent. Returns the demo household.
 * @param {{store: import('./home-store.js').HomeStore, service: import('./home-service.js').HomeService, userEmail?: string, userName?: string, timeZone?: string}} o
 */
export function seedDemo({ store, service, userEmail, userName, timeZone = 'America/Los_Angeles' }) {
  const members = userEmail ? [userEmail] : [];
  const existing = store.getHousehold(DEMO_HOUSEHOLD_ID);
  const nowS = Date.now() / 1000;

  const contractor = store.upsertContractor({
    id: DEMO_CONTRACTOR_ID,
    name: 'Demo Comfort Co.',
    tagline: 'Maintaining your home since 2024',
    members: [...new Set([...(store.getContractor(DEMO_CONTRACTOR_ID)?.members || []), ...members])],
    contact: { phone: '+1 555 0100', email: 'service@example.invalid', messageUrl: null, bookingUrl: null },
    demo: true,
  });

  const household = store.upsertHousehold({
    id: DEMO_HOUSEHOLD_ID,
    name: userName ? `${userName.split(' ')[0]}'s Home` : "Winston's Home",
    timeZone,
    members: [...new Set([...(existing?.members || []), ...members])],
    demo: true,
    profile: {
      sensitivities: { allergies: true, asthma: false, youngChildren: false, elderlyResidents: false },
      pets: { hasPets: true, types: ['cat'] },
      concerns: { pollen: false, dust: true, petAllergens: true, smoke: false, cooking: true, mold: false, odors: false },
    },
    rooms: existing?.rooms?.length ? existing.rooms : [
      { id: 'living', name: 'Living room', type: 'living', deviceKeys: [] },
      { id: 'bedroom', name: 'Bedroom', type: 'bedroom', deviceKeys: [] },
      { id: 'kitchen', name: 'Kitchen', type: 'kitchen', deviceKeys: [] },
    ],
    equipment: [
      { id: 'hvac', type: 'hvac', label: 'Central forced-air HVAC' },
      { id: 'filter', type: 'hvac_filter', label: '1" pleated filter', installedAt: nowS - 40 * 86400 },
      { id: 'purifier', type: 'portable_purifier', label: 'Portable HEPA purifier (living room)' },
      { id: 'hood', type: 'kitchen_exhaust', label: 'Range hood (recirculating)' },
    ],
  });
  store.assign({ householdId: household.id, contractorId: contractor.id, relationshipStatus: 'active', since: nowS - 400 * 86400, shareInsights: true });
  store.addServiceEvent({ id: 'demo-svc-filter', householdId: household.id, contractorId: contractor.id, type: 'filter_change', occurredAt: nowS - 40 * 86400, equipment: { type: 'hvac_filter', label: '1" pleated filter' }, notes: 'Routine filter replacement.' });

  const smith = store.upsertHousehold({
    id: 'demo-home-smith', name: 'Smith Home', timeZone, members: [], demo: true,
    profile: { sensitivities: { youngChildren: true }, pets: { hasPets: false, types: [] }, concerns: {} },
    rooms: store.getHousehold('demo-home-smith')?.rooms?.length ? store.getHousehold('demo-home-smith').rooms : [
      { id: 'bedroom', name: 'Main bedroom', type: 'bedroom', deviceKeys: [] },
      { id: 'living', name: 'Living room', type: 'living', deviceKeys: [] },
    ],
    equipment: [{ id: 'hvac', type: 'hvac', label: 'Heat pump with air handler' }],
  });
  store.assign({ householdId: smith.id, contractorId: contractor.id, relationshipStatus: 'active', since: nowS - 200 * 86400, shareInsights: true });

  const lopez = store.upsertHousehold({
    id: 'demo-home-lopez', name: 'Lopez Home', timeZone, members: [], demo: true,
    profile: { sensitivities: {}, pets: { hasPets: true, types: ['dog'] }, concerns: { mold: true } },
    rooms: store.getHousehold('demo-home-lopez')?.rooms?.length ? store.getHousehold('demo-home-lopez').rooms : [
      { id: 'kitchen', name: 'Kitchen', type: 'kitchen', deviceKeys: [] },
      { id: 'basement', name: 'Basement', type: 'basement', deviceKeys: [] },
    ],
    equipment: [{ id: 'hvac', type: 'hvac', label: 'Central forced-air HVAC' }, { id: 'cleaner', type: 'whole_home_air_cleaner', label: 'Whole-home media air cleaner', installedAt: nowS - 15 * 86400 }],
  });
  store.assign({ householdId: lopez.id, contractorId: contractor.id, relationshipStatus: 'active', since: nowS - 120 * 86400, shareInsights: true });

  // A fourth customer that has NOT consented to share insights: must be
  // invisible to the contractor view (authorization test fixture).
  const private_ = store.upsertHousehold({ id: 'demo-home-private', name: 'Nguyen Home', timeZone, members: [], demo: true, profile: {}, rooms: [{ id: 'living', name: 'Living room', type: 'living', deviceKeys: [] }], equipment: [] });
  store.assign({ householdId: private_.id, contractorId: contractor.id, relationshipStatus: 'active', shareInsights: false });

  // Live simulations (only for rooms without a running one).
  const plan = [
    [household, 'living', 'healthy'],
    [household, 'bedroom', 'poor_ventilation_overnight'],
    [household, 'kitchen', 'cooking_repeated'],
    [smith, 'bedroom', 'poor_ventilation_overnight'],
    [smith, 'living', 'healthy'],
    [lopez, 'kitchen', 'equipment_improvement'],
    [lopez, 'basement', 'high_humidity'],
    [private_, 'living', 'healthy'],
  ];
  let seed = 11;
  for (const [h, roomId, key] of plan) {
    const room = h.rooms.find((r) => r.id === roomId);
    if (!room || service.simulationFor(h, room)) continue;
    // Bedrooms show their overnight pattern in history; live they start quiet
    // unless it is actually night, which keeps the demo honest about time.
    const liveKey = key === 'poor_ventilation_overnight' ? 'healthy' : key;
    service.startScenario(h, room, liveKey, { seed: seed++, offsetS: key === 'cooking_repeated' ? 11 * 60 : key === 'equipment_improvement' ? 9 * 60 : 20 * 60, withHistory: true });
    if (liveKey !== key) {
      // Replace the healthy history with the scenario's own history.
      const engine = service.engineFor(`sim:${h.id}:${room.id}`);
      if (engine) {
        engine.ingestSlots(generateHistorySlots(SCENARIOS[key], { endT: engine.firstSampleAt || Date.now() / 1000, days: 30, timeZone, seed: seed + 50 }), { windowS: 300, trueCo2: true, source: 'simulated' });
      }
    }
  }
  return household;
}
