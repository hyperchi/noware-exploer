/* Live view from a public Caltrans camera near the home's area. Plays only while
 * on screen, directly from Caltrans, muted. Nothing is recorded. */
import { h, fill } from './ui.js';
import { homeApi } from './home-api.js';

export class OutsideCamera {
  constructor() {
    this.key = null; this.cameras = []; this.current = null; this.hls = null; this.visible = false;
    this.video = h('video', { muted: true, playsinline: true, controls: true });
    this.video.muted = true;
    this.status = h('p.simple-camera-status', { role: 'status' });
    this.updated = h('p.simple-camera-status');
    this.picker = h('div.simple-event-picker');
    this.el = h('section.simple-section.simple-camera', { hidden: true },
      h('div.simple-section-head', h('div', h('h2', { text: 'Outside, live' }), h('p', { text: 'A public Caltrans traffic camera near this area. It shows conditions, not air quality.' }))),
      this.picker, h('div.simple-camera-frame', this.video), this.status, this.updated);
    new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; this.sync(); }, { threshold: 0.2 }).observe(this.el);
    document.addEventListener('visibilitychange', () => this.sync());
  }

  setHousehold(id, location) {
    const key = id && location?.enabled ? `${id}/${location.latitude}/${location.longitude}` : null;
    if (key === this.key) return;
    this.key = key; this.householdId = id; this.stop(); this.cameras = []; this.current = null; this.el.hidden = true;
    if (!key) return;
    homeApi.cameras(id).then(({ cameras, checkedAt }) => {
      this.checkedAt = checkedAt;
      if (key !== this.key || !cameras.length) return;
      this.cameras = cameras; this.el.hidden = false; this.select(cameras[0]);
    }).catch(() => {});
  }

  select(camera) {
    this.stop(); this.current = camera;
    this.video.poster = camera.imageUrl || '';
    this.updated.textContent = '';
    fill(this.picker, ...this.cameras.map(c => h(`button.simple-button${c === camera ? '.primary' : ''}`, { type: 'button', text: c.name, 'aria-pressed': String(c === camera), onclick: () => this.select(c) })));
    this.status.textContent = '';
    this.sync();
  }

  sync() {
    if (this.current && this.visible && !document.hidden) this.start();
    else this.stop();
  }

  async start() {
    if (this.playing === this.current) return;
    const camera = this.playing = this.current;
    const failed = () => { if (this.playing === camera) { this.stop(); this.status.textContent = 'Live video is unavailable from this camera. Showing its latest snapshot.'; } };
    try {
      const { default: Hls } = await import('../vendor/hls/hls.light.mjs');
      if (this.playing !== camera) return;
      if (Hls.isSupported()) {
        this.hls = new Hls({ liveDurationInfinity: true, maxBufferLength: 20 });
        this.hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) failed(); });
        this.hls.loadSource(camera.streamUrl);
        this.hls.attachMedia(this.video);
      } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this.video.src = camera.streamUrl;
      } else return failed();
      this.status.textContent = `Live · ${camera.name} · about ${Math.max(0.1, camera.km)} km from this area's center · Caltrans${this.checkedAt ? ` · Cameras checked ${new Date(this.checkedAt * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`;
      this.showUpdated(camera);
      this.updatedTimer = setInterval(() => this.showUpdated(camera), 60000);
      await this.video.play().catch(() => {});
    } catch { failed(); }
  }

  /* The video carries no clock, so this reports Caltrans' own snapshot time. */
  async showUpdated(camera) {
    const { updatedAt } = await homeApi.cameraUpdated(this.householdId, camera.id).catch(() => ({}));
    if (camera !== this.current) return;
    if (!updatedAt) { this.updated.textContent = ''; return; }
    const minutes = Math.max(0, Math.round((Date.now() / 1000 - updatedAt) / 60));
    this.updated.textContent = `Latest Caltrans snapshot: ${minutes < 1 ? 'just now' : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`}. This is the snapshot's time. The video itself has no clock.`;
  }

  stop() {
    this.playing = null;
    clearInterval(this.updatedTimer);
    this.hls?.destroy(); this.hls = null;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
  }
}
