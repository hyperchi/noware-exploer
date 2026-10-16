/* Browser client for /api/home and /api/contractor, plus a polling feed.
 *
 * When the dashboard is served without the Express server (plain Vite dev or
 * a static host) every call fails fast and `available` becomes false; the
 * views then fall back to the local engine in local-intelligence.js.
 */

const HOME = "/api/home";
const CONTRACTOR = "/api/contractor";
const POLL_MS = 5000;

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) throw Object.assign(new Error("Server unavailable"), { status: res.status, unavailable: true });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, json });
  return json;
}

export const homeApi = {
  me: () => call("GET", `${HOME}/me`),
  scenarios: () => call("GET", `${HOME}/scenarios`),
  household: (id) => call("GET", `${HOME}/households/${id}`),
  updateHousehold: (id, patch) => call("PATCH", `${HOME}/households/${id}`, patch),
  summary: (id, { debug = false, units = "c" } = {}) => call("GET", `${HOME}/households/${id}/summary?debug=${debug ? 1 : 0}&units=${units}`),
  roomSummary: (id, roomId, { debug = false, units = "c" } = {}) => call("GET", `${HOME}/households/${id}/rooms/${roomId}/summary?debug=${debug ? 1 : 0}&units=${units}`),
  series: (id, roomId, seconds) => call("GET", `${HOME}/households/${id}/rooms/${roomId}/series?seconds=${seconds}`),
  ack: (id, eventId, recommendationId) => call("POST", `${HOME}/households/${id}/events/${encodeURIComponent(eventId)}/ack`, { recommendationId }),
  feedback: (id, eventId, body) => call("POST", `${HOME}/households/${id}/events/${encodeURIComponent(eventId)}/feedback`, body),
  contact: (id, body) => call("POST", `${HOME}/households/${id}/contact`, body),
  contactRequests: (id) => call("GET", `${HOME}/households/${id}/contact-requests`),
  report: (id) => call("GET", `${HOME}/households/${id}/report`),
  simulate: (id, body) => call("POST", `${HOME}/households/${id}/simulate`, body),
  contractorCustomers: () => call("GET", `${CONTRACTOR}/customers`),
  contractorCustomer: (householdId) => call("GET", `${CONTRACTOR}/customers/${householdId}`),
  signalStatus: (id, status) => call("POST", `${CONTRACTOR}/signals/${encodeURIComponent(id)}/status`, { status }),
  addServiceEvent: (householdId, body) => call("POST", `${CONTRACTOR}/customers/${householdId}/service-events`, body),
};

/**
 * Keeps the signed-in person's identity and the active household's summary
 * fresh. Views read `feed.me`, `feed.household`, `feed.summary` and listen for
 * "change".
 */
export class HomeFeed extends EventTarget {
  constructor() {
    super();
    this.available = null; // null = unknown, false = no server
    this.me = null;
    this.householdId = null;
    this.household = null;
    this.summary = null;
    this.debug = false;
    this.units = "c";
    this.error = "";
    this._timer = null;
    this._polling = false;
  }

  async start() {
    try {
      this.me = await homeApi.me();
      this.available = true;
      const stored = safeGet("noware.household");
      this.householdId = this.me.households.find((h) => h.id === stored)?.id || this.me.households[0]?.id || null;
      await this.refresh();
    } catch (err) {
      this.available = err.unavailable || err.status === 404 ? false : this.available;
      this.error = err.message;
      this.available = this.available ?? false;
    }
    this._emit();
    this._timer = setInterval(() => this.refresh().catch(() => {}), POLL_MS);
  }

  setHousehold(id) {
    this.householdId = id;
    try { localStorage.setItem("noware.household", id); } catch { /* private mode */ }
    this.summary = null;
    this.household = null;
    this._emit();
    this.refresh().catch(() => {});
  }

  async refresh() {
    if (!this.available || !this.householdId || this._polling) return;
    this._polling = true;
    try {
      const [household, summary] = await Promise.all([
        this.household && this._householdFetchedAt && Date.now() - this._householdFetchedAt < 30000 ? this.household : homeApi.household(this.householdId).then((h) => { this._householdFetchedAt = Date.now(); return h; }),
        homeApi.summary(this.householdId, { debug: this.debug, units: this.units }),
      ]);
      this.household = household;
      this.summary = summary;
      this.error = "";
    } catch (err) {
      this.error = err.message;
      if (err.status === 401) this.available = false;
    } finally {
      this._polling = false;
      this._emit();
    }
  }

  /** Re-read the household document (rooms, contractor) on demand. */
  async reloadHousehold() {
    this._householdFetchedAt = 0;
    await this.refresh();
  }

  roomSummary(roomId) {
    return this.summary?.rooms.find((r) => r.roomId === roomId) || null;
  }

  _emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
