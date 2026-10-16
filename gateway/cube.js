// One connected cube: command probe, live readings, history sync.
//
// Everything here is transport-agnostic; it is given a CubeLink. The USB FIFO
// rule from CONTRIBUTING.md is enforced: at most PROBE_MAX_ATTEMPTS get_config
// probes (21 bytes each) until the cube proves it hears commands, and no
// history commands before that.
import { EventEmitter } from "node:events";
import * as proto from "../public/dashboard/js/protocol.js";

export const PROBE_MAX_ATTEMPTS = 3;
export const PROBE_TIMEOUT_MS = 2500;

/** Wrapping u16 sequence distance (sequences wrap at 0xFFFE). Same as quality.js. */
export const seqDistance = (newer, older) => (newer - older) & 0xffff;

/**
 * Anchor history slots in wall-clock time. The cube has no RTC: the newest
 * slot is placed at `anchorTime` and the rest spaced backwards by windowS.
 */
export function anchorSlots(slots, windowS, anchorTime) {
  if (!slots.length) return [];
  let newest = slots[0].sequence;
  for (const s of slots) if (seqDistance(s.sequence, newest) < 0x8000) newest = s.sequence;
  const out = slots.map((s) => ({ ...s, timestamp: anchorTime - seqDistance(newest, s.sequence) * windowS }));
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/** Sensor capabilities as the frames reveal them. */
export function capabilitiesOf(reading) {
  if (!reading) return null;
  return {
    model: reading.isPro ? "pro" : "base",
    pm: Boolean(reading.pmPresent),
    pmValid: Boolean(reading.pmValid),
    trueCo2: Boolean(reading.hasTrueCo2),
    illuminance: Boolean(reading.hasLux),
    tvoc: true,
    temperature: true,
    humidity: true,
    warmingUp: Boolean(reading.warmingUp),
    ensStatus: reading.ensStatus || "",
  };
}

export class CubeSession extends EventEmitter {
  constructor(link, { log, now = () => Date.now() / 1000, probeTimeoutMs = PROBE_TIMEOUT_MS } = {}) {
    super();
    this.link = link;
    this.log = log;
    this.now = now;
    this.probeTimeoutMs = probeTimeoutMs;
    this.commandSupport = "unknown"; // "unknown" | "ok" | "none"
    this.config = null;
    this.lastReading = null;
    this.readingCount = 0;
    this.capabilities = null;
    this.historyWindowS = 300;
    this.isSyncing = false;
    this._probeAttempts = 0;
    this._probing = null;
    this._liveSinceProbe = 0;

    link.on("live", (reading) => this._onLive(reading));
    link.on("config", (config) => this._onConfig(config));
    link.on("stalled", () => {
      this.commandSupport = "none";
      this.log?.warn("cube write stalled: firmware cannot hear commands over USB");
    });
    link.on("closed", () => this.emit("closed"));
    link.on("log", (line) => this.log?.debug("cube log", { line }));
  }

  _onLive(reading) {
    this.readingCount++;
    this._liveSinceProbe++;
    const previous = this.capabilities;
    this.lastReading = reading;
    this.capabilities = capabilitiesOf(reading);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(this.capabilities)) {
      this.log?.info("cube capabilities", { ...this.capabilities, fw: reading.fwVersion });
    }
    this.emit("reading", reading);
    if (this.commandSupport === "unknown" && !this._probing) this.probe().catch(() => {});
  }

  _onConfig(config) {
    this.commandSupport = "ok";
    this.config = config;
  }

  get fwVersion() {
    return this.lastReading?.fwVersion || "";
  }

  get ledPercent() {
    return this.config ? Math.round(this.config.intensity * 100) : null;
  }

  /** Ask get_config within the byte budget; resolves when a verdict is reached or budget spent. */
  probe() {
    if (this._probing) return this._probing;
    if (this.commandSupport !== "unknown" || !this.link.isOpen) return Promise.resolve(this.commandSupport);
    if (this._probeAttempts >= PROBE_MAX_ATTEMPTS) return Promise.resolve(this.commandSupport);
    this._probing = (async () => {
      const liveBefore = this._liveSinceProbe;
      this._probeAttempts++;
      try {
        const reply = await this.link.send(proto.cmdGetConfig(), proto.isConfigReply, { timeoutMs: this.probeTimeoutMs });
        this._onConfig(proto.parseConfig(reply.config));
        this.log?.info("cube answers commands", { ledPercent: this.ledPercent, readoutPeriodMs: this.config.readoutPeriod });
      } catch {
        if (this.link.writeStalled) {
          this.commandSupport = "none";
        } else if (this._liveSinceProbe > liveBefore && this._probeAttempts >= 2) {
          this.commandSupport = "none";
          this.log?.warn("cube streams readings but ignores commands (legacy firmware); history sync disabled");
        }
      }
      return this.commandSupport;
    })().finally(() => {
      this._probing = null;
    });
    return this._probing;
  }

  /** Wait until the probe settles, the budget is spent, or the link closes. */
  async whenProbed(maxWaitMs = this.probeTimeoutMs * 4) {
    const deadline = Date.now() + maxWaitMs;
    while (this.link.isOpen && this.commandSupport === "unknown" && Date.now() < deadline) {
      if (this._probing) await this._probing.catch(() => {});
      else if (this._probeAttempts >= PROBE_MAX_ATTEMPTS) break;
      else await new Promise((r) => setTimeout(r, 250));
    }
    return this.commandSupport;
  }

  /**
   * Pull the whole history buffer a page at a time. Returns anchored slots,
   * or null when the cube cannot be asked (legacy firmware / link closed).
   */
  async syncHistory() {
    if (this.isSyncing) return null;
    if (this.commandSupport === "unknown") await this.whenProbed();
    if (this.commandSupport !== "ok" || !this.link.isOpen) return null;
    this.isSyncing = true;
    try {
      const infoReply = await this.link.send(proto.cmdGetHistoryInfo(), proto.isHistoryInfoReply);
      const info = proto.parseHistoryInfo(infoReply.history_info);
      this.historyWindowS = info.windowS || 300;
      const total = Math.min(info.entries, info.capacity) || 0;
      const collected = [];
      for (let start = 0; start < total; start += proto.HISTORY_PAGE) {
        if (!this.link.isOpen) throw new Error("Disconnected during history sync");
        const count = Math.min(proto.HISTORY_PAGE, total - start);
        const page = await this.link.send(
          proto.cmdGetHistory(start, count),
          (d) => proto.isHistoryReply(d) && Number(d.start) === start,
          { timeoutMs: 5000 },
        );
        for (const raw of page.history) {
          const slot = proto.parseHistorySlot(raw);
          if (slot) collected.push(slot);
        }
        // Firmware may emit fewer slots than asked when a page would overflow
        // its buffer; its reported count is the authoritative cursor advance.
        const emitted = Number(page.count);
        if (Number.isFinite(emitted) && emitted > 0 && emitted < count) start -= count - emitted;
        if (Number.isFinite(emitted) && emitted === 0) break;
      }
      const slots = anchorSlots(collected, this.historyWindowS, this.now());
      this.log?.info("history synced", { slots: slots.length, windowS: this.historyWindowS });
      return slots;
    } finally {
      this.isSyncing = false;
    }
  }
}
