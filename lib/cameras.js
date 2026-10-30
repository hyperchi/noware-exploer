/* Public Caltrans District 4 (Bay Area) traffic cameras near an area. Video
 * plays directly from Caltrans in the viewer's browser; nothing is stored. */
import { distanceKm } from './airnow.js';

const FEED = 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json';
const TTL_MS = 6 * 3600 * 1000;
const MAX_KM = 5;
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

export class CameraDirectory {
  constructor({ fetchImpl = fetch } = {}) { this.fetch = fetchImpl; this.cameras = null; this.at = 0; this.pending = null; }
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
    const ranked = (await this.load()).map(({ latitude, longitude, ...c }) => ({ ...c, km: Math.round(distanceKm(location, { latitude, longitude }) * 10) / 10 })).filter(c => c.km <= MAX_KM).sort((a, b) => a.km - b.km);
    const preferred = prefer.map(id => ranked.find(c => c.id === id)).filter(Boolean);
    return [...preferred, ...ranked.filter(c => !preferred.includes(c))].slice(0, LIMIT);
  }
}
