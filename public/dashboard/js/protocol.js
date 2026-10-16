/* AirCube USB serial wire protocol.
 *
 * Port of the JSON-lines half of aircubetray/aircubeapp/protocol.py, which
 * tracks firmware/main/serial_protocol.c in hyperchi/Noso_AirCube. See the
 * Serial Protocol Reference in that repository's CONTRIBUTING.md for the
 * authoritative message list.
 *
 * This module is pure: no DOM, no globals. The Node gateway (gateway/) and the
 * tests import it as well as the browser.
 */

/** ESP32-H2 built-in USB Serial/JTAG. */
export const AIRCUBE_USB_FILTER = { usbVendorId: 0x303a, usbProductId: 0x1001 };
export const SERIAL_BAUD = 115200;
export const SEQ_NONE = 0xffff;

/** Slots per get_history page. Matches the tray's paging. */
export const HISTORY_PAGE = 48;

const JSON_PATTERN = /\{.*\}/;

/**
 * Shown wherever a cube turns out to be running firmware that streams readings
 * but cannot hear commands (see Device.commandSupport in devices.js).
 *
 * Cubes shipped before February 2026 read commands from the UART0 pins rather
 * than the USB Serial/JTAG port, so over USB they are talk-only: the live
 * frame arrives every second, but get_config, set_intensity and the history
 * commands are never seen. Worse, every byte the host sends piles up in the
 * chip's 64-byte USB receive FIFO, and once that is full the host's writes hang.
 * Firmware from 2026-02-08 onwards (release 1.3 and later) reads the USB port.
 */
export const LEGACY_FIRMWARE_MESSAGE =
  "This cube runs firmware from before February 2026, which cannot receive " +
  "commands over USB. Live readings work, but brightness, history and settings " +
  "need a firmware update. Updating takes about 30 seconds.";

/** Pull the JSON object out of a line that may carry ESP_LOG noise around it. */
export function extractJson(line) {
  const match = JSON_PATTERN.exec(line);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse the periodic sensor JSON object into a normalized live reading.
 *
 * Since firmware 1.5.0 `ens16x.aqi` is the VOC Level index (0-500), which is a
 * different number from `ens16x.etvoc` in ppb despite the similar names.
 * Pro units add scd41.co2 and vcnl4040.lux. Boards with the Sensirion SEN63C
 * fitted add a `sen63c` object with PM1/PM2.5/PM4/PM10 and a true (NDIR) CO2
 * reading of their own; on those boards temperature and humidity also come
 * from the SEN63C, still under the legacy `ens210` keys. Older firmware omits
 * `model`, and firmware before 2.0.3 omits `fw`.
 *
 * Every field below is also what the share relay (api/cube.js) and the
 * gateway accept, so keep the three in step.
 *
 * @param {object} data one decoded serial frame
 * @param {{timestamp?: number}} [options] wall-clock seconds for the reading;
 *   defaults to now. The cube has no clock: its own `timestamp` is ms since boot.
 */
export function parseLive(data, { timestamp } = {}) {
  const ens210 = data.ens210 || {};
  const ens16x = data.ens16x || {};
  const scd41 = data.scd41 || {};
  const vcnl = data.vcnl4040 || {};
  const sen63c = data.sen63c || {};
  const health = data.health || {};
  const model = data.model;
  const senCo2Valid = Boolean(sen63c.co2_valid);
  const co2 = Math.round(num(senCo2Valid ? sen63c.co2 : scd41.co2));
  const isPro = model !== undefined ? model === "pro" : num(scd41.co2) > 0;
  const hasTrueCo2 = senCo2Valid || isPro || (model === undefined && co2 > 0);
  const etvocRaw = Number(ens16x.etvoc);
  const ensStatus = typeof ens16x.status === "string" ? ens16x.status : "";
  // "OK" is the only status under which the ENS161 vouches for its gas output;
  // "Warming Up" covers the 3-minute warm-up and the 1-hour first-run
  // conditioning, "No Valid Output" a sensor that has nothing to say.
  const vocReady = ensStatus === "" || ensStatus === "OK";
  const etvocValid =
    Number.isFinite(etvocRaw) && etvocRaw >= 0 && (health.etvoc_valid !== false) && vocReady;
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() / 1000,
    uptimeMs: Math.round(num(data.timestamp)),
    source: "physical",
    temperatureC: num(ens210.temperature_c),
    humidity: num(ens210.humidity),
    vocLevel: Math.round(num(ens16x.aqi)),
    eco2: Math.round(num(ens16x.eco2)),
    etvoc: Math.max(0, Math.round(num(ens16x.etvoc))),
    co2,
    lux: num(vcnl.lux),
    aqiUba: Math.round(num(ens16x.aqi_uba)),
    pmPresent: Boolean(sen63c.present),
    pmValid: Boolean(sen63c.valid),
    pm1: num(sen63c.pm1_0),
    pm25: num(sen63c.pm2_5),
    pm4: num(sen63c.pm4_0),
    pm10: num(sen63c.pm10_0),
    isPro,
    hasTrueCo2,
    hasLux: isPro,
    ensStatus,
    warmingUp: ensStatus === "Warming Up",
    tempValid: health.temp_valid !== undefined ? Boolean(health.temp_valid) : num(ens210.status) !== 0,
    humValid: health.hum_valid !== undefined ? Boolean(health.hum_valid) : num(ens210.status) !== 0,
    co2Valid: hasTrueCo2 && (health.co2_valid !== undefined ? Boolean(health.co2_valid) : co2 > 0),
    etvocValid,
    sensorMissing: Boolean(health.sensor_missing),
    fwVersion: typeof data.fw === "string" ? data.fw : "",
    frcNeeded: Boolean(health.frc_needed),
  };
}

/** Compare dotted firmware strings. Returns null if either side is unparseable. */
export function compareFw(a, b) {
  const parts = (s) => {
    const m = String(s || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
  };
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function fwLte(version, ceiling) {
  const cmp = compareFw(version, ceiling);
  return cmp !== null && cmp <= 0;
}

/**
 * Parse one slot of a get_history page.
 *
 * Serial keys: t_*=temp x100, h_*=humidity x100, q_*=VOC level, c_*=CO2 (true
 * CO2 where the board has it, eCO2 on legacy Base), v_*=eTVOC, p_*=PM2.5 x10.
 * The firmware writes INT16_MIN / 0xFFFF into a channel that had no valid
 * samples in the window; those come back as NaN so charts draw a gap instead
 * of a plausible-looking number.
 */
export function parseHistorySlot(s) {
  const seq = Math.round(num(s.seq));
  if (!Number.isFinite(seq) || seq === SEQ_NONE) return null;
  const s16x100 = (value) => {
    const raw = Number(value);
    return Number.isFinite(raw) && raw !== -32768 ? raw / 100 : NaN;
  };
  const u16 = (value, scale = 1) => {
    const raw = Number(value);
    return Number.isFinite(raw) && raw !== 0xffff ? raw / scale : NaN;
  };
  return {
    sequence: seq,
    timestamp: 0, // anchored by the caller; the device has no RTC
    tempAvg: s16x100(s.t_a),
    tempMin: s16x100(s.t_n),
    tempMax: s16x100(s.t_x),
    humAvg: s16x100(s.h_a),
    humMin: s16x100(s.h_n),
    humMax: s16x100(s.h_x),
    vocAvg: u16(s.q_a),
    vocMin: u16(s.q_n),
    vocMax: u16(s.q_x),
    co2Avg: u16(s.c_a),
    co2Min: u16(s.c_n),
    co2Max: u16(s.c_x),
    etvocAvg: u16(s.v_a),
    etvocMin: u16(s.v_n),
    etvocMax: u16(s.v_x),
    pm25Avg: u16(s.p_a, 10),
    pm25Min: u16(s.p_n, 10),
    pm25Max: u16(s.p_x, 10),
  };
}

export function parseHistoryInfo(info) {
  return {
    entries: Math.round(num(info.entries)),
    capacity: Math.round(num(info.capacity)),
    slotBytes: Math.round(num(info.slot_bytes)) || 32,
    windowS: Math.round(num(info.window_us) / 1e6) || 300,
  };
}

export function parseConfig(config) {
  const autoDim = config.auto_dim || {};
  return {
    intensity: num(config.intensity),
    readoutPeriod: Math.round(num(config.readout_period)) || 1000,
    autoDim: {
      enabled: Boolean(autoDim.enabled),
      nightEnterLux: num(autoDim.night_enter_lux),
      dayExitLux: num(autoDim.day_exit_lux),
      nightDimPct: Math.round(num(autoDim.night_dim_pct)),
    },
  };
}

// ----------------------------------------------------------------- commands

export const cmdGetConfig = () => '{"cmd":"get_config"}';

export const cmdSetIntensity = (fraction) =>
  JSON.stringify({ cmd: "set_intensity", value: Number(fraction.toFixed(2)) });

export const cmdSetReadoutPeriod = (ms) =>
  JSON.stringify({ cmd: "set_readout_period", value: Math.round(ms) });

export const cmdSetAutoDim = (o) =>
  JSON.stringify({
    cmd: "set_auto_dim",
    enabled: Boolean(o.enabled),
    night_enter_lux: Math.round(o.nightEnterLux),
    day_exit_lux: Math.round(o.dayExitLux),
    night_dim_pct: Math.round(o.nightDimPct),
  });

export const cmdGetHistoryInfo = () => '{"cmd":"get_history_info"}';

export const cmdGetHistory = (start, count) =>
  JSON.stringify({ cmd: "get_history", start, count });

export const cmdClearHistory = () => '{"cmd":"clear_history"}';

export const cmdScd41Frc = () => '{"cmd":"scd41_frc"}';

export const cmdScd41FrcAck = () => '{"cmd":"scd41_frc_ack"}';

export const cmdGetSensorHealth = () => '{"cmd":"get_sensor_health"}';

// ------------------------------------------------------------- reply shapes

/** Matchers pair a sent command with the reply line that answers it. */
export const isConfigReply = (d) => d.config !== undefined;
export const isHistoryInfoReply = (d) => d.history_info !== undefined;
export const isHistoryReply = (d) => Array.isArray(d.history);
export const isLive = (d) => d.ens210 !== undefined;
export const statusReply = (cmd) => (d) => d.status !== undefined && d.cmd === cmd;
export const isScd41FrcReply = (d) => d.cmd === "scd41_frc";
export const isSensorHealthReply = (d) => d.probe !== undefined && d.model_source !== undefined;
