// Contractor API: prioritized customers, per-home evidence, signal status and
// service-event records. A contractor only ever sees households that have an
// active relationship with their company and have consented to share.
import express from 'express';
import { principalFor, canActAsContractor, contractorHouseholds, contractorViewOfHousehold } from '../lib/authz.js';
import { SERVICE_EVENT_TYPES, SIGNAL_STATUSES, EQUIPMENT_TYPES } from '../lib/air-intelligence/index.js';

const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function contractorRouter({ store, service, env = process.env }) {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.session?.gateway) return res.status(403).json({ error: 'Gateways may only publish readings.' });
    req.principal = principalFor(req.session, store, { env });
    if (!req.principal) return res.status(401).json({ error: 'Sign in required.' });
    if (!req.principal.roles.includes('contractor') && !req.principal.isAdmin) return res.status(403).json({ error: 'Contractor access only.' });
    next();
  });

  router.get('/me', (req, res) => {
    res.json({ email: req.principal.email, contractors: req.principal.contractorIds.map((id) => ({ id, name: store.getContractor(id)?.name })) });
  });

  router.get('/customers', async (req, res) => {
    const ids = req.principal.isAdmin ? Object.keys(store.state.contractors) : req.principal.contractorIds;
    const merged = { counts: { needs_attention: 0, recurring: 0, improved: 0, all: 0 }, homes: [] };
    for (const id of ids) {
      const out = await service.customersFor(id);
      for (const k of Object.keys(merged.counts)) merged.counts[k] += out.counts[k];
      merged.homes.push(...out.homes.map((h) => ({ ...h, contractorId: id })));
    }
    res.json(merged);
  });

  const loadCustomer = (req, res, next) => {
    const entry = contractorHouseholds(req.principal, store).find((x) => x.household.id === req.params.householdId);
    if (!entry) return res.status(403).json({ error: 'This home is not shared with you.' });
    req.household = entry.household;
    req.contractorId = entry.contractorId;
    next();
  };

  router.get('/customers/:householdId', loadCustomer, async (req, res) => {
    const h = req.household;
    const { home, rooms, insights, signals } = await service.summaryForHousehold(h);
    res.json({
      household: contractorViewOfHousehold(h),
      home,
      rooms: rooms.map((r) => ({
        roomId: r.roomId, roomName: r.roomName, deviceHealth: r.deviceHealth, currentStatus: r.currentStatus, measurements: r.measurements,
        activeEvents: r.activeEvents.map((e) => ({ id: e.id, category: e.category, channel: e.channel, headline: e.headline, startedAt: e.startedAt, durationMinutes: e.durationMinutes, severity: e.severity, hypothesis: e.hypothesis && { source: e.hypothesis.source, label: e.hypothesis.label, confidence: e.hypothesis.confidence.level }, measurement: e.measurement, acknowledgedActions: (e.acknowledgedActions || []).map((a) => ({ title: a.title, at: a.at })), recovery: e.recovery })),
        patterns: r.patterns, timeline: r.timeline, source: r.source,
      })),
      insights,
      signals,
      serviceEvents: store.serviceEventsFor(h.id),
      contactRequests: store.contactRequestsFor({ householdId: h.id, contractorId: req.contractorId }).map((c) => ({ id: c.id, type: c.type, createdAt: c.createdAt, status: c.status, payload: c.payload })),
      relationship: store.assignmentFor(h.id),
    });
  });

  router.post('/signals/:id/status', (req, res) => {
    const signal = store.state.signals[req.params.id];
    if (!signal) return res.status(404).json({ error: 'Signal not found.' });
    const allowed = contractorHouseholds(req.principal, store).some((x) => x.household.id === signal.householdId);
    if (!allowed) return res.status(403).json({ error: 'This home is not shared with you.' });
    const status = SIGNAL_STATUSES.includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'Invalid status.' });
    res.json({ ok: true, signal: store.setSignalStatus(signal.id, status, req.principal.email) });
  });

  router.post('/customers/:householdId/service-events', loadCustomer, (req, res) => {
    if (!canActAsContractor(req.principal, req.contractorId)) return res.status(403).json({ error: 'Not allowed.' });
    const { type, occurredAt, equipment, notes } = req.body || {};
    if (!SERVICE_EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid service event type.' });
    const at = Number.isFinite(occurredAt) ? occurredAt : Date.now() / 1000;
    const eq = equipment && EQUIPMENT_TYPES.includes(equipment.type) ? { type: equipment.type, label: str(equipment.label, 80) || equipment.type } : null;
    const ev = store.addServiceEvent({ householdId: req.household.id, contractorId: req.contractorId, type, occurredAt: at, equipment: eq, notes: str(notes, 500), by: req.principal.email });
    if (eq && type === 'equipment_installation') {
      const h = req.household;
      if (!h.equipment.some((e) => e.type === eq.type)) store.upsertHousehold({ ...h, equipment: [...h.equipment, { id: `eq-${Date.now()}`, type: eq.type, label: eq.label, installedAt: at }] });
    }
    res.json({ ok: true, serviceEvent: ev });
  });

  return router;
}
