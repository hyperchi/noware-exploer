// Gateway configuration: process.env first, then an optional gateway/.env
// file, then defaults. Nothing machine-specific is baked in; the state
// directory is resolved from the home directory at runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");

/** Parse KEY=value lines; `#` comments, blank lines and surrounding quotes are ignored. */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Z_][A-Z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

const intOr = (value, fallback, { min = 0, max = Infinity } = {}) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
};

/**
 * Build the effective configuration.
 * @param {NodeJS.ProcessEnv} env usually process.env
 * @param {{envFile?: string|null, homedir?: string, hostname?: string}} options
 */
export function loadConfig(env = process.env, { envFile = DEFAULT_ENV_FILE, homedir = os.homedir(), hostname = os.hostname() } = {}) {
  let fileValues = {};
  if (envFile) {
    try {
      fileValues = parseEnvFile(fs.readFileSync(envFile, "utf8"));
    } catch {
      /* no .env file is the normal case for process-managed installs */
    }
  }
  const get = (key) => (env[key] !== undefined && env[key] !== "" ? env[key] : fileValues[key]);

  const stateDir = get("GATEWAY_STATE_DIR") || path.join(homedir, ".noware-gateway");
  const api = (get("NOWARE_API") || "http://localhost:8080").replace(/\/+$/, "");
  const token = (get("GATEWAY_TOKEN") || "").trim();
  return {
    api,
    token,
    publishEnabled: token.length >= 32,
    label: (get("GATEWAY_LABEL") || hostname || "gateway").slice(0, 60),
    deviceKey: (get("AIRCUBE_DEVICE_KEY") || "aircube-1").slice(0, 64),
    roomName: (get("AIRCUBE_ROOM") || "").slice(0, 60),
    portPath: get("AIRCUBE_PORT") || "",
    healthPort: intOr(get("GATEWAY_HEALTH_PORT"), 8787, { min: 1, max: 65535 }),
    stateDir,
    captureDir: get("GATEWAY_CAPTURE_DIR") || path.join(stateDir, "captures"),
    captureDays: intOr(get("GATEWAY_CAPTURE_DAYS"), 14, { min: 0, max: 3650 }),
    logLevel: (get("LOG_LEVEL") || "info").toLowerCase(),
    flushMs: intOr(get("GATEWAY_FLUSH_MS"), 3000, { min: 250, max: 60000 }),
    historyResyncMs: intOr(get("GATEWAY_HISTORY_RESYNC_MS"), 15 * 60 * 1000, { min: 10000 }),
  };
}

/** Describe the configuration for logs, with the token masked. */
export function describeConfig(config) {
  return {
    api: config.api,
    publish: config.publishEnabled ? "enabled" : "capture-only (GATEWAY_TOKEN missing or shorter than 32 chars)",
    label: config.label,
    deviceKey: config.deviceKey,
    roomName: config.roomName || "(unset)",
    portPath: config.portPath || "(auto-discover 303A:1001)",
    healthPort: config.healthPort,
    stateDir: config.stateDir,
    captureDir: config.captureDir,
    captureDays: config.captureDays,
  };
}
