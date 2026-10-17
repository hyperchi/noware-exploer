/* Air intelligence in the browser for devices on this machine.
 *
 * The same engine the server runs (served from /dashboard/js/intelligence/,
 * which Vite copies from lib/air-intelligence) is fed by a local USB Device or
 * a scenario player, so the room page works with no server at all and shows
 * the cube's verdict the instant a reading arrives, without waiting for the
 * relay round trip.
 */

import { RoomEngine, SCENARIOS, generateHistorySlots, readingAt, rng, unavailableOutdoor, scenarioServiceEvents } from "./intelligence/index.js";

const LOCAL_HOUSEHOLD = { id: "local", name: "This computer", profile: {}, equipment: [], rooms: [] };

/** Wraps one local Device (devices.js) with a RoomEngine. */
export class LocalRoomSource extends EventTarget {
  constructor(device, { roomName = device.name, roomType = "other", timeZone } = {}) {
    super();
    this.device = device;
    this.kind = "local";
    this.householdId = "local";
    this.roomId = device.id;
    this.roomName = roomName;
    this.engine = new RoomEngine({ deviceKey: `local:${device.id}`, roomId: device.id, roomName, roomType, householdId: "local", timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone });
    this.engine.deviceName = device.name;
    this._slotsVersion = -1;
    this._onReading = (e) => {
      this.engine.setConnection({ connected: true, heartbeatAt: Date.now() / 1000 });
      this.engine.ingestReadings([e.detail]);
      this._emit();
    };
    device.addEventListener("reading", this._onReading);
    device.addEventListener("change", () => this._syncSlots());
    if (device.liveReadings?.length) this.engine.ingestReadings(device.liveReadings);
    this._syncSlots();
  }

  _syncSlots() {
    if (this.device.historyVersion === this._slotsVersion) return;
    this._slotsVersion = this.device.historyVersion;
    if (this.device.slots?.length) {
      const trueCo2 = this.engine.capabilities.trueCo2 || Boolean(this.device.lastReading?.hasTrueCo2) || this.device.isPro;
      this.engine.ingestSlots(this.device.slots, { windowS: this.device.historyWindowS || 300, trueCo2 });
      this._emit();
    }
  }

  summary({ debug = false, fahrenheit = false } = {}) {
    this.engine.setConnection({ connected: Boolean(this.device.isConnected) });
    const s = this.engine.assess({ now: Date.now() / 1000, household: LOCAL_HOUSEHOLD, outdoor: unavailableOutdoor(), debug, fahrenheit, includeContractor: false });
    s.roomName = this.roomName;
    s.deviceName = this.device.name;
    return s;
  }

  series(seconds) {
    const now = Date.now() / 1000;
    const samples = this.engine.allSamples().filter((x) => x.t >= now - seconds);
    const channels = {};
    for (const c of Object.keys(samples[0]?.channels || {})) {
      const pts = samples.filter((x) => x.channels[c] != null).map((x) => [x.t, x.channels[c]]);
      if (pts.length) channels[c] = thin(pts, 720);
    }
    return { channels, events: this.engine.events.filter((e) => (e.endedAt ?? now) >= now - seconds), from: now - seconds, to: now, source: this.engine.source };
  }

  ack(eventId, recommendationId) {
    this.engine.acknowledge(eventId, recommendationId, { at: Date.now() / 1000 });
    this._emit();
  }

  feedback(eventId, body) {
    this.engine.recordFeedback(eventId, { ...body, at: Date.now() / 1000 });
    this._emit();
  }

  _emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }

  destroy() {
    this.device.removeEventListener("reading", this._onReading);
  }
}

/**
 * A scenario playing in this browser. Used when there is no server, and as the
 * quickest way to see every state of the room page. Clearly simulated.
 */
export class ScenarioSource extends EventTarget {
  constructor(scenarioKey, { withHistory = true, offsetS, speed = 1, timeZone } = {}) {
    super();
    const scenario = SCENARIOS[scenarioKey];
    if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}`);
    this.kind = "scenario";
    this.scenario = scenario;
    this.householdId = "local";
    this.roomId = `sim-${scenarioKey}`;
    this.roomName = `${scenario.label} (simulated)`;
    this.timeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.engine = new RoomEngine({ deviceKey: `sim:${scenarioKey}`, roomId: this.roomId, roomName: this.roomName, roomType: scenario.roomType, householdId: "local", timeZone: this.timeZone });
    this.engine.deviceName = "Simulated AirCube";
    this.engine.source = "simulated";
    this.household = { id: "local", name: "This computer", profile: scenario.profile ? { sensitivities: {}, pets: { hasPets: false, types: [] }, concerns: {}, ...scenario.profile } : {}, equipment: scenario.equipment || [], rooms: [] };
    this.outdoor = scenario.outdoor ? { ...unavailableOutdoor(), status: "available", provider: "scenario", fetchedAt: Date.now() / 1000, ...scenario.outdoor } : unavailableOutdoor();
    this.speed = speed;
    this.random = rng(7);
    const start = offsetS ?? scenario.demoOffsetS ?? Math.min(scenario.durationS * 0.3, 900);
    this.startWall = Date.now() / 1000 - start;
    this.cursorS = 0;
    this.serviceEvents = scenarioServiceEvents(scenario, { endT: this.startWall, householdId: "local" });
    if (withHistory) this.engine.ingestSlots(generateHistorySlots(scenario, { endT: this.startWall, days: 30, timeZone: this.timeZone, seed: 9 }), { windowS: 300, trueCo2: scenario.capabilities !== "base", source: "simulated" });
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  tick() {
    const wallNow = Date.now() / 1000;
    const target = Math.floor((wallNow - this.startWall) * this.speed);
    const offline = this.scenario.device?.offlineAfterS;
    const batch = [];
    while (this.cursorS <= target && batch.length < 4000) {
      if (offline == null || this.cursorS <= offline) {
        const reading = readingAt(this.scenario, this.cursorS, this.startWall, this.random);
        reading.timestamp = this.startWall + this.cursorS / this.speed;
        batch.push(reading);
      } else { this.cursorS = target + 1; break; }
      this.cursorS++;
    }
    if (batch.length) {
      this.engine.setConnection({ connected: offline == null || this.cursorS <= offline, heartbeatAt: wallNow });
      this.engine.ingestReadings(batch, { heartbeatAt: wallNow });
    } else if (offline != null) this.engine.setConnection({ connected: false });
    this._emit();
  }

  advance(seconds) {
    this.startWall -= seconds;
    const e = this.engine;
    for (const s of e.samples) s.t -= seconds;
    for (const s of e.slotSamples) s.t -= seconds;
    for (const s of e.archive) s.t -= seconds;
    if (e.aggregate) e.aggregate.start -= seconds;
    if (e.slotCoverage) { e.slotCoverage.from -= seconds; e.slotCoverage.to -= seconds; }
    for (const ev of e.events) { ev.startedAt -= seconds; if (ev.endedAt) ev.endedAt -= seconds; if (ev.peak) ev.peak.t -= seconds; for (const a of ev.acknowledgedActions || []) a.at -= seconds; }
    e.lastReadingAt -= seconds; e.firstSampleAt -= seconds; if (e.lastReading) e.lastReading.timestamp -= seconds;
    this.tick();
  }

  summary({ debug = false, fahrenheit = false } = {}) {
    const s = this.engine.assess({ now: Date.now() / 1000, household: this.household, outdoor: this.outdoor, serviceEvents: this.serviceEvents, contractor: null, debug, fahrenheit, includeContractor: true });
    s.roomName = this.roomName;
    return s;
  }

  series(seconds) {
    return LocalRoomSource.prototype.series.call(this, seconds);
  }

  ack(eventId, recommendationId) {
    this.engine.acknowledge(eventId, recommendationId, { at: Date.now() / 1000 });
    this._emit();
  }

  feedback(eventId, body) {
    this.engine.recordFeedback(eventId, { ...body, at: Date.now() / 1000 });
    this._emit();
  }

  _emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }

  destroy() {
    clearInterval(this.timer);
  }
}

function thin(points, max) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    const chunk = points.slice(i, i + step);
    out.push([chunk[0][0], chunk.reduce((a, p) => a + p[1], 0) / chunk.length]);
  }
  return out;
}

export { SCENARIOS };
