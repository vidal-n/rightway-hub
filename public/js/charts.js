// Small SVG charts, pure (strings in, strings out): trend lines and grouped bars for the analytics pages.
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nice = (max) => { if (max <= 5) return 5; const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function lineChart(labels, series, { w = 720, h = 240, pad = 34, area = false, fmt = (v) => v } = {}) {
  const n = labels.length;
  if (!n) return '';
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => pad + (n === 1 ? (w - pad * 2) / 2 : (i * (w - pad * 2)) / (n - 1));
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 100) / 100);
  const every = Math.max(1, Math.ceil(n / 8));
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} by day">
    ${ticks.map((t) => `<line class="grid" x1="${pad}" x2="${w - pad}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`).join('')}
    ${labels.map((l, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every >= Math.ceil(every / 2)) ? `<text x="${x(i)}" y="${h - pad + 16}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
 ${series.map((s) => `${area ? `<polygon points="${x(0)},${y(0)} ${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity=".13"/>` : ''}<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>
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

// ---- Dashboard and budget charts. Colors can be CSS variables (var(--c-blue)) so they follow light and dark. ----
export function stackBars(labels, series, { w = 720, h = 240, pad = 34, fmt = (v) => v, cap = 0 } = {}) {
  const n = labels.length;
  if (!n) return '';
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const top = Math.max(0.01, cap, ...totals);
  const max = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100].find((s) => s >= top * 1.05) || nice(top);
  const band = (w - pad * 2) / n, bw = Math.max(2, band * 0.7);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const every = Math.max(1, Math.ceil(n / 8));
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f * 100) / 100);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))} by day">
    ${ticks.map((t) => `<line class="grid" x1="${pad}" x2="${w - pad}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`).join('')}
    ${cap ? `<line class="capline" x1="${pad}" x2="${w - pad}" y1="${y(cap)}" y2="${y(cap)}"><title>Budget pace ${esc(fmt(Math.round(cap * 100) / 100))} a day</title></line>` : ''}
    ${labels.map((l, i) => {
    let acc = 0;
    const x = pad + band * i + (band - bw) / 2;
    return `${i % every === 0 || (i === n - 1 && (n - 1) % every >= Math.ceil(every / 2)) ? `<text x="${x + bw / 2}" y="${h - pad + 16}" text-anchor="middle">${esc(l)}</text>` : ''}
      ${series.map((s) => { const v = s.values[i] || 0; if (!v) return ''; const y0 = y(acc), y1 = y(acc + v); acc += v; return `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(1, y0 - y1)}" rx="${bw > 6 ? 2 : 0}" fill="${s.color}"><title>${esc(`${s.name} ${l}: ${fmt(v)}`)}</title></rect>`; }).join('')}`;
  }).join('')}
  </svg>`;
}

// Segments: [{ label, value, color }]. The middle shows a big number and a small caption.
export function donut(segs, { size = 160, thick = 22, center = '', sub = '' } = {}) {
  const total = segs.reduce((a, s) => a + s.value, 0);
  const r = (size - thick) / 2, c = 2 * Math.PI * r, mid = size / 2;
  let off = 0;
  const arcs = total ? segs.filter((s) => s.value > 0).map((s) => { const len = (s.value / total) * c; const d = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thick}" stroke-dasharray="${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}" stroke-dashoffset="${-off}" transform="rotate(-90 ${mid} ${mid})"><title>${esc(`${s.label}: ${s.value}`)}</title></circle>`; off += len; return d; }).join('') : '';
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(segs.map((s) => `${s.label} ${s.value}`).join(', '))}">
    <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" class="donut-bg" stroke-width="${thick}"/>${arcs}
    <text x="${mid}" y="${mid + (sub ? 2 : 8)}" text-anchor="middle" class="donut-n">${esc(center)}</text>${sub ? `<text x="${mid}" y="${mid + 20}" text-anchor="middle" class="donut-s">${esc(sub)}</text>` : ''}</svg>`;
}

// A progress ring: pct 0 to 100 (over 100 draws full). color is any CSS color.
export function ring(pct, { size = 132, thick = 14, color = 'var(--c-green)', center = '', sub = '' } = {}) {
  const r = (size - thick) / 2, c = 2 * Math.PI * r, mid = size / 2, p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<svg class="donut ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(`${center} ${sub}`.trim())}">
    <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" class="donut-bg" stroke-width="${thick}"/>
    <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${color}" stroke-width="${thick}" stroke-linecap="round" stroke-dasharray="${(p / 100) * c} ${c}" transform="rotate(-90 ${mid} ${mid})"/>
    <text x="${mid}" y="${mid + (sub ? 2 : 8)}" text-anchor="middle" class="donut-n">${esc(center)}</text>${sub ? `<text x="${mid}" y="${mid + 19}" text-anchor="middle" class="donut-s">${esc(sub)}</text>` : ''}</svg>`;
}

// A tiny trend line for a stat tile.
export function spark(values, { w = 120, h = 34, color = 'var(--c-green)' } = {}) {
  const n = values.length;
  if (n < 2) return '';
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const x = (i) => 2 + (i * (w - 4)) / (n - 1), y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${x(0)},${h} ${pts} ${x(n - 1)},${h}" fill="${color}" opacity=".14"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${x(n - 1)}" cy="${y(values[n - 1])}" r="2.6" fill="${color}"/></svg>`;
}
