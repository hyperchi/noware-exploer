/* Shared air-intelligence UI pieces: status classes, measurement tiles,
 * recommendation cards, evidence lists, timelines, contractor card.
 * Presentation only; every number and sentence comes from the summary.
 */

import { h, pill, setPill, toast, openModal, fill } from "./ui.js";

export const STATUS_CLASS = { excellent: "q-good", good: "q-good", needs_attention: "q-fair", poor: "q-poor", unhealthy: "q-bad" };
export const statusClass = (status) => STATUS_CLASS[status] || "q-none";

export const CATEGORY_LABEL = { particles: "Particles", voc: "Chemicals & odors", ventilation: "Fresh air", humidity: "Humidity", temperature: "Temperature", mixed: "Mixed" };
export const CHANNEL_CLASS = { pm25: "m-pm", pm10: "m-pm", pm1: "m-pm", pm4: "m-pm", tvoc: "m-voc", co2: "m-co2", eco2: "m-eco2", hum: "m-hum", temp: "m-temp", lux: "m-lux" };
export const LEVEL_LABEL = { diy: "Do it now", check: "Check something", contractor: "Ask your contractor" };
export const CONFIDENCE_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

export function clockText(t) {
  return new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayText(t) {
  const d = new Date(t * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function agoText(seconds) {
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function durationText(minutes) {
  if (minutes == null) return "";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

/** Small source badge: simulated data is always marked. */
export function sourceBadge(health) {
  if (!health) return null;
  if (health.simulated) return h("span.badge.sim", { text: health.source === "replay" ? "Replay" : "Simulated", title: "These readings come from a scenario, not a sensor." });
  return h("span.badge.phys", { text: "Live sensor", title: "Physical AirCube readings." });
}

export function devicePill(health) {
  const cls = health.state === "online" ? "q-good" : health.state === "warming_up" ? "q-fair" : health.state === "stale" ? "q-poor" : health.state === "fault" ? "q-bad" : null;
  return pill(health.label, cls);
}

export function deviceLine(health, { name } = {}) {
  const parts = [name || health.deviceName || "AirCube"];
  parts.push(health.state === "online" ? `Online · ${health.detail}` : `${health.label} · ${health.detail}`);
  return parts.join(" · ");
}

/** Meaning -> number -> context tile for one channel. */
export function measurementTile(m, { compact = false } = {}) {
  const cls = m.value == null ? "q-none" : m.elevated || m.low ? "q-fair" : statusClass(m.status);
  const tile = h(
    `div.card.measure${compact ? ".compact" : ""}`,
    h("div.row", h("span.measure-friendly", { text: m.friendly }), h("div.spacer"), pill(m.bandLabel, m.value == null ? null : m.band >= 3 ? (m.band >= 4 ? "q-bad" : "q-poor") : m.band === 2 || m.elevated || m.low ? "q-fair" : "q-good")),
    h("div.measure-value", { text: m.text }),
    h("div.measure-tech", h("span", { text: m.technical }), m.kind === "derived" ? h("span.faint", { text: " · estimated" }) : null),
    m.baseline ? h("div.measure-baseline", { text: m.baseline.text }) : null,
    m.ratioText ? h("div.measure-ratio", { class: m.elevated ? "up" : "", text: m.ratioText }) : null,
    h("button.linkbtn.tiny", { type: "button", text: "What is this?", onclick: () => toast(`${m.technical}: ${m.tooltip}${m.note ? ` ${m.note}` : ""}`) }),
  );
  tile.classList.add(cls);
  return tile;
}

/** One recommendation as an action card with "I did this". */
export function recommendationCard(rec, { onAck, onContact, contractorName } = {}) {
  const level = h(`span.level.${rec.level}`, { text: LEVEL_LABEL[rec.level] });
  const primary = rec.level === "contractor"
    ? h("button.btn.primary", { type: "button", text: rec.noContractor ? "Connect a service provider" : rec.title, disabled: rec.noContractor && !onContact, onclick: () => onContact?.(rec) })
    : h("button.btn", { type: "button", text: rec.acknowledged ? `Done · ${clockText(rec.acknowledgedAt)}` : "I did this", disabled: rec.acknowledged || !onAck, onclick: () => onAck?.(rec) });
  return h(
    `div.rec${rec.acknowledged ? ".done" : ""}${rec.level === "contractor" ? ".contractor" : ""}`,
    h("div.rec-head", level, rec.condition === "outdoor_unknown" ? h("span.faint.tiny", { text: "Conditional" }) : null),
    h("div.rec-title", { text: rec.title }),
    h("div.rec-desc", { text: rec.description }),
    rec.personalNote ? h("div.rec-note", { text: rec.personalNote }) : null,
    h("details.rec-why", h("summary", { text: "Why this?" }), h("div.muted", { text: rec.reason }), rec.expectedImpact ? h("div.muted", { text: `Expected: ${rec.expectedImpact}` }) : null),
    h("div.rec-actions", primary),
  );
}

/** Evidence for/against, labelled measured / derived / inferred / context. */
export function evidenceList(evidence, { showWeights = false } = {}) {
  const list = h("ul.evidence");
  for (const e of evidence || []) {
    if (!e.text) continue;
    list.append(h(`li.${e.supports ? "for" : "against"}`, h("span.kind", { text: e.kind }), h("span", { text: e.text }), showWeights && e.weight ? h("span.faint", { text: ` ${e.supports ? "+" : "−"}${e.weight}` }) : null));
  }
  return list;
}

export function confidenceChip(level) {
  if (!level) return null;
  return h(`span.conf.${level}`, { text: CONFIDENCE_LABEL[level] || level });
}

/** "What changed" rows: channel label and an arrow, no numbers needed here. */
export function changesTable(changes) {
  const table = h("div.changes");
  for (const c of changes || []) {
    table.append(h(`div.change${c.primary ? ".primary" : ""}`, h("span", { text: c.label }), h(`span.arrow.${c.direction}`, { text: c.text })));
  }
  return table;
}

/** Feedback control for an inferred source. */
export function feedbackControl(issue, { onFeedback }) {
  if (!issue || issue.source === "unknown" || !onFeedback) return null;
  if (issue.feedback) return h("div.faint.tiny", { text: issue.feedback.correct ? "Thanks, you confirmed this." : `Thanks, noted as ${issue.feedback.actualSource || "not this"}.` });
  const host = h("div.feedback");
  const options = [["cooking", "Cooking"], ["cleaning", "Cleaning"], ["outdoor_pollution", "Outdoor air"], ["dust", "Dust"], ["combustion", "Candle/smoke"], ["shower", "Shower"], ["pet_activity", "Pet activity"], ["unknown", "Not sure"]];
  const choose = () => {
    fill(host, h("span.faint", { text: "What was it?" }), ...options.filter(([k]) => k !== issue.source).map(([k, label]) => h("button.chip", { type: "button", text: label, onclick: () => onFeedback({ correct: false, actualSource: k }) })));
  };
  host.append(
    h("span.faint", { text: "Was this right?" }),
    h("button.chip", { type: "button", text: "That's right", onclick: () => onFeedback({ correct: true }) }),
    h("button.chip", { type: "button", text: "Not this", onclick: choose }),
  );
  return host;
}

/** Air story list. */
export function timelineList(items, { empty = "Nothing has happened today. Quiet is good." } = {}) {
  if (!items?.length) return h("div.faint", { text: empty });
  const list = h("ol.story");
  let lastDay = "";
  for (const item of items.slice().reverse()) {
    const day = dayText(item.t);
    if (day !== lastDay) {
      list.append(h("li.story-day", { text: day.toUpperCase() }));
      lastDay = day;
    }
    list.append(
      h(
        `li.story-item.${item.kind}`,
        h("span.story-time", { text: clockText(item.t) }),
        h("div", h("div.story-title", { text: item.title }), item.detail ? h("div.story-detail", { text: item.detail }) : null),
        item.value ? h("span.story-value", { text: item.value }) : null,
      ),
    );
  }
  return list;
}

/** Persistent, unobtrusive contractor card. */
export function contractorCard(contractor, { onContact, onReport, compact = false } = {}) {
  if (!contractor) {
    return h("div.card.contractor.none", h("div.section-label", { text: "Your home comfort provider" }), h("div.muted", { text: "No service provider connected." }), h("div.faint.tiny", { text: "When one is connected you can ask for help with one tap, with your air data attached." }));
  }
  const buttons = [];
  if (contractor.contactMethods?.includes("message") || !contractor.contactMethods?.length) buttons.push(h("button.btn", { type: "button", text: "Message", onclick: () => onContact?.("message") }));
  if (contractor.contact?.phone) buttons.push(h("a.btn", { href: `tel:${contractor.contact.phone.replace(/[^\d+]/g, "")}`, text: "Call" }));
  if (contractor.contactMethods?.includes("request_service")) buttons.push(h("button.btn", { type: "button", text: "Request service", onclick: () => onContact?.("request_service") }));
  if (onReport) buttons.push(h("button.btn", { type: "button", text: "Share air report", onclick: () => onReport() }));
  return h(
    `div.card.contractor${compact ? ".compact" : ""}`,
    h("div.section-label", { text: "Your home comfort provider" }),
    h("div.contractor-name", { text: contractor.name }),
    contractor.tagline || contractor.since ? h("div.faint", { text: contractor.tagline || `Maintaining your home since ${new Date(contractor.since * 1000).getFullYear()}` }) : null,
    h("div.row.wrap", ...buttons),
  );
}

/** Modal that previews the packaged context before sending to the contractor. */
export function openContactModal({ type, contractor, build, send }) {
  const { body, close } = openModal(type === "request_service" ? `Request service from ${contractor.name}` : `Message ${contractor.name}`);
  const preview = h("pre.payload", { text: "Preparing your air summary…" });
  const message = h("textarea", { rows: 3, placeholder: "Anything to add? (optional)" });
  const status = h("div.muted");
  const sendBtn = h("button.btn.primary", { type: "button", text: "Send with air summary", disabled: true });
  body.append(
    h("p.muted", { text: "This context is attached automatically so you do not have to explain it." }),
    preview,
    message,
    status,
    h("div.actions", h("button.btn", { type: "button", text: "Cancel", onclick: close }), sendBtn),
  );
  build().then((payload) => {
    preview.textContent = renderPayload(payload);
    sendBtn.disabled = false;
  }).catch((err) => { preview.textContent = err.message; });
  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    try {
      const result = await send(message.value.trim());
      fill(status);
      status.append(h("div", { text: "Request recorded." }));
      if (result?.fallback) {
        const links = [];
        if (result.fallback.tel) links.push(h("a.btn", { href: result.fallback.tel, text: `Call ${contractor.name}` }));
        if (result.fallback.mailto) links.push(h("a.btn", { href: result.fallback.mailto, text: "Open email with summary" }));
        if (result.fallback.bookingUrl) links.push(h("a.btn", { href: result.fallback.bookingUrl, target: "_blank", rel: "noreferrer", text: "Book online" }));
        status.append(h("div.faint.tiny", { text: "Direct messaging is not connected yet, so use one of these to reach them. The summary is included." }), h("div.row.wrap", ...links));
      }
      sendBtn.textContent = "Sent";
    } catch (err) {
      status.textContent = err.message;
      sendBtn.disabled = false;
    }
  });
  return close;
}

export function renderPayload(p) {
  const rows = [
    ["Homeowner", p.homeowner?.name], ["Room", p.room], ["Issue", p.issue],
    ["Started", p.startedAt ? new Date(p.startedAt * 1000).toLocaleString() : null],
    ["Current", p.current], ["Normal", p.normal], ["Duration", p.duration],
    ["Actions tried", (p.actionsTried || []).join(", ") || "none recorded"], ["Trend", p.trend],
    ["Likely category", p.likelyCategory], ["Supporting history", p.supportingHistory],
    ["Equipment", (p.equipment || []).join(", ")], ["Device", p.deviceHealth],
  ].filter(([, v]) => v);
  return rows.map(([k, v]) => `${k}:\n${v}`).join("\n\n");
}

export { pill, setPill };
