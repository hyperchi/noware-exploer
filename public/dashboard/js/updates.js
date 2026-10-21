const CHECK_MS = 5 * 60 * 1000;
const VERSION_URL = "/dashboard/version.json";
const VERSION_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Keep USB operations and open editors alive during an automatic update.
 * @param {{devices: Array<{isRemote?: boolean, isConnected?: boolean, isSyncing?: boolean, heldForFlash?: boolean, inFlashGrace?: boolean}>}} registry
 * @returns {boolean}
 */
export function canReloadDashboard(registry) {
  return !registry.devices.some(device => !device.isRemote &&
    (device.isConnected || device.isSyncing || device.heldForFlash || device.inFlashGrace)) &&
    !document.querySelector('.modal-backdrop') &&
    !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
}

/** Detect new dashboard builds without interrupting device work or drafts. */
export class DashboardUpdates {
  /**
   * @param {{version: string|null, canReload: () => boolean, onUpdate: () => void}} options
   */
  constructor({ version, canReload, onUpdate }) {
    this.version = version;
    this.canReload = canReload;
    this.onUpdate = onUpdate;
    this.pending = false;
    this.checking = false;
    this.lastCheckedAt = -Infinity;
    this.timer = null;
    this.edited = false;
    this.stopped = false;
    this.onVisibility = () => this.check();
    // A blurred field can still hold a draft. Once edited, require an explicit
    // reload rather than guessing whether individual views saved their inputs.
    this.onInput = () => { this.edited = true; };
  }

  /** Start one bounded checker; production versioning is disabled in dev. */
  start() {
    if (!this.version || this.timer !== null) return;
    this.stopped = false;
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("input", this.onInput);
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.check();
  }

  /** Fetch a release marker at most every five minutes while visible. */
  async check() {
    if (!this.version || this.stopped || document.hidden || this.checking) return;
    if (this.pending) {
      if (!this.edited && this.canReload()) location.reload();
      return;
    }
    if (Date.now() - this.lastCheckedAt < CHECK_MS) return;
    this.lastCheckedAt = Date.now();
    this.checking = true;
    try {
      const response = await fetch(VERSION_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      // Sign-in redirects and unavailable servers are not new releases.
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const release = await response.json();
      if (this.stopped) return;
      if (!VERSION_PATTERN.test(release?.version) || release.version === this.version) return;
      this.pending = true;
      this.onUpdate();
      if (!document.hidden && !this.edited && this.canReload()) location.reload();
    } catch (error) {
      console.warn("Dashboard update check failed", { error: error instanceof Error ? error.name : "UnknownError" });
    } finally {
      this.checking = false;
    }
  }

  /** Remove the timer and visibility listener when the shell is disposed. */
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("input", this.onInput);
  }
}
