/* Home store: households, rooms, equipment, contractors, assignments, service
 * events, contact requests, opportunity-signal status, feedback, and the
 * per-device engine state.
 *
 * Repository abstraction with two backends today: memory (Cloud Run, whose
 * filesystem is ephemeral and which runs one instance) and a JSON file for
 * local development and the Mac mini. Swapping in Firestore later means
 * implementing the same handful of methods; nothing else in the app reads
 * storage directly.
 */

import fs from 'node:fs';
import path from 'node:path';

const now = () => Date.now() / 1000;
const slug = () => Math.random().toString(36).slice(2, 10);

export function emptyState() {
  return {
    version: 1,
    households: {},       // id -> Household
    contractors: {},      // id -> Contractor
    assignments: [],      // HouseholdContractor[]
    serviceEvents: [],    // HomeServiceEvent[]
    contactRequests: [],  // {id, householdId, contractorId, type, payload, createdAt, status}
    signals: {},          // id -> OpportunitySignal (status is the part that persists)
    feedback: [],         // event feedback entries
    engines: {},          // deviceKey -> RoomEngine JSON
    devices: {},          // deviceKey -> {householdId, roomId, name, source, lastSeenAt}
  };
}

export class HomeStore {
  /** @param {{persistPath?: string}} [o] */
  constructor({ persistPath = null } = {}) {
    this.persistPath = persistPath;
    this.state = emptyState();
    this._timer = null;
    if (persistPath) this.load();
  }

  // ---------------------------------------------------------------- persist

  load() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
        if (parsed && parsed.version === 1) this.state = { ...emptyState(), ...parsed };
      }
    } catch (err) {
      console.error('home store: could not load', this.persistPath, err.message);
    }
  }

  /** Debounced write; engines are large, so never write per reading. */
  touch() {
    if (!this.persistPath) return;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 5000);
    this._timer.unref?.();
  }

  flush() {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const tmp = `${this.persistPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.persistPath);
    } catch (err) {
      console.error('home store: could not save', err.message);
    }
  }

  // ------------------------------------------------------------- households

  listHouseholds() {
    return Object.values(this.state.households);
  }

  getHousehold(id) {
    return this.state.households[id] || null;
  }

  upsertHousehold(h) {
    const id = h.id || `home-${slug()}`;
    const prev = this.state.households[id] || { id, createdAt: now(), members: [], rooms: [], equipment: [], deviceKeys: [], profile: {} };
    const next = { ...prev, ...h, id, updatedAt: now() };
    next.members = [...new Set((next.members || []).map((m) => m.toLowerCase()))];
    this.state.households[id] = next;
    this.touch();
    return next;
  }

  householdsForMember(email) {
    const e = (email || '').toLowerCase();
    return this.listHouseholds().filter((h) => h.members.includes(e));
  }

  addRoom(householdId, room) {
    const h = this.getHousehold(householdId);
    if (!h) return null;
    const r = { id: room.id || `room-${slug()}`, name: room.name || 'Room', type: room.type || 'other', deviceKeys: room.deviceKeys || [] };
    h.rooms.push(r);
    this.touch();
    return r;
  }

  roomOf(householdId, roomId) {
    return this.getHousehold(householdId)?.rooms.find((r) => r.id === roomId) || null;
  }

  // ---------------------------------------------------------------- devices

  getDevice(deviceKey) {
    return this.state.devices[deviceKey] || null;
  }

  attachDevice(deviceKey, { householdId, roomId, name, source }) {
    const h = this.getHousehold(householdId);
    if (!h) return null;
    for (const other of h.rooms) other.deviceKeys = (other.deviceKeys || []).filter((k) => k !== deviceKey);
    const room = h.rooms.find((r) => r.id === roomId);
    if (room && !room.deviceKeys.includes(deviceKey)) room.deviceKeys.push(deviceKey);
    if (!h.deviceKeys.includes(deviceKey)) h.deviceKeys.push(deviceKey);
    const d = { ...(this.state.devices[deviceKey] || {}), householdId, roomId, name: name || this.state.devices[deviceKey]?.name || deviceKey, source: source || 'physical', lastSeenAt: now() };
    this.state.devices[deviceKey] = d;
    this.touch();
    return d;
  }

  householdOfDevice(deviceKey) {
    const d = this.getDevice(deviceKey);
    if (d) return this.getHousehold(d.householdId);
    return this.listHouseholds().find((h) => h.deviceKeys.includes(deviceKey)) || null;
  }

  // ------------------------------------------------------------ contractors

  getContractor(id) {
    return this.state.contractors[id] || null;
  }

  upsertContractor(c) {
    const id = c.id || `contractor-${slug()}`;
    const prev = this.state.contractors[id] || { id, createdAt: now(), members: [], contact: {} };
    const next = { ...prev, ...c, id };
    next.members = [...new Set((next.members || []).map((m) => m.toLowerCase()))];
    this.state.contractors[id] = next;
    this.touch();
    return next;
  }

  contractorsForMember(email) {
    const e = (email || '').toLowerCase();
    return Object.values(this.state.contractors).filter((c) => c.members.includes(e));
  }

  assign(assignment) {
    const a = { relationshipStatus: 'active', since: now(), contactMethods: ['message', 'call', 'request_service', 'share_air_report'], shareInsights: true, ...assignment };
    this.state.assignments = this.state.assignments.filter((x) => !(x.householdId === a.householdId && x.contractorId === a.contractorId));
    this.state.assignments.push(a);
    this.touch();
    return a;
  }

  assignmentFor(householdId) {
    return this.state.assignments.find((a) => a.householdId === householdId && a.relationshipStatus === 'active') || null;
  }

  contractorFor(householdId) {
    const a = this.assignmentFor(householdId);
    return a ? this.getContractor(a.contractorId) : null;
  }

  /** Households a contractor may see: active relationship and homeowner consent. */
  householdsForContractor(contractorId) {
    return this.state.assignments
      .filter((a) => a.contractorId === contractorId && a.relationshipStatus === 'active' && a.shareInsights)
      .map((a) => this.getHousehold(a.householdId))
      .filter(Boolean);
  }

  setShareInsights(householdId, contractorId, on) {
    const a = this.state.assignments.find((x) => x.householdId === householdId && x.contractorId === contractorId);
    if (a) {
      a.shareInsights = Boolean(on);
      this.touch();
    }
    return a;
  }

  // --------------------------------------------------------- service events

  addServiceEvent(ev) {
    const e = { id: ev.id || `svc-${slug()}`, createdAt: now(), ...ev };
    this.state.serviceEvents = this.state.serviceEvents.filter((x) => x.id !== e.id);
    this.state.serviceEvents.push(e);
    this.touch();
    return e;
  }

  serviceEventsFor(householdId) {
    return this.state.serviceEvents.filter((e) => e.householdId === householdId).sort((a, b) => a.occurredAt - b.occurredAt);
  }

  // -------------------------------------------------------- contact requests

  addContactRequest(req) {
    const r = { id: `req-${slug()}`, createdAt: now(), status: 'sent', ...req };
    this.state.contactRequests.push(r);
    this.touch();
    return r;
  }

  contactRequestsFor({ householdId, contractorId }) {
    return this.state.contactRequests.filter((r) => (!householdId || r.householdId === householdId) && (!contractorId || r.contractorId === contractorId));
  }

  // ---------------------------------------------------------------- signals

  signalStatuses(householdId) {
    return Object.values(this.state.signals).filter((s) => s.householdId === householdId);
  }

  rememberSignals(signals) {
    for (const s of signals) {
      const prev = this.state.signals[s.id];
      this.state.signals[s.id] = { ...s, status: prev?.status || s.status, statusChangedAt: prev?.statusChangedAt || null, statusBy: prev?.statusBy || null };
    }
    this.touch();
  }

  setSignalStatus(id, status, by) {
    const s = this.state.signals[id];
    if (!s) return null;
    s.status = status;
    s.statusChangedAt = now();
    s.statusBy = by;
    this.touch();
    return s;
  }

  // --------------------------------------------------------------- feedback

  addFeedback(entry) {
    this.state.feedback.push(entry);
    this.touch();
  }

  // ---------------------------------------------------------------- engines

  saveEngine(deviceKey, json) {
    this.state.engines[deviceKey] = json;
    this.touch();
  }

  loadEngine(deviceKey) {
    return this.state.engines[deviceKey] || null;
  }

  engineKeys() {
    return Object.keys(this.state.engines);
  }
}

export function createHomeStore({ env = process.env } = {}) {
  const dir = env.NOWARE_DATA_DIR;
  if (dir) return new HomeStore({ persistPath: path.join(dir, 'home-store.json') });
  return new HomeStore();
}
