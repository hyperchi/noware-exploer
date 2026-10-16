/* Home: "YOUR HOME" summary, one card per room, the contractor card, and
 * anything connected to this computer that is not yet part of the home.
 */

import { h, toast, openMenu, fill } from "../ui.js";
import { statusClass, sourceBadge, contractorCard, agoText, openContactModal } from "../air-ui.js";
import { homeApi } from "../home-api.js";
import { SCENARIOS } from "../local-intelligence.js";

export class HomeView {
  constructor({ feed, registry, onOpenRoom, onOpenDevice, onOpenScenario, onOpenSettings, onConnect, onOpenContractor }) {
    this.feed = feed;
    this.registry = registry;
    this.onOpenRoom = onOpenRoom;
    this.onOpenDevice = onOpenDevice;
    this.onOpenScenario = onOpenScenario;
    this.onOpenContractor = onOpenContractor;

    this.hero = h("div.card.home-hero.q-none");
    this.rooms = h("div.room-grid");
    this.local = h("div.home-section");
    this.contractorHost = h("div.home-section");
    this.nav = h("div");
    this.pickerHost = h("div");
    this.el = h(
      "div.column",
      h(
        "div.page-header",
        h("a.toolbtn", { href: "#/", title: "Back to dashboard", "aria-label": "Back to dashboard", text: "←" }),
        h("h1.page-title", { text: "noware" }),
        this.nav,
        h("div.spacer"),
        this.pickerHost,
        h("button.toolbtn", { type: "button", title: "Settings", "aria-label": "Settings", text: "⚙", onclick: onOpenSettings }),
        h("button.toolbtn", { type: "button", title: "Connect a device", "aria-label": "Connect a device", text: "+", onclick: onConnect }),
      ),
      this.hero,
      h("div.home-section", h("div.row", h("span.eyebrow", { text: "Rooms" }), h("div.spacer"), this.feed.me?.demo ? h("button.linkbtn", { type: "button", text: "Try a scenario", onclick: (e) => this._scenarioMenu(e.currentTarget) }) : null), this.rooms),
      this.local,
      this.contractorHost,
    );
  }

  refresh() {
    const feed = this.feed;
    const summary = feed.summary;
    const me = feed.me;
    // Navigation between homeowner and contractor views when the account has both roles.
    fill(this.nav, me?.roles?.includes("contractor") ? h("div.nav-tabs", h("a.active", { href: "#/", text: "My home" }), h("a", { href: "#/contractor", text: "Customers" })) : null);
    fill(this.pickerHost, me && me.households.length > 1 ? h("select", { onchange: (e) => feed.setHousehold(e.target.value) }, ...me.households.map((hh) => h("option", { value: hh.id, selected: hh.id === feed.householdId, text: hh.name }))) : null);

    if (feed.available === false) {
      this.hero.className = "card home-hero q-none";
      fill(this.hero, 
        h("span.eyebrow", { text: "This computer" }),
        h("div.home-status", { text: "Local mode" }),
        h("div.home-sub", { text: "Not signed in to noware.so, so rooms and your contractor are unavailable. A cube on USB still works, and scenarios run in this tab." }),
      );
      fill(this.rooms, h("div.faint", { text: "No home connected." }));
      fill(this.contractorHost);
    } else if (me && !me.households.length) {
      this.hero.className = 'card home-hero q-none';
      fill(this.hero, h('span.eyebrow', { text: 'Your home' }), h('div.home-status', { text: 'Welcome home' }), h('div.home-sub', { text: 'Create your home, then add rooms and connect an AirCube.' }), h('button.btn.primary', { text: 'Create my home', onclick: async () => { try { const { household } = await homeApi.createHousehold('My home'); feed.me = await homeApi.me(); feed.setHousehold(household.id); } catch (e) { toast(e.message, 'err'); } } }));
      fill(this.rooms); fill(this.contractorHost);
    } else if (!summary) {
      this.hero.className = "card home-hero q-none";
      fill(this.hero, h("span.eyebrow", { text: "Your home" }), h("div.home-status", { text: feed.error ? "Could not load your home" : "Loading…" }), feed.error ? h("div.home-sub", { text: feed.error }) : null);
    } else {
      const home = summary.home;
      const name = feed.household?.household?.name || "Your home";
      this.hero.className = `card home-hero ${home.status ? statusClass(home.status) : "q-none"}`;
      const primary = home.primaryRoomId ? summary.rooms.find((r) => r.roomId === home.primaryRoomId) : null;
      fill(this.hero, 
        h("div.row", h("span.eyebrow", { text: name }), feed.household?.household?.demo ? h("span.badge.sim", { text: "Demo home" }) : null),
        h("div.home-status", { text: home.label }),
        h("div.home-sub", { text: primary?.primaryIssue ? `${primary.roomName}: ${primary.primaryIssue.headline.toLowerCase()}. ${primary.primaryIssue.explanation}` : home.offlineCount && home.offlineCount === home.rooms.length ? "No room is reporting right now." : home.status ? "Nothing needs your attention right now." : "" }),
        primary?.primaryIssue ? h("div.row", { style: { marginTop: "8px" } }, h("button.btn.primary", { type: "button", text: `Open ${primary.roomName}`, onclick: () => this.onOpenRoom(feed.householdId, primary.roomId) })) : null,
      );
      fill(this.rooms, ...summary.rooms.map((r) => this._roomCard(r)));
      if (!summary.rooms.length) this.rooms.append(h("div.faint", { text: "No rooms yet. Plug in a cube or add rooms in Settings." }));
      const contractor = feed.household?.contractor;
      fill(this.contractorHost, contractorCard(contractor, {
        onContact: (type) => this._contact(type),
        onReport: contractor ? () => homeApi.report(feed.householdId).then((r) => { const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "air-report.json"; a.click(); }) : null,
      }));
    }
    this._renderLocal();
  }

  _roomCard(r) {
    const live = r.currentStatus.live;
    const cls = live && r.currentStatus.status ? statusClass(r.currentStatus.status) : "q-none";
    const numbers = r.measurements.filter((m) => ["pm25", "tvoc", "co2", "eco2", "hum"].includes(m.channel)).slice(0, 4).map((m) => h("span", h("strong", { text: m.text }), ` ${m.technical}`));
    return h(
      `div.card.room-card.${cls}`,
      { role: "button", tabindex: "0", onclick: () => this.onOpenRoom(this.feed.householdId, r.roomId), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.onOpenRoom(this.feed.householdId, r.roomId); } } },
      h("div.row", h("span.room-name", { text: r.roomName }), h("div.spacer"), sourceBadge(r.deviceHealth)),
      h("div.room-status", { text: live ? (r.currentStatus.warmingUp ? "Warming up" : r.currentStatus.short) : r.deviceHealth.label }),
      h("div.room-headline", { text: r.primaryIssue ? `${r.primaryIssue.headline} · ${r.primaryIssue.measurement?.text || ""}` : live ? r.currentStatus.explanation : r.deviceHealth.lastReadingAt ? `Last reading ${agoText(r.deviceHealth.ageS)}` : "No readings yet" }),
      h("div.room-numbers", ...numbers),
    );
  }

  _renderLocal() {
    const locals = this.registry.devices.filter((d) => !d.isRemote);
    const shared = locals.filter((d) => d.shareState === "sharing" && this.feed.available);
    const unshared = locals.filter((d) => !shared.includes(d));
    const items = [];
    if (unshared.length) {
      items.push(h("div.row", h("span.eyebrow", { text: "Connected to this computer" })));
      for (const d of unshared) {
        items.push(h("div.card.room-card.q-none", { role: "button", tabindex: "0", onclick: () => this.onOpenDevice(d, { air: true }) },
          h("div.row", h("span.room-name", { text: d.name }), h("div.spacer"), h("span.badge.phys", { text: "USB" })),
          h("div.room-status", { text: d.isOnline ? "Open air view" : d.isConnected ? "Waiting for data" : "Disconnected" }),
          h("div.room-headline", { text: this.feed.available === false ? "Interpreted in this browser. Sign in to noware.so to add it to your home." : d.shareState === "blocked" ? `Not shared: ${d.shareBlockedBy} is sharing a cube.` : "Publishing to your home…" }),
        ));
      }
    } else if (shared.length) {
      items.push(h("div.faint.tiny", { text: `${shared.length === 1 ? "The cube" : `${shared.length} cubes`} on this computer ${shared.length === 1 ? "is" : "are"} shared with your home above.` }));
    }
    if (!locals.length && this.feed.available === false) {
      items.push(h("div.empty-state", h("div", { text: "No device yet." }), h("div", { text: "Plug an AirCube in over USB-C and click +, or try a scenario." })));
    }
    fill(this.local, ...items);
  }

  _scenarioMenu(anchor) {
    openMenu(anchor, Object.values(SCENARIOS).map((s) => ({ label: s.label, onSelect: () => this.onOpenScenario(s.key) })));
  }

  _contact(type) {
    const contractor = this.feed.household?.contractor;
    if (!contractor) return toast("No service provider connected.", "err");
    const householdId = this.feed.householdId;
    const primaryRoom = this.feed.summary?.home.primaryRoomId || this.feed.summary?.rooms[0]?.roomId;
    const primary = this.feed.summary?.rooms.find((r) => r.roomId === primaryRoom);
    openContactModal({
      type,
      contractor,
      build: async () => ({ homeowner: { name: this.feed.me?.name }, room: primary?.roomName, issue: primary?.primaryIssue?.headline || "General question", current: primary?.primaryIssue?.measurement ? `${primary.primaryIssue.measurement.technical} ${primary.primaryIssue.measurement.text}` : null, normal: primary?.primaryIssue?.measurement?.baselineText, supportingHistory: `${primary?.patterns?.totalEvents || 0} events in the last 30 days`, equipment: (this.feed.household?.household.equipment || []).map((e) => e.label), deviceHealth: primary?.deviceHealth.label }),
      send: (message) => homeApi.contact(householdId, { type, roomId: primaryRoom, eventId: primary?.primaryIssue?.eventId || null, message }),
    });
  }
}
