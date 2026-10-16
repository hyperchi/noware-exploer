/* Room page: the homeowner's main screen for one room / AirCube.
 *
 *   Header      room, device status, data source
 *   Hero        your air right now: status, likely cause, plain explanation,
 *               the actual number with its normal range, primary action
 *   Happening   what changed, likely source, confidence, evidence
 *   Action      recommendations in levels (do / check / ask contractor)
 *   Recovery    did it work?
 *   Today       air story timeline
 *   Trends      one annotated chart, raw toggle
 *   Sensors     meaning -> number -> context tiles
 *   Contractor  persistent card + contextual CTA
 *   Developer   features, baselines, inference scores, telemetry
 *
 * The page renders an AirIntelligenceSummary from either the server (a room
 * in the household) or a local source (a cube on this machine's USB, or a
 * scenario playing in this tab). It never derives anything itself.
 */

import { h, clear, pill, pillPicker, openMenu, toast, downloadFile, confirmDialog, fill } from "../ui.js";
import { prefs } from "../prefs.js";
import { HistoryChart } from "../charts.js";
import { homeApi } from "../home-api.js";
import {
  statusClass, CATEGORY_LABEL, CHANNEL_CLASS, sourceBadge, devicePill, measurementTile, recommendationCard, evidenceList,
  confidenceChip, changesTable, feedbackControl, timelineList, contractorCard, openContactModal, clockText, durationText, agoText,
} from "../air-ui.js";
import { SCENARIOS } from "../local-intelligence.js";

const REFRESH_MS = 5000;
const RANGES = [
  { label: "Past hour", seconds: 3600 },
  { label: "Today", seconds: 86400 },
  { label: "7 days", seconds: 7 * 86400 },
];
const FRIENDLY = { pm25: "Fine particles", tvoc: "Chemicals & odors", co2: "Fresh air", eco2: "Fresh air (est.)", hum: "Humidity", temp: "Temperature", pm10: "Coarse particles", pm1: "Small particles", lux: "Light" };
const TECH = { pm25: "PM2.5 µg/m³", tvoc: "eTVOC ppb", co2: "CO2 ppm", eco2: "eCO2 ppm", hum: "RH %", temp: "°C", pm10: "PM10 µg/m³", pm1: "PM1 µg/m³", lux: "lux" };
const CATEGORY_COLOR = { particles: "--m-pm", voc: "--m-voc", ventilation: "--m-co2", humidity: "--m-hum", temperature: "--m-temp" };

export class RoomView {
  constructor({ onBack, onOpenDevice }) {
    this.onBack = onBack;
    this.onOpenDevice = onOpenDevice;
    this.source = null; // {kind:'server'|'local'|'scenario', ...}
    this.summary = null;
    this.series = null;
    this.metric = "pm25";
    this.rangeSeconds = RANGES[0].seconds;
    this.raw = false;
    this.devOpen = false;
    this._timer = null;
    this._build();
  }

  _build() {
    this.title = h("h1.detail-title", { text: "Room" });
    this.devPill = pill("--");
    this.sourceHost = h("span");
    this.menuBtn = h("button.toolbtn", { type: "button", text: "⋯", title: "More", "aria-label": "More", onclick: () => this._menu() });
    this.hero = h("div.card.air-hero.q-none");
    this.happening = h("div.card");
    this.action = h("div.card");
    this.recovery = h("div.card.recovery");
    this.today = h("div.card");
    this.trends = h("div.card.trends");
    this.sensors = h("div.card");
    this.contractorHost = h("div");
    this.device = h("div.card");
    this.dev = h("div.card.dev");

    // Trends controls and chart.
    this.metricPicker = h("div");
    this.rangePicker = pillPicker(RANGES.map((r) => ({ value: r.seconds, label: r.label })), this.rangeSeconds, (v) => { this.rangeSeconds = v; this.loadSeries(); });
    this.rawToggle = h("button.btn", { type: "button", text: "Raw data", onclick: () => { this.raw = !this.raw; this.rawToggle.classList.toggle("primary", this.raw); this.renderTrends(); this.renderSensors(); } });
    this.chartHost = h("div.chart-host");
    this.chartReadout = h("span.faint", { text: "Hover the chart to read values" });
    this.chart = new HistoryChart(this.chartHost, (p) => this._scrub(p));
    this.chartEmpty = h("div.chart-empty", { text: "No data for this range yet." });
    this.legend = h("div.trend-legend");
    this.trends.append(
      h("h2.card-title", { text: "Trends" }),
      h("div.trend-controls", this.metricPicker, h("div.spacer"), this.rangePicker, this.rawToggle),
      this.chartReadout,
      h("div", { style: { position: "relative", display: "flex", minHeight: "240px" } }, this.chartHost, this.chartEmpty),
      this.legend,
    );

    this.el = h(
      "div.column.detail",
      h("div.page-header", h("button.toolbtn", { type: "button", text: "←", title: "Back", "aria-label": "Back", onclick: () => this.onBack() }), this.title, this.devPill, this.sourceHost, h("div.spacer"), this.menuBtn),
      h("div.room-layout",
        h("div.room-main", this.hero, this.action, this.happening, this.recovery, this.today, this.trends),
        h("div.room-rail", this.sensors, this.contractorHost, this.device, this.dev),
      ),
    );
  }

  // ---------------------------------------------------------------- source

  /** @param {object} source  see makeServerSource / LocalRoomSource / ScenarioSource */
  setSource(source) {
    if (this.source?.kind !== "server") this.source?.removeEventListener?.("change", this._onSourceChange);
    this.source = source;
    this.summary = null;
    this.series = null;
    this._onSourceChange = () => this.refresh();
    if (source.kind !== "server") source.addEventListener("change", this._onSourceChange);
    this.refresh();
    this.loadSeries();
  }

  start() {
    clearInterval(this._timer);
    this._timer = setInterval(() => { this.refresh(); if (this.rangeSeconds <= 3600) this.loadSeries(); }, REFRESH_MS);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async refresh() {
    if (!this.source) return;
    try {
      const fahrenheit = prefs.get("useFahrenheit");
      this.summary = this.source.kind === "server" ? await this.source.summary({ debug: this.devOpen, units: fahrenheit ? "f" : "c" }) : this.source.summary({ debug: this.devOpen, fahrenheit });
      this.render();
    } catch (err) {
      fill(this.hero, h("div.hero-status", { text: "Could not load this room" }), h("div.hero-explain", { text: err.message }));
    }
  }

  async loadSeries() {
    if (!this.source) return;
    try {
      this.series = await this.source.series(this.rangeSeconds);
      this.renderTrends();
    } catch { /* keep the previous chart */ }
  }

  // ---------------------------------------------------------------- render

  render() {
    const s = this.summary;
    if (!s) return;
    this.title.textContent = s.roomName || s.deviceName || "Room";
    this.devPill.replaceWith((this.devPill = devicePill(s.deviceHealth)));
    fill(this.sourceHost, sourceBadge(s.deviceHealth));
    this.renderHero(s);
    this.renderAction(s);
    this.renderHappening(s);
    this.renderRecovery(s);
    this.renderToday(s);
    this.renderSensors(s);
    this.renderContractor(s);
    this.renderDevice(s);
    this.renderDev(s);
    if (!this.series) this.renderTrends();
  }

  renderHero(s) {
    const issue = s.primaryIssue;
    const status = s.currentStatus;
    this.hero.className = `card air-hero ${status.live && status.status ? statusClass(status.status) : "q-none"}`;
    const children = [h("div.hero-eyebrow", h("span.eyebrow", { text: "Your air right now" }), s.deviceHealth.simulated ? h("span.badge.sim", { text: "Simulated" }) : null)];
    children.push(h("div.hero-status", { text: status.label }));
    if (!status.live || status.warmingUp) {
      children.push(h("div.hero-explain", { text: status.explanation }));
      if (status.warmingUp && s.deviceHealth.warmupRemainingS != null) children.push(h("div.hero-expect", { text: `About ${Math.ceil(s.deviceHealth.warmupRemainingS / 60)} min to go.` }));
      if (!status.live && s.deviceHealth.lastReadingAt) children.push(h("div.hero-expect", { text: `Last reading ${agoText(s.deviceHealth.ageS)}. Numbers below are from then, not now.` }));
      fill(this.hero, ...children);
      return;
    }
    if (issue) {
      children.push(h("div.hero-cause", h("span", { text: issue.headline }), confidenceChip(issue.confidence)));
      children.push(h("div.hero-explain", { text: issue.explanation }));
      const m = issue.measurement;
      if (m) children.push(h("div.hero-measure", h("span.big", { text: m.text }), h("span.ctx", h("div", { text: `${m.technical} · ${m.friendly}` }), h("div", { text: m.baselineText }), m.ratioText ? h("div", { text: m.ratioText }) : null)));
      const top = (issue.recommendations || []).find((r) => r.level === "diy") || issue.recommendations?.[0];
      if (top) {
        children.push(h("div.hero-cta",
          top.level === "contractor"
            ? h("button.btn.primary", { type: "button", text: top.title, onclick: () => this._contact(top) })
            : h("button.btn.primary", { type: "button", text: top.acknowledged ? `${top.title} · done` : top.title, disabled: top.acknowledged, onclick: () => this._ack(top) }),
          h("span.hero-expect", { text: top.expectedImpact || "" }),
        ));
      }
      if (issue.personalNotes?.length) children.push(h("div.hero-expect", { text: issue.personalNotes[0] }));
    } else {
      children.push(h("div.hero-explain", { text: status.explanation }));
      if (s.recovery && s.recovery.state === "resolved") children.push(h("div.hero-expect", { text: s.recovery.text }));
      const main = s.measurements.find((m) => m.channel === status.primaryChannel) || s.measurements[0];
      if (main) children.push(h("div.hero-measure", h("span.big", { text: main.text }), h("span.ctx", h("div", { text: `${main.technical} · ${main.friendly}` }), main.baseline ? h("div", { text: main.baseline.text }) : null)));
    }
    fill(this.hero, ...children);
  }

  renderAction(s) {
    const recs = s.homeownerRecommendations || [];
    const live = s.currentStatus.live && !s.currentStatus.warmingUp;
    if (!live || !recs.length) {
      this.action.style.display = "none";
      return;
    }
    this.action.style.display = "";
    const groups = { diy: [], check: [], contractor: [] };
    for (const r of recs) (groups[r.level] || groups.diy).push(r);
    const stack = h("div.card-stack");
    for (const level of ["diy", "check", "contractor"]) {
      for (const r of groups[level]) stack.append(recommendationCard(r, { onAck: (rec) => this._ack(rec), onContact: (rec) => this._contact(rec) }));
    }
    fill(this.action, h("h2.card-title", { text: "What should I do?" }), stack);
  }

  renderHappening(s) {
    const issue = s.primaryIssue;
    const others = (s.activeEvents || []).filter((e) => e.id !== issue?.eventId);
    if (!issue && !others.length) {
      this.happening.style.display = "none";
      return;
    }
    this.happening.style.display = "";
    const parts = [h("h2.card-title", { text: "What's happening" })];
    if (issue) {
      parts.push(
        h("div.row.wrap", h("strong", { text: issue.headline }), h("span.faint", { text: `· started ${clockText(issue.startedAt)} · ${durationText(issue.durationMinutes)}` })),
        changesTable(issue.changes),
        h("div.row.wrap", { style: { marginTop: "8px" } }, h("span.faint", { text: "Likely source" }), h("strong", { text: issue.source === "unknown" ? "Not sure yet" : issue.sourceLabel }), confidenceChip(issue.confidence)),
        issue.source === "unknown" && issue.alternatives?.length
          ? h("div.muted.tiny", { text: `Common possibilities: ${issue.alternatives.slice(0, 3).map((a) => a.label.toLowerCase()).join(", ")}.` })
          : issue.alternatives?.length
            ? h("div.faint.tiny", { text: `Also possible: ${issue.alternatives.filter((a) => a.score >= 0.15).slice(0, 3).map((a) => a.label.toLowerCase()).join(", ") || "nothing else fits well"}.` })
            : null,
        h("details", h("summary.linkbtn", { text: "See the evidence" }), evidenceList(issue.evidence)),
        feedbackControl(issue, { onFeedback: (body) => this._feedback(issue, body) }),
      );
    }
    for (const e of others) {
      parts.push(h("div.row.wrap", { style: { marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--card-border)" } }, h("strong", { text: e.headline }), confidenceChip(e.hypothesis?.confidence?.level), h("span.faint", { text: `· ${CATEGORY_LABEL[e.category]} · since ${clockText(e.startedAt)}` })));
    }
    fill(this.happening, ...parts);
  }

  renderRecovery(s) {
    const r = s.recovery;
    if (!r || !s.currentStatus.live) {
      this.recovery.style.display = "none";
      return;
    }
    this.recovery.style.display = "";
    const cls = r.state === "resolved" || r.state === "improving" ? "q-good" : r.state === "not_improving" ? "q-poor" : "q-fair";
    this.recovery.className = `card recovery ${cls}`;
    const title = { resolved: "Back to normal", improving: "Improving", not_improving: "Not improving yet", watching: "Watching" }[r.state] || "";
    const parts = [h("h2.card-title", { text: "Did it work?" }), h("div.recovery-state", { text: title }), h("div.recovery-text", { text: r.text })];
    if (r.state !== "resolved") parts.push(h("div.bar", h("span", { style: { width: `${r.pct || 0}%` } })));
    if (r.state === "not_improving") {
      const next = (s.homeownerRecommendations || []).find((x) => !x.acknowledged && x.level !== "contractor");
      const esc = (s.homeownerRecommendations || []).find((x) => x.level === "contractor");
      if (next) parts.push(h("div.row.wrap", { style: { marginTop: "8px" } }, h("span.faint", { text: "Try:" }), h("button.btn", { type: "button", text: next.title, onclick: () => this._ack(next) })));
      if (esc) parts.push(h("div.row.wrap", { style: { marginTop: "6px" } }, h("button.btn.primary", { type: "button", text: esc.title, onclick: () => this._contact(esc) })));
    }
    fill(this.recovery, ...parts);
  }

  renderToday(s) {
    fill(this.today, h("h2.card-title", { text: "Today" }), timelineList(s.timeline));
  }

  renderSensors(s = this.summary) {
    if (!s) return;
    const grid = h("div.measure-grid");
    for (const m of s.measurements) grid.append(measurementTile(this.raw ? { ...m, friendly: m.technical, technical: m.friendly } : m, { compact: true }));
    const note = !s.currentStatus.live ? h("div.faint.tiny", { text: `Readings from ${agoText(s.deviceHealth.ageS)}. Not the current state of the air.` }) : null;
    fill(this.sensors, h("h2.card-title", { text: "Sensor details" }), note, grid);
  }

  renderContractor(s) {
    const contractor = this.source.contractor?.() || null;
    fill(this.contractorHost, contractorCard(contractor, {
      onContact: (type) => this._contact({ actionType: "contact_contractor" }, type),
      onReport: contractor && this.source.kind === "server" ? () => this._report() : null,
    }));
  }

  renderDevice(s) {
    const d = s.deviceHealth;
    const caps = d.capabilities || {};
    const capText = [caps.pm25 && "particles", caps.tvoc && "chemicals", caps.trueCo2 ? "true CO2" : caps.eco2 ? "estimated CO2" : null, caps.humidity && "humidity", caps.temperature && "temperature", caps.illuminance && "light"].filter(Boolean).join(", ");
    const rows = [
      ["Status", `${d.label} · ${d.detail}`],
      ["Data source", d.simulated ? "Simulated scenario" : "Physical AirCube"],
      ["Last reading", d.lastReadingAt ? `${clockText(d.lastReadingAt)} (${agoText(d.ageS)})` : "none yet"],
      ["Gateway heartbeat", d.lastHeartbeatAt ? agoText(s.generatedAt - d.lastHeartbeatAt) : "n/a"],
      ["Measures", capText || "unknown"],
      ["Firmware", d.fwVersion ? `v${d.fwVersion}` : "—"],
      ["Model", d.model ? d.model : "—"],
    ];
    const dl = h("dl.advanced-grid");
    for (const [k, v] of rows) dl.append(h("dt", { text: k }), h("dd", { text: v }));
    const actions = [];
    if (this.source.kind === "local" && this.onOpenDevice) actions.push(h("button.btn", { type: "button", text: "Device settings", onclick: () => this.onOpenDevice(this.source.device) }));
    fill(this.device, h("h2.card-title", { text: s.deviceName || "AirCube" }), dl, actions.length ? h("div.row", { style: { marginTop: "8px" } }, ...actions) : null);
  }

  renderDev(s) {
    const btn = h("button.linkbtn", { type: "button", text: this.devOpen ? "Developer view ▾" : "Developer view ▸", onclick: () => { this.devOpen = !this.devOpen; this.refresh(); } });
    if (!this.devOpen || !s.debug) {
      fill(this.dev, btn);
      return;
    }
    const d = s.debug;
    const table = h("table", h("thead", h("tr", ...["channel", "current", "baseline", "range", "kind", "ratio", "slope/5m", "line", "trend", "elev min", "onset"].map((t) => h("th", { text: t })))));
    const tb = h("tbody");
    for (const [c, f] of Object.entries(d.features)) {
      tb.append(h("tr", h("td", { text: c }), h("td", { text: fmt(f.current) }), h("td", { text: fmt(f.baseline.median) }), h("td", { text: `${fmt(f.baseline.low)}–${fmt(f.baseline.high)}` }), h("td", { text: f.baseline.kind }), h("td", { text: fmt(f.ratio) }), h("td", { text: fmt(f.slope5m) }), h("td", { text: fmt(f.elevatedLine) }), h("td", { text: f.trend }), h("td", { text: fmt(f.elevatedMinutes) }), h("td", { text: fmt(f.onsetMinutes) })));
    }
    table.append(tb);
    const inference = h("div");
    for (const [eventId, candidates] of Object.entries(d.candidates || {})) {
      const ev = s.activeEvents.find((e) => e.id === eventId);
      inference.append(h("div", { style: { marginTop: "8px" } }, h("strong", { text: `${ev?.headline || eventId} → ${ev?.hypothesis?.source} (${ev?.hypothesis?.confidence.score})` })));
      for (const c of candidates) {
        inference.append(h("div.tiny", { style: { marginTop: "4px" } }, h("strong", { text: `${c.source}: ${c.score}` })), evidenceList(c.evidence.filter((e) => e.weight), { showWeights: true }));
      }
    }
    fill(this.dev, 
      btn,
      h("h2.card-title", { style: { marginTop: "10px" }, text: "Features & baselines" }),
      table,
      h("h2.card-title", { style: { marginTop: "12px" }, text: "Inference" }),
      inference.childElementCount ? inference : h("div.faint", { text: "No active event." }),
      h("h2.card-title", { style: { marginTop: "12px" }, text: "Telemetry" }),
      h("pre", { text: JSON.stringify({ health: s.deviceHealth, capabilities: s.capabilities, counts: d.sampleCounts, cross: d.cross, outdoor: s.outdoor, lastReading: d.lastReading }, null, 2) }),
    );
  }

  // ---------------------------------------------------------------- trends

  renderTrends() {
    const s = this.summary;
    const series = this.series;
    const available = series ? Object.keys(series.channels).filter((c) => c !== "vocLevel" && c !== "pm4" && !(c === "eco2" && series.channels.co2)) : [];
    const order = ["pm25", "tvoc", "co2", "eco2", "hum", "temp", "pm10", "pm1", "lux"].filter((c) => available.includes(c));
    if (!order.includes(this.metric)) this.metric = order[0] || "pm25";
    const picker = pillPicker(order.map((c) => ({ value: c, label: this.raw ? TECH[c] : FRIENDLY[c] })), this.metric, (c) => { this.metric = c; this.renderTrends(); });
    fill(this.metricPicker, picker);
    const pts = series?.channels[this.metric] || [];
    this.chartEmpty.style.display = pts.length ? "none" : "";
    if (!series) return;
    const useF = prefs.get("useFahrenheit") && this.metric === "temp";
    const conv = (v) => (useF ? (v * 9) / 5 + 32 : v);
    const unit = this.metric === "temp" ? (useF ? "°F" : "°C") : (TECH[this.metric] || "").split(" ").pop();
    const decimals = this.metric === "pm25" || this.metric === "pm10" || this.metric === "pm1" || this.metric === "temp" ? 1 : 0;
    this.formatValue = (v) => `${v.toFixed(decimals)}${unit.startsWith("°") ? unit : ` ${unit}`}`;
    const colorVar = `--${CHANNEL_CLASS[this.metric] || "m-voc"}`.replace("--m-", "--m-");
    const events = (series.events || []).map((e) => ({ ...e, color: CATEGORY_COLOR[e.category] || "--m-voc", label: e.headline || CATEGORY_LABEL[e.category] }));
    this.chart.setEvents(events);
    this.chart.setData([pts.map(([t, v]) => [t, conv(v)])], colorVar, this.formatValue, [series.from, series.to], []);
    fill(this.legend, 
      ...Object.entries(CATEGORY_COLOR).filter(([cat]) => events.some((e) => e.category === cat)).map(([cat, v]) => h("span", h("span.swatch", { style: { background: `var(${v})`, opacity: 0.5 } }), CATEGORY_LABEL[cat] + " event")),
      s?.deviceHealth.simulated ? h("span.badge.sim", { text: "Simulated" }) : null,
    );
  }

  _scrub(point) {
    if (!point) {
      this.chartReadout.textContent = "Hover the chart to read values";
      this.chartReadout.className = "faint";
      return;
    }
    const ev = (this.series?.events || []).find((e) => point.time >= e.startedAt && point.time <= (e.endedAt || Infinity));
    this.chartReadout.textContent = `${this.formatValue(point.value)} · ${clockText(point.time)}${ev ? ` · ${ev.headline || CATEGORY_LABEL[ev.category]}` : ""}`;
    this.chartReadout.className = "muted";
  }

  // ---------------------------------------------------------------- actions

  async _ack(rec) {
    const issue = this.summary?.primaryIssue;
    const eventId = rec.eventId || issue?.eventId;
    if (!eventId) return;
    try {
      await this.source.ack(eventId, rec.id);
      toast(`Marked done: ${rec.title}. We will watch whether it helps.`);
      await this.refresh();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async _feedback(issue, body) {
    try {
      await this.source.feedback(issue.eventId, body);
      toast("Thanks, that helps us tune this room.");
      await this.refresh();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  _contact(rec, type = "request_service") {
    const contractor = this.source.contractor?.();
    if (!contractor || this.source.kind !== "server") {
      toast(rec?.noContractor || !contractor ? "No service provider is connected to this home yet. Add one in Settings when you have one." : "Contact is available for rooms in your home on noware.so.", "err");
      return;
    }
    const issue = this.summary?.primaryIssue;
    openContactModal({
      type,
      contractor,
      build: () => this.source.contactPreview({ type, eventId: issue?.eventId }),
      send: (message) => this.source.contact({ type, eventId: issue?.eventId, message }),
    });
  }

  async _report() {
    try {
      const report = await this.source.report();
      downloadFile(`air-report-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 2), "application/json");
      toast("Air report downloaded. Share it with your contractor.");
    } catch (err) {
      toast(err.message, "err");
    }
  }

  _menu() {
    const items = [];
    if (this.source.kind === "server" && this.source.isMember) {
      items.push({ label: "Run a scenario in this room…", onSelect: () => this._pickScenario((key) => this.source.simulate({ scenario: key })) });
      if (this.source.simulation) {
        items.push({ label: "Jump ahead 15 minutes", onSelect: () => this.source.simulate({ advanceMinutes: 15 }).then(() => this.refresh()) });
        items.push({ label: "Stop simulation", onSelect: () => this.source.simulate({ stop: true }).then(() => this.refresh()) });
      }
    }
    if (this.source.kind === "scenario") {
      items.push({ label: "Switch scenario…", onSelect: () => this._pickScenario((key) => { location.hash = `#/scenario/${key}`; }) });
      items.push({ label: "Jump ahead 15 minutes", onSelect: () => { this.source.advance(15 * 60); this.refresh(); this.loadSeries(); } });
    }
    if (this.source.kind === "local") items.push({ label: "Device settings", onSelect: () => this.onOpenDevice?.(this.source.device) });
    items.push({ label: this.devOpen ? "Hide developer view" : "Developer view", onSelect: () => { this.devOpen = !this.devOpen; this.refresh(); } });
    openMenu(this.menuBtn, items);
  }

  async _pickScenario(run) {
    const keys = Object.keys(SCENARIOS);
    const list = keys.map((k) => `${k}: ${SCENARIOS[k].label}`).join("\n");
    const ok = await confirmDialog("Run a scenario", `Simulated data replaces this room's readings until you stop it. Scenarios:\n\n${list}`, "Choose");
    if (!ok) return;
    const key = window.prompt("Scenario key", keys[1]);
    if (!key || !SCENARIOS[key]) return;
    try {
      await run(key);
      toast(`Running "${SCENARIOS[key].label}" (simulated).`);
      setTimeout(() => { this.refresh(); this.loadSeries(); }, 500);
    } catch (err) {
      toast(err.message, "err");
    }
  }
}

const fmt = (v) => (v == null || !Number.isFinite(v) ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/** Adapter for a room in the signed-in person's household on the server. */
export function makeServerSource(feed, householdId, roomId) {
  const household = () => (feed.household?.household?.id === householdId ? feed.household : null);
  return {
    kind: "server",
    householdId,
    roomId,
    get isMember() { return Boolean(household()?.isMember); },
    get simulation() { return household()?.household.rooms.find((r) => r.id === roomId)?.devices?.some((d) => d.simulation) || false; },
    contractor: () => household()?.contractor || null,
    summary: ({ debug, units }) => homeApi.roomSummary(householdId, roomId, { debug, units }),
    series: (seconds) => homeApi.series(householdId, roomId, seconds),
    ack: (eventId, recId) => homeApi.ack(householdId, eventId, recId).then(() => feed.refresh()),
    feedback: (eventId, body) => homeApi.feedback(householdId, eventId, body),
    contactPreview: async ({ type, eventId }) => {
      // Preview = the payload the server will attach; built by asking for it
      // without sending: we reuse the report endpoint's room block for the
      // numbers and the summary for the rest, keeping one evidence system.
      const s = await homeApi.roomSummary(householdId, roomId, {});
      const issue = s.activeEvents.find((e) => e.id === eventId) || null;
      const m = s.primaryIssue?.measurement;
      return {
        homeowner: { name: feed.me?.name }, room: s.roomName, issue: issue ? issue.headline : "No active issue", startedAt: issue?.startedAt,
        current: m ? `${m.technical} ${m.text}` : null, normal: m?.baselineText, duration: issue ? durationText(issue.durationMinutes) : null,
        actionsTried: (issue?.acknowledgedActions || []).map((a) => a.title), trend: issue?.recovery?.text,
        likelyCategory: issue ? `${issue.category} / ${issue.hypothesis?.label || "unclear"}` : null,
        supportingHistory: issue ? `${s.patterns.byCategory[issue.category]?.count || 0} similar events in the last 30 days` : `${s.patterns.totalEvents} events in the last 30 days`,
        equipment: (household()?.household.equipment || []).map((e) => e.label), deviceHealth: s.deviceHealth.label + (s.deviceHealth.simulated ? " (simulated data)" : ""),
      };
    },
    contact: ({ type, eventId, message }) => homeApi.contact(householdId, { type, roomId, eventId, message }),
    report: () => homeApi.report(householdId),
    simulate: (body) => homeApi.simulate(householdId, { roomId, ...body }).then((r) => { feed.reloadHousehold(); return r; }),
  };
}

export { clear };
