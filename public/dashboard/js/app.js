/* App shell: hash router, device registry, home feed, appearance boot.
 *
 * Routes
 *   #/                         home (rooms, contractor, local devices)
 *   #/room/:householdId/:roomId  a room in the signed-in person's home
 *   #/air/:deviceId            air view of a cube on this computer (local engine)
 *   #/scenario/:key            a scenario playing in this tab (simulated)
 *   #/device/:deviceId         device settings page (brightness, history, firmware)
 *   #/settings                 preferences and household context
 *   #/contractor               customers (contractor role)
 *   #/contractor/:householdId  one customer's evidence
 */

import { h, toast } from "./ui.js";
import { applyAppearance } from "./prefs.js";
import { DeviceRegistry } from "./devices.js";
import { ShareFeed } from "./share.js";
import { HomeFeed } from "./home-api.js";
import { SimpleView } from "./views/simple.js";
import { HomeView } from "./views/home.js";
import { HomeView as IntelligenceHomeView } from "./views/intelligence-home.js";
import { RoomView, makeServerSource } from "./views/room.js";
import { DetailView } from "./views/detail.js";
import { SettingsView } from "./views/settings.js";
import { ContractorListView, ContractorHomeView } from "./views/contractor.js";
import { openFlashModal } from "./views/flash-modal.js";
import { maybeOfferUpgradeCalibration } from "./frc-nudge.js";
import { LocalRoomSource, ScenarioSource } from "./local-intelligence.js";

const STALE_TICK_MS = 2000;

class App {
  constructor() {
    this.registry = new DeviceRegistry();
    this.feed = new HomeFeed();
    this.route = { name: "home" };
    this.localSources = new Map();
    this.scenario = null;

    this.suppressAutoRoute = false;
    this.home = new HomeView(this.registry, {
      onOpenDetail: id => this.navigate(`#/device/${id}`),
      onOpenSettings: () => this.navigate('#/settings'),
      onConnect: () => this.connect(),
    });
    this.intelligence = new IntelligenceHomeView({
      feed: this.feed,
      registry: this.registry,
      onOpenRoom: (householdId, roomId) => this.navigate(`#/room/${householdId}/${roomId}`),
      onOpenDevice: (device, { air } = {}) => this.navigate(air ? `#/air/${device.id}` : `#/device/${device.id}`),
      onOpenScenario: (key) => this.navigate(`#/scenario/${key}`),
      onOpenSettings: () => this.navigate("#/settings"),
      onConnect: () => this.connect(),
    });
    this.simple = new SimpleView({ feed: this.feed });
    this.room = new RoomView({ onBack: () => this.navigate("#/"), onOpenDevice: (device) => this.navigate(`#/device/${device.id}`) });
    this.detail = new DetailView(this.registry, { onBack: () => { this.suppressAutoRoute = true; this.navigate("#/"); }, onFlash: (device) => this.openFlash(device) });
    this.settings = new SettingsView(this.registry, { onBack: () => history.back(), onFlash: (device) => this.openFlash(device), feed: this.feed });
    this.contractorList = new ContractorListView({ onOpenCustomer: (id) => this.navigate(`#/contractor/${id}`) });
    this.contractorHome = new ContractorHomeView({ onBack: () => this.navigate("#/contractor") });

    this.routes = {
      home: h("div.route", this.home.el),
      intelligence: h("div.route", this.intelligence.el),
      simple: h("div.route", this.simple.el),
      room: h("div.route", this.room.el),
      device: h("div.route", this.detail.el),
      settings: h("div.route", this.settings.el),
      contractor: h("div.route", this.contractorList.el),
      customer: h("div.route", this.contractorHome.el),
    };

    this.banner = h("div", { style: { display: "none" } });
    document.querySelector("#app").append(this.banner, ...Object.values(this.routes));
  }

  async start() {
    applyAppearance();
    window.addEventListener("hashchange", () => this.render());
    this.registry.addEventListener("change", () => this.onRegistryChange());
    this.feed.addEventListener("change", () => this.onFeedChange());

    new ShareFeed(this.registry).start();
    this.feed.start();

    if (!this.registry.supported) {
      this.showBanner("This browser cannot connect to a cube over USB. Rooms in your home, shared cubes and scenarios still work. Web Serial is available in Chrome, Edge and other Chromium browsers on desktop.", "warn");
    } else {
      try {
        await this.registry.init();
      } catch (err) {
        this.showBanner(`Could not list serial ports: ${err.message}`, "warn");
      }
    }
    this.render();
    setInterval(() => this.refreshActive(), STALE_TICK_MS);
  }

  showBanner(message, kind = "") {
    this.banner.replaceChildren(h(`div.banner${kind ? `.${kind}` : ""}`, { text: message }));
    this.banner.style.display = "";
  }

  async connect() {
    if (!this.registry.supported) {
      toast("Connecting a cube needs Chrome or Edge on a desktop.", "err");
      return;
    }
    try {
      const device = await this.registry.requestPort();
      if (device) this.navigate(`#/device/${device.id}`);
    } catch (err) {
      if (err?.name !== "NotFoundError" && err?.name !== "AbortError") toast(err.message || String(err), "err");
    }
  }

  openFlash(device) {
    openFlashModal(this.registry, device).catch((err) => toast(err.message, "err"));
  }

  onRegistryChange() {
    for (const device of this.registry.devices) maybeOfferUpgradeCalibration(device);
    // Preserve the original dashboard: one physical cube opens its sensor/chart view.
    if (!this.suppressAutoRoute && this.registry.devices.length === 1 &&
        this.registry.devices[0].source !== 'simulated' &&
        (!location.hash || location.hash === '#/' || location.hash === '#')) {
      location.replace(`#/device/${this.registry.devices[0].id}`);
      return;
    }
    this.render();
  }

  onFeedChange() {
    if (this.route.name === "simple") this.simple.refresh();
    if (this.route.name === "intelligence") this.intelligence.refresh();
  }

  navigate(hash) {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  }

  parseHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "simple") return { name: "simple" };
    if (parts[0] === "intelligence") return { name: "intelligence" };
    if (parts[0] === "room" && parts.length >= 3) return { name: "room", householdId: parts[1], roomId: parts.slice(2).join("/") };
    if (parts[0] === "air" && parts[1]) return { name: "room", deviceId: parts[1] };
    if (parts[0] === "scenario" && parts[1]) return { name: "room", scenario: parts[1] };
    if (parts[0] === "device" && parts[1]) return { name: "device", id: parts[1] };
    if (parts[0] === "settings") return { name: "settings" };
    if (parts[0] === "contractor" && parts[1]) return { name: "customer", householdId: parts[1] };
    if (parts[0] === "contractor") return { name: "contractor" };
    return { name: "home" };
  }

  render() {
    const route = this.parseHash();
    const previous = this.route;

    if (route.name === "room") {
      const source = this.sourceFor(route);
      if (!source) {
        location.replace("#/");
        return;
      }
      if (this.room.source !== source) this.room.setSource(source);
      this.room.start();
    } else {
      this.room.stop();
    }
    if (route.name !== "room" || !route.scenario) this.stopScenario();

    if (route.name === "device") {
      const device = this.registry.byId(route.id);
      if (!device) {
        location.replace("#/");
        return;
      }
      if (this.detail.device !== device) this.detail.setDevice(device);
    }
    if (route.name === "customer" && (previous.name !== "customer" || previous.householdId !== route.householdId)) this.contractorHome.setHousehold(route.householdId);
    if (route.name === "contractor") this.contractorList.refresh();

    this.route = route;
    for (const [name, node] of Object.entries(this.routes)) node.classList.toggle("active", name === route.name);
    if (JSON.stringify(previous) !== JSON.stringify(route)) window.scrollTo(0, 0);
    this.refreshActive();
  }

  sourceFor(route) {
    if (route.scenario) {
      if (this.scenario?.scenario.key !== route.scenario) {
        this.stopScenario();
        try {
          this.scenario = new ScenarioSource(route.scenario);
        } catch (err) {
          toast(err.message, "err");
          return null;
        }
      }
      return this.scenario;
    }
    if (route.deviceId) {
      const device = this.registry.byId(route.deviceId);
      if (!device) return null;
      if (device.isRemote) {
        // A shared cube is a room in the home when the server is around.
        if (this.feed.available && this.feed.householdId) {
          const room = this.feed.summary?.rooms.find((r) => r.deviceKey && r.deviceHealth.source === "physical");
          if (room) return this.serverSource(this.feed.householdId, room.roomId);
        }
      }
      let source = this.localSources.get(device.id);
      if (!source) {
        source = new LocalRoomSource(device);
        this.localSources.set(device.id, source);
      }
      return source;
    }
    return this.serverSource(route.householdId, route.roomId);
  }

  serverSource(householdId, roomId) {
    const key = `${householdId}/${roomId}`;
    if (this._serverSource?.key !== key) this._serverSource = Object.assign(makeServerSource(this.feed, householdId, roomId), { key });
    if (this.feed.householdId !== householdId && this.feed.me?.households.some((hh) => hh.id === householdId)) this.feed.setHousehold(householdId);
    return this._serverSource;
  }

  stopScenario() {
    if (this.scenario) {
      this.scenario.destroy();
      this.scenario = null;
    }
  }

  refreshActive() {
    switch (this.route.name) {
      case "simple":
        this.simple.refresh();
        break;
      case "intelligence":
        this.intelligence.refresh();
        break;
      case "device":
        if (this.registry.byId(this.route.id)) this.detail.refresh();
        break;
      case "settings":
        this.settings.refresh();
        break;
      case "room":
      case "contractor":
      case "customer":
        break;
      default:
        this.home.refresh();
    }
  }
}

const app = new App();
app.start();
