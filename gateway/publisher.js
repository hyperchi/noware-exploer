// Buffers readings and posts them to the noware relay (/api/cube) with a
// bearer token. Survives an unreachable server by buffering, backs off when
// another publisher owns the relay, and re-uploads history when asked.
const MAX_BUFFER = 4000;
const MAX_BATCH = 300;
const BLOCKED_BACKOFF_MS = 30000;
const UNAVAILABLE_BACKOFF_MS = 5000;
const RELAY_PATH = "/api/cube";

export class Publisher {
  /**
   * @param {object} options
   * @param {string} options.api base URL
   * @param {string} options.token bearer token
   * @param {string} options.label X-Noware-Gateway header
   * @param {string} options.publisherId stable id (8-64 chars)
   * @param {() => object} options.meta returns the current meta object
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now] unix seconds
   * @param {object} [options.log]
   */
  constructor({ api, token, label, publisherId, meta, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() / 1000, log }) {
    this.api = api;
    this.token = token;
    this.label = label;
    this.publisherId = publisherId;
    this.meta = meta;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.buffer = [];
    this.dropped = 0;
    this.blockedUntil = 0;
    this.lastPublishAt = 0;
    this.lastPublishStatus = ""; // "ok" | "blocked" | "unauthorized" | "unavailable" | "error"
    this.lastError = "";
    this.needHistory = false;
    this.onNeedHistory = null;
    this._flushing = false;
  }

  push(reading) {
    this.buffer.push(reading);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
      this.dropped++;
    }
  }

  async _post(path, body) {
    const res = await this.fetch(this.api + RELAY_PATH + path, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "X-Noware-Gateway": this.label,
      },
      body: JSON.stringify({ ...body, publisher: this.publisherId, sentAt: this.now() }),
    });
    const json = (res.headers.get("content-type") || "").includes("json");
    const data = json ? await res.json().catch(() => ({})) : {};
    // A redirect to the login page or an HTML error is never a success.
    return { status: res.status, ok: res.ok && json, data };
  }

  /** Send up to one batch. Returns the outcome string. */
  async flush() {
    if (this._flushing) return "busy";
    if (!this.buffer.length) return "empty";
    if (Date.now() < this.blockedUntil) return this.lastPublishStatus || "blocked";
    this._flushing = true;
    const batch = this.buffer.slice(0, MAX_BATCH);
    try {
      const res = await this._post("/live", { readings: batch, meta: this.meta() });
      if (res.ok) {
        this.buffer.splice(0, batch.length);
        this.lastPublishAt = this.now();
        this._status("ok");
        if (res.data.needHistory && !this.needHistory) {
          this.needHistory = true;
          this.onNeedHistory?.();
        }
        return "ok";
      }
      if (res.status === 409) {
        this.blockedUntil = Date.now() + BLOCKED_BACKOFF_MS;
        this._status("blocked", `another publisher (${res.data.publisher || "unknown"}) owns the relay`);
        return "blocked";
      }
      if (res.status === 401 || res.status === 403) {
        this.blockedUntil = Date.now() + BLOCKED_BACKOFF_MS;
        this._status("unauthorized", res.data.error || `HTTP ${res.status}`);
        return "unauthorized";
      }
      this.blockedUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
      this._status("unavailable", res.data.error || `HTTP ${res.status}`);
      return "unavailable";
    } catch (err) {
      this.blockedUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
      this._status("unavailable", err.message);
      return "unavailable";
    } finally {
      this._flushing = false;
    }
  }

  async pushHistory(slots, windowS) {
    if (!slots?.length) return false;
    try {
      const res = await this._post("/history", { slots, windowS });
      if (res.ok) {
        this.needHistory = false;
        this.log?.info("history published", { slots: res.data.slots });
        return true;
      }
      this.log?.warn("history publish refused", { status: res.status, error: res.data.error });
      return false;
    } catch (err) {
      this.log?.warn("history publish failed", { error: err.message });
      return false;
    }
  }

  _status(status, detail = "") {
    if (status !== this.lastPublishStatus || detail !== this.lastError) {
      const line = `publish ${status}`;
      if (status === "ok") this.log?.info(line, { api: this.api });
      else this.log?.warn(line, { api: this.api, detail, buffered: this.buffer.length });
    }
    this.lastPublishStatus = status;
    this.lastError = detail;
  }
}
