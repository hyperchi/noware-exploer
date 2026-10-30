/* Presentation only: both values already share EPA PM2.5 + NowCast math. */
import { h, openModal, fill, toast } from './ui.js';
import { homeApi } from './home-api.js';
import { measurementIsLive } from './intelligence/live-measurements.js';

export function aqiPanel(room, feed, onLocation) {
  const comparison = room.aqiComparison;
  if (!comparison) return null;
  const live = measurementIsLive({ state: room.deviceHealth.state, measuredAt: room.deviceHealth.lastReadingAt, now: Date.now() / 1000 });
  const indoor = live ? comparison.indoor : { state: 'unavailable', reason: 'Waiting for usable live sensor readings.' };
  const area = feed.household?.household?.location;
  const card = (title, result, outside = false) => {
    const ready = result.state === 'available';
    return h('article.aqi-card', { 'data-band': ready ? result.band : 'unknown' },
      h('div.simple-kicker', { text: title }),
      h('div.aqi-result', h('div.aqi-number', { text: ready ? result.text : '—' }),
        h('div.aqi-category', h('span.aqi-status-dot', { 'aria-hidden': 'true' }), ready ? result.label : outside && !area && onLocation ? 'Choose your area' : 'Not available yet')),
      h('p.aqi-metric', { text: 'US AQI · PM2.5 · NowCast estimate' }),
      ready ? h('p', { text: `PM2.5 weighted average: ${result.pm25.toFixed(1)} µg/m³` }) : h('p', { text: result.reason }),
      h('p.aqi-origin', { text: outside ? (ready && result.provider?.startsWith('US EPA') ? `${result.provider} · preliminary data` : 'Regional outdoor model · Open-Meteo / CAMS') : room.deviceHealth.simulated ? 'Simulated readings · not your AirCube' : 'Measured by your AirCube · AQI calculated' }),
      ready ? h('p.aqi-time', { text: `${result.hoursUsed} hourly values · through ${new Date(result.through * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }) : null,
    );
  };
  return h('section.simple-section.aqi-section',
    h('div.simple-section-head', h('div', h('h2', { text: 'Your room & outside' }), h('p', { text: 'The same air-quality scale, inside and out.' })),
      !onLocation ? null : h('button.simple-button', { type: 'button', text: area ? 'Change area' : 'Set your location', 'data-focus': 'aqi-location', onclick: onLocation })),
    h('div.aqi-pair', card(room.roomName, indoor), card(area?.label ? `Outside · ${area.label.split(',')[0]}` : 'Outside near you', comparison.outdoor, true)),
    h('div.aqi-comparison', { text: live ? comparison.explanation : 'Both values use the same US EPA PM2.5 scale and NowCast calculation.' }),
    h('details.simple-disclosure', { 'data-key': 'aqi-method' }, h('summary', { text: 'How these AQI numbers compare', 'data-focus': 'aqi-method' }),
      h('p', { text: comparison.note }),
      h('p', { text: 'Both use the US EPA PM2.5 breakpoints updated in 2024, the same completed-hour window, and the same weighting rules. The AirCube’s VOC index is not used. Current sensor values below may change faster than this hourly index.' }),
      h('p', { text: 'Apple Weather may show a different value because its provider, pollutant coverage and update time can differ. Our comparison covers fine particles on both sides. Outdoor values represent the nearest monitor or a regional model, not the air directly outside your window.' }),
      h('p', { text: 'AQI is not an allergy score. Low particle levels cannot establish that pet allergens are absent.' }),
      h('div.aqi-attribution', h('a', { href: 'https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html', target: '_blank', rel: 'noopener noreferrer', text: 'EPA scale' }), ' · ',
        h('a', { href: 'https://forum.airnowtech.org/t/the-nowcast-for-pm2-5-and-pm10/172', target: '_blank', rel: 'noopener noreferrer', text: 'NowCast method' }), ' · ',
        h('a', { href: 'https://open-meteo.com/en/docs/air-quality-api', target: '_blank', rel: 'noopener noreferrer', text: 'Open-Meteo / CAMS data' }), ' · ', h('a', { href: 'https://www.airnow.gov/', target: '_blank', rel: 'noopener noreferrer', text: 'EPA AirNow data' }))),
  );
}

export function openLocationPicker(feed) {
  const { body, close, backdrop } = openModal('Compare with outdoor air');
  backdrop.classList.add('simple-note-modal');
  const modal = backdrop.querySelector('.modal');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Compare with outdoor air');
  const message = h('p', { role: 'status', 'aria-live': 'polite' });
  const results = h('div.aqi-city-results');
  const save = async area => {
    if (!backdrop.isConnected) return;
    try { await homeApi.setLocation(feed.householdId, { ...area, enabled: true }); await feed.reloadHousehold(); close(); toast('Outdoor comparison connected.'); }
    catch (e) { message.textContent = e.message; }
  };
  const locate = h('button.simple-button.primary', { type: 'button', text: 'Use approximate location', onclick: () => {
    if (!navigator.geolocation) { message.textContent = 'Location is unavailable in this browser. Choose a city below.'; return; }
    locate.disabled = true; message.textContent = 'Waiting for your browser’s location permission…';
    navigator.geolocation.getCurrentPosition(async p => {
      // Never send or persist the precise browser coordinates.
      message.textContent = 'Looking up outdoor air for your area…';
      await save({ latitude: Math.round(p.coords.latitude * 10) / 10, longitude: Math.round(p.coords.longitude * 10) / 10, label: 'Your approximate area' });
      locate.disabled = false;
    }, () => { locate.disabled = false; message.textContent = 'Could not use location. You can choose your city below.'; }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  } });
  const query = h('input', { id: 'aqi-city', type: 'search', placeholder: 'ZIP code or city', minlength: '2', maxlength: '100', required: true });
  const search = h('button.simple-button', { type: 'submit', text: 'Find area' });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); search.disabled = true; fill(results); message.textContent = 'Finding places…';
    try {
      const response = await homeApi.searchLocations(query.value);
      message.textContent = response.locations.length ? 'Choose the area for this home.' : 'No match found. Try a nearby city.';
      fill(results, ...response.locations.map(area => h('button.simple-button', { type: 'button', text: area.label, onclick: () => { message.textContent = 'Looking up outdoor air…'; save(area); } })));
    } catch (err) { message.textContent = err.message; }
    finally { search.disabled = false; }
  } }, h('label', { for: 'aqi-city', text: 'Or enter a ZIP code or city' }), h('div.aqi-search', query, search));
  const remove = feed.household?.household?.location ? h('button.simple-button', { type: 'button', text: 'Stop using location', onclick: async () => {
    try { await homeApi.setLocation(feed.householdId, { enabled: false }); await feed.reloadHousehold(); close(); } catch (e) { message.textContent = e.message; }
  } }) : null;
  body.append(h('p', { text: 'Use this home’s area for outdoor air quality. Browser location is rounded to about 10 km before it is stored or used to look up outdoor air. No background location tracking.' }), locate, form, message, results,
    h('p.aqi-location-credit', 'Area search: Zippopotam.us, Open-Meteo / GeoNames. Outdoor air: EPA AirNow or CAMS via Open-Meteo.'),
    h('div.simple-note-actions', remove, h('button.simple-button', { type: 'button', text: 'Cancel', onclick: close })));
  locate.focus();
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const nodes = [...modal.querySelectorAll('button:not(:disabled),input')];
    if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
  });
}
