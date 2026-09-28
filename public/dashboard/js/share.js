/* Team sharing through noware.so.
 *
 * The browser with the cube on USB publishes its readings and history to
 * /api/cube, and every other signed-in viewer polls it and shows the same cube
 * as a read-only RemoteDevice. Only one laptop needs to be connected.
 */

import { LIVE_RANGE_SECONDS } from "./quality.js";

const API = "/api/cube";
const FLUSH_MS = 3000;
const POLL_MS = 3000;
// New 5-minute slots only arrive on the cube, so re-read them periodically.
const RESYNC_MS = 15 * 60 * 1000;
const ONLINE_WINDOW_S = 20;

/** Identifies this tab as a publisher, so it does not also list its own cube twice. */
const PUBLISHER_ID =
  crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

async function post(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, publisher: PUBLISHER_ID, sentAt: Date.now() / 1000 }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export class SharePublisher {
  constructor(device) {
    this.device = device;
    this.buffer = [];
    this.blockedUntil = 0;
    // "sharing" | "blocked" | "unavailable" | "" (nothing sent yet)
    device.shareState = "";
    device.shareBlockedBy = "";

    device.addEventListener("reading", (e) => this.buffer.push(e.detail));
    device.addEventListener("history", () => this.pushHistory().catch(() => {}));
    this.flushTimer = setInterval(() => this.flush().catch(() => this._set("unavailable")), FLUSH_MS);
    this.resyncTimer = setInterval(() => {
      if (device.isConnected && !device.isSyncing && device.shareState === "sharing") {
        device.syncHistory().catch(() => {});
      }
    }, RESYNC_MS);
  }

  _set(state, blockedBy = "") {
    if (this.device.shareState === state && this.device.shareBlockedBy === blockedBy) return;
    this.device.shareState = state;
    this.device.shareBlockedBy = blockedBy;
    this.device.dispatchEvent(new CustomEvent("change"));
  }

  async flush() {
    const device = this.device;
    if (!device.isConnected || !this.buffer.length) return;
    const readings = this.buffer.splice(0);
    if (Date.now() < this.blockedUntil) return;

    const res = await post("/live", {
      readings,
      meta: {
        name: device.name,
        isPro: device.isPro,
        fwVersion: device.fwVersion,
        ledPercent: device.ledPercent,
      },
    });
    if (res.status === 409) {
      // Someone else's cube is already on the shared view; retry later.
      this.blockedUntil = Date.now() + 30000;
      this._set("blocked", res.data.publisher || "another laptop");
      return;
    }
    if (!res.ok) {
      this._set("unavailable");
      return;
    }
    this._set("sharing");
    if (res.data.needHistory) {
      if (device.slots.length) await this.pushHistory();
      else if (!device.isSyncing) device.syncHistory().catch(() => {});
    }
  }

  async pushHistory() {
    const device = this.device;
    if (!device.slots.length || Date.now() < this.blockedUntil) return;
    await post("/history", {
      slots: device.slots,
      windowS: device.historyWindowS,
    });
  }

  stop() {
    clearInterval(this.flushTimer);
    clearInterval(this.resyncTimer);
  }
}

/**
 * A cube connected to someone else's laptop, seen through the server.
 * Mirrors the read side of Device so the home and detail views can show it;
 * anything that would talk to the hardware is refused.
 */
export class RemoteDevice extends EventTarget {
  constructor() {
    super();
    this.id = "shared";
    this.slot = -1;
    this.isRemote = true;
    this.name = "noware";
    this.publisher = "";
    this.isPro = false;
    this.fwVersion = "";
    this.frcNeeded = false;
    this.pendingFrcNudge = false;
    this._frcNudgeOffered = true;
    this.lastReading = null;
    this.liveReadings = [];
    this.config = null;
    this.ledPercent = null;
    this.slots = [];
    this.historyWindowS = 300;
    this.historyVersion = 0;
    this.serverHistoryVersion = -1;
    this.lastSyncedAt = 0;
    this.isSyncing = false;
    this.syncProgress = { current: 0, total: 0 };
    this.syncError = "";
    this.heldForFlash = false;
    this.online = false;
    this.onRefresh = null;
  }

  get isConnected() {
    return this.online;
  }

  get isOnline() {
    return (
      this.online &&
      this.lastReading != null &&
      Date.now() / 1000 - this.lastReading.timestamp < ONLINE_WINDOW_S
    );
  }

  get modelLabel() {
    return this.isPro ? "noware Pro" : "noware Base";
  }

  get lastUpdated() {
    return this.lastReading ? this.lastReading.timestamp : 0;
  }

  /** Fold one poll response in. `offset` maps server time onto this clock. */
  apply(body, offset) {
    this.publisher = body.publisher;
    this.online = body.online;
    this.name = body.meta.name || "noware";
    this.isPro = body.meta.isPro;
    this.fwVersion = body.meta.fwVersion;
    this.ledPercent = body.meta.ledPercent;
    for (const r of body.live) {
      this.liveReadings.push({ ...r, timestamp: r.timestamp + offset });
    }
    if (this.liveReadings.length) this.lastReading = this.liveReadings[this.liveReadings.length - 1];
    const cutoff = Date.now() / 1000 - LIVE_RANGE_SECONDS;
    while (this.liveReadings.length && this.liveReadings[0].timestamp < cutoff) {
      this.liveReadings.shift();
    }
    if (body.slots) {
      this.slots = body.slots.map((s) => ({ ...s, timestamp: s.timestamp + offset }));
      this.serverHistoryVersion = body.historyVersion;
      this.historyWindowS = body.windowS;
      this.lastSyncedAt = body.lastSyncedAt + offset;
      this.historyVersion++;
    }
    this.dispatchEvent(new CustomEvent("change"));
  }

  /** "Sync" for a shared cube means re-reading the server's copy. */
  async syncHistory() {
    this.serverHistoryVersion = -1;
    await this.onRefresh?.();
  }

  slotsInRange(seconds) {
    const cutoff = Date.now() / 1000 - seconds;
    return this.slots.filter((s) => s.timestamp >= cutoff);
  }

  liveReadingsInRange(seconds = LIVE_RANGE_SECONDS) {
    const cutoff = Date.now() / 1000 - seconds;
    return this.liveReadings.filter((reading) => reading.timestamp >= cutoff);
  }

  sparklineSlots(n = 24) {
    return this.slots.slice(-n);
  }

  _refuse() {
    throw new Error("This cube is shared from another laptop. Change settings on the laptop it is plugged into.");
  }

  async setBrightness() { this._refuse(); }
  async setAutoDim() { this._refuse(); }
  async setReadoutPeriod() { this._refuse(); }
  async runCo2Frc() { this._refuse(); }
  async clearHistory() { this._refuse(); }
  async refreshConfig() { return null; }
  async dismissFrcNudge() {}
  async disconnect() {}

  rename(name) {
    this.name = name.trim() || this.name;
    this.dispatchEvent(new CustomEvent("change"));
  }
}

/** Polls the server and keeps the registry's shared cube up to date. */
export class ShareFeed {
  constructor(registry) {
    this.registry = registry;
    this.remote = null;
    this.liveSince = 0;
    this.stopped = false;
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  async poll() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const version = this.remote ? this.remote.serverHistoryVersion : -1;
      const res = await fetch(
        `${API}?me=${PUBLISHER_ID}&live_since=${this.liveSince}&history_version=${version}`,
        { headers: { Accept: "application/json" } },
      );
      if (res.status === 404) {
        // Served without the relay (e.g. a plain static server): stay local-only.
        this.stopped = true;
        clearInterval(this.timer);
        return;
      }
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return;
      const body = await res.json();
      if (!body.active || body.yours) {
        this._drop();
        return;
      }
      if (!this.remote || (this.remote.publisher && this.remote.publisher !== body.publisher)) {
        this._drop();
        this.remote = new RemoteDevice();
        this.remote.onRefresh = () => this.poll();
        this.registry.addRemote(this.remote);
      }
      const offset = Date.now() / 1000 - body.serverNow;
      if (body.live.length) this.liveSince = body.live[body.live.length - 1].timestamp;
      this.remote.apply(body, offset);
    } catch {
      // Offline or signed out; the next poll tries again.
    } finally {
      this.polling = false;
    }
  }

  _drop() {
    if (!this.remote) return;
    this.registry.removeRemote(this.remote);
    this.remote = null;
    this.liveSince = 0;
  }
}
