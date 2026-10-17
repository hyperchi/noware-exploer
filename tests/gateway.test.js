import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server.js";
import { parseEnvFile, loadConfig } from "../gateway/config.js";
import { pickAirCube } from "../gateway/discover.js";
import { CubeLink } from "../gateway/link.js";
import { CubeSession, anchorSlots, capabilitiesOf, PROBE_MAX_ATTEMPTS } from "../gateway/cube.js";
import { Publisher } from "../gateway/publisher.js";
import { Capture, dayKey } from "../gateway/capture.js";

// One real frame from the cube on this desk (firmware 2.0.7, SEN63C fitted).
const FRAME =
  '{"model":"base","fw":"2.0.7","ens210":{"status":1,"temperature_c":25.94,"temperature_f":78.70,"humidity":45.88},' +
  '"ens16x":{"status":"OK","etvoc":0,"eco2":400,"aqi":0,"aqi_s":0,"aqi_uba":1},"scd41":{"co2":0},"vcnl4040":{"lux":0.0},' +
  '"sen63c":{"present":true,"valid":true,"pm1_0":3.8,"pm2_5":5.0,"pm4_0":5.8,"pm10_0":6.2,"temperature_c":25.94,"humidity":45.88,' +
  '"co2":540,"temp_valid":true,"hum_valid":true,"co2_valid":true},"health":{"ok":true,"temp_valid":true,"hum_valid":true,' +
  '"co2_valid":true,"etvoc_valid":true,"sensor_missing":false,"frc_needed":false},"timestamp":419780}';

/** Fake serial transport: scripted replies keyed by command name. */
class FakeTransport extends EventEmitter {
  constructor({ answers = true, replies = {} } = {}) {
    super();
    this.answers = answers;
    this.replies = replies;
    this.writes = [];
  }
  write(text, cb) {
    this.writes.push(text);
    cb?.(null);
    if (!this.answers) return;
    const cmd = JSON.parse(text).cmd;
    const reply = this.replies[cmd];
    if (reply) setTimeout(() => this.emit("data", Buffer.from(reply(JSON.parse(text)) + "\n")), 1);
  }
  frame(text = FRAME) {
    this.emit("data", Buffer.from(`I (1) main: noise\n${text}\nI (2) main: more noise\n`));
  }
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

test("gateway config: defaults, .env file, env precedence, capture-only without a token", () => {
  const parsed = parseEnvFile('# c\nNOWARE_API="https://noware.so"\nGATEWAY_TOKEN=abc\nbad line\nlower=no\n');
  assert.deepEqual(parsed, { NOWARE_API: "https://noware.so", GATEWAY_TOKEN: "abc" });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-cfg-"));
  fs.writeFileSync(path.join(dir, ".env"), "NOWARE_API=https://noware.so/\nAIRCUBE_ROOM=Office\nGATEWAY_HEALTH_PORT=9000\n");
  const fromFile = loadConfig({}, { envFile: path.join(dir, ".env"), homedir: "/home/x", hostname: "mini" });
  assert.equal(fromFile.api, "https://noware.so");
  assert.equal(fromFile.roomName, "Office");
  assert.equal(fromFile.healthPort, 9000);
  assert.equal(fromFile.publishEnabled, false);
  assert.equal(fromFile.label, "mini");
  assert.equal(fromFile.stateDir, path.join("/home/x", ".noware-gateway"));
  assert.equal(fromFile.captureDir, path.join("/home/x", ".noware-gateway", "captures"));
  assert.equal(fromFile.captureDays, 14);

  const fromEnv = loadConfig({ NOWARE_API: "http://127.0.0.1:8089", GATEWAY_TOKEN: "x".repeat(32), GATEWAY_HEALTH_PORT: "notaport" }, { envFile: path.join(dir, ".env"), homedir: "/home/x" });
  assert.equal(fromEnv.api, "http://127.0.0.1:8089");
  assert.equal(fromEnv.publishEnabled, true);
  assert.equal(fromEnv.healthPort, 8787, "an invalid value falls back to the default");
  assert.equal(loadConfig({}, { envFile: null, homedir: "/h" }).api, "http://localhost:8080");
});

test("gateway discovery picks the ESP32-H2 USB id and prefers the macOS call-out device", () => {
  const ports = [
    { path: "/dev/tty.Bluetooth-Incoming-Port" },
    { path: "/dev/tty.usbmodem2101", vendorId: "303a", productId: "1001", serialNumber: "74:4D:BD:69:0C:9F" },
  ];
  assert.deepEqual(pickAirCube(ports, { platform: "darwin" }), { path: "/dev/cu.usbmodem2101", serialNumber: "74:4D:BD:69:0C:9F", matched: "usb-id", candidates: 1 });
  assert.equal(pickAirCube(ports, { platform: "linux" }).path, "/dev/tty.usbmodem2101");
  assert.equal(pickAirCube([{ path: "/dev/ttyUSB0", vendorId: "0x10C4", productId: "EA60" }]), null);
  assert.equal(pickAirCube([], { preferred: "/dev/cu.custom" }).matched, "override");
});

test("gateway link parses live frames around log noise, matches replies, and detects a write stall", async () => {
  const transport = new FakeTransport({ replies: { get_config: () => '{"config":{"intensity":1.00,"readout_period":1000,"auto_dim":{"enabled":false}}}' } });
  const link = new CubeLink(transport, { now: () => 1700000000 });
  const live = [];
  link.on("live", (r) => live.push(r));
  transport.frame();
  assert.equal(live.length, 1);
  assert.equal(live[0].timestamp, 1700000000);
  assert.equal(live[0].pm25, 5);
  assert.equal(live[0].co2, 540);
  assert.equal(live[0].hasTrueCo2, true);
  assert.equal(live[0].pmPresent, true);
  assert.equal(live[0].fwVersion, "2.0.7");
  assert.equal(live[0].source, "physical");
  const reply = await link.send('{"cmd":"get_config"}', (d) => d.config !== undefined);
  assert.equal(reply.config.readout_period, 1000);

  const deaf = new FakeTransport({ answers: false });
  deaf.write = (text, cb) => {
    deaf.writes.push(text);
    /* never calls back: FIFO full */
  };
  const deafLink = new CubeLink(deaf, { stallMs: 40 });
  let stalled = false;
  deafLink.on("stalled", () => (stalled = true));
  await assert.rejects(deafLink.send('{"cmd":"get_config"}', () => true, { timeoutMs: 5000 }), /stalled/);
  assert.equal(stalled, true);
  await assert.rejects(deafLink.write("x"), /stalled/);
  deafLink.close();
  link.close();
});

test("gateway session: command probe budget, capabilities, history paging and anchoring", async () => {
  const slots = Array.from({ length: 100 }, (_, i) => ({ seq: i + 1, t_a: 2500 + i, t_n: 2490, t_x: 2510, h_a: 4500, h_n: 4400, h_x: 4600, q_a: 0, q_n: 0, q_x: 0, c_a: 500 + i, c_n: 480, c_x: 520, v_a: 0, v_n: 0, v_x: 0, p_a: 40 + i, p_n: 30, p_x: 60 }));
  const transport = new FakeTransport({
    replies: {
      get_config: () => '{"config":{"intensity":0.60,"readout_period":1000,"auto_dim":{"enabled":false}}}',
      get_history_info: () => `{"history_info":{"entries":${slots.length},"capacity":2016,"slot_bytes":40,"window_us":300000000}}`,
      get_history: (cmd) => JSON.stringify({ history: slots.slice(cmd.start, cmd.start + cmd.count), start: cmd.start, count: Math.min(cmd.count, slots.length - cmd.start) }),
    },
  });
  const link = new CubeLink(transport, { now: () => 1700000000 });
  const session = new CubeSession(link, { log: silentLog, now: () => 1700000000 });
  await session.probe();
  assert.equal(session.commandSupport, "ok");
  assert.equal(session.ledPercent, 60);
  transport.frame();
  assert.deepEqual(session.capabilities, { model: "base", pm: true, pmValid: true, trueCo2: true, illuminance: false, tvoc: true, temperature: true, humidity: true, warmingUp: false, ensStatus: "OK" });
  const synced = await session.syncHistory();
  assert.equal(synced.length, 100);
  assert.equal(synced.at(-1).sequence, 100);
  assert.equal(synced.at(-1).timestamp, 1700000000);
  assert.equal(synced[0].timestamp, 1700000000 - 99 * 300);
  assert.equal(synced.at(-1).pm25Avg, 13.9, "p_a is x10");
  assert.equal(transport.writes.filter((w) => w.includes("get_history\"")).length, 3, "48-slot pages");
  link.close();

  // Legacy firmware: streams frames, never answers. Budget is 3 probes.
  const deaf = new FakeTransport({ answers: false });
  const deafLink = new CubeLink(deaf, { stallMs: 40 });
  const deafSession = new CubeSession(deafLink, { log: silentLog, probeTimeoutMs: 40 });
  const probes = [];
  for (let i = 0; i < 4; i++) {
    const p = deafSession.probe();
    deaf.frame();
    deaf.frame();
    probes.push(p);
    await p;
  }
  assert.equal(deafSession.commandSupport, "none");
  assert.ok(deaf.writes.length <= PROBE_MAX_ATTEMPTS, `sent ${deaf.writes.length} probes`);
  assert.equal(await deafSession.syncHistory(), null);
  assert.equal(deaf.writes.length <= PROBE_MAX_ATTEMPTS, true, "no history bytes to a deaf cube");
  deafLink.close();

  // Wrapping sequence numbers keep their order and spacing across the wrap.
  const wrapped = anchorSlots([{ sequence: 0 }, { sequence: 0xfffc }, { sequence: 0xfffe }, { sequence: 0xfffd }], 300, 1000);
  assert.deepEqual(wrapped.map((s) => s.sequence), [0xfffc, 0xfffd, 0xfffe, 0]);
  assert.equal(wrapped.at(-1).timestamp, 1000);
  assert.equal(wrapped[1].timestamp, 1000 - 3 * 300);
  assert.equal(capabilitiesOf(null), null);
});

test("gateway publisher: bearer auth against the real relay, batching, needHistory, 409 backoff, redirects are not success", async () => {
  process.env.SESSION_SECRET = "test-only-secret".repeat(4);
  process.env.GATEWAY_TOKENS = "gateway-token-for-tests-0123456789abcdef";
  const seen = [];
  const server = createApp({ onLive: (readings, store) => seen.push([readings.length, store.publisher.kind]) }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const api = "http://127.0.0.1:" + server.address().port;
  try {
    let needHistoryCalls = 0;
    const meta = () => ({ name: "Office cube", isPro: false, fwVersion: "2.0.7", ledPercent: 100, source: "physical", deviceKey: "aircube-office", roomId: "", roomName: "Office" });
    const publisher = new Publisher({ api, token: process.env.GATEWAY_TOKENS, label: "test-mini", publisherId: "gateway-test-00000001", meta, log: silentLog });
    publisher.onNeedHistory = () => needHistoryCalls++;
    const base = Date.now() / 1000 - 400;
    for (let i = 0; i < 350; i++) publisher.push({ timestamp: base + i, pm25: 4 + (i % 3), pmValid: true, pmPresent: true, co2: 500, hasTrueCo2: true, co2Valid: true, etvoc: 0, source: "physical" });
    assert.equal(await publisher.flush(), "ok");
    assert.equal(publisher.buffer.length, 50, "batches are capped at 300");
    assert.equal(needHistoryCalls, 1);
    assert.equal(await publisher.flush(), "ok");
    assert.equal(publisher.buffer.length, 0);
    assert.equal(publisher.lastPublishStatus, "ok");
    assert.deepEqual(seen, [[300, "gateway"], [50, "gateway"]]);

    const slots = anchorSlots([{ sequence: 1, pm25Avg: 4 }, { sequence: 2, pm25Avg: 5 }], 300, Date.now() / 1000);
    assert.equal(await publisher.pushHistory(slots, 300), true);
    assert.equal(publisher.needHistory, false);

    // A second machine is refused and backs off instead of hammering.
    const other = new Publisher({ api, token: process.env.GATEWAY_TOKENS, label: "other", publisherId: "gateway-other-00000001", meta, log: silentLog });
    other.push({ timestamp: Date.now() / 1000, pm25: 1 });
    assert.equal(await other.flush(), "blocked");
    assert.ok(other.blockedUntil > Date.now() + 20000);
    assert.equal(await other.flush(), "blocked", "no request while backing off");
    assert.equal(other.buffer.length, 1, "nothing dropped");

    // Wrong token: unauthorized, reading kept.
    const bad = new Publisher({ api, token: "wrong-token-wrong-token-wrong-token-wrong", label: "bad", publisherId: "gateway-bad-000000001", meta, log: silentLog });
    bad.push({ timestamp: Date.now() / 1000, pm25: 1 });
    assert.equal(await bad.flush(), "unauthorized");

    // A redirect to the login page (wrong path or missing auth) never counts as ok.
    const misrouted = new Publisher({ api: api + "/not-the-api", token: process.env.GATEWAY_TOKENS, label: "x", publisherId: "gateway-misrouted-0001", meta, log: silentLog });
    misrouted.push({ timestamp: Date.now() / 1000, pm25: 1 });
    assert.notEqual(await misrouted.flush(), "ok");
    assert.equal(misrouted.buffer.length, 1);

    // Unreachable server: buffered, short backoff, no throw.
    const offline = new Publisher({ api: "http://127.0.0.1:1", token: process.env.GATEWAY_TOKENS, label: "x", publisherId: "gateway-offline-00001", meta, log: silentLog });
    offline.push({ timestamp: Date.now() / 1000, pm25: 1 });
    assert.equal(await offline.flush(), "unavailable");
    assert.equal(offline.buffer.length, 1);

    // Buffer cap: oldest readings go first.
    for (let i = 0; i < 4500; i++) offline.push({ timestamp: i });
    assert.equal(offline.buffer.length, 4000);
    assert.equal(offline.buffer[0].timestamp, 500);
  } finally {
    await new Promise((r) => server.close(r));
    delete process.env.SESSION_SECRET;
    delete process.env.GATEWAY_TOKENS;
  }
});

test("gateway capture: daily JSONL files, exact reading lines, pruning by age", async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gw-cap-")), "captures");
  const day0 = Date.UTC(2026, 9, 16, 12) / 1000;
  let now = day0;
  const capture = new Capture(dir, { days: 2, log: silentLog, now: () => now });
  fs.mkdirSync(dir, { recursive: true });
  for (const old of ["2026-10-01", "2026-10-13", "2026-10-14"]) fs.writeFileSync(path.join(dir, `readings-${old}.jsonl`), "{}\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");

  const reading = { timestamp: day0, source: "physical", pm25: 4.2, pmValid: true };
  capture.append(reading);
  capture.append({ ...reading, timestamp: day0 + 86400 });
  await new Promise((r) => capture.stream.end(r));
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ["notes.txt", "readings-2026-10-14.jsonl", "readings-2026-10-16.jsonl", "readings-2026-10-17.jsonl"], "files older than 2 days pruned, foreign files kept");
  assert.equal(fs.readFileSync(path.join(dir, "readings-2026-10-16.jsonl"), "utf8"), JSON.stringify(reading) + "\n");
  assert.equal(capture.written, 2);
  assert.equal(dayKey(day0), "2026-10-16");
  capture.close();
});
