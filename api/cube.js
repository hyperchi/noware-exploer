// Shared cube relay for /dashboard.
// Whoever has the cube on USB (a browser tab, or the headless gateway in
// gateway/) publishes its readings and history here, and every signed-in
// viewer reads them back, so only one machine has to be connected. State is in
// memory on the single Cloud Run instance (the service runs with
// max-instances=1). The cube keeps 7 days of history itself, so when an
// instance restarts the server answers needHistory and the publisher
// re-uploads it.
//
// Every accepted live batch is also handed to the air-intelligence home
// service (lib/home-service.js) through the onLive hook, which is where
// events, baselines and contractor insights are derived.
import express from 'express';

const LIVE_WINDOW_S = 3600;
const ONLINE_WINDOW_S = 20;
// A publisher that has gone quiet this long can be replaced by another machine.
const PUBLISHER_TIMEOUT_S = 30;
const MAX_BATCH = 300;
const MAX_SLOTS = 4032;
const READING_NUMBERS = ['temperatureC', 'humidity', 'vocLevel', 'eco2', 'etvoc', 'co2', 'lux', 'aqiUba', 'pm1', 'pm25', 'pm4', 'pm10', 'uptimeMs'];
const READING_FLAGS = ['isPro', 'hasTrueCo2', 'hasLux', 'pmPresent', 'pmValid', 'warmingUp', 'tempValid', 'humValid', 'co2Valid', 'etvocValid', 'sensorMissing', 'frcNeeded'];
const SOURCES = new Set(['physical', 'simulated', 'replay']);
const SLOT_FIELD = /^(temp|hum|voc|co2|etvoc|pm25)(Avg|Min|Max)$/;

const now = () => Date.now() / 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function createCubeStore() {
  return {
    publisher: null, // {id, email, kind, lastSeen}
    meta: {name: 'noware', isPro: false, fwVersion: '', ledPercent: null, source: 'physical', deviceKey: '', roomId: '', roomName: ''},
    live: [],
    slots: [],
    windowS: 300,
    historyVersion: 0,
    lastSyncedAt: 0,
  };
}

export function cleanReading(r, offset = 0) {
  if (!r || typeof r !== 'object' || !finite(r.timestamp)) return null;
  const out = {timestamp: r.timestamp + offset};
  for (const key of READING_NUMBERS) out[key] = finite(r[key]) ? r[key] : 0;
  for (const key of READING_FLAGS) out[key] = r[key] === true;
  // Readings without validity flags come from older publishers: trust them
  // the way the old dashboard did, rather than withholding every channel.
  if (r.tempValid === undefined) out.tempValid = true;
  if (r.humValid === undefined) out.humValid = true;
  if (r.etvocValid === undefined) out.etvocValid = true;
  if (r.co2Valid === undefined) out.co2Valid = out.hasTrueCo2 || out.isPro;
  if (r.hasTrueCo2 === undefined) out.hasTrueCo2 = out.isPro;
  out.fwVersion = str(r.fwVersion, 20);
  out.ensStatus = str(r.ensStatus, 20);
  out.source = SOURCES.has(r.source) ? r.source : 'physical';
  return out;
}

function cleanSlot(s, offset) {
  if (!s || typeof s !== 'object' || !Number.isInteger(s.sequence) || !finite(s.timestamp)) return null;
  const out = {sequence: s.sequence, timestamp: s.timestamp + offset};
  for (const [key, value] of Object.entries(s)) if (SLOT_FIELD.test(key) && finite(value)) out[key] = value;
  return out;
}

function cleanMeta(meta, previous) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return {
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 60) : previous.name,
    isPro: m.isPro === true,
    fwVersion: str(m.fwVersion, 20),
    ledPercent: finite(m.ledPercent) ? m.ledPercent : null,
    source: SOURCES.has(m.source) ? m.source : 'physical',
    deviceKey: str(m.deviceKey, 64),
    roomId: str(m.roomId, 64),
    roomName: str(m.roomName, 60),
  };
}

/**
 * Bearer-token authentication for headless publishers (the Mac mini gateway).
 * Tokens come from the GATEWAY_TOKENS environment variable, comma separated,
 * each at least 32 characters. When the variable is unset no gateway can
 * publish; browser publishers always use the normal Google session instead.
 */
export function gatewayPrincipal(req, env = process.env) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  const allowed = (env.GATEWAY_TOKENS || '').split(',').map(t => t.trim()).filter(t => t.length >= 32);
  if (!token || !allowed.includes(token)) return null;
  return {kind: 'gateway', email: str(req.headers['x-noware-gateway'] || 'gateway', 60), token};
}

export function cubeRouter(store = createCubeStore(), {onLive, onHistory} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  // Only this site's pages may publish from a browser; JSON bodies also force
  // a CORS preflight. Gateways send no Origin header and authenticate with a
  // bearer token instead (see gatewayPrincipal).
  const origins = [process.env.APP_ORIGIN || 'https://noware.so', ...(process.env.ADDITIONAL_AUTH_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)];
  function claim(req, res) {
    const gateway = req.gateway || null;
    if (!gateway && process.env.NODE_ENV === 'production' && !origins.includes(req.headers.origin)) {
      res.status(403).json({error: 'Request origin not allowed.'});
      return null;
    }
    const {publisher, sentAt} = req.body || {};
    if (typeof publisher !== 'string' || publisher.length < 8 || publisher.length > 64 || !finite(sentAt)) {
      res.status(400).json({error: 'Invalid publish request.'});
      return null;
    }
    const current = store.publisher;
    if (current && current.id !== publisher && now() - current.lastSeen < PUBLISHER_TIMEOUT_S) {
      res.status(409).json({error: 'Another machine is already sharing a cube.', publisher: current.email});
      return null;
    }
    if (!current || current.id !== publisher) {
      // A new source: its history and timeline replace the previous one's.
      Object.assign(store, createCubeStore(), {historyVersion: store.historyVersion + 1});
    }
    store.publisher = {id: publisher, email: gateway ? gateway.email : (req.session?.email || ''), kind: gateway ? 'gateway' : 'browser', lastSeen: now()};
    // Timestamps come from the publisher's clock; shift them onto the server's.
    return now() - sentAt;
  }

  router.post('/live', express.json({limit: '256kb'}), (req, res) => {
    const offset = claim(req, res);
    if (offset == null) return;
    const readings = Array.isArray(req.body.readings) ? req.body.readings.slice(-MAX_BATCH) : [];
    const accepted = [];
    for (const raw of readings) {
      const reading = cleanReading(raw, offset);
      if (reading && (!store.live.length || reading.timestamp > store.live.at(-1).timestamp)) {
        store.live.push(reading);
        accepted.push(reading);
      }
    }
    const cutoff = now() - LIVE_WINDOW_S;
    while (store.live.length && store.live[0].timestamp < cutoff) store.live.shift();
    store.meta = cleanMeta(req.body.meta, store.meta);
    if (accepted.length) {
      try { onLive?.(accepted, store); } catch (err) { console.error('onLive failed', err); }
    }
    res.json({ok: true, needHistory: store.slots.length === 0});
  });

  router.post('/history', express.json({limit: '3mb'}), (req, res) => {
    const offset = claim(req, res);
    if (offset == null) return;
    const slots = (Array.isArray(req.body.slots) ? req.body.slots.slice(-MAX_SLOTS) : [])
      .map(s => cleanSlot(s, offset)).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    store.slots = slots;
    store.windowS = finite(req.body.windowS) && req.body.windowS > 0 ? req.body.windowS : 300;
    store.lastSyncedAt = now();
    store.historyVersion++;
    try { onHistory?.(slots, store); } catch (err) { console.error('onHistory failed', err); }
    res.json({ok: true, slots: slots.length});
  });

  router.get('/', (req, res) => {
    const url = new URL(req.originalUrl, 'https://localhost');
    const liveSince = Number(url.searchParams.get('live_since')) || 0;
    const haveVersion = Number(url.searchParams.get('history_version'));
    const last = store.live.at(-1) || null;
    const body = {
      serverNow: now(),
      active: Boolean(store.publisher && (last || store.slots.length)),
      yours: Boolean(store.publisher && store.publisher.id === url.searchParams.get('me')),
      online: Boolean(last && now() - last.timestamp < ONLINE_WINDOW_S),
      publisher: store.publisher?.email || '',
      publisherKind: store.publisher?.kind || '',
      lastHeartbeat: store.publisher?.lastSeen || 0,
      lastReadingAt: last ? last.timestamp : 0,
      meta: store.meta,
      live: store.live.filter(r => r.timestamp > liveSince),
      historyVersion: store.historyVersion,
      windowS: store.windowS,
      lastSyncedAt: store.lastSyncedAt,
    };
    if (haveVersion !== store.historyVersion) body.slots = store.slots;
    res.json(body);
  });

  return router;
}
