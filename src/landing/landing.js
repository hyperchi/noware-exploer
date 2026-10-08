/* Homepage controller: scroll choreography, demo states, labels, and loading
 * the WebGL showcase lazily with a static fallback. */

const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const showcase = $('#showcase');
const stage = $('#stage');
const canvas = $('#stage-canvas');
const fallback = $('#stage-fallback');
const status = $('#stage-status');
const scenes = [...document.querySelectorAll('.scene')];
const dots = [...document.querySelectorAll('.progress span')];
const labelsHost = $('#labels');
const leaders = $('#leaders');
const detail = $('#part-detail');
const statusTitle = $('#status-title');
const selector = $('#state-selector');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory < 4) || window.innerWidth < 900;

// Scene windows in scroll progress. Copy cross-fades at the edges.
const SCENES = [
  [0, 0.14],
  [0.14, 0.4],
  [0.4, 0.58],
  [0.58, 0.85],
  [0.85, 1.001],
];

let controller = null;
let progress = 0;
let currentScene = 0;

// ---------------------------------------------------------------- scrolling
function readProgress() {
  const rect = showcase.getBoundingClientRect();
  const scrollable = rect.height - window.innerHeight;
  return scrollable > 0 ? clamp(-rect.top / scrollable, 0, 1) : 0;
}

function applyProgress() {
  progress = readProgress();
  controller?.setProgress(progress);
  SCENES.forEach(([a, b], i) => {
    const fade = 0.035;
    const inner = smooth(a - fade, a + fade, progress) * (1 - smooth(b - fade, b + fade, progress));
    const vis = i === 0 ? 1 - smooth(a + 0.08, a + 0.14, progress) : i === SCENES.length - 1 ? smooth(a - fade, a + fade, progress) : inner;
    const el = scenes[i];
    el.style.opacity = vis.toFixed(3);
    el.style.transform = reducedMotion ? '' : `translateY(${((1 - vis) * 18).toFixed(1)}px)`;
    el.classList.toggle('active', vis > 0.02);
    if (vis > 0.5 && currentScene !== i) {
      currentScene = i;
      dots.forEach((d, j) => d.classList.toggle('on', j === i));
    }
  });
  if (currentScene !== 3 && !detail.hidden) hideDetail();
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; applyProgress(); });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
// Keep the page's own scroll height sensible on short viewports.
applyProgress();

// Only render while the stage is on screen (and the tab is visible).
const io = new IntersectionObserver(([entry]) => controller?.setVisible(entry.isIntersecting && !document.hidden), { threshold: 0 });
io.observe(stage);
document.addEventListener('visibilitychange', () => controller?.setVisible(!document.hidden));

// ------------------------------------------------------------------- states
let currentState = 'good';
function setState(name, STATES) {
  currentState = name;
  const s = STATES[name];
  statusTitle.textContent = s.label;
  document.documentElement.style.setProperty('--state', s.css);
  for (const b of selector.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.state === name));
  controller?.setState(name);
}
selector.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-state]');
  if (b && STATES_REF) setState(b.dataset.state, STATES_REF);
});
selector.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !STATES_REF) return;
  const order = ['good', 'moderate', 'poor'];
  const next = order[(order.indexOf(currentState) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
  setState(next, STATES_REF);
  selector.querySelector(`[data-state="${next}"]`).focus();
  e.preventDefault();
});
let STATES_REF = null;

// ------------------------------------------------------------------- labels
const labelEls = new Map();
let labelMeta = {};
const NS = 'http://www.w3.org/2000/svg';

function labelFor(name) {
  if (labelEls.has(name)) return labelEls.get(name);
  const meta = labelMeta[name];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'label' + (meta.approx ? ' approx' : '');
  el.innerHTML = `${meta.title}<small>${meta.sub || ''}</small>`;
  el.addEventListener('pointerenter', () => setHover(name));
  el.addEventListener('pointerleave', () => setHover(null));
  el.addEventListener('focus', () => setHover(name));
  el.addEventListener('blur', () => setHover(null));
  el.addEventListener('click', () => showDetail(name));
  const line = document.createElementNS(NS, 'line');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '2.5');
  leaders.append(line, dot);
  labelsHost.append(el);
  const entry = { el, line, dot };
  labelEls.set(name, entry);
  return entry;
}

function placeLabels(items, vis, centre = {}) {
  if (!items.length || vis <= 0) {
    for (const { el, line, dot } of labelEls.values()) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      line.style.opacity = '0';
      dot.style.opacity = '0';
    }
    return;
  }
  const w = stage.clientWidth, h = stage.clientHeight;
  const mobile = w < 900;
  const mid = centre.x ?? w * 0.7;
  // Two columns either side of the model; on desktop the left one stops short of the copy.
  const columnRight = w - (mobile ? 14 : 48);
  const columnLeft = mobile ? 14 : Math.max(w * 0.44, mid - w * 0.23);
  // Small screens get the parts and the headline chips only.
  const keep = mobile ? new Set(['top', 'lightWall', 'airWall', 'button', 'pcb', 'bottom', 'U7', 'U3', 'U2', 'P1']) : null;
  const sorted = [...items].filter((i) => !keep || keep.has(i.name)).sort((a, b) => a.y - b.y);
  const placed = [];
  const spacing = mobile ? 26 : 34;
  for (const item of sorted) {
    const { el, line, dot } = labelFor(item.name);
    const right = item.x > mid;
    let lx = right ? columnRight : columnLeft;
    let ly = item.y;
    // Push apart vertically within the same column.
    for (const p of placed) {
      if (p.right === right && Math.abs(p.y - ly) < spacing) ly = p.y + spacing;
    }
    ly = clamp(ly, 40, h - 40);
    placed.push({ right, y: ly });
    const bw = el.offsetWidth || 90;
    const left = right ? lx - bw / 2 : lx + bw / 2;
    el.style.left = `${left}px`;
    el.style.top = `${ly}px`;
    el.style.opacity = vis.toFixed(3);
    el.style.pointerEvents = vis > 0.6 ? 'auto' : 'none';
    const edgeX = right ? left - bw / 2 : left + bw / 2;
    line.setAttribute('x1', item.x); line.setAttribute('y1', item.y);
    line.setAttribute('x2', edgeX); line.setAttribute('y2', ly);
    line.style.opacity = (vis * 0.6).toFixed(3);
    dot.setAttribute('cx', item.x); dot.setAttribute('cy', item.y);
    dot.style.opacity = vis.toFixed(3);
  }
}

function setHover(name) {
  for (const [n, { el }] of labelEls) el.classList.toggle('active', n === name);
  controller?.setHover(name);
}

function showDetail(name) {
  const meta = labelMeta[name];
  if (!meta) return hideDetail();
  $('#part-detail-name').textContent = meta.title + (meta.approx ? ' · illustrative geometry' : '');
  $('#part-detail-text').textContent = meta.text;
  detail.hidden = false;
  setHover(name);
}
function hideDetail() {
  detail.hidden = true;
  setHover(null);
}

// ------------------------------------------------------------------ loading
function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

function useFallback(message) {
  canvas.hidden = true;
  fallback.hidden = false;
  labelsHost.hidden = true;
  status.textContent = message;
  status.classList.add('show');
  setTimeout(() => status.classList.remove('show'), 6000);
}

async function boot() {
  if (!webglAvailable()) return useFallback('3D preview unavailable in this browser');
  status.textContent = 'Loading model';
  status.classList.add('show');
  try {
    const mod = await import('./showcase.js');
    STATES_REF = mod.STATES;
    labelMeta = {};
    for (const [k, v] of Object.entries(mod.PARTS)) labelMeta[k] = { ...v, sub: 'printed part' };
    for (const [k, v] of Object.entries(mod.COMPONENTS)) labelMeta[k] = { ...v, sub: k };
    controller = await mod.createShowcase(canvas, {
      reducedMotion,
      lowPower,
      onLabels: placeLabels,
      onHover: (name) => { for (const [n, { el }] of labelEls) el.classList.toggle('active', n === name); },
      onPick: (name) => (name ? showDetail(name) : hideDetail()),
    });
    controller.setState(currentState);
    controller.setProgress(progress);
    status.classList.remove('show');
  } catch (err) {
    console.error(err);
    useFallback('3D preview could not load');
  }
}

if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 800 });
else setTimeout(boot, 50);

// Signed-in visitors get straight to the workspace.
fetch('/api/auth?action=session', { headers: { Accept: 'application/json' } }).then((r) => {
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) return;
  for (const a of [$('#auth-link'), $('#hero-cta')]) {
    a.href = '/explorer';
    a.textContent = a.id === 'auth-link' ? 'Open workspace' : 'Open the workspace';
  }
}).catch(() => {});
