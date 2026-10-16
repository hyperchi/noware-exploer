#!/usr/bin/env node
// noware AirCube gateway: discover the cube over USB, parse its readings,
// capture them locally and publish them to the noware relay. No UI logic.
//
//   node collector.js            (reads gateway/.env if present)
//   GATEWAY_TOKEN=... NOWARE_API=https://noware.so node collector.js
import { loadConfig, describeConfig } from "./config.js";
import { createLogger } from "./log.js";
import { discoverAirCube } from "./discover.js";
import { CubeLink } from "./link.js";
import { CubeSession } from "./cube.js";
import { Publisher } from "./publisher.js";
import { Capture } from "./capture.js";
import { startHealthServer } from "./health.js";
import { loadState } from "./state.js";
import { createRequire } from "node:module";

const VERSION = createRequire(import.meta.url)("./package.json").version;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function main(env = process.env) {
  const config = loadConfig(env);
  const log = createLogger(config.logLevel);
  const startedAt = Date.now();
  log.info(`noware gateway v${VERSION} starting`, describeConfig(config));

  const state = loadState(config.stateDir);
  const capture = new Capture(config.captureDir, { days: config.captureDays, log });

  let session = null;
  let port = null;
  let portPath = "";
  let serialNumber = "";
  let lastReadingAt = 0;
  let stopping = false;
  let historyTimer = null;

  const meta = () => ({
    name: config.roomName ? `${config.roomName} cube` : "noware",
    isPro: Boolean(session?.lastReading?.isPro),
    fwVersion: session?.fwVersion || "",
    ledPercent: session?.ledPercent ?? null,
    source: "physical",
    deviceKey: config.deviceKey,
    roomId: "",
    roomName: config.roomName,
  });

  const publisher = config.publishEnabled
    ? new Publisher({ api: config.api, token: config.token, label: config.label, publisherId: state.publisherId, meta, log })
    : null;
  if (!publisher) log.warn("capture-only mode: set GATEWAY_TOKEN (>= 32 chars) to publish to the relay");

  const snapshot = () => ({
    version: VERSION,
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    connected: Boolean(session && session.link.isOpen),
    port: portPath,
    serialNumber,
    model: session?.capabilities?.model || "",
    fwVersion: session?.fwVersion || "",
    capabilities: session?.capabilities || null,
    commandSupport: session?.commandSupport || "unknown",
    lastReadingAt,
    lastReading: session?.lastReading || null,
    readings: session?.readingCount || 0,
    publish: publisher
      ? {
          enabled: true,
          api: config.api,
          publisherId: state.publisherId,
          buffered: publisher.buffer.length,
          dropped: publisher.dropped,
          lastPublishAt: publisher.lastPublishAt,
          lastPublishStatus: publisher.lastPublishStatus,
          lastError: publisher.lastError,
          needHistory: publisher.needHistory,
        }
      : { enabled: false },
    capture: { dir: config.captureDir, written: capture.written, lastError: capture.lastError },
    deviceKey: config.deviceKey,
    roomName: config.roomName,
  });
  const health = startHealthServer(config.healthPort, snapshot, { log });

  async function syncAndPublishHistory(reason) {
    if (!session || !publisher) return;
    try {
      const slots = await session.syncHistory();
      if (slots) await publisher.pushHistory(slots, session.historyWindowS);
    } catch (err) {
      log.warn("history sync failed", { reason, error: err.message });
    }
  }

  if (publisher) {
    publisher.onNeedHistory = () => syncAndPublishHistory("server asked");
    setInterval(() => publisher.flush().catch(() => {}), config.flushMs).unref();
    historyTimer = setInterval(() => syncAndPublishHistory("periodic"), config.historyResyncMs);
    historyTimer.unref();
  }

  async function connectOnce() {
    const found = await discoverAirCube({ preferred: config.portPath });
    if (!found) throw new Error("no AirCube found (USB 303A:1001)");
    const { SerialPort } = await import("serialport");
    portPath = found.path;
    serialNumber = found.serialNumber;
    port = await new Promise((resolve, reject) => {
      const p = new SerialPort({ path: found.path, baudRate: 115200, autoOpen: false });
      p.open((err) => (err ? reject(err) : resolve(p)));
    });
    // DTR high / RTS low keeps every later transition clear of the ESP32
    // auto-reset state (DTR=0, RTS=1), so closing the port does not reboot
    // the cube and restart its sensor warm-up.
    await new Promise((resolve) => port.set({ dtr: true, rts: false }, () => resolve()));
    log.info("cube connected", { port: found.path, serialNumber: found.serialNumber, matched: found.matched });

    const link = new CubeLink(port);
    session = new CubeSession(link, { log });
    session.on("reading", (reading) => {
      lastReadingAt = reading.timestamp;
      capture.append(reading);
      publisher?.push(reading);
    });
    link.on("error", (err) => log.warn("serial error", { error: err.message }));
    await session.probe().catch(() => {});
    // First sync after the probe settles; later ones are periodic or on request.
    syncAndPublishHistory("connected");
    await new Promise((resolve) => session.once("closed", resolve));
    log.warn("cube disconnected", { port: found.path });
    session = null;
    port = null;
  }

  async function run() {
    let delay = RECONNECT_MIN_MS;
    while (!stopping) {
      try {
        await connectOnce();
        delay = RECONNECT_MIN_MS;
      } catch (err) {
        log.warn("connect failed", { error: err.message, retryInMs: delay });
      }
      if (stopping) break;
      await sleep(delay);
      delay = Math.min(RECONNECT_MAX_MS, delay * 2);
    }
  }

  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info("stopping", { signal });
    clearInterval(historyTimer);
    try {
      if (publisher) await publisher.flush();
    } catch {
      /* best effort */
    }
    capture.close();
    health.close();
    if (port?.isOpen) await new Promise((resolve) => port.close(() => resolve()));
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await run();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err.stack || err}\n`);
    process.exit(1);
  });
}
