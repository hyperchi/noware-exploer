/* Server-only regional outdoor provider. Coarse area only, no IP geolocation.
 * No upstream AQI index is used: PM concentrations enter our shared EPA math.
 */
import { unavailableOutdoor } from './air-intelligence/outdoor.js';

export function coarseLocation(value) {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  return { latitude: Math.round(value.latitude * 10) / 10, longitude: Math.round(value.longitude * 10) / 10,
    label: typeof value.label === 'string' ? value.label.trim().slice(0, 100) : 'Approximate location', precision: 'area', enabled: true };
}

export class OpenMeteoOutdoorProvider {
  constructor({ fetchImpl = fetch, clock = () => Date.now() / 1000, apiKey = process.env.OPEN_METEO_API_KEY, production = process.env.NODE_ENV === 'production' } = {}) {
    this.fetch = fetchImpl; this.clock = clock; this.apiKey = apiKey; this.production = production;
    this.cache = new Map(); this.pending = new Map();
  }
  url(service, path) {
    const u = new URL(`https://${this.apiKey ? 'customer-' : ''}${service}.open-meteo.com/v1/${path}`);
    if (this.apiKey) u.searchParams.set('apikey', this.apiKey);
    return u;
  }
  async json(url) {
    const r = await this.fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Outdoor service unavailable. Try again shortly.');
    const data = await r.json(); if (data.error) throw new Error('Outdoor service unavailable.'); return data;
  }
  async cached(key, fetcher, ttl = 600) {
    const old = this.cache.get(key);
    if (old && this.clock() < old.expires) return old.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = (async () => {
      let value;
      try { value = await fetcher(); }
      catch { value = unavailableOutdoor('Outdoor service is temporarily unavailable.'); }
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { value, expires: this.clock() + (value.status === 'unavailable' ? 60 : ttl) });
      return value;
    })();
    this.pending.set(key, promise);
    try { return await promise; } finally { this.pending.delete(key); }
  }
  async getOutdoor({ location }) {
    if (!location?.enabled) return unavailableOutdoor('Choose an area to compare your room with outdoor air.');
    const area = coarseLocation(location);
    if (!area) return unavailableOutdoor('Choose a valid area.');
    if (this.production && !this.apiKey) return unavailableOutdoor('The outdoor data service needs configuration.');
    return this.cached(`air:${area.latitude}:${area.longitude}`, async () => {
      const u = this.url('air-quality-api', 'air-quality');
      for (const [k, v] of Object.entries({ latitude: area.latitude, longitude: area.longitude, hourly: 'pm2_5', current: 'pm2_5', past_days: 1, forecast_days: 1, timeformat: 'unixtime', timezone: 'GMT' })) u.searchParams.set(k, v);
      const data = await this.json(u), now = this.clock();
      if (!Number.isFinite(data.current?.time) || data.current.time < now - 7200 || data.current.time > now + 900 || data.hourly_units?.pm2_5 !== 'μg/m³') return unavailableOutdoor('The outdoor provider has no recent usable data.');
      const through = Math.floor(now / 3600) * 3600;
      const hourlyPm25 = Array.isArray(data.hourly?.time) ? data.hourly.time.map((t, i) => ({ t, value: data.hourly.pm2_5?.[i] })).filter(p => Number.isFinite(p.t) && p.t >= through - 24 * 3600 && p.t < through && Number.isFinite(p.value) && p.value >= 0) : [];
      if (!hourlyPm25.length) return unavailableOutdoor('Outdoor PM2.5 history is unavailable.');
      return { ...unavailableOutdoor(), status: 'available', reason: null, pm25: Number.isFinite(data.current.pm2_5) && data.current.pm2_5 >= 0 ? data.current.pm2_5 : null,
        hourlyPm25, kind: 'modeled', provider: 'Open-Meteo / CAMS', fetchedAt: now, observedAt: data.current.time,
        resolution: 'Regional estimate (about 11–45 km)', attributionUrl: 'https://open-meteo.com/en/docs/air-quality-api', wildfireSmoke: null };
    });
  }
  // US ZIP codes need no Open-Meteo key, so an area can be set before one is configured.
  async searchZip(zip) {
    const r = await this.fetch(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('ZIP code lookup is temporarily unavailable.');
    const place = (await r.json()).places?.[0];
    const area = place && coarseLocation({ latitude: Number(place.latitude), longitude: Number(place.longitude), label: `${place['place name']}, ${place['state abbreviation']} ${zip}` });
    return area ? [area] : [];
  }
  async searchLocations(query) {
    if (/^\d{5}$/.test(query.trim())) return this.searchZip(query.trim());
    if (this.production && !this.apiKey) throw new Error('City search is not configured yet. Enter a 5-digit US ZIP code.');
    const u = this.url('geocoding-api', 'search');
    u.searchParams.set('name', query); u.searchParams.set('count', '5'); u.searchParams.set('language', 'en');
    const result = await this.cached(`city:${query.toLowerCase()}`, async () => {
      const data = await this.json(u);
      return (data.results || []).map(p => coarseLocation({ latitude: p.latitude, longitude: p.longitude, label: [...new Set([p.name, p.admin1, p.country].filter(Boolean))].join(', ') })).filter(Boolean);
    }, 3600);
    if (!Array.isArray(result)) throw new Error('City search is temporarily unavailable.');
    return result;
  }
}
