/* HomeService: wires the cube relay, the air-intelligence engines and the
 * home store together, and runs server-side scenario simulations so the
 * homeowner and contractor views can be exercised from one switch.
 *
 *   relay /live  -> onLive  -> RoomEngine.ingestReadings -> store
 *   relay /history -> onHistory -> RoomEngine.ingestSlots
 *   API -> summaryForHousehold / summaryForRoom -> AirIntelligenceSummary
 */

import { canPublishTeamDevice, isTeamEmail, teamDeviceKeys, TEAM_OFFICE_LOCATION } from './authz.js';
import { demoEnabled } from './demo-seed.js';
import { RoomEngine, homeSummary, buildContactPayload, buildAirReport, unavailableOutdoor, SCENARIOS, generateHistorySlots, readingAt, rng, scenarioServiceEvents, NoOutdoorProvider, StaticOutdoorProvider, availableChannels } from './air-intelligence/index.js';
import { channelSeries } from './air-intelligence/series.js';

const nowS = () => Date.now() / 1000;
const SIM_TICK_MS = 2000;

export class HomeService {
  /**
   * @param {object} o
   * @param {import('./home-store.js').HomeStore} o.store
   * @param {object} [o.outdoorProvider]
   * @param {() => number} [o.clock]
   */
  constructor({ store, outdoorProvider = new NoOutdoorProvider(), clock = nowS } = {}) {
    this.store = store;
    this.outdoorProvider = outdoorProvider;
    this.clock = clock;
    this.engines = new Map();
    this.simulations = new Map(); // deviceKey -> {scenario, startWall, cursorS, timer, random, outdoor}
    this.outdoorByHousehold = new Map();
    for (const key of store.engineKeys()) {
      try {
        this.engines.set(key, RoomEngine.fromJSON(store.loadEngine(key)));
      } catch (err) {
        console.error('home service: dropping engine state for', key, err.message);
      }
    }
  }

  // ---------------------------------------------------------------- engines

  engineFor(deviceKey) {
    return this.engines.get(deviceKey) || null;
  }

  ensureEngine(deviceKey, { householdId, roomId, roomName, roomType, timeZone }) {
    let engine = this.engines.get(deviceKey);
    if (!engine) {
      engine = new RoomEngine({ deviceKey, householdId, roomId, roomName, roomType, timeZone });
      this.engines.set(deviceKey, engine);
    } else {
      Object.assign(engine, { householdId, roomId, roomName, roomType, timeZone: timeZone || engine.timeZone });
    }
    return engine;
  }

  persistEngine(deviceKey) {
    const engine = this.engines.get(deviceKey);
    if (engine) this.store.saveEngine(deviceKey, engine.toJSON());
  }

  // ------------------------------------------------------------- relay hooks

  /**
   * Resolve which household/room a published cube belongs to. Explicit device
   * keys (gateway config) win; otherwise the publisher's own household; a
   * publisher with no household gets one created so their cube has a home.
   */
  resolveDevice(cubeStore) {
    const meta = cubeStore.meta || {};
    const publisherEmail = (cubeStore.publisher?.email || '').toLowerCase();
    // A Noso browser publishes the team relay's one physical cube, which is the office cube.
    const officeKey = isTeamEmail(publisherEmail) && meta.source !== 'simulated' && !demoEnabled() ? teamDeviceKeys()[0] : '';
    const deviceKey = meta.deviceKey || officeKey || (publisherEmail && publisherEmail.includes('@') ? `cube:${publisherEmail}` : 'cube:shared');
    let household = this.store.householdOfDevice(deviceKey);
    const teamDevice = canPublishTeamDevice(deviceKey, publisherEmail);
    if (household && !household.members.includes(publisherEmail) && !teamDevice) throw new Error("Device belongs to another household.");
    // A first-seen office cube gets its own home, so sharing it never exposes the publisher's.
    if (!household && teamDevice) household = this.store.upsertHousehold({ name: 'Noso Office', members: [publisherEmail], rooms: [], equipment: [], profile: {} });
    if (!household && publisherEmail.includes('@')) household = this.store.householdsForMember(publisherEmail)[0] || null;
    if (!household && publisherEmail.includes('@') && this.beforeCreateHousehold) {
      // Gives the host a chance to provision (e.g. the demo seed) before a
      // bare household is invented for this publisher.
      try { this.beforeCreateHousehold(publisherEmail); } catch (err) { console.error('beforeCreateHousehold failed', err); }
      household = this.store.householdsForMember(publisherEmail)[0] || null;
    }
    if (!household && publisherEmail.includes('@')) {
      const name = `${publisherEmail.split('@')[0].replace(/^\w/, (c) => c.toUpperCase())}'s Home`;
      household = this.store.upsertHousehold({ name, members: [publisherEmail], rooms: [], equipment: [], profile: {} });
    }
    if (!household) return null;
    // A cleared location is null, so a member's "Stop using location" is respected.
    if (teamDevice && household.location === undefined) household = this.store.upsertHousehold({ ...household, location: { ...TEAM_OFFICE_LOCATION } });
    const known = this.store.getDevice(deviceKey);
    let room = null;
    // The publisher's configured room name wins (gateway AIRCUBE_ROOM); a
    // remembered room is used when no name is given.
    if (meta.roomName) room = household.rooms.find((r) => r.name.toLowerCase() === meta.roomName.toLowerCase()) || this.store.addRoom(household.id, { name: meta.roomName, type: guessRoomType(meta.roomName) });
    if (!room && known) room = household.rooms.find((r) => r.id === known.roomId) || null;
    if (!room) room = household.rooms.find((r) => (r.deviceKeys || []).includes(deviceKey)) || household.rooms[0] || this.store.addRoom(household.id, { name: 'Living room', type: 'living' });
    this.store.attachDevice(deviceKey, { householdId: household.id, roomId: room.id, name: meta.name, source: meta.source });
    return { deviceKey, household, room };
  }

  onLive(readings, cubeStore) {
    const resolved = this.resolveDevice(cubeStore);
    if (!resolved) return;
    const { deviceKey, household, room } = resolved;
    const engine = this.ensureEngine(deviceKey, { householdId: household.id, roomId: room.id, roomName: room.name, roomType: room.type, timeZone: household.timeZone });
    engine.deviceName = cubeStore.meta?.name || engine.deviceName;
    engine.setConnection({ connected: true, heartbeatAt: cubeStore.publisher?.lastSeen });
    engine.ingestReadings(readings, { heartbeatAt: cubeStore.publisher?.lastSeen });
    engine.assess({ now: this.clock(), household, ...this.roomSummaryInputs(household) });
    this.persistEngine(deviceKey);
  }

  onHistory(slots, cubeStore) {
    const resolved = this.resolveDevice(cubeStore);
    if (!resolved) return;
    const { deviceKey, household, room } = resolved;
    const engine = this.ensureEngine(deviceKey, { householdId: household.id, roomId: room.id, roomName: room.name, roomType: room.type, timeZone: household.timeZone });
    engine.ingestSlots(slots, { windowS: cubeStore.windowS || 300, trueCo2: engine.capabilities.trueCo2 || Boolean(cubeStore.meta?.isPro) });
    this.persistEngine(deviceKey);
  }

  // -------------------------------------------------------------- summaries

  async outdoorFor(household) {
    const sim = [...this.simulations.values()].find((s) => s.householdId === household.id && s.outdoor);
    if (sim) return sim.outdoor;
    try {
      return await this.outdoorProvider.getOutdoor({ householdId: household.id, location: household.location || null });
    } catch {
      return unavailableOutdoor();
    }
  }

  roomSummaryInputs(household) {
    return {
      observations: this.store.observationsFor(household.id),
      contractor: this.store.contractorFor(household.id),
      serviceEvents: this.store.serviceEventsFor(household.id).map((s) => ({ ...s, contractorName: s.contractorId ? this.store.getContractor(s.contractorId)?.name : null })),
      existingSignals: this.store.signalStatuses(household.id),
    };
  }

  /** The device to show for a room: the one that reported most recently. */
  deviceKeyForRoom(room) {
    const keys = room.deviceKeys || [];
    const physical = keys.filter(k => this.store.getDevice(k)?.source === 'physical');
    if (physical.length) return physical.sort((a, b) => (this.engines.get(b)?.lastReadingAt || 0) - (this.engines.get(a)?.lastReadingAt || 0))[0];
    if (keys.length <= 1) return keys[0];
    return keys.slice().sort((a, b) => (this.engines.get(b)?.lastReadingAt || 0) - (this.engines.get(a)?.lastReadingAt || 0))[0];
  }

  async summaryForRoom(household, room, { now = this.clock(), debug = false, fahrenheit = false, includeContractor = true } = {}) {
    const deviceKey = this.deviceKeyForRoom(room);
    const engine = deviceKey ? this.engines.get(deviceKey) : null;
    const outdoor = await this.outdoorFor(household);
    const inputs = this.roomSummaryInputs(household);
    if (!engine) {
      const empty = new RoomEngine({ deviceKey: deviceKey || null, householdId: household.id, roomId: room.id, roomName: room.name, roomType: room.type, timeZone: household.timeZone });
      return empty.assess({ now, household, outdoor, ...inputs, debug, fahrenheit, includeContractor });
    }
    const summary = engine.assess({ now, household, outdoor, ...inputs, debug, fahrenheit, includeContractor });
    if (summary.opportunitySignals.length) this.store.rememberSignals(summary.opportunitySignals);
    summary.deviceName = this.store.getDevice(deviceKey)?.name || engine.deviceName;
    return summary;
  }

  async summaryForHousehold(household, options = {}) {
    const rooms = [];
    for (const room of household.rooms) rooms.push(await this.summaryForRoom(household, room, options));
    const now = options.now || this.clock();
    const home = homeSummary(rooms, { now });
    // Household-level contractor view: the union of room insights, de-duplicated by category.
    const insights = [];
    const seen = new Set();
    for (const r of rooms) for (const i of r.contractorInsights) if (!seen.has(i.category)) { seen.add(i.category); insights.push({ ...i, roomName: r.roomName, roomId: r.roomId }); }
    const signals = [];
    const seenS = new Set();
    for (const r of rooms) for (const s of r.opportunitySignals) if (!seenS.has(s.id)) { seenS.add(s.id); signals.push({ ...s, roomName: r.roomName, roomId: r.roomId, ...statusOf(this.store, s.id) }); }
    return { home, rooms, insights, signals, generatedAt: now };
  }

  /** Downsampled series for charts. */
  seriesForRoom(household, room, { seconds = 3600, maxPoints = 720, now = this.clock() } = {}) {
    const deviceKey = this.deviceKeyForRoom(room);
    const engine = deviceKey ? this.engines.get(deviceKey) : null;
    if (!engine) return { channels: {}, events: [], from: now - seconds, to: now };
    const samples = engine.allSamples().filter((s) => s.t >= now - seconds);
    const out = {};
    for (const channel of availableChannels(engine.capabilities)) {
      const series = channelSeries(samples, channel);
      const step = Math.max(1, Math.ceil(series.length / maxPoints));
      const pts = [];
      for (let i = 0; i < series.length; i += step) {
        const chunk = series.slice(i, i + step);
        const avg = chunk.reduce((a, p) => a + p.v, 0) / chunk.length;
        pts.push([Math.round(chunk[0].t), Math.round(avg * 100) / 100]);
      }
      out[channel] = pts;
    }
    const events = engine.events.filter((e) => (e.endedAt ?? now) >= now - seconds).map((e) => ({ id: e.id, category: e.category, channel: e.channel, startedAt: e.startedAt, endedAt: e.endedAt || null, state: e.state, headline: e.headline || null, source: e.hypothesis?.source || null, peak: e.peak }));
    return { channels: out, events, from: now - seconds, to: now, source: engine.source };
  }

  // ------------------------------------------------------------- homeowner

  findEvent(household, eventId) {
    for (const key of household.deviceKeys) {
      const engine = this.engines.get(key);
      const event = engine?.events.find((e) => e.id === eventId);
      if (event) return { engine, event };
    }
    return null;
  }

  acknowledge(household, eventId, recommendationId, { by, at = this.clock() }) {
    const found = this.findEvent(household, eventId);
    if (!found) return null;
    const event = found.engine.acknowledge(eventId, recommendationId, { at });
    if (event) {
      const ack = event.acknowledgedActions.find((a) => a.id === recommendationId);
      if (ack) ack.by = by;
    }
    this.persistEngine(found.engine.deviceKey);
    return event;
  }

  feedback(household, eventId, { correct, actualSource, note, by, at = this.clock() }) {
    const found = this.findEvent(household, eventId);
    if (!found) return null;
    const entry = found.engine.recordFeedback(eventId, { correct, actualSource, note, by, at });
    this.store.addFeedback({ ...entry, householdId: household.id });
    this.persistEngine(found.engine.deviceKey);
    return entry;
  }

  async contact(household, { type, roomId, eventId, message, homeowner, now = this.clock() }) {
    const contractor = this.store.contractorFor(household.id);
    const assignment = this.store.assignmentFor(household.id);
    const room = roomId ? this.store.roomOf(household.id, roomId) : household.rooms[0];
    const summary = room ? await this.summaryForRoom(household, room, { now }) : null;
    const event = eventId && summary ? summary.activeEvents.find((e) => e.id === eventId) || summary.recentEvents.find((e) => e.id === eventId) : null;
    const payload = summary ? buildContactPayload({ type, summary, event, household, room, homeowner, contractor, now }) : { type, householdId: household.id, createdAt: now };
    payload.message = message || '';
    const request = this.store.addContactRequest({ householdId: household.id, contractorId: contractor?.id || null, type, payload, by: homeowner?.email || '' });
    // No messaging/booking integration exists yet: expose safe fallbacks built
    // from the contractor's recorded contact methods.
    const fallback = contractor ? {
      tel: contractor.contact?.phone ? `tel:${contractor.contact.phone.replace(/[^\d+]/g, '')}` : null,
      mailto: contractor.contact?.email ? `mailto:${contractor.contact.email}?subject=${encodeURIComponent(`Air quality: ${payload.issue || 'question'} (${household.name})`)}&body=${encodeURIComponent(renderPayloadText(payload))}` : null,
      bookingUrl: contractor.contact?.bookingUrl || null,
      messageUrl: contractor.contact?.messageUrl || null,
      methods: assignment?.contactMethods || [],
    } : null;
    return { request, payload, fallback, contractor: contractor ? { id: contractor.id, name: contractor.name } : null };
  }

  async report(household, { now = this.clock() } = {}) {
    const summaries = [];
    for (const room of household.rooms) summaries.push(await this.summaryForRoom(household, room, { now }));
    return buildAirReport({ summaries, household, contractor: this.store.contractorFor(household.id), serviceEvents: this.store.serviceEventsFor(household.id), now });
  }

  // ------------------------------------------------------------ contractor

  async customersFor(contractorId, { now = this.clock() } = {}) {
    const homes = [];
    for (const household of this.store.householdsForContractor(contractorId)) {
      const { home, rooms, insights, signals } = await this.summaryForHousehold(household, { now });
      const openSignals = signals.filter((s) => s.status === 'new' || s.status === 'reviewed' || s.status === 'contacted');
      const activeEscalation = rooms.some((r) => (r.homeownerRecommendations || []).some((x) => x.level === 'contractor'));
      const improved = rooms.some((r) => r.patterns.serviceComparisons.some((c) => Object.values(c.categories).some((cat) => cat.sufficient && cat.recoveryChange < -0.2)));
      const bucket = activeEscalation ? 'needs_attention' : openSignals.length ? 'recurring' : improved ? 'improved' : 'all';
      const top = insights[0] || null;
      homes.push({
        householdId: household.id,
        name: household.name,
        bucket,
        status: home.status,
        statusLabel: home.label,
        live: rooms.some((r) => r.currentStatus.live),
        simulated: rooms.some((r) => r.deviceHealth.simulated),
        rooms: home.rooms,
        topInsight: top ? { category: top.category, problem: top.problem, confidence: top.confidence.level, roomName: top.roomName, recurring: top.evidence[0]?.text || '' } : null,
        signals: openSignals.map((s) => ({ id: s.id, type: s.type, status: s.status, confidence: s.confidence, recurringEventCount: s.recurringEventCount })),
        equipment: (household.equipment || []).map((e) => e.label),
        lastSeenAt: Math.max(0, ...rooms.map((r) => r.deviceHealth.lastReadingAt || 0)),
        contactRequests: this.store.contactRequestsFor({ householdId: household.id, contractorId }).length,
      });
    }
    const order = { needs_attention: 0, recurring: 1, improved: 2, all: 3 };
    homes.sort((a, b) => order[a.bucket] - order[b.bucket] || a.name.localeCompare(b.name));
    return {
      counts: {
        needs_attention: homes.filter((h) => h.bucket === 'needs_attention').length,
        recurring: homes.filter((h) => h.bucket === 'recurring').length,
        improved: homes.filter((h) => h.bucket === 'improved').length,
        all: homes.length,
      },
      homes,
    };
  }

  // ------------------------------------------------------------ simulation

  /**
   * Start (or replace) a server-side simulation for a room. History for the
   * scenario is generated into the engine, then live readings advance in real
   * time from `offsetS` into the scenario. Everything is labelled simulated.
   */
  startScenario(household, room, scenarioKey, { offsetS, days = 30, seed = 7, withHistory = true } = {}) {
    const scenario = SCENARIOS[scenarioKey];
    if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}`);
    const deviceKey = `sim:${household.id}:${room.id}`;
    this.stopScenario(deviceKey);
    this.engines.delete(deviceKey);
    const engine = this.ensureEngine(deviceKey, { householdId: household.id, roomId: room.id, roomName: room.name, roomType: room.type, timeZone: household.timeZone });
    engine.deviceName = `${room.name} (simulated)`;
    engine.source = 'simulated';
    this.store.attachDevice(deviceKey, { householdId: household.id, roomId: room.id, name: engine.deviceName, source: 'simulated' });
    for (const s of scenarioServiceEvents(scenario, { endT: this.clock(), householdId: household.id, contractorId: this.store.contractorFor(household.id)?.id })) {
      this.store.addServiceEvent({ ...s, id: `${s.id}:${household.id}:${room.id}`, title: undefined });
    }
    const startOffset = offsetS ?? scenario.demoOffsetS ?? Math.min(scenario.durationS * 0.3, 900);
    const wallNow = this.clock();
    const startWall = wallNow - startOffset;
    if (withHistory) engine.ingestSlots(generateHistorySlots(scenario, { endT: startWall, days, timeZone: household.timeZone, seed: seed + 3 }), { windowS: 300, trueCo2: scenario.capabilities !== 'base', source: 'simulated' });
    const sim = { deviceKey, householdId: household.id, roomId: room.id, scenario, startWall, cursorS: 0, random: rng(seed), timer: null, outdoor: scenario.outdoor ? { ...unavailableOutdoor(), status: 'available', provider: 'scenario', fetchedAt: wallNow, ...scenario.outdoor } : null, speed: 1 };
    this.simulations.set(deviceKey, sim);
    this.tickScenario(sim);
    sim.timer = setInterval(() => this.tickScenario(sim), SIM_TICK_MS);
    sim.timer.unref?.();
    return { deviceKey, scenario: scenario.key, startedAt: startWall };
  }

  tickScenario(sim) {
    const engine = this.engines.get(sim.deviceKey);
    if (!engine) return this.stopScenario(sim.deviceKey);
    const wallNow = this.clock();
    const targetS = Math.floor((wallNow - sim.startWall) * sim.speed);
    const offline = sim.scenario.device?.offlineAfterS;
    const batch = [];
    while (sim.cursorS <= targetS) {
      if (offline == null || sim.cursorS <= offline) {
        const reading = readingAt(sim.scenario, sim.cursorS, sim.startWall, sim.random);
        reading.timestamp = sim.startWall + sim.cursorS / sim.speed;
        batch.push(reading);
      } else { sim.cursorS = targetS + 1; break; }
      sim.cursorS++;
      if (batch.length > 3600) break;
    }
    // Readings are stamped in wall-clock time whatever the speed, so the
    // engine's clock stays consistent; speed only compresses the scenario.
    if (batch.length) {
      engine.setConnection({ connected: offline == null || sim.cursorS <= offline, heartbeatAt: wallNow });
      engine.ingestReadings(batch, { heartbeatAt: wallNow });
    } else if (offline != null) {
      engine.setConnection({ connected: false });
    }
  }

  /** Demo shortcut: jump the scenario ahead by `seconds` of scenario time. */
  advanceScenario(deviceKey, seconds) {
    const sim = this.simulations.get(deviceKey);
    if (!sim) return null;
    sim.startWall -= seconds;
    const engine = this.engines.get(deviceKey);
    // Shift what the engine already has so timestamps stay monotonic.
    if (engine) {
      for (const s of engine.samples) s.t -= seconds;
      for (const s of engine.slotSamples) s.t -= seconds;
      for (const s of engine.archive) s.t -= seconds;
      if (engine.aggregate) engine.aggregate.start -= seconds;
      if (engine.slotCoverage) { engine.slotCoverage.from -= seconds; engine.slotCoverage.to -= seconds; }
      for (const e of engine.events) { e.startedAt -= seconds; if (e.endedAt) e.endedAt -= seconds; if (e.peak) e.peak.t -= seconds; for (const a of e.acknowledgedActions || []) a.at -= seconds; }
      engine.lastReadingAt -= seconds;
      engine.firstSampleAt -= seconds;
      if (engine.lastReading) engine.lastReading.timestamp -= seconds;
    }
    this.tickScenario(sim);
    return { deviceKey, advancedS: seconds };
  }

  stopScenario(deviceKey) {
    const sim = this.simulations.get(deviceKey);
    if (!sim) return false;
    clearInterval(sim.timer);
    this.simulations.delete(deviceKey);
    return true;
  }

  /** True while the seeded demo household has its simulations running. */
  demoRunning() {
    return [...this.simulations.keys()].some((k) => k.startsWith('sim:demo-home-winston:'));
  }

  simulationFor(household, room) {
    return this.simulations.get(`sim:${household.id}:${room.id}`) || null;
  }

  stopAll() {
    for (const key of [...this.simulations.keys()]) this.stopScenario(key);
  }
}

function statusOf(store, id) {
  const s = store.state.signals[id];
  return s ? { status: s.status, statusChangedAt: s.statusChangedAt || null } : {};
}

export function guessRoomType(name = '') {
  const n = name.toLowerCase();
  if (/kitchen/.test(n)) return 'kitchen';
  if (/bed/.test(n)) return 'bedroom';
  if (/nursery|kid|child/.test(n)) return 'nursery';
  if (/bath/.test(n)) return 'bathroom';
  if (/office|study/.test(n)) return 'office';
  if (/basement|cellar/.test(n)) return 'basement';
  if (/living|lounge|family/.test(n)) return 'living';
  return 'other';
}

export function renderPayloadText(p) {
  const lines = [
    `Homeowner: ${p.homeowner?.name || ''}`,
    `Room: ${p.room || ''}`,
    `Issue: ${p.issue || ''}`,
    p.startedAt ? `Started: ${new Date(p.startedAt * 1000).toLocaleString()}` : null,
    p.current ? `Current: ${p.current}` : null,
    p.normal ? `Normal: ${p.normal}` : null,
    p.duration ? `Duration: ${p.duration}` : null,
    `Actions tried: ${(p.actionsTried || []).join(', ') || 'none recorded'}`,
    p.trend ? `Trend: ${p.trend}` : null,
    p.likelyCategory ? `Likely category: ${p.likelyCategory}` : null,
    `Supporting history: ${p.supportingHistory || ''}`,
    p.equipment?.length ? `Equipment: ${p.equipment.join(', ')}` : null,
    `Device: ${p.deviceHealth || ''}`,
    p.message ? `\nMessage: ${p.message}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export { StaticOutdoorProvider };
