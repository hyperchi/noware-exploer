/* Small, decorative line icons for the companion view. No remote assets. */
const paths = {
  air: ['M3 8h12a3 3 0 1 0-3-3', 'M3 12h16a3 3 0 1 1-3 3', 'M3 16h5a3 3 0 1 1-3 3'],
  particles: ['M7 4h.01M17 5h.01M12 11h.01M5 15h.01M18 17h.01M10 21h.01'],
  chemicals: ['M9 3h6M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3', 'M8 15h8'],
  humidity: ['M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12Z', 'M9 16a3 3 0 0 0 3 3'],
  check: ['m6 12 4 4 8-8'],
  device: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M10 7h4M11 17h2'],
};

export function simpleIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'particles' ? '3.5' : '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'simple-icon' })) svg.setAttribute(key, value);
  for (const d of paths[name] || paths.air) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

/** Separate typography for a number and its unit without rounding it again. */
export function readingParts(text) {
  const parts = String(text).match(/^(-?[\d,.]+)\s*(.*)$/);
  return parts ? { number: parts[1], unit: parts[2] } : { number: text, unit: '' };
}
