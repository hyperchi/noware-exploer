# noware — Hardware Playground

Primary domain: https://noware.so

Direct GCP access while DNS caches update: https://noware-1010426969452.us-central1.run.app

GCP project: `noware-hardware`. Cloud Run is deployed at https://noware-1010426969452.us-central1.run.app. Cloudflare routing is configured and the zone is active. The dedicated Google OAuth client is configured on Cloud Run. Cloudflare Universal SSL is active and HTTPS/login-page checks pass at its current IPs. Some local DNS caches still resolve the old Namecheap parking address. Real-account sign-in and logout remain to be verified. Hosting is exclusively Google Cloud Run with Cloudflare routing. See [hosting setup](infrastructure/README.md).

Interactive PCB explorer and browser-based behavioral simulator, built from the actual [hyperchi/AirCube](https://github.com/hyperchi/AirCube) KiCad design.

## Use

- Search or click components to inspect positions, pad numbers, and nets.
- Highlight a net, flip the board, toggle traces/copper fills/labels, zoom, and drag to pan.
- Adjust TVOC, simulated true CO₂ (Pro), brightness, and power. Presets provide quick scenarios.
- Simulation settings persist in this browser. Export a scenario as JSON.
- Download original KiCad board and schematic files from the footer.

## Scope and provenance

The rendered board is **AirCube v1.1 Base**, extracted from upstream commit `bd857275c1f02efbec6942a96e433bde9d4d417e`: 52 footprints including mechanical/graphic items, 301 routed tracks, 53 vias, and 47 net entries. The source PCB does not contain the Pro sensors shown in the supplied schematic photographs. Pro inputs are virtual; switching model does not alter board geometry.

The renderer uses original pad positions/rotations, routing, vias, footprint linework, filled copper polygons, and edge cuts. It simplifies component body rendering and does not render custom footprint graphics/text or 3D STEP models. It is an explorer, not a PCB editor; changes do not modify manufacturing files.

`src/simulation.js` ports the TVOC and CO₂ threshold interpolation and worst-source selection from upstream `firmware/main/main.c`. Target hue follows the green-to-red firmware curve. Manual brightness is a visual approximation. This does **not** execute ESP32 firmware, solve electrical circuits, emulate sensor dynamics/warm-up, reproduce automatic ambient-light dimming or LED transition timing, or connect to live hardware. No AI credentials are required. Production sign-in uses a small server authentication endpoint. Scenario settings stay in browser local storage unless downloaded.

## Development

### Shared dashboard cube

Every signed-in `@noso.so` account can publish to and read the same live cube relay
at `/dashboard/`; there is no named-user allowlist. Owner-bound gateways for NOSO
accounts publish into that same relay. One publisher holds the relay at a time;
another publisher can take over after the current publisher is silent for 30 seconds.
Approved guests and gateways without a NOSO owner remain isolated. Household and
contractor permissions are unchanged. Viewers receive updates through the existing
polling feed (up to 30 seconds to discover a cube, then every 10 seconds).

Requires Node 20.19+ or 22.12+ and Python 3 for regenerating board data.

```sh
npm ci
npm run dev
npm test
npm run build
python3 scripts/extract.py
node scripts/browser-check.mjs
```

The browser check requires Chrome and a running dev server. Set `TEST_URL` to check a deployed site. Cloud Run runs `node server.js` from the Dockerfile.

## Attribution

Original AirCube hardware and firmware by [StuckAtPrototype](https://github.com/StuckAtPrototype/AirCube), obtained through hyperchi/AirCube. Original source files retain their upstream content. The extracted data, renderer, and JavaScript simulation port are additions for this explorer. Distributed under Apache-2.0; see LICENSE.

Deploy using `./infrastructure/deploy-gcp.sh`; deploy Cloudflare routing with `npx wrangler@latest deploy --config infrastructure/wrangler.jsonc`.

## Noso and approved guest Google sign-in

Production routes are protected by the Express server on Cloud Run, including board JSON, bundles, and source downloads. Only the login page, login script, favicon, authentication endpoint, and health endpoint are public. The API verifies Google's RS256 signature, issuer, audience, freshness, email verification, exact `hd=noso.so`, and a browser-bound login nonce. Merely entering an email address never grants access.

Verified identities receive a signed HttpOnly, Secure, SameSite=Lax cookie lasting exactly 30 days (2,592,000 seconds). Expiry is fixed at sign-in, not extended by page visits. Sign out clears this browser's session. Changing `SESSION_SECRET` invalidates all sessions. Workspace membership is checked at sign-in; removing a Workspace account does not revoke an existing 30-day session immediately.

Required server-only Cloud Run environment variables:

- `GOOGLE_CLIENT_ID`: OAuth web client in the dedicated noware project.
- `SESSION_SECRET`: independently generated random secret, at least 32 characters.
- `APP_ORIGIN`: `https://noware.so`.
- `ADDITIONAL_AUTH_ORIGINS`: `https://noware-1010426969452.us-central1.run.app` (legacy OAuth allowlist; browser visits to the direct GCP URL now redirect to the canonical domain).

Google Auth Platform lists both `https://noware.so` and `https://noware-1010426969452.us-central1.run.app` under the client's **Authorized JavaScript origins**. No redirect URI or Google client secret is needed for this GIS callback flow. The browser receives only the public client ID and a short-lived nonce.

`npm run dev` is for local UI development without the authentication server. Run `npm run build && npm start` to exercise the server locally. The existing public source repository remains public. Run `node scripts/auth-browser-check.mjs` to check production authentication; a real Noso account must complete the final sign-in check.

## Branding and canonical URLs

The login and explorer use the visual language of noso.so: Inter, white grid backgrounds, neutral borders, square controls and blue accents. `public/favicon.ico` is the exact favicon served by noso.so (downloaded from its declared S3 icon URL).

`/login` serves sign-in; `/login.html` permanently redirects there. Direct `*.run.app` requests redirect to `https://noware.so` with the path and query preserved, except `/api/health`. The Cloudflare worker overwrites `X-Noware-Public-Host` so forwarded requests avoid a redirect loop. This header only controls URL redirects, never authentication. Deploy the worker before the server when changing this routing.

Guest access: `lib/auth-policy.js` permits the exact Google-verified Gmail address `shanshan0343@gmail.com` alongside verified `@noso.so` Workspace identities. Other Gmail accounts and aliases remain denied. Google audience must be External; the app enforces its own allowlist. The sign-in button has no hosted-domain account-picker filter. Guest sessions use the same 30-day signed, HttpOnly cookie.

## Design lab

The side panel includes a design study for current ESP32-H2 with a gateway, a Wi-Fi MCU replacement (ESP32-C3 candidate), or an added LTE-M modem + SIM. Select Base or Pro sensor configuration, reporting interval, payload, USB-C input current, board power, radio rail and supply capacity. Run an accelerated connection sequence, inject missing SIM/network/antenna and supply faults, compare options, save a baseline, and export a JSON study. State remains in local storage.

All numerical power/timing/throughput defaults are **editable illustrative assumptions**, not measurements or guaranteed part specifications. Duty cycle is capped at 100%; throughput limits produce a backlog. USB-C input power is modeled load divided by conversion efficiency; daily energy is input power × 24 hours. Peak input current is checked against the configured 5 V source budget. Failed attempts consume energy but deliver no data. Each report reconnects; weak signal models doubled connection/transfer time and one retry. Data estimates include configurable overhead and retries over 30 days. Carrier billing, TLS timing, RF, real firmware, detailed electrical behavior and physical PCB edits are not simulated.

Both Base KiCad and the user's Pro schematic photos label U7 ESP32-H2-MINI-1, which has BLE/802.15.4, not Wi-Fi. The Pro-only section adds SCD41 and VCNL4040; ENS210 is omitted. Pro selection changes the sensor configuration description, not the displayed Base layout or an invented measured power load: set the rest-of-board power from measurements. Unrouted signal pads are shown as candidates requiring review; NC pads are excluded. Manufacturer links in each option substantiate connectivity/module choices, not the illustrative numerical defaults.

Verification: `npm test`, then with local Vite running `TEST_URL=http://localhost:5175 node scripts/design-browser-check.mjs` and `TEST_URL=http://localhost:5175 node scripts/browser-check.mjs`.

Connection changes automatically focus the PCB front and highlight affected source components. Thread keeps U7; Wi-Fi marks U7 for replacement and U6 for power review; cellular keeps U7 and marks U6/P1 for power-budget review. Colored rings remain attached to KiCad component coordinates while zooming/panning. The caption lists proposed cellular additions without inventing their PCB placement. Air & LEDs clears the design overlay; returning to Design lab restores it.

## Component library and 3D

Open **Component library** in the header area or **View in 3D** in the inspector. All 44 Base PCB components are searchable by reference, value and footprint, with category filters, roles, footprint details and a Locate on board action. Rotate with drag, zoom with wheel/pinch, or use Top/Bottom/Reset.

All 44 board entries have dedicated model assets: 40 use manufacturer, community or package CAD; ENS161, ENS210 and the RKB2 switch use labeled datasheet reconstructions; TP2 shows board copper. USB4105 has a detailed socket model and TL1016 uses official E-Switch STEP. The resistor/capacitor/SOT/SOD packages have body and contact materials. Reconstructions reproduce published package features, with illustrative finishes and undocumented details. Generic CAD does not establish exact vendor markings or tolerances. These are individual part views, not a complete 3D board assembly. Pro-only sensors are absent from this Base catalog.

Source attribution, license terms and transformation notes are in `public/models/README.md`. Espressif geometry is CC BY-SA 4.0 with the KiCad exception; see `ESPRESSIF-LICENSE.md`. Conversion uses occt-import-js at development time; the browser lazily loads Three.js, OrbitControls and preconverted geometry. Models remain protected by the existing login middleware. WebGL failure displays an explicit fallback message with component details available.

Run `node scripts/library-browser-check.mjs` against local Vite (default port 5175) to verify 3D, search, provenance labeling, locate, reopening, Escape and mobile layout. Rebuild geometry with `node scripts/prepare-component-models.mjs <AirCube.step> <ESP32-H2-MINI-1.STEP>`.

## Proposed connectivity options and USB-C power

The library includes two proposed solution entries separate from the 44 installed components: ESP32-C3-MINI-1 Wi-Fi and Quectel BG95 cellular + SIM. Each lists supporting hardware and offers Try in design lab, which selects the connection and highlights affected PCB components. Wi-Fi uses official Espressif CAD. BG95 uses detailed community-hosted STEP geometry with shield markings and underside contacts; it remains a proposed part without board placement. Supporting SIM/antenna/regulator parts are requirements, not a finalized BOM.

The design simulator is now USB-C-only. Legacy battery settings are removed when restoring saved state. Controls expose the 5 V source current budget, radio rail current/voltage and conversion efficiency. Results show USB input watts, Wh/day, average and peak input current, and headroom; neither battery runtime nor USB PD negotiation is modeled. The default 500 mA is an editable planning input, not a guarantee of any USB source. Supply availability must be established from the actual source, cable and advertised/negotiated capability.

## Air intelligence (dashboard)

`/dashboard/` retains the original device cards and sensor/chart console. The added **Simple view** (`#/simple`) presents a plain-language status, one next step, visible measurements, pet/dust and outdoor-smoke clues, and homeowner activity notes. The optional **Air insights** view (`#/intelligence`) answers, for each room: what is in the air, whether that is normal for this home, what probably caused it, what to do, whether it worked, and whether to ask your contractor. The numbers stay visible under every conclusion. See [docs/AIR_INTELLIGENCE_ARCHITECTURE.md](docs/AIR_INTELLIGENCE_ARCHITECTURE.md) for the design and [docs/MAC_MINI_AIRCUBE_GATEWAY.md](docs/MAC_MINI_AIRCUBE_GATEWAY.md) for running the headless collector on the office Mac mini.

- Engine: `lib/air-intelligence/` (pure ES modules, shared by server, browser and tests). Capabilities come from the device's frames: the AirCube with the SEN63C reports PM1/PM2.5/PM4/PM10 and true CO2; a legacy Base has neither and is treated accordingly.
- Server: `/api/home` (homeowner) and `/api/contractor` (contractor), authorization in `lib/authz.js`, store in `lib/home-store.js` (local JSON with `NOWARE_DATA_DIR`, or private GCS snapshots with `NOWARE_STORE_BUCKET`; otherwise ephemeral).
- Gateway: `gateway/` publishes a USB cube to the relay with a bearer token (`GATEWAY_TOKENS=<token>:<owner email>` on the server). The browser path (Web Serial) still works and is used on laptops.
- Demo: outside production (`NODE_ENV` not `production`; `NOWARE_DEMO=1` cannot override production) the first sign-in seeds a demo household, contractor and customers with simulated data, always labelled. Set `NOWARE_DEMO=0` to disable. Production never seeds.
- Simulator: every room can run a scenario (home menu "Try a scenario", or the room menu). Scenarios cover healthy, cooking, repeated cooking, smoke/combustion, cleaning, dust, outdoor pollution, overnight ventilation, persistent particles, shower, high humidity, pet/allergy context, sensor offline, warm-up, equipment before/after, unknown mixed and a legacy Base cube.

Verification:

```sh
npm test
npm run build
SESSION_SECRET=<secret> NODE_ENV=development PORT=8089 node server.js
SESSION_SECRET=<same secret> TEST_URL=http://localhost:8089 node scripts/air-browser-check.mjs
```

Environmental guidance only, never medical advice. Simulated data is always labelled as such.

## Deploy from GitHub

Push to `main` to validate and deploy automatically to https://noware.so on GCP. You can also use [Actions → Deploy noware to GCP](https://github.com/hyperchi/noware-exploer/actions/workflows/deploy-gcp.yml) and select **Run workflow** on `main`. Pull requests run checks without production access. Keyless GCP authentication and repository deployment variables are configured; the runtime login secret stays in Secret Manager. See `infrastructure/README.md` for permissions and deployment details.

Run `node scripts/library-models-check.mjs` to load all 46 entries and check model bounds/camera controls. Additional STEP assets use `node scripts/convert-step.mjs <model-name> <source.step>`; reconstructions use `node scripts/prepare-datasheet-models.mjs`. Sources and material treatments are recorded in `public/models/README.md`.

### Simple view: AQI, source patterns and settings

Open `/dashboard/#/simple` for the companion view; the original dashboard remains at `/dashboard/`. Choose your city/postal code under **Set your location** for regional outdoor PM2.5. Indoor and outdoor AQI use the same **2024 US EPA PM2.5 NowCast** calculation. The outdoor estimate comes from Open-Meteo / CAMS, and is not a measurement directly outside your home. Commercial production use requires a configured `OPEN_METEO_API_KEY`; local development can use the public endpoint.

**Chemicals & odors → What causes this?** opens the common-source guide and your room's recorded event patterns, durations, recovery and activity-note matches. Sources are hypotheses, not chemical identification. Settings now group optional home, people/pets, equipment and provider choices, with firmware/calibration under Advanced.

For a local physical-device session, set `NOWARE_DEMO=0` and follow [the gateway guide](docs/MAC_MINI_AIRCUBE_GATEWAY.md). Keep the feature branch local for review; do not deploy until explicitly approved.
