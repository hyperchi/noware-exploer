/* Household context settings: concerns, sensitivities, pets, rooms,
 * equipment, contractor relationship and data sharing. Optional; defaults
 * are reasonable without any of it.
 */

import { h, toggle, toast, confirmDialog, fill } from "../ui.js";
import { homeApi } from "../home-api.js";

const CONCERNS = [["pollen", "Pollen"], ["dust", "Dust"], ["petAllergens", "Pet allergens"], ["smoke", "Smoke / wildfire"], ["cooking", "Cooking pollution"], ["mold", "Humidity / mould"], ["odors", "Odors"]];
const SENSITIVITIES = [["allergies", "Allergies"], ["asthma", "Asthma / respiratory sensitivity"], ["youngChildren", "Young children"], ["elderlyResidents", "Older residents"]];
const PETS = [["cat", "Cat"], ["dog", "Dog"], ["other", "Other"]];
const EQUIPMENT = [["hvac", "Central HVAC"], ["hvac_filter", "HVAC filter"], ["whole_home_air_cleaner", "Whole-home air cleaner"], ["portable_purifier", "Portable purifier"], ["humidifier", "Humidifier"], ["dehumidifier", "Dehumidifier"], ["fresh_air_ventilator", "Fresh-air ventilator (ERV/HRV)"], ["kitchen_exhaust", "Kitchen exhaust"], ["bathroom_exhaust", "Bathroom exhaust"], ["thermostat", "Smart thermostat"], ["operable_windows", "Operable windows"]];
const ROOM_TYPES = ["living", "bedroom", "kitchen", "nursery", "bathroom", "office", "basement", "other"];

function row(label, control, sub) {
  return h("div.settings-row", h("div.label", h("div", { text: label }), sub ? h("span.sub", { text: sub }) : null), control);
}

export function householdSection(feed) {
  const host = h("div");
  let signature = "";

  function render() {
    const hh = feed.household;
    if (feed.available === false) {
      fill(host, h("h2.section-label", { text: "Your home" }), h("div.card.settings-group", row("Not available", h("span.faint", { text: "Local mode" }), "Sign in to noware.so to set up rooms, context and your contractor.")), h("div", { style: { height: "14px" } }));
      return;
    }
    if (!hh) return;
    const sig = JSON.stringify([hh.household.id, hh.household.profile, hh.household.rooms.map((r) => [r.id, r.name, r.type]), hh.household.equipment, hh.contractor?.shareInsights]);
    if (sig === signature) return;
    signature = sig;
    const home = hh.household;
    const profile = home.profile || {};
    const save = async (patch, msg = "Saved") => {
      try {
        await homeApi.updateHousehold(home.id, patch);
        await feed.reloadHousehold();
        toast(msg);
      } catch (err) {
        toast(err.message, "err");
      }
    };
    const checks = (items, current, onChange) => h("div.check-list", ...items.map(([key, label]) => h("label", h("input", { type: "checkbox", checked: Boolean(current?.[key]), onchange: (e) => onChange(key, e.target.checked) }), label)));

    const nameInput = h("input", { type: "text", value: home.name, onchange: (e) => save({ name: e.target.value }) });
    const concerns = checks(CONCERNS, profile.concerns, (k, v) => save({ profile: { concerns: { [k]: v } } }, "Context updated"));
    const sens = checks(SENSITIVITIES, profile.sensitivities, (k, v) => save({ profile: { sensitivities: { [k]: v } } }, "Context updated"));
    const petTypes = new Set(profile.pets?.types || []);
    const pets = h("div.check-list", h("label", h("input", { type: "checkbox", checked: Boolean(profile.pets?.hasPets), onchange: (e) => save({ profile: { pets: { hasPets: e.target.checked, types: [...petTypes] } } }, "Context updated") }), "We have pets"), ...PETS.map(([key, label]) => h("label", h("input", { type: "checkbox", checked: petTypes.has(key), onchange: (e) => { if (e.target.checked) petTypes.add(key); else petTypes.delete(key); save({ profile: { pets: { hasPets: petTypes.size > 0 || Boolean(profile.pets?.hasPets), types: [...petTypes] } } }, "Context updated"); } }), label)));

    const roomsList = h("div.card-stack", ...home.rooms.map((r) => h("div.row.wrap",
      h("input", { type: "text", value: r.name, style: { width: "160px" }, onchange: (e) => save({ rooms: home.rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)) }) }),
      h("select", { onchange: (e) => save({ rooms: home.rooms.map((x) => (x.id === r.id ? { ...x, type: e.target.value } : x)) }) }, ...ROOM_TYPES.map((t) => h("option", { value: t, selected: t === r.type, text: t }))),
      h("span.faint.tiny", { text: r.devices?.length ? `${r.devices.length} device${r.devices.length > 1 ? "s" : ""}${r.devices.some((d) => d.simulation) ? " (simulated)" : ""}` : "no device" }),
      h("button.linkbtn.tiny", { type: "button", text: "Remove", onclick: async () => { if (await confirmDialog("Remove room", `Remove ${r.name}? Its device (if any) will be detached.`, "Remove")) save({ rooms: home.rooms.filter((x) => x.id !== r.id) }); } }),
    )), h("button.btn", { type: "button", text: "Add room", onclick: () => { const name = window.prompt("Room name", "Bedroom"); if (name) save({ rooms: [...home.rooms, { id: `room-${Date.now()}`, name, type: guess(name) }] }); } }));

    const equipmentSet = new Map((home.equipment || []).map((e) => [e.type, e]));
    const equipment = h("div.check-list", ...EQUIPMENT.map(([key, label]) => h("label", h("input", { type: "checkbox", checked: equipmentSet.has(key), onchange: (e) => { const next = home.equipment.filter((x) => x.type !== key); if (e.target.checked) next.push({ id: `eq-${key}`, type: key, label }); save({ equipment: next }, "Equipment updated"); } }), label)));

    const contractor = hh.contractor;
    const contractorRows = contractor
      ? [row(contractor.name, toggle(contractor.shareInsights, (on) => save({ shareInsights: on }, on ? "Sharing air insights" : "Sharing paused")), `Share air insights with ${contractor.name}. When off, they cannot see this home at all.`),
        row("What is shared", h("span.faint.tiny", { text: "Status, recurring patterns, measurements, equipment and the context above. Never raw second-by-second data." }))]
      : [row("No service provider connected", h("span.faint", { text: "—" }), "Connecting one lets you ask for help with your air data attached. Nothing is invented until then.")];

    fill(host, 
      h("h2.section-label", { text: `Your home${home.demo ? " · demo" : ""}` }),
      h("div.card.settings-group", row("Home name", nameInput), row("Time zone", h("span.faint", { text: home.timeZone || "browser default" }), "Used for time-of-day baselines and overnight patterns.")),
      h("div", { style: { height: "14px" } }),
      h("h2.section-label", { text: "What matters in this home" }),
      h("div.card.settings-group", row("Concerns", concerns, "Personalizes wording and which possibilities are listed. Never turns the sensor into an allergen detector."), row("Sensitivities", sens), row("Pets", pets)),
      h("div", { style: { height: "14px" } }),
      h("h2.section-label", { text: "Rooms" }),
      h("div.card.settings-group", row("Rooms", roomsList, "A cube is attached to a room by the name it publishes with, or the first room.")),
      h("div", { style: { height: "14px" } }),
      h("h2.section-label", { text: "Equipment" }),
      h("div.card.settings-group", row("Installed", equipment, "Used to tailor actions (e.g. run your purifier) and contractor insights.")),
      h("div", { style: { height: "14px" } }),
      h("h2.section-label", { text: "Service provider" }),
      h("div.card.settings-group", ...contractorRows),
      h("div", { style: { height: "14px" } }),
    );
  }

  feed.addEventListener("change", render);
  render();
  return host;
}

function guess(name) {
  const n = name.toLowerCase();
  for (const t of ROOM_TYPES) if (n.includes(t === "living" ? "living" : t)) return t;
  if (/bed/.test(n)) return "bedroom";
  return "other";
}
