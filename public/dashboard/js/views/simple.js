/* A plain-language view alongside the original dashboard. All conclusions
 * come from the shared summary; this view only selects and presents them. */
import { h, fill, toast, openModal } from '../ui.js';
import { homeApi } from '../home-api.js';
import { agoText, clockText, recommendationCard, contractorCard, timelineList, evidenceList, openContactModal } from '../air-ui.js';
import { OBSERVATION_TYPES } from '../intelligence/source-patterns.js';

const NAMES = { pm25: 'Fine particles', co2: 'Fresh air', eco2: 'Fresh-air estimate', tvoc: 'Chemicals & odors', hum: 'Humidity', temp: 'Temperature' };
const MEANINGS = { pm25: 'Tiny particles from things like cooking, dust or smoke.', co2: 'Carbon dioxide helps show when a room needs more fresh air.', eco2: 'An estimate from the gas sensor. It also reacts to odors.', tvoc: 'An estimate of gases from products, cooking and other sources.', hum: 'How much moisture is in the air.', temp: 'How warm or cool this room is.' };

export class SimpleView {
  constructor({ feed }) {
    this.feed = feed;
    this.roomId = null;
    this.headerRooms = h('div.simple-selectors');
    this.body = h('div.simple-body');
    this.expanded = new Set();
    this.el = h('main.simple-air',
      h('header.simple-header', h('a.simple-brand', { href: '#/', text: 'noware', 'aria-label': 'Noware original dashboard' }),
        h('span.simple-wordmark', { text: 'AIR, UNDERSTOOD.' }), h('div.spacer'),
        h('nav.simple-switch', { 'aria-label': 'Dashboard view' }, h('a.selected', { href: '#/simple', text: 'Simple view', 'aria-current': 'page' }), h('a', { href: '#/', text: 'Original view' }))),
      h('div.simple-topline', h('div', h('div.simple-kicker', { text: 'YOUR EVERYDAY AIR' }), h('p', { text: 'A little clarity. A more comfortable home.' })), this.headerRooms),
      this.body,
      h('footer.simple-footer', h('span', { text: 'AirCube · Real readings. Thoughtful guidance.' }), h('a', { href: '#/intelligence', text: 'All rooms & air insights →' })),
    );
  }

  refresh() {
    // Preserve disclosure state and keyboard focus across the live refresh.
    this.body.querySelectorAll('details[data-key]').forEach(d => d.open ? this.expanded.add(d.dataset.key) : this.expanded.delete(d.dataset.key));
    const focusKey = this.el.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const f = this.feed;
    const rooms = f.summary?.rooms || [];
    if (!rooms.some(r => r.roomId === this.roomId)) this.roomId = f.summary?.home.primaryRoomId || rooms[0]?.roomId;
    const room = rooms.find(r => r.roomId === this.roomId);
    fill(this.headerRooms,
      f.me?.households?.length > 1 ? h('label', 'Home', h('select', { 'data-focus': 'household', onchange: e => f.setHousehold(e.target.value) }, ...f.me.households.map(hh => h('option', { value: hh.id, selected: hh.id === f.householdId, text: hh.name })))) : null,
      rooms.length ? h('label', 'Room', h('select', { 'data-focus': 'room', onchange: e => { this.roomId = e.target.value; this.refresh(); } }, ...rooms.map(r => h('option', { value: r.roomId, selected: r.roomId === this.roomId, text: r.roomName })))) : null,
    );
    if (!room || f.error) {
      fill(this.body, h('section.simple-hero', h('div.simple-kicker', { text: 'YOUR HOME' }), h('h1', { text: f.error ? 'Let’s reconnect.' : f.summary ? 'Welcome home.' : 'Checking your air…' }), h('p', { text: f.error ? 'We cannot get a current reading right now. Check your connection or open the original dashboard.' : 'Your connected AirCube will appear here. Add a home or room in Settings if needed.' }), h('a.simple-button', { href: '#/settings', text: 'Open settings' })));
      return;
    }
    const online = room.deviceHealth.state === 'online';
    const good = online && ['excellent', 'good'].includes(room.currentStatus.status);
    const issue = online ? room.primaryIssue : null;
    const warm = room.deviceHealth.state === 'warming_up';
    const title = warm ? 'Getting to know your air.' : !online ? 'Let’s reconnect.' : good && !issue ? 'Your air looks good.' : issue?.headline || room.currentStatus.label;
    const rec = online ? room.homeownerRecommendations.find(r => r.level === 'diy') || room.homeownerRecommendations[0] : null;
    const roomHref = `#/room/${encodeURIComponent(f.householdId)}/${encodeURIComponent(room.roomId)}`;
    const tone = !online ? 'quiet' : good ? 'good' : 'attention';
    const current = issue ? room.measurements.find(m => m.channel === issue.channel) || issue.measurement : null;
    const hero = h(`section.simple-hero.${tone}`,
      h('div.simple-hero-main',
        h('div.simple-kicker', h('span.simple-state-dot'), `${room.roomName} · ${warm ? 'WARMING UP' : online ? 'RIGHT NOW' : room.deviceHealth.label.toUpperCase()}`,
          room.deviceHealth.simulated ? h('span.badge.sim', { text: 'Simulated' }) : null),
        h('h1', { text: title }),
        h('p.simple-lead', { text: warm ? 'Your sensor is settling in. We’ll interpret the air once readings are ready.' : !online ? 'Your AirCube is not sending usable readings. We can’t tell how the air is right now.' : good && !issue ? 'Nothing in the measurements needs your attention right now.' : issue?.explanation || room.currentStatus.explanation }),
        current ? h('div.simple-primary-reading', h('strong', { text: current.text }), h('span', { text: current.technical }), h('span', { text: current.baseline?.text || current.baselineText || '' })) : null,
        h('div.simple-health', { text: `${room.deviceName || 'AirCube'} · ${online ? 'Updated ' : 'Last reading '}${agoText(room.deviceHealth.ageS) || 'not available'}${room.deviceHealth.simulated ? ' · Simulated data' : ' · Physical sensor'}` }),
      ),
      h('aside.simple-next', h('div.simple-kicker', { text: 'WHAT TO DO' }),
        rec ? recommendationCard(rec, { onAck: async r => { try { await homeApi.ack(f.householdId, issue.eventId, r.id); await f.refresh(); toast('Saved. We’ll keep watching the air.'); } catch (e) { toast(e.message, 'err'); } }, onContact: () => this.contact(room), contractorName: f.household?.contractor?.name })
          : h('div', h('div.simple-next-mark', { 'aria-hidden': 'true', text: good ? '✓' : '—' }), h('h2', { text: warm ? 'Give it a little time.' : !online ? 'Check your AirCube.' : good ? 'Carry on with your day.' : 'Keep an eye on the readings.' }), h('p', { text: warm ? 'Warm-up values will not be treated as an air problem.' : !online ? 'Check its power and the collector connection.' : good ? 'We’ll keep watching for changes.' : 'Open the room details for the measurements and guidance.' }), !online ? h('a.simple-link', { href: '#/', text: 'Open device dashboard →' }) : !good ? h('a.simple-link', { href: roomHref, text: 'See room details →' }) : null)),
    );
    const recovery = room.recovery && online ? h('div.simple-recovery', h('span', { 'aria-hidden': 'true', text: room.recovery.state === 'improving' || room.recovery.state === 'resolved' ? '↘' : '↔' }), h('div', h('strong', { text: 'Is it getting better?' }), h('p', { text: room.recovery.text }))) : null;
    const mainChannels = ['pm25', room.capabilities.trueCo2 ? 'co2' : 'eco2', 'tvoc', 'hum'];
    const metrics = h('section.simple-section', this.sectionHead('The numbers, made simple', 'What your AirCube is seeing.', h('a.simple-link', { href: roomHref, text: 'All measurements →' })),
      h('div.simple-metrics', ...mainChannels.map(c => room.measurements.find(m => m.channel === c)).filter(Boolean).map(m => this.metric(m, online, warm))));
    const cause = issue ? h('section.simple-cause', h('div.simple-kicker', { text: 'WHAT MAY HAVE CHANGED' }), h('h2', { text: issue.source && issue.source !== 'unknown' ? `Possibly ${issue.sourceLabel || 'a change in this room'}` : 'A few different causes could fit.' }),
      h('p', { text: issue.source !== 'unknown' ? `${issue.confidence ? issue.confidence[0].toUpperCase() + issue.confidence.slice(1) : 'Low'} confidence · This is an interpretation of the pattern, not a directly measured source.` : 'The reading is real. The cause is still uncertain. A note about what was happening may help.' }),
      this.disclosure('cause', 'See the evidence', evidenceList(issue.evidence)),
    ) : null;
    const patterns = room.sourcePatterns;
    const clues = h('section.simple-section', this.sectionHead('What might be behind it?', 'Clues from your air, plus what you notice at home.', h('button.simple-button', { type: 'button', text: '+ Add an activity note', 'data-focus': 'add-note', onclick: () => this.addNote(room) })),
      h('div.simple-patterns', ...(patterns?.cards || []).map(p => this.pattern(p))),
      patterns?.associations.length ? h('div.simple-associations', ...patterns.associations.map(a => h('div', h('strong', { text: `${a.label} · ${a.recurring ? 'Repeated timing match' : 'Still learning'}` }), h('p', { text: a.text })))) : null,
      patterns?.recentObservations.length ? this.disclosure('notes', 'Your activity notes', h('ul.simple-notes', ...patterns.recentObservations.map(o => h('li', h('div', h('strong', { text: o.label }), h('span', { text: `You recorded · ${new Date(o.occurredAt * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clockText(o.occurredAt)}` }), o.note ? h('p', { text: o.note }) : null), h('button.simple-link', { type: 'button', text: 'Remove', 'aria-label': `Remove ${o.label} note`, 'data-focus': `remove-${o.id}`, onclick: async () => { try { await homeApi.removeObservation(f.householdId, o.id); await f.refresh(); } catch (e) { toast(e.message, 'err'); } } }))))) : null,
    );
    const story = h('section.simple-section', this.sectionHead('Your air, over the day', 'Changes and actions from the last 24 hours.'), timelineList(room.timeline?.slice(-6), { empty: online ? 'No air events recorded in the last 24 hours.' : 'No recent air events recorded. Live readings are unavailable.' }));
    const provider = f.household?.contractor;
    const help = provider ? contractorCard(provider, { onContact: type => this.contact(room, type), onReport: () => this.contact(room, 'share_air_report') }) : h('section.simple-help', h('div', h('h2', { text: 'A little help, when you need it.' }), h('p', { text: 'Connect your home comfort provider to ask about recurring air problems.' })), h('a.simple-link', { href: '#/settings', text: 'Connect a provider →' }));
    fill(this.body, hero, recovery, metrics, cause, clues, story, help);
    this.body.querySelectorAll('details[data-key]').forEach(d => { d.open = this.expanded.has(d.dataset.key); });
    if (focusKey) this.el.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  sectionHead(title, subtitle, action) {
    return h('div.simple-section-head', h('div', h('h2', { text: title }), h('p', { text: subtitle })), action);
  }

  metric(m, online, warm) {
    return h('article.simple-metric', h('div.simple-metric-heading', h('h3', { text: NAMES[m.channel] }), h('span', { text: !online ? warm ? 'Settling' : 'Last reading' : m.bandLabel })),
      h('div.simple-metric-value', { text: warm ? '—' : m.text }), h('div.simple-technical', { text: `${m.technical}${m.kind === 'derived' ? ' · estimate' : ' · measured'}` }),
      h('p', { text: MEANINGS[m.channel] }),
      h('div.simple-baseline', { text: m.baseline?.text || 'Learning what’s usual for this room.' }),
      online && m.ratioText ? h('div.simple-trend', { text: m.ratioText }) : null,
    );
  }

  disclosure(key, label, content) {
    return h('details.simple-disclosure', { 'data-key': key }, h('summary', { text: label, 'data-focus': key }), content);
  }

  pattern(p) {
    return h('article.simple-pattern', h('div.simple-kicker', { text: p.title }), h('h3', { text: p.label }), h('p', { text: p.explanation }),
      p.state === 'possible' || p.state === 'clue' ? h('span.simple-confidence', { text: `${p.confidence.level === 'medium' ? 'Medium' : 'Low'} confidence · pattern clue` }) : null,
      this.disclosure(p.id, 'How we work this out', h('div', p.confidence.evidence.length ? evidenceList(p.confidence.evidence) : h('p', { text: 'No supporting pattern established yet.' }), h('strong', { text: 'What we still need to know' }), h('ul', ...p.missing.map(t => h('li', { text: t }))), h('p', { text: p.nextStep }))),
      p.externalUrl ? h('a.simple-link', { href: p.externalUrl, target: '_blank', rel: 'noopener noreferrer', text: `${p.externalLabel} ↗` }) : null);
  }

  addNote(room) {
    const { body, close, backdrop } = openModal('What was happening?');
    backdrop.classList.add('simple-note-modal');
    const modal = backdrop.querySelector('.modal');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'What was happening?');
    const type = h('select', { id: 'activity-type', required: true }, h('option', { value: '', text: 'Choose an activity', selected: true }), ...Object.entries(OBSERVATION_TYPES).map(([value, text]) => h('option', { value, text })));
    const time = h('select', { id: 'activity-time' }, ...[[0, 'Just now'], [5, '5 minutes ago'], [15, '15 minutes ago'], [30, '30 minutes ago'], [60, 'An hour ago']].map(([value, text]) => h('option', { value, text })));
    const note = h('textarea', { id: 'activity-note', maxlength: '300', rows: '2', placeholder: 'Anything else you noticed?' });
    const error = h('p', { role: 'alert' });
    const submit = h('button.simple-button.primary', { type: 'submit', text: 'Save activity note' });
    const form = h('form', { onsubmit: async e => {
      e.preventDefault(); submit.disabled = true;
      try { await homeApi.observe(this.feed.householdId, { roomId: room.roomId, type: type.value, occurredAt: Date.now() / 1000 - Number(time.value) * 60, note: note.value }); this.expanded.add('notes'); close(); await this.feed.refresh(); toast('Activity saved as your observation.'); this.el.querySelector('[data-focus="add-note"]')?.focus(); }
      catch (err) { error.textContent = err.message; submit.disabled = false; }
    } }, h('p', { text: `Add context for ${room.roomName}. This records what you noticed; it does not change the sensor readings.` }),
      h('p', { text: this.feed.household?.contractor?.shareInsights ? 'Your notes and pattern summaries are shared with your connected provider while insight sharing is on.' : 'Your notes stay with your household unless you choose to share insights with a provider.' }),
      h('label', { for: 'activity-type', text: 'Activity' }), type,
      h('label', { for: 'activity-time', text: 'When?' }), time,
      h('label', { for: 'activity-note', text: 'A note (optional)' }), note, error,
      h('div.simple-note-actions', h('button.simple-button', { type: 'button', text: 'Cancel', onclick: close }), submit));
    body.append(form); type.focus();
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const nodes = [...modal.querySelectorAll('button:not(:disabled),select,textarea')];
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
    });
  }

  contact(room, type = 'message') {
    const f = this.feed, contractor = f.household?.contractor;
    if (!contractor) { location.hash = '#/settings'; return; }
    openContactModal({ type, contractor, build: async () => ({ room: room.roomName, issue: room.primaryIssue?.headline || 'Question about my air', current: room.primaryIssue?.measurement?.text, supportingHistory: `${room.patterns.totalEvents} air events in the last 30 days`, deviceHealth: room.deviceHealth.label }), send: message => homeApi.contact(f.householdId, { type, roomId: room.roomId, eventId: room.primaryIssue?.eventId || null, message }) });
  }
}
