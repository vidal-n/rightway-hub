// Small dependency-free map: OpenStreetMap tiles plus rank markers.
// If tiles can't load (offline, blocked), the markers still draw on a plain background.
import { rankBand, rankLabel } from './grid.js';

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

export function createMap(el, points, target, opts = {}) {
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

  const tiles = document.createElement('div');
  tiles.className = 'gmap-tiles';
  const zi = Math.ceil(z); // sharper tiles, scaled down slightly
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

  const layer = document.createElement('div');
  layer.className = 'gmap-markers';
  el.appendChild(layer);

  const place = (node, lat, lng) => {
    const p = project(lat, lng, z);
    node.style.left = `${p.x - left}px`;
    node.style.top = `${p.y - top}px`;
  };

  if (target && typeof target.lat === 'number' && typeof target.lng === 'number') {
    const pin = document.createElement('div');
    pin.className = 'gmap-pin';
    pin.title = target.title || 'Business location';
    place(pin, target.lat, target.lng);
    layer.appendChild(pin);
  }

  const markers = points.map((pt) => {
    const m = document.createElement('div');
    place(m, pt.lat, pt.lng);
    layer.appendChild(m);
    return m;
  });

  const attribution = document.createElement('div');
  attribution.className = 'gmap-attr';
  attribution.innerHTML = 'Map &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  el.appendChild(attribution);

  function update(i) {
    const pt = points[i];
    const m = markers[i];
    if (!pt || !m) return;
    const band = rankBand(pt);
    m.className = `gmap-pt band-${band}`;
    m.textContent = rankLabel(pt);
    m.title = band === 'pending' ? 'Checking...' : band === 'none' ? 'Not in the top 20' : band === 'error' ? 'Check failed' : `Rank ${pt.rank}`;
  }
  points.forEach((_, i) => update(i));
  return { update, zoom: z };
}
