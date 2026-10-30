/* Outdoor PM2.5 from the nearest US EPA AirNow monitor, using AirNow's public
 * hourly files. No key is needed. AirNow data is preliminary. US coverage only. */
const BASE = 'https://files.airnowtech.org/airnow/today';
const HOURS = 12;
const MAX_KM = 50;
const SITES_TTL_S = 24 * 3600;

export function parseSites(text) {
  const sites = [];
  for (const line of text.split('\n')) {
    const f = line.split('|');
    if (f[1] !== 'PM2.5' || f[4] !== 'Active') continue;
    const latitude = Number(f[8]), longitude = Number(f[9]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) sites.push({ id: f[0], name: f[3], latitude, longitude });
  }
  return sites;
}

export function parseHourly(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const f = line.split('|');
    if (f[5] !== 'PM2.5' || f[6] !== 'UG/M3') continue;
    const value = Number(f[7]);
    if (f[7] !== '' && Number.isFinite(value) && value >= 0) values.set(f[2], value);
  }
  return values;
}

export const distanceKm = (a, b) => {
  const rad = Math.PI / 180, x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad), y = (b.latitude - a.latitude) * rad;
  return Math.hypot(x, y) * 6371;
};

const fileHour = t => new Date(t * 1000).toISOString().slice(0, 13).replace(/[-T]/g, '');

export class AirNowClient {
  constructor({ fetchImpl = fetch } = {}) { this.fetch = fetchImpl; this.hours = new Map(); this.sites = null; this.sitesAt = 0; }
  async text(url) {
    const r = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error(`AirNow unavailable (${r.status})`);
    return r.text();
  }
  async loadSites(now) {
    if (this.sites && now - this.sitesAt < SITES_TTL_S) return this.sites;
    const text = await this.text(`${BASE}/monitoring_site_locations.dat`);
    if (!text) throw new Error('AirNow monitor list unavailable');
    this.sites = parseSites(text); this.sitesAt = now;
    return this.sites;
  }
  /** A published hour is kept; an hour that is not published yet is asked for again. */
  async loadHours(now) {
    const through = Math.floor(now / 3600) * 3600;
    const wanted = Array.from({ length: HOURS }, (_, i) => through - (i + 1) * 3600);
    await Promise.all(wanted.filter(t => !this.hours.has(t)).map(async t => {
      const text = await this.text(`${BASE}/HourlyData_${fileHour(t)}.dat`);
      if (text) this.hours.set(t, parseHourly(text));
    }));
    for (const t of this.hours.keys()) if (!wanted.includes(t)) this.hours.delete(t);
    return wanted.filter(t => this.hours.has(t)).sort((a, b) => a - b);
  }
  /** Nearest monitor with a reading in the last 3 hours, or null when none is close. */
  async nearest(location, now) {
    const [sites, hours] = await Promise.all([this.loadSites(now), this.loadHours(now)]);
    const recent = hours.slice(-3);
    const candidates = sites.map(site => ({ ...site, km: distanceKm(location, site) })).filter(s => s.km <= MAX_KM).sort((a, b) => a.km - b.km);
    for (const site of candidates) {
      if (recent.filter(t => this.hours.get(t).has(site.id)).length < 2) continue;
      return { site, hourlyPm25: hours.filter(t => this.hours.get(t).has(site.id)).map(t => ({ t, value: this.hours.get(t).get(site.id) })) };
    }
    return null;
  }
}
