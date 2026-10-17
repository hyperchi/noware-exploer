/* Contractor views: prioritized customers, and one home's evidence.
 * Denser than the homeowner pages, same design system, still an air product.
 */

import { h, toast, pill, confirmDialog, fill } from "../ui.js";
import { homeApi } from "../home-api.js";
import { statusClass, evidenceList, timelineList, clockText, dayText, agoText, durationText, CATEGORY_LABEL } from "../air-ui.js";

const BUCKET_LABEL = { needs_attention: "Needs attention", recurring: "Recurring air issues", improved: "Recently improved", all: "All homes" };
const INSIGHT_LABEL = { filtration: "Filtration", ventilation: "Ventilation", humidity_control: "Humidity control", airflow: "Airflow", maintenance: "Maintenance", source_control: "Source control", investigation: "Investigation" };

export class ContractorListView {
  constructor({ onOpenCustomer }) {
    this.onOpenCustomer = onOpenCustomer;
    this.filter = null;
    this.data = null;
    this.counts = h("div.counts");
    this.list = h("div.card-stack");
    this.el = h(
      "div.column.narrow",
      h("div.page-header", h("a.toolbtn", { href: "#/", title: "My home", "aria-label": "My home", text: "←" }), h("h1.page-title", { text: "Customers" }), h("div.nav-tabs", h("a", { href: "#/", text: "My home" }), h("a.active", { href: "#/contractor", text: "Customers" }))),
      this.counts,
      h("div", { style: { height: "14px" } }),
      this.list,
    );
  }

  async refresh() {
    try {
      this.data = await homeApi.contractorCustomers();
    } catch (err) {
      fill(this.list, h("div.card", h("div.muted", { text: err.status === 403 ? "This account has no contractor access." : err.message })));
      return;
    }
    const { counts, homes } = this.data;
    fill(this.counts, ...Object.keys(BUCKET_LABEL).map((k) => h(`div.card.count${this.filter === k ? ".active" : ""}`, { onclick: () => { this.filter = this.filter === k ? null : k; this.refresh(); } }, h("span.n", { text: String(counts[k]) }), h("span.l", { text: BUCKET_LABEL[k] }))));
    const shown = homes.filter((hh) => !this.filter || this.filter === "all" || hh.bucket === this.filter);
    fill(this.list, ...shown.map((hh) => this._row(hh)));
    if (!shown.length) this.list.append(h("div.faint", { text: "No homes in this group." }));
  }

  _row(hh) {
    const ins = hh.topInsight;
    return h(
      "div.card.customer",
      { onclick: () => this.onOpenCustomer(hh.householdId) },
      h("div", h("div.cname", { text: hh.name }), h("div.cmeta", h(`span.bucket.${hh.bucket}`, { text: BUCKET_LABEL[hh.bucket] }), h("span", { text: hh.live ? hh.statusLabel : "No live readings" }), hh.simulated ? h("span.badge.sim", { text: "Simulated" }) : null), h("div.cmeta", { style: { marginTop: "4px" } }, h("span", { text: hh.equipment.length ? `Equipment: ${hh.equipment.join(", ")}` : "No equipment recorded" }))),
      ins
        ? h("div.cinsight", h("div.k", { text: `${INSIGHT_LABEL[ins.category] || ins.category} opportunity · ${ins.confidence} confidence` }), h("div", { text: ins.problem }), h("div.faint.tiny", { text: `${ins.recurring}${ins.roomName ? ` · ${ins.roomName}` : ""}` }))
        : h("div.cinsight.faint", { text: hh.bucket === "improved" ? "Recovery improved since the last service visit." : "No recurring issue. Do not sell on this evidence." }),
      h("button.btn", { type: "button", text: "View home" }),
    );
  }
}

export class ContractorHomeView {
  constructor({ onBack }) {
    this.onBack = onBack;
    this.householdId = null;
    this.data = null;
    this.title = h("h1.detail-title", { text: "Home" });
    this.body = h("div.card-stack");
    this.el = h("div.column", h("div.page-header", h("button.toolbtn", { type: "button", text: "←", title: "Back", "aria-label": "Back", onclick: () => this.onBack() }), this.title), this.body);
  }

  setHousehold(id) {
    this.householdId = id;
    fill(this.body, h("div.faint", { text: "Loading…" }));
    this.refresh();
  }

  async refresh() {
    if (!this.householdId) return;
    try {
      this.data = await homeApi.contractorCustomer(this.householdId);
    } catch (err) {
      fill(this.body, h("div.card", h("div.muted", { text: err.message })));
      return;
    }
    const d = this.data;
    this.title.textContent = d.household.name;
    const cards = [];

    // Current state
    cards.push(h("div.card", h("h2.card-title", { text: "Current state" }),
      h("div.row.wrap", h("span", { style: { fontSize: "20px", fontWeight: 650 }, text: d.home.label }), ...d.rooms.filter((r) => r.source !== "physical").length ? [h("span.badge.sim", { text: "Simulated data" })] : []),
      h("div.room-grid", { style: { marginTop: "10px" } }, ...d.rooms.map((r) => h(`div.card.room-card.${r.currentStatus.live && r.currentStatus.status ? statusClass(r.currentStatus.status) : "q-none"}`,
        h("div.row", h("span.room-name", { text: r.roomName }), h("div.spacer"), pill(r.deviceHealth.label, r.deviceHealth.state === "online" ? "q-good" : null)),
        h("div.room-status", { text: r.currentStatus.live ? r.currentStatus.short : r.deviceHealth.label }),
        h("div.room-headline", { text: r.activeEvents[0] ? `${r.activeEvents[0].headline} · ${durationText(r.activeEvents[0].durationMinutes)} · ${r.activeEvents[0].measurement?.text || ""}${r.activeEvents[0].acknowledgedActions.length ? ` · homeowner tried: ${r.activeEvents[0].acknowledgedActions.map((a) => a.title).join(", ")}` : ""}` : r.currentStatus.explanation }),
        h("div.room-numbers", ...r.measurements.slice(0, 4).map((m) => h("span", h("strong", { text: m.text }), ` ${m.technical}`))),
      ))),
    ));

    // Recurring issues table
    const rows = [];
    for (const r of d.rooms) {
      for (const [cat, v] of Object.entries(r.patterns.byCategory)) if (v.count) rows.push(h("tr", h("td", { text: r.roomName }), h("td", { text: CATEGORY_LABEL[cat] }), h("td.n", { text: String(v.count) }), h("td.n", { text: String(v.longCount) }), h("td.n", { text: v.medianRecoveryMin != null ? `${Math.round(v.medianRecoveryMin)} min` : "–" }), h("td", { text: topSource(v.bySource) })));
      const n = r.patterns.overnightVentilation;
      if (n.nightsElevated) rows.push(h("tr", h("td", { text: r.roomName }), h("td", { text: "Overnight fresh air" }), h("td.n", { text: `${n.nightsElevated}/${n.nightsObserved} nights` }), h("td.n", { text: "" }), h("td.n", { text: `${durationText(n.avgDurationMin)} avg` }), h("td", { text: `peak ~${Math.round(n.avgPeak)} ppm` })));
      if (r.patterns.humidity.shareAbove60 >= 0.1) rows.push(h("tr", h("td", { text: r.roomName }), h("td", { text: "Humidity above 60%" }), h("td.n", { text: `${Math.round(r.patterns.humidity.shareAbove60 * 100)}% of time` }), h("td.n"), h("td.n"), h("td")));
    }
    cards.push(h("div.card", h("h2.card-title", { text: "Recurring issues · last 30 days" }), rows.length ? h("table.recur-table", h("thead", h("tr", ...["Room", "Issue", "Events", "> 30 min", "Median recovery", "Mostly"].map((t) => h("th", { text: t })))), h("tbody", ...rows)) : h("div.faint", { text: "No recurring issues recorded." })));

    // Insights: observed issue vs possible solution
    const insights = d.insights.length ? d.insights.map((i) => h("div.card", h("div.row.wrap", h("span.eyebrow", { text: `${INSIGHT_LABEL[i.category] || i.category} opportunity` }), h(`span.conf.${i.confidence.level}`, { text: `${i.confidence.level} confidence` }), i.roomName ? h("span.faint", { text: `· ${i.roomName}` }) : null, h("div.spacer"), h("span.faint.tiny", { text: i.requiresProfessionalDiagnosis ? "Requires on-site diagnosis" : "No equipment indicated" })),
      h("div.insight", { style: { marginTop: "8px" } },
        h("div.col", h("h4", { text: "Observed issue" }), h("div.problem", { text: i.problem }), evidenceList(i.evidence), h("div.muted.tiny", { style: { marginTop: "6px" }, text: `Homeowner impact: ${i.homeownerImpact}` })),
        h("div.col", h("h4", { text: "Possible solutions" }), h("ul", ...i.potentialSolutions.map((s) => h("li", { text: s }))), h("h4", { style: { marginTop: "10px" }, text: "What to inspect / discuss" }), h("ul", ...i.contractorActions.map((s) => h("li", { text: s }))), h("div.talk", { text: `Before you call: ${i.talkingPoints}` })),
      ),
      this._signalControls(i),
    )) : [h("div.card", h("h2.card-title", { text: "Opportunities" }), h("div.muted", { text: "No legitimate service or equipment opportunity from the measured evidence. Occasional events that clear quickly are not a lead." }))];
    cards.push(...insights);

    // Before / after
    const comparisons = d.rooms.flatMap((r) => r.patterns.serviceComparisons.map((c) => ({ ...c, roomName: r.roomName })));
    if (comparisons.length) {
      cards.push(h("div.card", h("h2.card-title", { text: "Since service visits" }), ...comparisons.map((c) => h("div", { style: { marginBottom: "10px" } },
        h("div", h("strong", { text: `${c.type.replace("_", " ")}${c.equipment ? `: ${c.equipment.label}` : ""}` }), h("span.faint", { text: ` · ${dayText(c.occurredAt)} · ${c.roomName}` })),
        ...Object.entries(c.categories).map(([cat, v]) => h("div.muted.tiny", { text: v.sufficient ? `${CATEGORY_LABEL[cat]}: median recovery ${Math.round(v.before.medianRecoveryMin || 0)} → ${Math.round(v.after.medianRecoveryMin || 0)} min since the visit (${v.recoveryChange < 0 ? `${Math.round(-v.recoveryChange * 100)}% faster` : `${Math.round(v.recoveryChange * 100)}% slower`}), ${v.before.perDay.toFixed(1)} → ${v.after.perDay.toFixed(1)} events/day` : `${CATEGORY_LABEL[cat]}: not enough events yet to compare (${v.before.count} before, ${v.after.count} after)` })),
      ))));
    }

    // Equipment + service events + record form
    cards.push(h("div.card", h("h2.card-title", { text: "Equipment & service history" }),
      h("div.two-col",
        h("div", h("div.eyebrow", { text: "Recorded equipment" }), d.household.equipment.length ? h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "13px" } }, ...d.household.equipment.map((e) => h("li", { text: `${e.label}${e.installedAt ? ` · installed ${dayText(e.installedAt)}` : ""}` }))) : h("div.faint", { text: "None recorded." }),
          h("div.eyebrow", { style: { marginTop: "12px" }, text: "Household context" }), h("div.muted.tiny", { text: contextText(d.household.profile) })),
        h("div", h("div.eyebrow", { text: "Service events" }), d.serviceEvents.length ? h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "13px" } }, ...d.serviceEvents.slice().reverse().map((s) => h("li", { text: `${dayText(s.occurredAt)} · ${s.type.replace("_", " ")}${s.equipment ? ` · ${s.equipment.label}` : ""}${s.notes ? ` · ${s.notes}` : ""}` }))) : h("div.faint", { text: "None recorded." }), this._serviceForm()),
      ),
    ));

    // Homeowner requests
    if (d.contactRequests.length) {
      cards.push(h("div.card", h("h2.card-title", { text: "Requests from the homeowner" }), ...d.contactRequests.slice().reverse().map((c) => h("div", { style: { marginBottom: "10px" } }, h("div", h("strong", { text: c.type.replace("_", " ") }), h("span.faint", { text: ` · ${dayText(c.createdAt)} ${clockText(c.createdAt)}` })), h("pre.payload", { text: Object.entries(c.payload).filter(([k, v]) => v && typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join("\n") + (c.payload.actionsTried?.length ? `\nactionsTried: ${c.payload.actionsTried.join(", ")}` : "") })))));
    }

    // Timeline per room (today)
    cards.push(h("div.card", h("h2.card-title", { text: "Today, by room" }), ...d.rooms.map((r) => h("div", { style: { marginBottom: "8px" } }, h("div.eyebrow", { text: r.roomName }), timelineList(r.timeline, { empty: "Quiet." })))));

    fill(this.body, ...cards);
  }

  _signalControls(insight) {
    const signal = this.data.signals.find((s) => s.insightId === insight.id);
    if (!signal) return null;
    const statuses = ["new", "reviewed", "contacted", "resolved", "dismissed"];
    return h("div.signal-status", { style: { marginTop: "10px" } }, h("span.faint.tiny", { text: `Opportunity signal · score ${signal.score} · status` }), ...statuses.map((st) => h(`button.chip${signal.status === st ? ".primary" : ""}`, { type: "button", text: st, style: signal.status === st ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}, onclick: async () => { try { await homeApi.signalStatus(signal.id, st); toast(`Marked ${st}`); this.refresh(); } catch (err) { toast(err.message, "err"); } } })));
  }

  _serviceForm() {
    const type = h("select", ...["maintenance", "repair", "filter_change", "equipment_installation", "inspection"].map((t) => h("option", { value: t, text: t.replace("_", " ") })));
    const eqType = h("select", h("option", { value: "", text: "no equipment" }), ...["hvac_filter", "whole_home_air_cleaner", "portable_purifier", "dehumidifier", "humidifier", "fresh_air_ventilator", "kitchen_exhaust", "bathroom_exhaust", "hvac"].map((t) => h("option", { value: t, text: t.replace(/_/g, " ") })));
    const label = h("input", { type: "text", placeholder: "Equipment label" });
    const notes = h("input", { type: "text", placeholder: "Notes" });
    const date = h("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    return h("details", { style: { marginTop: "10px" } }, h("summary.linkbtn", { text: "Record a service event" }),
      h("div.form-grid", { style: { marginTop: "8px" } }, h("span", { text: "Type" }), type, h("span", { text: "Date" }), date, h("span", { text: "Equipment" }), eqType, h("span", { text: "Label" }), label, h("span", { text: "Notes" }), notes),
      h("div.row", { style: { marginTop: "8px" } }, h("button.btn.primary", { type: "button", text: "Save", onclick: async () => {
        try {
          const ok = await confirmDialog("Record service event", "This becomes part of the home's air story and before/after comparisons. Record it?", "Record");
          if (!ok) return;
          await homeApi.addServiceEvent(this.householdId, { type: type.value, occurredAt: new Date(date.value).getTime() / 1000, equipment: eqType.value ? { type: eqType.value, label: label.value || eqType.value } : null, notes: notes.value });
          toast("Service event recorded.");
          this.refresh();
        } catch (err) { toast(err.message, "err"); }
      } })),
    );
  }
}

function topSource(bySource) {
  const e = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0].replace("_", " ") : "–";
}

function contextText(profile) {
  const parts = [];
  if (profile?.sensitivities?.allergies) parts.push("allergies");
  if (profile?.sensitivities?.asthma) parts.push("respiratory sensitivity");
  if (profile?.pets?.hasPets) parts.push("pets");
  for (const [k, v] of Object.entries(profile?.concerns || {})) if (v) parts.push(`${k} concern`);
  return parts.length ? parts.join(", ") : "No context shared.";
}

export { agoText };
