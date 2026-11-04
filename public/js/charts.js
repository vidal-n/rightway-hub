// Small SVG charts, pure (strings in, strings out): trend lines and grouped bars for the analytics pages.
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nice = (max) => { if (max <= 5) return 5; const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function lineChart(labels, series, { w = 720, h = 240, pad = 34 } = {}) {
  const n = labels.length;
  if (!n) return '';
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => pad + (n === 1 ? (w - pad * 2) / 2 : (i * (w - pad * 2)) / (n - 1));
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const every = Math.max(1, Math.ceil(n / 8));
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} by day">
    ${ticks.map((t) => `<line class="grid" x1="${pad}" x2="${w - pad}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${h - pad + 16}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
    ${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
      ${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${n > 40 ? 0 : 3}" fill="${s.color}"><title>${esc(`${s.name} ${labels[i]}: ${v}`)}</title></circle>`).join('')}`).join('')}
  </svg>`;
}

export function barChart(labels, series, { w = 720, h = 240, pad = 34 } = {}) {
  const n = labels.length;
  if (!n) return '';
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)));
  const band = (w - pad * 2) / n, bw = Math.max(3, (band * 0.72) / series.length);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">
    ${ticks.map((t) => `<line class="grid" x1="${pad}" x2="${w - pad}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${labels.map((l, i) => `<text x="${pad + band * i + band / 2}" y="${h - pad + 16}" text-anchor="middle">${esc(l)}</text>
      ${series.map((s, k) => `<rect x="${pad + band * i + band * 0.14 + k * bw}" y="${y(s.values[i])}" width="${bw - 2}" height="${Math.max(0, h - pad - y(s.values[i]))}" rx="3" fill="${s.color}"><title>${esc(`${s.name} ${l}: ${s.values[i]}`)}</title></rect>`).join('')}`).join('')}
  </svg>`;
}

export const legend = (series) => `<div class="legend" style="margin-top:6px">${series.map((s) => `<span><i class="dot" style="background:${s.color};box-shadow:none"></i>${esc(s.name)}</span>`).join('')}</div>`;
