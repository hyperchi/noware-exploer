/* Everyday choices first. Each group is an explicit, optional edit. */
import { h, toast, confirmDialog, fill, openModal } from '../ui.js';
import { homeApi } from '../home-api.js';
import { openLocationPicker } from '../aqi-ui.js';

const CONCERNS = [['pollen', 'Pollen'], ['dust', 'Dust'], ['petAllergens', 'Pet allergens'], ['smoke', 'Smoke'], ['cooking', 'Cooking'], ['mold', 'Humidity'], ['odors', 'Odors']];
const SENSITIVITIES = [['allergies', 'Allergies'], ['asthma', 'Asthma'], ['youngChildren', 'Young children'], ['elderlyResidents', 'Older adults']];
const PETS = [['cat', 'Cat'], ['dog', 'Dog'], ['other', 'Other pets'], ['unspecified', 'Prefer not to specify']];
const EQUIPMENT = [['hvac', 'Central heating & cooling'], ['hvac_filter', 'HVAC filter'], ['whole_home_air_cleaner', 'Whole-home air cleaner'], ['portable_purifier', 'Portable purifier'], ['humidifier', 'Humidifier'], ['dehumidifier', 'Dehumidifier'], ['fresh_air_ventilator', 'ERV / HRV'], ['kitchen_exhaust', 'Kitchen exhaust'], ['bathroom_exhaust', 'Bathroom fan'], ['thermostat', 'Thermostat'], ['operable_windows', 'Windows that open']];
const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'nursery', 'bathroom', 'office', 'basement', 'other'];

export function settingsFold(key, title, subtitle, ...children) {
  return h('details.settings-fold', { 'data-key': key },
    h('summary', h('div', h('strong', { text: title }), h('span', { text: subtitle })), h('span.settings-chevron', { 'aria-hidden': 'true', text: '+' })),
    h('div.settings-fold-body', ...children));
}
const field = (title, input, help) => h('label.settings-field', h('span', { text: title }), input, help ? h('small', { text: help }) : null);
function choices(items, current) {
  const nodes = items.map(([key, label]) => [key, h('input', { type: 'checkbox', checked: Boolean(current?.[key]) }), label]);
  return { el: h('div.settings-choices', ...nodes.map(([, input, label]) => h('label', input, label))), value: () => Object.fromEntries(nodes.map(([key, input]) => [key, input.checked])) };
}
function saveForm(children, submit, label = 'Save changes') {
  const status = h('span.settings-save-status', { role: 'status' });
  const button = h('button.simple-button.primary', { type: 'submit', text: label });
  return h('form.settings-form', { onsubmit: async e => {
    e.preventDefault(); button.disabled = true; status.textContent = 'Saving…';
    try { await submit(); status.textContent = 'Saved'; }
    catch (err) { status.textContent = err.message; }
    finally { button.disabled = false; }
  } }, ...children, h('div.settings-save', button, status));
}

export function householdSection(feed) {
  const host = h('div.settings-home');
  let signature = '';
  const expanded = new Set();
  function render() {
    const hh = feed.household;
    if (feed.available === false) { fill(host, h('p.settings-hint', { text: 'Home preferences are available when connected to your account.' })); return; }
    if (!hh) { fill(host, h('p.settings-hint', { text: 'Your home will appear when your AirCube connects.' })); return; }
    const home = hh.household, profile = home.profile || {};
    const sig = JSON.stringify([home.id, home.name, home.timeZone, profile, home.rooms, home.equipment, home.location, hh.contractor]);
    if (sig === signature) return;
    host.querySelectorAll('details[data-key]').forEach(d => d.open ? expanded.add(d.dataset.key) : expanded.delete(d.dataset.key));
    signature = sig;
    const save = async patch => { await homeApi.updateHousehold(home.id, patch); await feed.reloadHousehold(); toast('Changes saved'); };
    const name = h('input', { value: home.name, required: true, maxlength: '60' });
    const roomList = h('div.settings-rooms', ...home.rooms.map(room => {
      const name = h('input', { value: room.name, required: true, maxlength: '60', 'aria-label': `Room name: ${room.name}` });
      const type = h('select', { 'aria-label': `Room type: ${room.name}` }, ...ROOM_TYPES.map(t => h('option', { value: t, selected: t === room.type, text: t[0].toUpperCase() + t.slice(1) })));
      return h('div.settings-room', name, type, h('button.simple-link', { type: 'button', text: 'Save', 'aria-label': `Save ${room.name}`, onclick: async () => {
        if (!name.reportValidity()) return;
        try { await save({ rooms: home.rooms.map(r => r.id === room.id ? { ...r, name: name.value.trim(), type: type.value } : r) }); } catch (e) { toast(e.message, 'err'); }
      } }), h('button.simple-link.settings-remove', { type: 'button', text: 'Remove', 'aria-label': `Remove ${room.name}`, onclick: async () => {
        if (await confirmDialog('Remove room', `Remove ${room.name}? Its device will be detached.`, 'Remove')) {
          try { await save({ rooms: home.rooms.filter(r => r.id !== room.id) }); } catch (e) { toast(e.message, 'err'); }
        }
      } }));
    }));
    const addRoom = () => {
      const { body, close, backdrop } = openModal('Add a room'); backdrop.classList.add('simple-note-modal');
      const modal = backdrop.querySelector('.modal');
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Add a room');
      const input = h('input', { required: true, maxlength: '60', placeholder: 'For example, Bedroom' });
      const type = h('select', ...ROOM_TYPES.map(t => h('option', { value: t, text: t[0].toUpperCase() + t.slice(1), selected: t === 'other' })));
      body.append(saveForm([field('Room name', input), field('Room type', type)], async () => {
        await save({ rooms: [...home.rooms, { id: `room-${Date.now()}`, name: input.value.trim(), type: type.value }] }); close();
      }, 'Add room'), h('button.simple-button', { type: 'button', text: 'Cancel', onclick: close })); input.focus();
      modal.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const nodes = [...modal.querySelectorAll('input,select,button:not(:disabled)')];
        if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
      });
    };
    const concerns = choices(CONCERNS, profile.concerns), sens = choices(SENSITIVITIES, profile.sensitivities);
    const petTypes = new Set(profile.pets?.hasPets ? profile.pets.types || [] : []);
    if (profile.pets?.hasPets && !petTypes.size) petTypes.add('unspecified');
    const pets = choices(PETS, Object.fromEntries([...petTypes].map(t => [t, true])));
    const installed = choices(EQUIPMENT, Object.fromEntries((home.equipment || []).map(e => [e.type, true])));
    const contractor = hh.contractor;
    const provider = h('select', { 'aria-label': 'Choose service provider' }, h('option', { value: '', text: 'Loading providers…' }));
    const providerButton = h('button.simple-button', { type: 'button', text: contractor ? 'Change provider' : 'Connect provider', disabled: true, onclick: async () => {
      if (!provider.value) return;
      providerButton.disabled = true;
      try { await homeApi.connectProvider(home.id, provider.value, false); await feed.reloadHousehold(); toast('Provider connected. Sharing is off.'); }
      catch (e) { toast(e.message, 'err'); }
      finally { providerButton.disabled = !provider.value; }
    } });
    const providerMessage = h('p.settings-hint');
    provider.addEventListener('change', () => { providerButton.disabled = !provider.value; });
    homeApi.providers().then(list => {
      fill(provider, h('option', { value: '', text: list.length ? 'Choose a provider' : 'No providers available yet' }), ...list.map(p => h('option', { value: p.id, text: p.name })));
      providerMessage.textContent = list.length ? 'Connecting starts with sharing off.' : 'A registered provider will appear here when available.';
    }).catch(() => { fill(provider, h('option', { text: 'Providers unavailable' })); providerMessage.textContent = 'Could not load providers. Try again later.'; });
    const share = contractor ? h('input', { type: 'checkbox', checked: contractor.shareInsights, onchange: async e => {
      const requested = e.target.checked; e.target.disabled = true;
      try { await save({ shareInsights: requested }); } catch (err) { e.target.checked = !requested; toast(err.message, 'err'); }
      finally { e.target.disabled = false; }
    } }) : null;
    const context = [...SENSITIVITIES.filter(([k]) => profile.sensitivities?.[k]).map(([, v]) => v), ...PETS.filter(([k]) => profile.pets?.hasPets && petTypes.has(k)).map(([k, v]) => k === 'unspecified' ? 'Pets' : v)];
    fill(host,
      h('div.settings-area-row', h('div', h('strong', { text: 'Outdoor air' }), h('p', { text: home.location?.label || 'Add your area to compare inside and outside.' })), h('button.simple-button', { type: 'button', text: home.location ? 'Change area' : 'Choose area', onclick: () => openLocationPicker(feed) })),
      settingsFold('home', 'Home & rooms', `${home.name} · ${home.rooms.length} ${home.rooms.length === 1 ? 'room' : 'rooms'}`,
        saveForm([field('Home name', name)], () => save({ name: name.value.trim() })),
        h('h3', { text: 'Rooms' }), roomList, h('button.simple-button', { type: 'button', text: 'Add room', onclick: addRoom })),
      settingsFold('comfort', 'Make it personal', context.length ? context.join(' · ') : 'Allergies, pets and what matters to you. Optional.',
        saveForm([
          h('p.settings-hint', { text: 'Choose what applies. This helps tailor advice; it does not identify allergens.' }),
          h('fieldset', h('legend', { text: 'People in your home' }), sens.el),
          h('fieldset', h('legend', { text: 'Pets' }), pets.el),
          h('fieldset', h('legend', { text: 'What would you like help with?' }), concerns.el),
        ], () => { const selected = Object.entries(pets.value()).filter(([, v]) => v).map(([k]) => k); return save({ profile: { concerns: concerns.value(), sensitivities: sens.value(), pets: { hasPets: selected.length > 0, types: selected.filter(k => k !== 'unspecified') } } }); })),
      settingsFold('equipment', 'Air & comfort equipment', home.equipment?.length ? `${home.equipment.length} ${home.equipment.length === 1 ? 'item' : 'items'} added` : 'Purifier, heating, cooling and fans. Optional.',
        saveForm([h('p.settings-hint', { text: 'Select what you have so recommendations fit your home.' }), installed.el], () => {
          const values = installed.value();
          const next = (home.equipment || []).filter(e => !(e.type in values) || values[e.type]);
          for (const [type, label] of EQUIPMENT) if (values[type] && !next.some(e => e.type === type)) next.push({ id: `eq-${type}`, type, label });
          return save({ equipment: next });
        })),
      settingsFold('provider', 'Your service provider', contractor ? `${contractor.name} · Sharing ${contractor.shareInsights ? 'on' : 'off'}` : 'Connect someone you trust when you need help.',
        contractor ? h('div.settings-sharing', h('label', share, ` Share air insights with ${contractor.name}`), h('p.settings-hint', { text: 'Includes readings, event patterns, activity notes, household context and equipment. Turn off to remove their access to this home.' })) : null,
        h('div.settings-provider-picker', provider, providerButton), providerMessage),
    );
    host.querySelectorAll('details[data-key]').forEach(d => { d.open = expanded.has(d.dataset.key); });
  }
  feed.addEventListener('change', render); render();
  return host;
}
