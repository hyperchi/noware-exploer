// Homeowner API: households, air-intelligence summaries, actions, feedback,
// contractor contact and reports. Authorization is checked against the store
// on every route (lib/authz.js); the UI never decides who sees what.
import express from 'express';
import { principalFor, canViewHousehold, canEditHousehold, contractorViewOfHousehold } from '../lib/authz.js';
import { SCENARIOS, mergeProfile, ROOM_TYPES, EQUIPMENT_TYPES, CONTACT_ACTIONS } from '../lib/air-intelligence/index.js';
import { demoEnabled, seedDemo, DEMO_HOUSEHOLD_ID } from '../lib/demo-seed.js';

const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function homeRouter({ store, service, env = process.env }) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.session?.gateway) return res.status(403).json({ error: 'Gateways may only publish readings.' });
    // In demo mode the first signed-in person gets the seeded home so the
    // product can be explored without hardware. Never in production.
    // Simulations live in memory, so a restarted server re-seeds them too.
    if (demoEnabled(env) && req.session?.email && (!store.getHousehold(DEMO_HOUSEHOLD_ID)?.members.includes(req.session.email.toLowerCase()) || !service.demoRunning())) {
      seedDemo({ store, service, userEmail: req.session.email.toLowerCase(), userName: req.session.name, timeZone: env.NOWARE_TIMEZONE || 'America/Los_Angeles' });
    }
    req.principal = principalFor(req.session, store, { env });
    if (!req.principal) return res.status(401).json({ error: 'Sign in required.' });
    next();
  });

  const loadHousehold = (edit = false) => (req, res, next) => {
    const h = store.getHousehold(req.params.id);
    if (!h) return res.status(404).json({ error: 'Household not found.' });
    const ok = edit ? canEditHousehold(req.principal, h.id) : canViewHousehold(req.principal, h.id, store);
    if (!ok) return res.status(403).json({ error: 'Not allowed for this household.' });
    req.household = h;
    req.isMember = canEditHousehold(req.principal, h.id);
    next();
  };

  router.get('/me', (req, res) => {
    const p = req.principal;
    res.json({
      email: p.email,
      name: p.name,
      roles: p.roles,
      households: p.householdIds.map((id) => ({ id, name: store.getHousehold(id)?.name || id, demo: Boolean(store.getHousehold(id)?.demo) })),
      contractors: p.contractorIds.map((id) => ({ id, name: store.getContractor(id)?.name || id })),
      demo: demoEnabled(env),
    });
  });

  router.get('/scenarios', (req, res) => {
    res.json(Object.values(SCENARIOS).map((s) => ({ key: s.key, label: s.label, description: s.description, roomType: s.roomType, capabilities: s.capabilities, expect: s.expect })));
  });

  router.get('/households/:id', loadHousehold(), (req, res) => {
    const h = req.household;
    const contractor = store.contractorFor(h.id);
    const assignment = store.assignmentFor(h.id);
    const view = req.isMember ? h : contractorViewOfHousehold(h);
    res.json({
      household: { ...view, rooms: h.rooms.map((r) => ({ ...r, devices: (r.deviceKeys || []).map((k) => ({ key: k, ...(store.getDevice(k) || {}), simulation: service.simulationFor(h, r) ? service.simulationFor(h, r).scenario.key : null })) })) },
      contractor: contractor ? { id: contractor.id, name: contractor.name, tagline: contractor.tagline || '', contact: { phone: contractor.contact?.phone || null, email: contractor.contact?.email || null, messageUrl: contractor.contact?.messageUrl || null, bookingUrl: contractor.contact?.bookingUrl || null }, since: assignment?.since || null, contactMethods: assignment?.contactMethods || [], shareInsights: Boolean(assignment?.shareInsights) } : null,
      isMember: req.isMember,
      roomTypes: ROOM_TYPES,
      equipmentTypes: EQUIPMENT_TYPES,
    });
  });

  router.patch('/households/:id', loadHousehold(true), (req, res) => {
    const h = req.household;
    const body = req.body || {};
    const patch = {};
    if (body.name) patch.name = str(body.name, 60);
    if (body.timeZone) patch.timeZone = str(body.timeZone, 60);
    if (body.profile) patch.profile = mergeProfile(h.profile, body.profile);
    if (Array.isArray(body.equipment)) patch.equipment = body.equipment.slice(0, 30).filter((e) => EQUIPMENT_TYPES.includes(e.type)).map((e, i) => ({ id: str(e.id, 40) || `eq-${i}`, type: e.type, label: str(e.label, 80) || e.type, installedAt: Number.isFinite(e.installedAt) ? e.installedAt : null, details: typeof e.details === 'object' && e.details ? e.details : undefined }));
    if (Array.isArray(body.rooms)) {
      patch.rooms = body.rooms.slice(0, 30).map((r, i) => {
        const prev = h.rooms.find((x) => x.id === r.id);
        return { id: str(r.id, 40) || `room-${i}`, name: str(r.name, 40) || prev?.name || 'Room', type: ROOM_TYPES.includes(r.type) ? r.type : prev?.type || 'other', deviceKeys: prev?.deviceKeys || [] };
      });
    }
    if (typeof body.shareInsights === 'boolean') {
      const a = store.assignmentFor(h.id);
      if (a) store.setShareInsights(h.id, a.contractorId, body.shareInsights);
    }
    const updated = store.upsertHousehold({ ...h, ...patch });
    res.json({ ok: true, household: updated });
  });

  router.get('/households/:id/summary', loadHousehold(), async (req, res) => {
    const debug = req.query.debug === '1' && req.isMember;
    const fahrenheit = req.query.units === 'f';
    const out = await service.summaryForHousehold(req.household, { debug, fahrenheit });
    res.json(req.isMember ? out : stripForContractor(out));
  });

  router.get('/households/:id/rooms/:roomId/summary', loadHousehold(), async (req, res) => {
    const room = store.roomOf(req.household.id, req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    const summary = await service.summaryForRoom(req.household, room, { debug: req.query.debug === '1' && req.isMember, fahrenheit: req.query.units === 'f' });
    res.json(summary);
  });

  router.get('/households/:id/rooms/:roomId/series', loadHousehold(), (req, res) => {
    const room = store.roomOf(req.household.id, req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    const seconds = Math.min(7 * 86400, Math.max(600, Number(req.query.seconds) || 3600));
    res.json(service.seriesForRoom(req.household, room, { seconds }));
  });

  router.post('/households/:id/events/:eventId/ack', loadHousehold(true), (req, res) => {
    const recommendationId = str(req.body?.recommendationId, 40);
    if (!recommendationId) return res.status(400).json({ error: 'recommendationId required.' });
    const event = service.acknowledge(req.household, req.params.eventId, recommendationId, { by: req.principal.email });
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    res.json({ ok: true, acknowledgedActions: event.acknowledgedActions });
  });

  router.post('/households/:id/events/:eventId/feedback', loadHousehold(true), (req, res) => {
    const { correct, actualSource, note } = req.body || {};
    const entry = service.feedback(req.household, req.params.eventId, { correct: correct === true, actualSource: str(actualSource, 40) || null, note: str(note, 500), by: req.principal.email });
    if (!entry) return res.status(404).json({ error: 'Event not found.' });
    res.json({ ok: true, feedback: entry });
  });

  router.post('/households/:id/contact', loadHousehold(true), async (req, res) => {
    const type = CONTACT_ACTIONS.includes(req.body?.type) ? req.body.type : 'message';
    if (!store.contractorFor(req.household.id)) return res.status(409).json({ error: 'No service provider connected to this home.' });
    const out = await service.contact(req.household, { type, roomId: str(req.body?.roomId, 40) || null, eventId: str(req.body?.eventId, 120) || null, message: str(req.body?.message, 1000), homeowner: { name: req.principal.name, email: req.principal.email } });
    res.json({ ok: true, ...out });
  });

  router.get('/households/:id/contact-requests', loadHousehold(), (req, res) => {
    res.json(store.contactRequestsFor({ householdId: req.household.id }));
  });

  router.get('/households/:id/report', loadHousehold(), async (req, res) => {
    res.json(await service.report(req.household));
  });

  router.get('/households/:id/service-events', loadHousehold(), (req, res) => {
    res.json(store.serviceEventsFor(req.household.id));
  });

  // Simulation controls: members only, every output labelled simulated.
  router.post('/households/:id/simulate', loadHousehold(true), (req, res) => {
    const { roomId, scenario, advanceMinutes, stop } = req.body || {};
    const room = store.roomOf(req.household.id, str(roomId, 40));
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    const deviceKey = `sim:${req.household.id}:${room.id}`;
    if (stop) {
      service.stopScenario(deviceKey);
      return res.json({ ok: true, stopped: true });
    }
    if (Number.isFinite(advanceMinutes) && advanceMinutes > 0) {
      const out = service.advanceScenario(deviceKey, Math.min(240, advanceMinutes) * 60);
      return out ? res.json({ ok: true, ...out }) : res.status(404).json({ error: 'No simulation running for this room.' });
    }
    if (!SCENARIOS[scenario]) return res.status(400).json({ error: 'Unknown scenario.' });
    res.json({ ok: true, ...service.startScenario(req.household, room, scenario) });
  });

  return router;
}

/** Contractors get insights and patterns, not the homeowner's action buttons or debug. */
function stripForContractor(out) {
  return {
    ...out,
    rooms: out.rooms.map((r) => ({ ...r, debug: undefined, homeownerRecommendations: r.homeownerRecommendations.map((x) => ({ id: x.id, title: x.title, level: x.level, acknowledged: x.acknowledged, acknowledgedAt: x.acknowledgedAt })) })),
  };
}
