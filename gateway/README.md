# noware AirCube gateway

A small headless collector for the machine the AirCube is plugged into. It
finds the cube on USB, parses its one-line-per-second JSON frames, writes them
to a local daily capture file, and publishes them to the noware relay
(`/api/cube`) with a bearer token so every signed-in dashboard sees the cube
without a browser tab holding the USB port.

It contains no presentation logic. The same `public/dashboard/js/protocol.js`
the browser uses does the parsing, so the gateway and the dashboard always
agree on what a frame means.

```text
AirCube (USB 303A:1001)
   ↓ 115200 baud JSON lines
gateway/collector.js
   ├─ captures/readings-YYYY-MM-DD.jsonl   (local, N days)
   ├─ http://127.0.0.1:8787/health         (loopback only)
   └─ POST {NOWARE_API}/api/cube/live, /history   (Bearer GATEWAY_TOKEN)
          ↓
      noware relay (api/cube.js) → dashboards
```

## Run

```sh
cd gateway
npm install
cp .env.example .env     # fill in GATEWAY_TOKEN, NOWARE_API, AIRCUBE_ROOM
node collector.js
```

Without a `GATEWAY_TOKEN` the collector runs in capture-only mode and says so.

See [docs/MAC_MINI_AIRCUBE_GATEWAY.md](../docs/MAC_MINI_AIRCUBE_GATEWAY.md) for
the Mac mini install, LaunchAgent and troubleshooting.

## Behaviour

- **Discovery**: `SerialPort.list()` filtered to vendor `303A` product `1001`.
  `AIRCUBE_PORT` overrides. On macOS the `/dev/cu.*` call-out device is used.
- **Reset safety**: after opening, DTR is set high and RTS low so no later
  transition passes through the ESP32 auto-reset state (which would reboot
  the cube and restart its sensor warm-up).
- **Command probe**: `get_config` is sent at most 3 times per connection.
  Firmware from before February 2026 never reads the USB receive FIFO, so a
  talk-only cube is detected before 64 bytes are sent and nothing further is
  written to it. History sync only runs after a reply proves the cube listens.
- **History**: `get_history_info` then `get_history` pages of 48 slots, anchored
  to wall-clock time at sync (the cube has no RTC). Synced on connect, every
  15 minutes, and whenever the relay answers `needHistory`.
- **Publishing**: readings are buffered (cap 4000) and flushed every 3 s in
  batches of at most 300. HTTP 409 (another publisher owns the relay) and
  401/403 back off 30 s; network errors back off 5 s. The publisher id is
  persisted in `state.json` so restarts keep the same relay slot.
- **Capture**: one JSON line per reading in `readings-YYYY-MM-DD.jsonl`, pruned
  after `GATEWAY_CAPTURE_DAYS`. Each line is exactly the `parseLive` object
  (timestamp in unix seconds, `source: "physical"`), for example:

  ```json
  {"timestamp":1792183208.075,"uptimeMs":951980,"source":"physical","temperatureC":25.87,"humidity":46.16,"vocLevel":0,"eco2":400,"etvoc":0,"co2":487,"lux":0,"aqiUba":1,"pmPresent":true,"pmValid":true,"pm1":2.5,"pm25":4,"pm4":5.2,"pm10":5.8,"isPro":false,"hasTrueCo2":true,"hasLux":false,"ensStatus":"OK","warmingUp":false,"tempValid":true,"humValid":true,"co2Valid":true,"etvocValid":true,"sensorMissing":false,"fwVersion":"2.0.7","frcNeeded":false}
  ```

- **Health**: `GET http://127.0.0.1:8787/health` returns connection state, port,
  capabilities derived from the frames, firmware, command support, last
  reading/publish times, buffer depth and capture status.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NOWARE_API` | `http://localhost:8080` | Relay base URL (`https://noware.so` in production) |
| `GATEWAY_TOKEN` | unset | Bearer token (>= 32 chars); unset = capture-only |
| `GATEWAY_LABEL` | hostname | Publisher name shown to viewers |
| `AIRCUBE_DEVICE_KEY` | `aircube-1` | Stable key for this cube in the home model |
| `AIRCUBE_ROOM` | empty | Room name reported with the readings |
| `AIRCUBE_PORT` | auto | Serial port override |
| `GATEWAY_HEALTH_PORT` | `8787` | Loopback health port |
| `GATEWAY_STATE_DIR` | `~/.noware-gateway` | `state.json` location |
| `GATEWAY_CAPTURE_DIR` | `<state>/captures` | Daily JSONL files |
| `GATEWAY_CAPTURE_DAYS` | `14` | Retention; `0` keeps everything |
| `LOG_LEVEL` | `info` | `debug` also logs the cube's ESP_LOG lines |

## Files

| File | Purpose |
|---|---|
| `collector.js` | Entry point: wiring, reconnect loop, shutdown |
| `config.js` | Environment and `.env` parsing with defaults |
| `discover.js` | USB vendor/product matching |
| `link.js` | Line framing, request/reply matching, write-stall detection |
| `cube.js` | Command probe, capabilities, history sync and anchoring |
| `publisher.js` | Buffering, batching, relay HTTP with backoff |
| `capture.js` | Daily JSONL files and pruning |
| `health.js` | Loopback health server |
| `state.js` | Persistent publisher id |
| `launchd/` | LaunchAgent template for the Mac mini |

Tests live in `../tests/gateway.test.js` and run with the root `npm test`; they
use a fake serial transport and a real in-process relay, no hardware needed.
