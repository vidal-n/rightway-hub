// Small dependency-free map: OpenStreetMap tiles, rank markers, optional heat map.
// If tiles can't load (offline, blocked), markers still draw on a plain background.

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export function project(lat, lng, z) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

// Fractional zoom that fits all points with padding (tiles render at the next integer zoom, scaled down).
export function fitZoom(points, width, height, pad = 36) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const a = project(Math.max(...lats), Math.min(...lngs), 0);
  const b = project(Math.min(...lats), Math.max(...lngs), 0);
  const spanX = Math.max(b.x - a.x, 1e-9);
  const spanY = Math.max(b.y - a.y, 1e-9);
  const z = Math.min(Math.log2((width - 2 * pad) / spanX), Math.log2((height - 2 * pad) / spanY));
  return Math.max(3, Math.min(17, z));
}

export function bandOf(rank) {
  if (rank === undefined) return 'pending';
  if (rank === 'error') return 'error';
  if (rank == null) return 'none';
  if (rank <= 3) return 'top3';
  if (rank <= 10) return 'top10';
  return 'top20';
}

// Rank 1 green, 10 amber, 21 red.
const STOPS = [[1, [35, 176, 126]], [5, [130, 200, 100]], [10, [242, 181, 68]], [15, [232, 131, 58]], [21, [214, 69, 69]]];
export function heatColor(rank) {
  const r = Math.min(Math.max(rank, 1), 21);
  for (let i = 1; i < STOPS.length; i++) {
    const [r1, c1] = STOPS[i - 1];
    const [r2, c2] = STOPS[i];
    if (r <= r2) {
      const t = (r - r1) / (r2 - r1);
      return c1.map((v, k) => Math.round(v + (c2[k] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const defaultRankOf = (p) => (p.status === 'done' ? p.rank : p.status === 'error' ? 'error' : undefined);

export function createMap(el, points, opts = {}) {
  el.innerHTML = '';
  el.classList.add('gmap');
  const width = opts.size || el.clientWidth || 480;
  const height = opts.size || el.clientHeight || width;
  const z = fitZoom(points, width, height);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const mid = project((Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lngs) + Math.min(...lngs)) / 2, z);
  const left = mid.x - width / 2;
  const top = mid.y - height / 2;
  let rankOf = opts.rankOf || defaultRankOf;
  let heatOn = Boolean(opts.heat);
  let selected = -1;

  // Tiles
  const tiles = document.createElement('div');
  tiles.className = 'gmap-tiles';
  const zi = Math.ceil(z);
  const scale = 2 ** (z - zi);
  const size = TILE * scale;
  const n = 2 ** zi;
  for (let tx = Math.floor(left / size); tx <= Math.floor((left + width) / size); tx++) {
    for (let ty = Math.floor(top / size); ty <= Math.floor((top + height) / size); ty++) {
      if (ty < 0 || ty >= n) continue;
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'strict-origin-when-cross-origin';
      img.style.left = `${tx * size - left}px`;
      img.style.top = `${ty * size - top}px`;
      img.style.width = img.style.height = `${size + 0.5}px`;
      img.onerror = () => img.remove();
      img.src = TILE_URL(zi, ((tx % n) + n) % n, ty);
      tiles.appendChild(img);
    }
  }
  el.appendChild(tiles);

  // Heat map
  const canvas = document.createElement('canvas');
  canvas.className = 'gmap-heat';
  canvas.width = Math.round(width / 4);
  canvas.height = Math.round(height / 4);
  el.appendChild(canvas);

  const xy = points.map((p) => {
    const q = project(p.lat, p.lng, z);
    return { x: q.x - left, y: q.y - top };
  });

  function drawHeat() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.toggle('is-on', heatOn);
    if (!heatOn) return;
    const known = points.map((p, i) => ({ ...xy[i], r: rankOf(p) })).filter((k) => k.r !== undefined && k.r !== 'error');
    if (!known.length) return;
    const xs = xy.map((p) => p.x), ys = xy.map((p) => p.y);
    const stepPx = points.length > 1 ? Math.abs(xy[1].x - xy[0].x) || 40 : 40;
    const minX = Math.min(...xs) - stepPx / 2, maxX = Math.max(...xs) + stepPx / 2;
    const minY = Math.min(...ys) - stepPx / 2, maxY = Math.max(...ys) + stepPx / 2;
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let cy = 0; cy < canvas.height; cy++) {
      for (let cx = 0; cx < canvas.width; cx++) {
        const px = cx * 4 + 2, py = cy * 4 + 2;
        if (px < minX || px > maxX || py < minY || py > maxY) continue;
        let wSum = 0, vSum = 0;
        for (const k of known) {
          const d2 = (k.x - px) ** 2 + (k.y - py) ** 2 + 1;
          const w = 1 / (d2 * d2);
          wSum += w;
          vSum += w * (k.r ?? 21);
        }
        const [r, g, b] = heatColor(vSum / wSum);
        const o = (cy * canvas.width + cx) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 120;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Markers
  const layer = document.createElement('div');
  layer.className = 'gmap-markers';
  el.appendChild(layer);
  const markers = points.map((pt, i) => {
    const m = document.createElement('button');
    m.type = 'button';
    m.style.left = `${xy[i].x}px`;
    m.style.top = `${xy[i].y}px`;
    m.addEventListener('click', () => opts.onSelect && opts.onSelect(i));
    layer.appendChild(m);
    return m;
  });

  const attribution = document.createElement('div');
  attribution.className = 'gmap-attr';
  attribution.innerHTML = 'Map &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  el.appendChild(attribution);

  function paint(i, animate) {
    const m = markers[i];
    if (!m) return;
    const r = rankOf(points[i]);
    const band = bandOf(r);
    const was = m.dataset.band;
    m.className = `gmap-pt band-${band}${i === selected ? ' is-selected' : ''}`;
    if (animate && was === 'pending' && band !== 'pending') {
      m.classList.add('is-new');
    }
    m.dataset.band = band;
    m.textContent = band === 'pending' ? '' : band === 'error' ? '!' : band === 'none' ? '20+' : String(r);
    m.setAttribute('aria-label', band === 'pending' ? 'Checking' : band === 'none' ? 'Not in the top 20' : band === 'error' ? 'Check failed' : `Rank ${r}`);
  }

  points.forEach((_, i) => paint(i, false));
  drawHeat();

  return {
    zoom: z,
    update(i) { paint(i, true); if (heatOn) drawHeat(); },
    setRankOf(fn) { rankOf = fn || defaultRankOf; points.forEach((_, i) => paint(i, false)); drawHeat(); },
    setHeat(on) { heatOn = on; drawHeat(); },
    select(i) {
      const prev = selected;
      selected = i;
      if (prev >= 0) paint(prev, false);
      if (i >= 0) paint(i, false);
    },
  };
}
