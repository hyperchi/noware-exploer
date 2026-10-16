# Air intelligence architecture

noware turns AirCube measurements into conclusions and actions for a homeowner, and into evidence for the homeowner's contractor. Numbers are evidence; conclusions and actions are the product; the numbers never disappear.

## What was there before (inspection, October 2026)

- **Explorer app** (`src/`, Vite): PCB explorer, design lab, component library. Untouched by this work.
- **Dashboard** (`public/dashboard/`): a no-build static app (plain ES modules, vendored uPlot and esptool-js) ported from the upstream AirCube web app. Chrome's Web Serial API talks to the cube over USB at 115200 baud; the firmware prints one JSON line per second and answers JSON commands.
- **Sharing relay** (`api/cube.js`): the browser with the cube publishes readings and the cube's 7-day history to the Express server on Cloud Run; other signed-in browsers poll it. One in-memory store, one Cloud Run instance.
- **Auth and hosting**: Google sign-in for `@noso.so` plus one approved guest, 30-day signed cookie, Cloud Run behind a Cloudflare worker, GitHub Actions deploy on `main`. Unchanged.
- **Hardware attached to this Mac**: an AirCube Base with the Sensirion SEN63C fitted (firmware 2.0.7). It reports PM1 / PM2.5 / PM4 / PM10, a direct CO2 reading, temperature and humidity (all from the SEN63C) plus ENS161 eTVOC / eCO2 / VOC level. No illuminance. The firmware's 5-minute history slots carry PM2.5 (x10) since the layout migration in `hyperchi/Noso_AirCube`.
- **Gap found**: our dashboard copy of `protocol.js` ignored the `sen63c` object and the `p_a/p_n/p_x` history keys, so particle data was dropped. That is fixed; capability detection now comes from the frames, not from a model name.

## Pipeline

```
AirCube (USB serial JSON)
   │
   ├── browser tab (Web Serial, devices.js)  ──┐
   └── gateway/ (headless Node, serialport)  ──┤  POST /api/cube/live, /api/cube/history
                                               ▼
                                   api/cube.js relay (in memory)
                                               │ onLive / onHistory
                                               ▼
                               lib/home-service.js  → RoomEngine per device
                                               │
                 lib/air-intelligence/ (pure ES modules, shared with the browser)
                 normalize → capabilities → baseline → features → events →
                 infer-source → recommendations → status/health → summary
                                               │
                     ┌─────────────────────────┼──────────────────────────┐
                     ▼                         ▼                          ▼
          /api/home (homeowner)      /api/contractor (contractor)   reports / contact payloads
                     ▼                         ▼
        public/dashboard room & home    public/dashboard contractor views
```

The same engine runs in the browser for a cube on this computer's USB and for in-tab scenarios (`public/dashboard/js/local-intelligence.js`), so the room page works with no server and shows the verdict the moment a reading arrives.

## Engine modules (`lib/air-intelligence/`)

| Module | Responsibility |
|---|---|
| `types.js` | Vocabulary: channels, statuses, categories, sources, evidence kinds, roles, profile defaults. |
| `thresholds.js` | Accepted bands per channel (EPA PM, ENS161 TVOC bands, CO2 ventilation guidance, comfort ranges), friendly names, tooltips, formatting. |
| `normalize.js` | One `Sample` shape from live readings or 5-minute slots; a channel is `null` unless the device vouched for it. |
| `capabilities.js` | `DeviceCapabilities` derived from frames (`pmPresent`, `hasTrueCo2`, validity flags). |
| `baseline.js` | Personal baselines: p10–p65 over up to 7 days excluding the last 30 min, per time-of-day bucket once two days exist; a "session" baseline for a device with no history; the elevated line is the accepted "good" ceiling raised by the personal range but capped halfway into the "needs attention" band, so a room that is stuffy every night is still told so. |
| `features.js` | Per-channel: robust current value, ratio/delta to baseline, slopes, trend, elevated run (start, peak), onset minutes, recovery share; cross-channel relations (PM10/PM2.5, PM1/PM2.5, co-rises). |
| `events.js` | `AirEvent` lifecycle active → improving → resolved with continuity across assessments; what-changed rows. |
| `infer-source.js` | Evidence-weighted candidates (cooking, cleaning, outdoor, dust, combustion, poor ventilation, shower, pet activity) with for/against items tagged measured / derived / inferred / context; the winner needs a minimum score and a margin, otherwise `unknown` with the possibilities listed. Pet activity is capped and can never win; outdoor pollution is capped without outdoor data. |
| `confidence.js` | Score → low / medium / high. |
| `recommendations.js` | Leveled actions (`diy`, `check`, `contractor`) with reason, expected impact, conditions and a smart-home capability hook; window advice depends on outdoor data and never reads "unavailable" as "good"; the contractor step only appears when `escalationFor` says so. |
| `status.js`, `health.js` | Overall status (worst important risk) with explanation; device state online / warming up / stale / offline / fault; no verdict without a live reading. |
| `patterns.js` | 30-day recurrence: counts, long events, median recovery, time-of-day histogram, overnight CO2 nights, sustained humidity, before/after service events. |
| `contractor.js` | `ContractorInsight` (observed issue vs possible solutions, `requiresProfessionalDiagnosis`, talking points) and `OpportunitySignal` generation; escalation thresholds shared with the homeowner recommendations. |
| `summary.js`, `engine.js` | `RoomEngine` (ingest readings/slots, acknowledge, feedback, assess) producing the `AirIntelligenceSummary`; measurement rows (meaning → number → context), recovery wording, air-story timeline, home roll-up. |
| `report.js` | Contact payload and air report: a summary of the story, never a dump of readings. |
| `household.js`, `outdoor.js` | Household context and personal notes; `OutdoorAirProvider` contract with an explicit "unavailable" state. |
| `scenarios.js` | Deterministic multivariate scenario generator (live curves, 30-day histories, service events) used by the simulator, the demo seed and the tests. |

### AirIntelligenceSummary

One object feeds every surface: `currentStatus`, `primaryIssue` (headline, explanation, measurement with baseline, source, confidence, evidence, alternatives, recommendations, recovery, personal notes), `measurements[]`, `activeEvents[]`, `recentEvents[]`, `homeownerRecommendations[]`, `recovery`, `timeline[]`, `patterns`, `contractorInsights[]`, `opportunitySignals[]`, `deviceHealth` (with `source` and `simulated`), `outdoor`, optional `debug` (features, baselines, candidate scores, telemetry).

## Data layer

- `lib/home-store.js`: households (members, profile, rooms, equipment), contractors, consent-gated `HouseholdContractor` relationships, service events, contact requests, signal status, feedback, engine state. Memory on Cloud Run; a JSON file when `NOWARE_DATA_DIR` is set (local dev, Mac mini). Firestore would be another implementation of the same methods.
- `lib/authz.js`: roles from the store, not the UI. Homeowner = member; contractor = staff of a company with an active relationship and `shareInsights = true`; admin via `ADMIN_EMAILS`. Contractors get a reduced household view (no member emails, no debug, no homeowner action buttons).
- `lib/home-service.js`: relay hooks → engines; summaries; acknowledge / feedback / contact / report; contractor customer triage; server-side scenario simulations (real time, with an "advance" demo shortcut). A published cube is attached to the publisher's household and to the room it names (`AIRCUBE_ROOM` on the gateway); a publisher without a household gets one.
- `lib/demo-seed.js`: outside production only (`NOWARE_DEMO=1` forces it; `NODE_ENV=production` disables it). Seeds a demo household with allergies and a cat, three rooms with 30-day histories and live simulations, a demo contractor, two more customers and one non-consenting home for authorization tests. Everything seeded is labelled simulated.

## APIs

- `/api/cube` (existing relay; session or gateway bearer token from `GATEWAY_TOKENS`).
- `/api/home`: `me`, `scenarios`, household read/patch, household and room summaries, series for charts, event ack and feedback, contact (returns the packaged payload and safe fallbacks: tel / mailto / booking URL, since no messaging integration exists), report, simulate.
- `/api/contractor`: customers with triage counts (needs attention / recurring / improved / all), customer detail (state, recurring issues, insights, signals, service history, homeowner requests), signal status, service events (an installation also records the equipment).

## Dashboard

- `#/` retains the original device-card dashboard and automatically opens the sensor/chart detail when one cube is connected. `#/intelligence` holds the optional air-insights home: "Your home" status, one card per room (status word, headline, numbers), contractor card, devices on this computer, "Try a scenario".
- `#/room/:home/:room`, `#/air/:device`, `#/scenario/:key`: the room page. Hero (status, likely cause, confidence, plain explanation, the number with its normal range, primary action, personal note), What should I do (levels), What's happening (what changed, source, evidence, feedback), Did it work, Today, Trends (one annotated chart, raw toggle), Sensor details (meaning → number → context tiles with tooltips), contractor card with contextual CTA, device status, developer view.
- `#/contractor`, `#/contractor/:home`: prioritized customers and one home's evidence (current state, recurring issues table, observed issue vs possible solutions, before/after since service visits, equipment and service history, homeowner requests, per-room story).
- `#/device/:id`, `#/settings`: the existing device page (brightness, history export, firmware) and settings, now with household context, rooms, equipment and the sharing toggle.

The dashboard imports the engine from `/dashboard/js/intelligence/`; `vite.config.js` serves it from `lib/air-intelligence` in dev and copies it into `dist/` at build time.

## Guardrails that are enforced in code

- No verdict from stale, offline or warming-up data; stale numbers are shown as "from N min ago".
- Simulated and replayed readings carry `source` through the relay, the store, the summary and every badge.
- A cat in the profile adds "pet activity" to the possibilities and a gentle note; it never produces "allergen detected".
- An occasional cooking event never produces a contractor step or an opportunity signal; recurrence, persistence after an acknowledged action, or sustained conditions do.
- Missing outdoor data is "unknown", not "good".
- Confidence is shown as low / medium / high; scores live in the developer view.

## Tests

`tests/intelligence.test.js` (20 fixtures, including the ten required ones and flows A–G), `tests/home-api.test.js` (authorization boundaries, homeowner flows, physical-cube attachment), `tests/gateway.test.js`, plus the existing suites. `scripts/air-browser-check.mjs` drives the dashboard in Chrome against a running server.

## Persistence and scale

`NOWARE_DATA_DIR` enables atomic JSON snapshots on local persistent disk. Live ingestion runs assessments even with no dashboard open, keeps two hours of raw samples, rolls readings into five-minute samples retained for 31 days, and retains events for 45 days. Firmware history resync merges older retained history instead of deleting it. Warm-up and fault samples do not enter valid rollups.

`NOWARE_STORE_BUCKET` selects `CloudHomeStore`: a private GCS snapshot authenticated with the Cloud Run runtime identity, loaded before requests are accepted, with a 30-second write debounce and generation preconditions. Startup fails closed on a storage read failure. Concurrent writers cannot silently overwrite another revision. This is a small single-writer deployment, not a multi-instance database. Configure one active writer and always-allocated CPU; drain the old writer before switching revisions. A failed conditional write needs operator intervention/restart after the competing writer is stopped. Snapshot storage is suitable for a small pilot; move the repository to a transactional database before broad fleet deployment. Unconfigured storage is explicitly ephemeral. No bucket or production deployment was created by this branch.

The cube also retains seven days of five-minute history and the gateway captures physical readings locally. An abrupt process termination can lose the last debounce window. No historical observations are invented to fill outages.


## Verification and provenance of this branch (October 16, 2026)

The original checkout was clean on `air-intelligence` at `a8837f9`. Remote `main` was fetched at `77544ed`. Work is isolated in sibling `noware-air-intelligence` on `feature/air-intelligence`. Existing commits `8e9dc32`, `8c12185`, and `a8837f9` were reused and integrated with the newer main. The public homepage, source PCB/design tools, Google auth, Cloudflare and deployment workflow remain intact. The protocol's stricter PM validation and source selection tests from main were retained.

Hardware reference inspected: `hyperchi/Noso_AirCube` commit `2b19449` (a clean temporary clone). It contains the SEN63C driver, CRC-checked I2C readings at address 0x6B, per-channel validity, and modified PM2.5 five-minute history layout. Its README still describes stock Base/Pro sensors; firmware code is authoritative for this modified device. The older local `hardware/aircube-source` checkout is clean at `23ff6f7`, points to `hyperchi/AirCube`, and lacks the SEN63C changes. No dirty firmware checkout was found in the inspected locations. The exact source tree used to flash the attached binary cannot be established from a version string. No firmware was changed or flashed during this work.

Read-only inspection of the existing loopback collector at port 8787 confirmed Base firmware 2.0.7, SEN63C PM1 / PM2.5 / PM4 / PM10 plus direct CO2 / temperature / humidity and ENS161 eTVOC / eCO2 / derived VOC Level; no illuminance. Example physical frame in the final live acceptance check: PM2.5 3.0 µg/m³, PM1 1.4, PM4 4.3, PM10 4.9, CO2 466 ppm, eTVOC 0 ppb, 25.78 °C, RH 42.45%. These are observations at test time, not seeded demo readings. A live reading does not independently prove calibration accuracy or inspect the physical PCB visually.

The currently running collector reads USB and publishes to an existing local server on port 8089. It was left untouched. `scripts/air-live-check.mjs` reads the collector's fresh health snapshot without opening the serial port, passes that exact physical reading through an isolated instance of this branch's authenticated relay and home API, and asserts matching metrics, online health, physical provenance and no lead. USB transport parsing, commands, history paging, reconnect budgets and failure buffering are separately exercised with scripted transport tests. Physical unplug/replug and a real Mac mini migration were not performed.

The firmware also supports BLE/BTHome and Zigbee for Home Assistant. Noware's collector uses USB serial; it does not pretend to ingest those radios. Only one radio stack is used per firmware boot. ENS161 reports warm-up for approximately three minutes (first conditioning may take an hour); SEN63C CO2 validity is withheld until its channel is ready. Health follows flags rather than inventing a fixed ready time. The [Sensirion SEN6x datasheet](https://sensirion.com/media/documents/FAFC548D/6731FFFA/Sensirion_Datasheet_SEN6x.pdf) describes separate SEN63C CO2 specifications; the UI therefore says direct CO2 and does not assume it uses the Pro SCD41's NDIR principle.

## Additional boundaries and product operations

- Every relay read, lease and publish is scoped to an authenticated owner. Publisher ids and device keys are not authorization. A known device cannot be rebound to another household by guessing its key. Ownerless gateway tokens can publish only to their private relay scope; use owner-bound tokens for the household UI. Contractor views use consent-gated summary APIs and cannot read the owner's legacy relay or raw series.
- `POST /api/home/households` creates the caller's own home. `POST /api/home/providers` requires an `ADMIN_EMAILS` principal and provisions a company with staff emails/contact details. `GET /api/home/providers` exposes the registered directory. Homeowner Settings can connect/change the provider through `POST /api/home/households/:id/provider`; sharing starts off, and the homeowner explicitly enables it. Role checks remain in the backend.
- Demo seeding is unconditionally disabled when `NODE_ENV=production`, including when `NOWARE_DEMO=1`. Development demo identities intentionally share the labelled demo household; do not expose the development server as a production tenant service.
- Measurement tiles and issue cards expose the latest actual channel value. Event detection uses a recent robust median; its spacing is calculated from recent live samples rather than old five-minute history. Baseline, trend, and source inference remain derived. Missing latest channels are withheld instead of reusing an old valid value.
- Contact actions record a contextual request and expose actual tel/mailto/booking fallbacks. The status is `recorded`, never a claim that an external message was delivered. A connected contractor with active consent sees recorded requests in customer detail. No email, SMS, booking or CRM integration is fabricated.
- `notifications.js` produces deduplicatable homeowner event/resolution intents and recurring-pattern contractor intents with a consent requirement. No delivery service is connected.
- Outdoor context defaults to unavailable. Simulation provides explicit fixture outdoor data. No live outdoor provider has been configured.

## Checks

Run `npm ci`, `npm ci --prefix gateway`, `npm run build`, and `npm test`. There is no configured lint or TypeScript check: the application is JavaScript. Use `node --check` across source modules for syntax validation. Root and gateway `npm audit` were clean after updating two vulnerable transitive lockfile entries.

Against a local server with `SESSION_SECRET` configured, run `scripts/air-browser-check.mjs` and `scripts/air-scenarios-browser-check.mjs` with the same secret and `TEST_URL`. The first checks actions, confidence/evidence, recovery, timeline, contact preview, contractor portfolio/detail, profile/settings and mobile. The second exercises every scenario on desktop and mobile with explicit offline/warm-up assertions. Screenshots are written under `/tmp` for visual inspection. Existing explorer/design/library checks run against Vite with `TEST_URL`.

## Remaining limits and next work

Source hypotheses are transparent heuristics, not chemical/allergen/source identification. eTVOC and eCO2 are sensor estimates, and VOC Level is a firmware-derived score. PM bands are orientation using published concentration breakpoints, not a computed official AQI or a claim that a short reading has the meaning of a 24-hour average. PM1/PM4 reference bands are provisional product context, not regulatory limits. Before/after comparisons describe association and require enough actual events. No product can establish filter fit, system pressure or equipment compatibility from these sensors alone.

This branch implements and tests the full local product loop. Production deployment, production provider provisioning, GCS IAM/bucket configuration, real Google sign-in with a user account, radio ingestion, external notification delivery, and physical Mac mini migration remain operational steps; they were not performed against the live service. The GCS adapter is tested against a deterministic API double, not a real bucket. Snapshot storage needs replacement with transactional storage for multiple writers or a large fleet.


## Cloud Run durable pilot configuration (operator runbook)

Use a private bucket in the existing dedicated `noware-hardware` project. Set `NOWARE_STORE_BUCKET` on the feature deployment and grant only its runtime service account `roles/storage.objectUser` on that bucket. Do not grant public access. Set max instances to 1 and use always-allocated CPU (`--no-cpu-throttling`) for the snapshot timer. Stop/drain the previous writer before starting another revision with this snapshot backend; generation preconditions protect data by rejecting competing writes rather than merging them. Leave the existing Cloudflare proxy and Google OAuth configuration in place. No production settings were modified during branch development.

The adapter uses [GCS object-generation preconditions](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert) and the runtime metadata identity; it needs no exported service-account key. Snapshot writes are intentionally a small pilot implementation with up to 30 seconds of crash-loss exposure. At larger scale, replace `HomeStore` with a transactional repository and preserve the shared domain API. Deployments still require test/build success and must be reviewed separately from this feature branch.

To register a real contractor, configure `ADMIN_EMAILS` to the administrator's already-authorized Google email and, from that signed-in session, POST `/api/home/providers` with `{name, members: [staffEmail], contact: {phone, email, bookingUrl}}`. Staff must also satisfy the existing Google identity allowlist; this work preserves that policy. Homeowner Settings can then choose the registered provider and enable sharing. The full provider staff setup is an administrative API operation; a public self-registration/contractor marketplace is intentionally absent.


## Preserve the existing dashboard (user preference)

The original device-card and sensor/chart views are the default again. They retain PM size-channel tiles and actual device history; air intelligence is a secondary `#/intelligence` view linked as “Air insights.” Normal live accounts do not show scenario controls on that home. Local viewing uses `NOWARE_DEMO=0` and a separate physical-only data directory. The design reference is noso.so: light surfaces, Inter typography, fine borders and restrained blue accents, while preserving the established dashboard layout.

`scripts/classic-air-browser-check.mjs` verifies the physical publisher, actual history, PM2.5 chart, original device cards/detail, absence of seeded demo homes, secondary insights navigation, and desktop/mobile layout. It requires an actual local physical publisher and the development login endpoint; it does not generate readings.

## Simple view and source clues (October 2026)

`/dashboard/#/simple` is an additional homeowner view; the original device dashboard remains the default. It uses the same room summaries, recommendations, recovery, timeline and contact APIs. A visible Original view switch returns to the existing product. The new view uses larger status text, calm surfaces, readable measurement cards, one primary action, and expandable evidence. Physical preview stays on `NOWARE_DEMO=0`; no simulated home or activity observations are seeded into the live account.

`lib/air-intelligence/source-patterns.js` adds `sourcePatterns` to the shared room summary. Homeowner, contractor-authorized summaries and reports receive the same evidence. It is a transparent, provisional rule set, not a trained or validated source classifier:

- Pets/dust: compare the change in the derived PM10-minus-PM2.5 fraction with the fine-particle change. A coarse increase over 5 µg/m³ and 1.5 times the fine increase is a weak dust/activity clue. Only a homeowner pet-activity observation within 20 minutes of the measured event supports a possible pet-activity association. Confidence remains low. Pet ownership by itself never identifies a source; hair, dander and allergens are not detected.
- Smoke: elevated indoor fine particles plus a recent outdoor smoke report can support a possible outdoor-smoke clue. Medium confidence additionally requires elevated outdoor PM2.5. Outdoor provider data older than one hour, missing timestamps, or unavailable data are treated as unknown. A homeowner report of smoke outside is separately labelled context and capped at low confidence. No live outdoor provider is configured; the current view says outdoor conditions are unknown and links to the AirNow smoke map. It does not infer a wildfire from indoor PM alone or claim an indoor/outdoor time-series correlation without data.
- Repeated timing: count distinct air-event onsets within ±20 minutes of activity notes over 30 days. Concurrent events and duplicate notes do not multiply the count. Three matches expose a recurring timing association, not causality, a validated predictive model, or a contractor sales opportunity. Sources and rooms are isolated. Unobserved activity is not interpreted as absence of activity; there is no automatic learning of causal rules from these notes.
- Offline, stale, fault and warm-up states withhold current source conclusions. Previously recorded associations remain history.

`POST /api/home/households/:id/observations` accepts a room, allowlisted activity, time within the last day and optional 300-character note. `DELETE .../observations/:observationId` removes one. Both require household edit authorization; contractors cannot create or delete homeowner observations. Reading provenance comes from the server's selected device, not a submitted field. Observations persist through HomeStore/local JSON/cloud snapshots, are retained for up to 45 days on writes, and are included in room summaries for the last 30 days. Summary/report access follows existing contractor consent. The activity dialog explains sharing; no activity is inferred from clicking a UI suggestion.

Near-zero baseline ratios are retained numerically in the domain result. Presentation copy gives the usual range and minimum meaningful change priority, preventing a 2 µg/m³ reading from looking alarming because the median was close to zero.

Evidence informing the limitations: [EPA indoor PM sources](https://www.epa.gov/indoor-air-quality-iaq/sources-indoor-particulate-matter-pm) describes many overlapping indoor and outdoor particle sources; [EPA biological contaminants](https://www.epa.gov/indoor-air-quality-iaq/biological-contaminants-and-indoor-air-quality) describes settled dust stirred up by normal activity; [AirNow sensor guidance for smoke](https://document.airnow.gov/using-air-quality-sensors-for-smoke.pdf) describes interpreting trends and comparing locations, including sensor uncertainty. These references support cautious interpretation, not the numerical heuristic cutoffs above. Those cutoffs need field validation with labelled real-household data.

Validation: `npm test` includes source-pattern, near-zero baseline, persistence and API authorization tests. After `npm run build`, `node scripts/simple-air-browser-check.mjs` runs a disposable test server and checks healthy air, cooking, persistent particles, offline, warm-up, action/recovery, note save/remove, preserved disclosures, original navigation and 1440/390/320-pixel layouts. Its fixtures never enter the user's live store. `scripts/classic-air-browser-check.mjs` still checks the original view against the physical publisher.
