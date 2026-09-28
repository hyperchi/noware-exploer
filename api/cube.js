// Shared cube relay for /dashboard.
// The browser with the cube on USB publishes its readings and history here, and
// every other signed-in viewer reads them back, so only one laptop has to be
// connected. State is in memory on the single Cloud Run instance (the service
// runs with max-instances=1). The cube keeps 7 days of history itself, so when
// an instance restarts the server answers needHistory and the publisher
// re-uploads it.
import express from 'express';

const LIVE_WINDOW_S = 3600;
const ONLINE_WINDOW_S = 20;
// A publisher that has gone quiet this long can be replaced by another laptop.
const PUBLISHER_TIMEOUT_S = 30;
const MAX_BATCH = 300;
const MAX_SLOTS = 4032;
const READING_NUMBERS = ['temperatureC', 'humidity', 'vocLevel', 'eco2', 'etvoc', 'co2', 'lux', 'aqiUba'];
const SLOT_FIELD = /^(temp|hum|voc|co2|etvoc)(Avg|Min|Max)$/;

const now = () => Date.now() / 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function createCubeStore() {
  return {
    publisher: null, // {id, email, lastSeen}
    meta: {name: 'noware', isPro: false, fwVersion: '', ledPercent: null},
    live: [],
    slots: [],
    windowS: 300,
    historyVersion: 0,
    lastSyncedAt: 0,
  };
}

function cleanReading(r, offset) {
  if (!r || typeof r !== 'object' || !finite(r.timestamp)) return null;
  const out = {timestamp: r.timestamp + offset, isPro: r.isPro === true, frcNeeded: false};
  for (const key of READING_NUMBERS) out[key] = finite(r[key]) ? r[key] : 0;
  out.fwVersion = typeof r.fwVersion === 'string' ? r.fwVersion.slice(0, 20) : '';
  return out;
}

function cleanSlot(s, offset) {
  if (!s || typeof s !== 'object' || !Number.isInteger(s.sequence) || !finite(s.timestamp)) return null;
  const out = {sequence: s.sequence, timestamp: s.timestamp + offset};
  for (const [key, value] of Object.entries(s)) if (SLOT_FIELD.test(key) && finite(value)) out[key] = value;
  return out;
}

export function cubeRouter(store = createCubeStore()) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });

  // Only this site's pages may publish; JSON bodies also force a CORS preflight.
  const origins = [process.env.APP_ORIGIN || 'https://noware.so', ...(process.env.ADDITIONAL_AUTH_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)];
  function claim(req, res) {
    if (process.env.NODE_ENV === 'production' && !origins.includes(req.headers.origin)) {
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
      res.status(409).json({error: 'Another laptop is already sharing a cube.', publisher: current.email});
      return null;
    }
    if (!current || current.id !== publisher) {
      // A new source: its history and timeline replace the previous one's.
      Object.assign(store, createCubeStore(), {historyVersion: store.historyVersion + 1});
    }
    store.publisher = {id: publisher, email: req.session?.email || '', lastSeen: now()};
    // Timestamps come from the publisher's clock; shift them onto the server's.
    return now() - sentAt;
  }

  router.post('/live', express.json({limit: '256kb'}), (req, res) => {
    const offset = claim(req, res);
    if (offset == null) return;
    const readings = Array.isArray(req.body.readings) ? req.body.readings.slice(-MAX_BATCH) : [];
    for (const raw of readings) {
      const reading = cleanReading(raw, offset);
      if (reading && (!store.live.length || reading.timestamp > store.live.at(-1).timestamp)) store.live.push(reading);
    }
    const cutoff = now() - LIVE_WINDOW_S;
    while (store.live.length && store.live[0].timestamp < cutoff) store.live.shift();
    const meta = req.body.meta || {};
    store.meta = {
      name: typeof meta.name === 'string' ? meta.name.slice(0, 60) : store.meta.name,
      isPro: meta.isPro === true,
      fwVersion: typeof meta.fwVersion === 'string' ? meta.fwVersion.slice(0, 20) : '',
      ledPercent: finite(meta.ledPercent) ? meta.ledPercent : null,
    };
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
