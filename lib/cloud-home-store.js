// Small single-instance deployment: one private GCS snapshot using the Cloud
// Run runtime identity. Generation preconditions reject competing writers.
// There is no service-account key, public bucket, or browser credential.
import { HomeStore, emptyState } from './home-store.js';

export class CloudHomeStore extends HomeStore {
  constructor({ bucket, object = 'air-intelligence/home-store.json', fetchImpl = fetch, tokenProvider } = {}) {
    super();
    this.bucket = bucket; this.object = object; this.fetch = fetchImpl;
    this.tokenProvider = tokenProvider; this.generation = '0';
    this.pending = Promise.resolve(); this.lastError = null;
    this.ready = this.loadCloud();
  }
  async headers() {
    if (this.tokenProvider) return { Authorization: `Bearer ${await this.tokenProvider()}` };
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      const r = await this.fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Runtime identity unavailable (${r.status})`);
      const t = await r.json(); this.accessToken = t.access_token;
      this.tokenExpiresAt = Date.now() + Math.max(0, t.expires_in - 60) * 1000;
    }
    return { Authorization: `Bearer ${this.accessToken}` };
  }
  url() { return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.object)}`; }
  async loadCloud() {
    const headers = await this.headers();
    const meta = await this.fetch(this.url(), { headers, signal: AbortSignal.timeout(7000) });
    if (meta.status === 404) return;
    if (!meta.ok) throw new Error(`Cannot load air store (${meta.status})`);
    const { generation } = await meta.json();
    const r = await this.fetch(`${this.url()}?alt=media&generation=${generation}`, { headers, signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`Cannot read air store (${r.status})`);
    const state = await r.json();
    if (state?.version !== 1) throw new Error('Unsupported air store version');
    this.state = { ...emptyState(), ...state }; this.generation = generation;
  }
  touch() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush().catch(e => { this.lastError = e.message; console.error('air store persistence failed:', e.message); this.touch(); }); }, 30000);
    this._timer.unref?.();
  }
  flush() {
    const snapshot = JSON.stringify(this.state);
    const write = async () => {
      await this.ready;
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(this.object)}&ifGenerationMatch=${this.generation}`;
      const r = await this.fetch(url, { method: 'POST', headers: { ...await this.headers(), 'Content-Type': 'application/json' }, body: snapshot, signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error(r.status === 412 ? 'Concurrent store writer: snapshot was not overwritten. Run one instance without overlapping revisions.' : `Cannot persist air store (${r.status})`);
      this.generation = (await r.json()).generation; this.lastError = null;
    };
    this.pending = this.pending.catch(() => {}).then(write);
    return this.pending;
  }
}
