// Tiny dependency-free chart helpers that return HTML/SVG strings.

// Donut / ring chart. segments: [{ value, color }]. Renders clockwise from top.
// opts: { size, stroke, center (HTML string in the middle), track (bg ring color) }
export function donut(segments, opts = {}) {
  const size = opts.size ?? 132;
  const stroke = opts.stroke ?? 16;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;

  let offset = 0;
  const arcs = segments.filter(s => s.value > 0).map((s) => {
    const frac = s.value / total;
    const len = frac * circ;
    const dash = `${len} ${circ - len}`;
    const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none"
      stroke="${s.color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${c} ${c})" />`;
    offset += len;
    return el;
  }).join('');

  const track = opts.track
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${opts.track}" stroke-width="${stroke}" />`
    : '';

  const center = opts.center
    ? `<div class="donut-center" style="inset:0">${opts.center}</div>` : '';

  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${track}${arcs}</svg>
    ${center}
  </div>`;
}

// Convenience: single-value progress ring.
export function ring(pct, color, opts = {}) {
  return donut([{ value: pct, color }], { track: opts.track ?? 'rgba(128,128,128,.15)', ...opts });
}

// GitHub-style contribution heatmap.
// cells: array of { level: 0..4, title, color } ordered oldest -> newest, length multiple-of-7 friendly.
export function heatmap(cells, opts = {}) {
  const cellHtml = cells.map((d) =>
    `<i class="hm-cell" data-lvl="${d.level}" title="${d.title || ''}"
        style="${d.color && d.level ? `background:${d.color};opacity:${0.25 + d.level * 0.1875}` : ''}"></i>`
  ).join('');
  return `<div class="heatmap">${cellHtml}</div>`;
}
