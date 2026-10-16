# Moving the AirCube to the Mac mini gateway

The AirCube is developed on a laptop today. When it moves to the office Mac
mini, that machine becomes the always-on collector: `gateway/collector.js`
reads the cube over USB and publishes to the noware relay, and every signed-in
dashboard (laptop, phone, contractor view) reads from the relay. No browser tab
needs to stay open anywhere.

Nothing in the gateway is tied to a machine. The serial port is discovered by
USB id, paths come from the home directory at runtime, and the only secret is
the bearer token, which lives in a gitignored `.env` file on the mini and in
Secret Manager / Cloud Run on the server.

Local development uses exactly the same collector against a local server, so
the migration is: same steps, different `NOWARE_API` and token.

| | Local Mac (today) | Mac mini (later) |
|---|---|---|
| `NOWARE_API` | `http://localhost:8080` (`npm run build && npm start`) | `https://noware.so` |
| `GATEWAY_TOKEN` | any 32+ char string, also passed to the local server as `GATEWAY_TOKENS` | the token stored in Cloud Run's `GATEWAY_TOKENS` |
| Start | `node gateway/collector.js` in a terminal | LaunchAgent (step 6) |

## 1. Clone or update the repository

```sh
# first time
git clone https://github.com/hyperchi/noware-exploer.git
cd noware-exploer

# later updates
cd noware-exploer
git pull
```

Node 20 or newer is required (`node --version`). Install it with the official
installer or Homebrew (`brew install node`). The Mac mini does not need Vite,
Playwright or the explorer build; only the gateway's own dependencies.

## 2. Install dependencies

```sh
cd gateway
npm install
```

This installs `serialport` (with a prebuilt binary for Apple silicon and
Intel). Nothing is installed globally and the root project's `package.json`
is untouched.

## 3. Device permissions on macOS

The AirCube uses the ESP32-H2's built-in USB Serial/JTAG, which macOS drives
with its own class driver: no kernel extension, no driver download, no `sudo`.
The device node (`/dev/cu.usbmodem…`) is world read/write, so the logged-in
user can open it.

Checks:

```sh
ls -l /dev/cu.usbmodem*          # one entry per plugged-in cube
system_profiler SPUSBDataType | grep -A6 "USB JTAG/serial debug unit"
```

Use a data-capable USB-C cable (charge-only cables enumerate nothing). If
the mini will run headless, keep a user logged in (or enable automatic login
for the gateway user) so the per-user LaunchAgent in step 6 starts.

## 4. Configure the environment

```sh
cd gateway
cp .env.example .env
```

Edit `.env`:

```ini
NOWARE_API=https://noware.so
GATEWAY_TOKEN=<token from the step below>
GATEWAY_LABEL=office-mac-mini
AIRCUBE_DEVICE_KEY=aircube-office
AIRCUBE_ROOM=Office
```

`.env` is gitignored. Do not commit it and do not paste the token into chat
or tickets.

### Generating the token and enabling it on Cloud Run

Generate a token on any machine:

```sh
openssl rand -base64 48 | tr -d '/+=' | cut -c1-44
```

Put the same value in the server's `GATEWAY_TOKENS` (comma separated if
several gateways exist; each token must be at least 32 characters). The
preferred way is a Secret Manager secret referenced by the Cloud Run service,
matching how `SESSION_SECRET` is handled. Run these from a workstation with
`gcloud` access to project `noware-hardware`; do not run them from the mini:

```sh
# one-time: create the secret and grant the runtime service account access
printf '%s' '<token>' | gcloud secrets create noware-gateway-tokens \
  --project=noware-hardware --data-file=-
gcloud secrets add-iam-policy-binding noware-gateway-tokens \
  --project=noware-hardware \
  --member=serviceAccount:noware-runtime@noware-hardware.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

# attach it to the service (preserves the other env vars and secrets)
gcloud run services update noware \
  --project=noware-hardware --region=us-central1 \
  --update-secrets=GATEWAY_TOKENS=noware-gateway-tokens:latest
```

Rotating a token later means adding a new secret version and restarting the
gateway with the new value; the old one stops working as soon as the service
picks up the new version. If `GATEWAY_TOKENS` is unset on the server, no
gateway can publish; browser publishing keeps working.

For a local server, pass the token directly:

```sh
# repo root, in another terminal
npm run build
SESSION_SECRET=$(openssl rand -base64 48) GATEWAY_TOKENS=<token> npm start
```

## 5. Start the collector

```sh
cd gateway
node collector.js
```

Expected log lines, in order:

```text
INFO  noware gateway v0.1.0 starting {"api":"https://noware.so","publish":"enabled",...}
INFO  health endpoint ready {"url":"http://127.0.0.1:8787/health"}
INFO  cube connected {"port":"/dev/cu.usbmodem2101","serialNumber":"74:4D:BD:69:0C:9F","matched":"usb-id"}
INFO  cube answers commands {"ledPercent":100,"readoutPeriodMs":1000}
INFO  cube capabilities {"model":"base","pm":true,"pmValid":true,"trueCo2":true,"illuminance":false,...,"fw":"2.0.7"}
INFO  history synced {"slots":1009,"windowS":300}
INFO  history published {"slots":1009}
INFO  publish ok {"api":"https://noware.so"}
```

`Ctrl-C` flushes the buffer and closes the port cleanly.

## 6. Install as a persistent startup service (LaunchAgent)

The template `gateway/launchd/com.noware.aircube-gateway.plist` runs the
collector at login, restarts it if it exits, and logs to `/tmp`. It reads
`gateway/.env` itself, so the plist contains no secret.

```sh
cd /path/to/noware-exploer          # the checkout from step 1
sed -e "s|__NODE__|$(command -v node)|g" -e "s|__REPO__|$PWD|g" \
    gateway/launchd/com.noware.aircube-gateway.plist \
    > ~/Library/LaunchAgents/com.noware.aircube-gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.noware.aircube-gateway.plist
launchctl print gui/$(id -u)/com.noware.aircube-gateway | head -20
```

Useful commands:

```sh
launchctl kickstart -k gui/$(id -u)/com.noware.aircube-gateway   # restart (e.g. after git pull)
launchctl bootout gui/$(id -u)/com.noware.aircube-gateway        # uninstall
tail -f /tmp/noware-aircube-gateway.log
```

Stop the terminal instance from step 5 before bootstrapping the agent: two
collectors cannot share the port, and the relay only accepts one publisher at
a time (the second one logs `publish blocked`).

## 7. Verify the device is detected

```sh
curl -s http://127.0.0.1:8787/health
```

Look for:

```json
"connected": true,
"port": "/dev/cu.usbmodem2101",
"model": "base",
"fwVersion": "2.0.7",
"capabilities": { "pm": true, "trueCo2": true, "illuminance": false, ... },
"commandSupport": "ok",
"lastReadingAt": 1792183220.915
```

`lastReadingAt` should advance about once a second (`date +%s` for
comparison). `capabilities` is derived from the frames, so a cube without a
particle sensor shows `"pm": false` and the dashboards hide particle tiles.

## 8. Verify readings reach the backend

In the same health output:

```json
"publish": {
  "enabled": true,
  "lastPublishStatus": "ok",
  "lastPublishAt": 1792183262.193,
  "buffered": 1,
  "needHistory": false
}
```

`buffered` stays small (readings are flushed every 3 s). From any signed-in
browser you can also read the relay directly: `https://noware.so/api/cube`
returns JSON with `"publisherKind": "gateway"`, your `GATEWAY_LABEL` as
`publisher`, `"online": true`, recent `live` readings and `slots`.

## 9. Verify the dashboard shows the device online

Open `https://noware.so/dashboard/` on any machine and sign in. The cube
appears as the shared device, named `<AIRCUBE_ROOM> cube`, with a live status
and the room you configured. Live values should match the health endpoint's
`lastReading`. The history chart fills from the slots the gateway uploaded.

Then unplug the cube for 30 seconds: the dashboard must show it offline with
the last reading time, not keep displaying the old values as current. Plug it
back in and the gateway reconnects on its own (`cube connected` in the log).

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `connect failed {"error":"no AirCube found (USB 303A:1001)"}` repeating | Cable is charge-only, cube unpowered, or a USB hub is not enumerating. `ls /dev/cu.usbmodem*` must list it. Set `AIRCUBE_PORT` only if the id ever changes. |
| `connect failed ... Resource busy` | Another process has the port: a browser tab with the dashboard connected over USB, a second collector, or `idf.py monitor`. `lsof /dev/cu.usbmodem*` names it. |
| `cube streams readings but ignores commands (legacy firmware)` | Firmware older than February 2026. Live readings still publish; history does not. Flash current firmware from the dashboard's Flash firmware dialog. |
| `publish unauthorized` | Token mismatch between `.env` and the server's `GATEWAY_TOKENS`, or the token is shorter than 32 characters. |
| `publish blocked ... another publisher owns the relay` | A browser tab or another gateway is publishing. It is retried every 30 s and takes over once the other side has been quiet for 30 s. |
| `publish unavailable` | Server unreachable (network, DNS, local server not running). Readings buffer (up to 4000) and flush when it returns. |
| Readings arrive but `needHistory` stays `true` | The cube refused or timed out on history paging; the next 15-minute resync retries. `LOG_LEVEL=debug` shows the cube's own log lines. |
| Cube reboots when the collector starts/stops | Should not happen (DTR high, RTS low after open). If it does on a particular hub, report the hub; sensor warm-up restarts take about 3 minutes. |
| LaunchAgent not running after reboot | No user logged in. Enable automatic login for the gateway user, or convert to a LaunchDaemon (runs before login; needs the plist in `/Library/LaunchDaemons` with `UserName` set). |
| `health` port already in use | Change `GATEWAY_HEALTH_PORT` in `.env`. |
| Capture files growing | Default retention is 14 days under `~/.noware-gateway/captures`; set `GATEWAY_CAPTURE_DAYS`. |

Capture files are the replay source for the dashboard's scenario replay: one
JSON object per line, timestamp in unix seconds, `source: "physical"`.
