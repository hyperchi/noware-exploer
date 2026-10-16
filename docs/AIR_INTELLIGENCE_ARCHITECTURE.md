# Air intelligence architecture

noware turns AirCube measurements into conclusions and actions for a homeowner, and into evidence for the homeowner's contractor. Numbers are evidence; conclusions and actions are the product; the numbers never disappear.

## What was there before (inspection, October 2026)

- **Explorer app** (`src/`, Vite): PCB explorer, design lab, component library. Untouched by this work.
- **Dashboard** (`public/dashboard/`): a no-build static app (plain ES modules, vendored uPlot and esptool-js) ported from the upstream AirCube web app. Chrome's Web Serial API talks to the cube over USB at 115200 baud; the firmware prints one JSON line per second and answers JSON commands.
- **Sharing relay** (`api/cube.js`): the browser with the cube publishes readings and the cube's 7-day history to the Express server on Cloud Run; other signed-in browsers poll it. One in-memory store, one Cloud Run instance.
- **Auth and hosting**: Google sign-in for `@noso.so` plus one approved guest, 30-day signed cookie, Cloud Run behind a Cloudflare worker, GitHub Actions deploy on `main`. Unchanged.
- **Hardware attached to this Mac**: an AirCube Base with the Sensirion SEN63C fitted (firmware 2.0.7). It reports PM1 / PM2.5 / PM4 / PM10, a true NDIR CO2 reading, temperature and humidity (all from the SEN63C) plus ENS161 eTVOC / eCO2 / VOC level. No illuminance. The firmware's 5-minute history slots carry PM2.5 (x10) since the layout migration in `hyperchi/Noso_AirCube`.
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

- `#/` home: "Your home" status, one card per room (status word, headline, numbers), contractor card, devices on this computer, "Try a scenario".
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

Cloud Run keeps the store in memory on one instance; the cube itself holds 7 days of history and republishes it after a restart, and the gateway keeps raw captures on disk. When longer retention or more than one instance is needed, implement `HomeStore` over Firestore and keep the rest unchanged.
