/* Public Caltrans District 4 (Bay Area) traffic cameras near an area. Video
 * plays directly from Caltrans in the viewer's browser; nothing is stored. */
import { distanceKm } from './airnow.js';

const FEED = 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json';
const TTL_MS = 6 * 3600 * 1000;
export const MAX_KM = 5;
const LIMIT = 8;

export function parseCameras(data) {
  const out = [];
  for (const { cctv: c } of data?.data || []) {
    const latitude = Number(c?.location?.latitude), longitude = Number(c?.location?.longitude), streamUrl = c?.imageData?.streamingVideoURL;
    if (c?.inService !== 'true' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^https:\/\/\S+\.m3u8$/.test(streamUrl || '')) continue;
    const name = String(c.location.locationName || '');
    out.push({ id: name.split(' ')[0], name: name.replace(/^\S+\s+--\s+/, '').trim(), latitude, longitude, streamUrl, imageUrl: c.imageData.static?.currentImageURL || null });
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mediaLines = text => text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

/** Working means new video segments keep arriving and the newest one downloads. */
export async function probeStream(url, { fetchImpl = fetch, waitMs = 25000 } = {}) {
  const get = async target => {
    const r = await fetchImpl(target, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  const read = async target => {
    const text = await (await get(target)).text(), sequence = Number(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1]);
    if (!Number.isFinite(sequence)) throw new Error('no live playlist');
    return { sequence, segments: mediaLines(text) };
  };
  try {
    const master = await (await get(url)).text();
    const child = master.includes('#EXT-X-MEDIA-SEQUENCE') ? url : new URL(mediaLines(master)[0], url).href;
    const first = await read(child);
    await sleep(waitMs);
    const second = await read(child);
    if (second.sequence <= first.sequence) return { ok: false, reason: 'stream is frozen: no new segments' };
    const segment = await get(new URL(second.segments.at(-1), child).href);
    if (!(await segment.arrayBuffer()).byteLength) return { ok: false, reason: 'empty video segment' };
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: err.message || 'unreachable' };
  }
}

/** Probe a few at a time. A failure is retried once so a blip does not condemn a camera. */
export async function checkCameras(cameras, { probe = probeStream, concurrency = 4 } = {}) {
  const queue = [...cameras], results = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let result = await probe(c.streamUrl);
      if (!result.ok) result = await probe(c.streamUrl);
      results.push({ id: c.id, name: c.name, streamUrl: c.streamUrl, ...result });
    }
  }));
  return results;
}

export const withinKm = (cameras, location, km = MAX_KM) => cameras.map(({ latitude, longitude, ...c }) => ({ ...c, km: Math.round(distanceKm(location, { latitude, longitude }) * 10) / 10 })).filter(c => c.km <= km).sort((a, b) => a.km - b.km);

export class CameraDirectory {
  constructor({ fetchImpl = fetch, probe = probeStream, clock = Date.now, random = Math.random } = {}) {
    this.fetch = fetchImpl; this.probe = probe; this.clock = clock; this.random = random;
    this.cameras = null; this.at = 0; this.pending = null;
    this.failed = new Set(); this.checkedAt = null; this.nextCheckAt = new Map(); this.checking = new Set();
  }
  /** Runs in the background, at most once per area every 6 to 10 hours. */
  spotCheck(key, nearby) {
    if (this.clock() < (this.nextCheckAt.get(key) || 0) || this.checking.has(key)) return;
    this.checking.add(key);
    this.nextCheckAt.set(key, this.clock() + (6 + this.random() * 4) * 3600 * 1000);
    return checkCameras(nearby, { probe: this.probe }).then(results => {
      const bad = results.filter(r => !r.ok);
      console.log(`camera spot check: ${results.length - bad.length} ok, ${bad.length} failing${bad.length ? `: ${bad.map(r => `${r.name} (${r.reason})`).join('; ')}` : ''}`);
      // If everything failed the likely fault is this check, so hide nothing.
      if (bad.length === results.length) return;
      for (const r of results) { if (r.ok) this.failed.delete(r.id); else this.failed.add(r.id); }
      this.checkedAt = this.clock() / 1000;
    }).catch(err => console.error('camera spot check failed:', err.message)).finally(() => this.checking.delete(key));
  }
  async load() {
    if (this.cameras && Date.now() - this.at < TTL_MS) return this.cameras;
    this.pending ||= (async () => {
      const r = await this.fetch(FEED, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Caltrans unavailable (${r.status})`);
      this.cameras = parseCameras(await r.json()); this.at = Date.now();
      return this.cameras;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  /** Named cameras first, then the nearest in-service ones. */
  async near(location, { prefer = [] } = {}) {
    const nearby = withinKm(await this.load(), location);
    this.lastCheck = this.spotCheck(`${location.latitude}:${location.longitude}`, nearby);
    const ranked = nearby.filter(c => !this.failed.has(c.id));
    const preferred = prefer.map(id => ranked.find(c => c.id === id)).filter(Boolean);
    return [...preferred, ...ranked.filter(c => !preferred.includes(c))].slice(0, LIMIT);
  }
}
