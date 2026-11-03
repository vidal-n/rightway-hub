// Grid map with rank markers and an optional heat map. Uses Google Maps when the Hub has a Google Maps browser key
// (GOOGLE_MAPS_KEY, served by /api/maps/config); otherwise our own small OpenStreetMap tile renderer.
// Both share one API, so the scan tool and the Hub never need to know which one is showing.
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

function createTileMap(el, points, opts = {}) {
  el.innerHTML = '';
  el.classList.remove('is-google');
  el.classList.add('gmap');
  const width = opts.size || el.clientWidth || 480;
  const height = opts.size || el.clientHeight || width;
  const z0 = fitZoom(points, width, height);
  const minZ = Math.max(3, z0 - 2), maxZ = Math.min(18, z0 + 3.5);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const c0 = project((Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lngs) + Math.min(...lngs)) / 2, 0);
  let z = z0;
  let cx = c0.x, cy = c0.y; // view center in zoom-0 world units
  let rankOf = opts.rankOf || defaultRankOf;
  let heatOn = Boolean(opts.heat);
  let selected = -1;
  let scanning = -1;
  let xy = [];

  // Everything that moves together sits in one stage, so drags and pinches can preview with a CSS transform.
  const stage = document.createElement('div');
  stage.className = 'gmap-stage';
  el.appendChild(stage);
  const tiles = document.createElement('div');
  tiles.className = 'gmap-tiles';
  stage.appendChild(tiles);
  const canvas = document.createElement('canvas');
  canvas.className = 'gmap-heat';
  canvas.width = Math.round(width / 4);
  canvas.height = Math.round(height / 4);
  stage.appendChild(canvas);
  const layer = document.createElement('div');
  layer.className = 'gmap-markers';
  stage.appendChild(layer);
  const markers = points.map((pt, i) => {
    const m = document.createElement('button');
    m.type = 'button';
    m.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); return; } if (opts.onSelect) opts.onSelect(i); });
    layer.appendChild(m);
    return m;
  });

  const showTiles = opts.tiles !== false;
  if (showTiles) {
    const attribution = document.createElement('div');
    attribution.className = 'gmap-attr';
    attribution.innerHTML = 'Map &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    el.appendChild(attribution);
  }

  if (opts.controls !== false) {
    const ctl = document.createElement('div');
    ctl.className = 'gmap-ctl';
    ctl.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">&minus;</button><button type="button" data-z="fit" aria-label="Fit the grid">Fit</button>';
    ctl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      if (b.dataset.z === 'fit') { z = z0; cx = c0.x; cy = c0.y; layout(); return; }
      zoomAt(b.dataset.z === 'in' ? 1 : -1, width / 2, height / 2);
    });
    el.appendChild(ctl);
  }

  function view() {
    const scale = 2 ** z;
    return { scale, left: cx * scale - width / 2, top: cy * scale - height / 2 };
  }

  function layout() {
    const { left, top } = view();
    tiles.innerHTML = '';
    const zi = Math.min(19, Math.ceil(z));
    const size = TILE * 2 ** (z - zi);
    const n = 2 ** zi;
    for (let tx = Math.floor(left / size); tx <= Math.floor((left + width) / size); tx++) {
      for (let ty = Math.floor(top / size); ty <= Math.floor((top + height) / size); ty++) {
        if (ty < 0 || ty >= n || !showTiles) continue;
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        img.referrerPolicy = 'strict-origin-when-cross-origin';
        img.style.left = `${tx * size - left}px`;
        img.style.top = `${ty * size - top}px`;
        img.style.width = img.style.height = `${size + 0.5}px`;
        img.onerror = () => img.remove();
        img.src = TILE_URL(zi, ((tx % n) + n) % n, ty);
        tiles.appendChild(img);
      }
    }
    xy = points.map((p) => {
      const q = project(p.lat, p.lng, z);
      return { x: q.x - left, y: q.y - top };
    });
    markers.forEach((m, i) => { m.style.left = `${xy[i].x}px`; m.style.top = `${xy[i].y}px`; });
    // Markers shrink when the grid is dense and grow back when you zoom in.
    const step = points.length > 1 ? Math.min(...xy.slice(1).map((q) => Math.hypot(q.x - xy[0].x, q.y - xy[0].y)).filter((d) => d > 1)) : 60;
    el.style.setProperty('--pt', `${Math.round(Math.max(18, Math.min(38, step * 0.8)))}px`);
    el.classList.toggle('is-zoomed', z > z0 + 0.01);
    drawHeat();
  }

  function zoomAt(delta, px, py) {
    const nz = Math.max(minZ, Math.min(maxZ, z + delta));
    if (nz === z) return;
    const { scale, left, top } = view();
    const wx = (left + px) / scale, wy = (top + py) / scale; // world point under the cursor stays put
    const ns = 2 ** nz;
    cx = (wx * ns - px + width / 2) / ns;
    cy = (wy * ns - py + height / 2) / ns;
    z = nz;
    layout();
  }

  // Drag to pan, pinch to zoom, ctrl or trackpad pinch to zoom, double click to zoom in.
  const ptrs = new Map();
  let start = null;
  let suppress = false;
  const ac = new AbortController();
  const on = { signal: ac.signal };
  const local = (e) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (height / r.height) }; };
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gmap-ctl, .gmap-attr')) return;
    ptrs.set(e.pointerId, local(e));
    const pts = [...ptrs.values()];
    if (pts.length === 1) start = { kind: 'drag', a: pts[0], moved: false };
    else if (pts.length === 2) start = { kind: 'pinch', d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, m: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, moved: true };
  }, on);
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !start) return;
    ptrs.set(e.pointerId, local(e));
    const pts = [...ptrs.values()];
    if (start.kind === 'drag' && pts.length === 1) {
      const dx = pts[0].x - start.a.x, dy = pts[0].y - start.a.y;
      if (!start.moved && Math.hypot(dx, dy) < 5) return;
      if (!start.moved) { start.moved = true; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } el.classList.add('is-dragging'); }
      start.dx = dx; start.dy = dy;
      stage.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (start.kind === 'pinch' && pts.length === 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const k = Math.max(2 ** (minZ - z), Math.min(2 ** (maxZ - z), d / start.d));
      start.k = k; start.m2 = m;
      stage.style.transformOrigin = '0 0';
      stage.style.transform = `translate(${m.x - start.m.x}px, ${m.y - start.m.y}px) translate(${start.m.x}px, ${start.m.y}px) scale(${k}) translate(${-start.m.x}px, ${-start.m.y}px)`;
    }
  }, on);
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!start) return;
    const s0 = start;
    if (s0.kind === 'drag' && s0.moved && ptrs.size === 0) {
      const { scale } = view();
      cx -= (s0.dx || 0) / scale; cy -= (s0.dy || 0) / scale;
      suppress = true; setTimeout(() => { suppress = false; }, 0);
    } else if (s0.kind === 'pinch' && s0.k) {
      const { scale, left, top } = view();
      const wx = (left + s0.m.x) / scale, wy = (top + s0.m.y) / scale;
      const nz = Math.max(minZ, Math.min(maxZ, z + Math.log2(s0.k)));
      const ns = 2 ** nz;
      cx = (wx * ns - s0.m2.x + width / 2) / ns;
      cy = (wy * ns - s0.m2.y + height / 2) / ns;
      z = nz;
      suppress = true; setTimeout(() => { suppress = false; }, 0);
    }
    if (ptrs.size === 0 || s0.kind === 'pinch') {
      start = null;
      stage.style.transform = '';
      el.classList.remove('is-dragging');
      if (s0.moved) layout();
      ptrs.clear();
    }
  };
  el.addEventListener('pointerup', end, on);
  el.addEventListener('pointercancel', end, on);
  el.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain scrolling keeps scrolling the page
    e.preventDefault();
    const p = local(e);
    zoomAt(-Math.sign(e.deltaY) * (Math.abs(e.deltaY) > 40 ? 0.5 : 0.25), p.x, p.y);
  }, { passive: false, signal: ac.signal });
  el.addEventListener('dblclick', (e) => { if (e.target.closest('.gmap-pt, .gmap-ctl')) return; const p = local(e); zoomAt(1, p.x, p.y); }, on);

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
    for (let cy2 = 0; cy2 < canvas.height; cy2++) {
      for (let cx2 = 0; cx2 < canvas.width; cx2++) {
        const px = cx2 * 4 + 2, py = cy2 * 4 + 2;
        if (px < minX || px > maxX || py < minY || py > maxY) continue;
        let wSum = 0, vSum = 0;
        for (const k of known) {
          const d2 = (k.x - px) ** 2 + (k.y - py) ** 2 + 1;
          const w = 1 / (d2 * d2);
          wSum += w;
          vSum += w * (k.r ?? 21);
        }
        const [r, g, b] = heatColor(vSum / wSum);
        const o = (cy2 * canvas.width + cx2) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 120;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function paint(i, animate) {
    const m = markers[i];
    if (!m) return;
    const r = rankOf(points[i]);
    const band = bandOf(r);
    const was = m.dataset.band;
    m.className = `gmap-pt band-${band}${i === selected ? ' is-selected' : ''}${i === scanning ? ' is-scanning' : ''}`;
    if (animate && was === 'pending' && band !== 'pending') m.classList.add('is-new');
    m.dataset.band = band;
    m.textContent = band === 'pending' ? '' : band === 'error' ? '!' : band === 'none' ? '20+' : String(r);
    m.setAttribute('aria-label', band === 'pending' ? 'Checking' : band === 'none' ? 'Not in the top 20' : band === 'error' ? 'Check failed' : `Rank ${r}`);
  }

  layout();
  points.forEach((_, i) => paint(i, false));
  drawHeat();

  return {
    get zoom() { return z; },
    update(i) { paint(i, true); if (heatOn) drawHeat(); },
    setRankOf(fn) { rankOf = fn || defaultRankOf; points.forEach((_, i) => paint(i, false)); drawHeat(); },
    setHeat(on) { heatOn = on; drawHeat(); },
    zoomIn() { zoomAt(1, width / 2, height / 2); },
    zoomOut() { zoomAt(-1, width / 2, height / 2); },
    fit() { z = z0; cx = c0.x; cy = c0.y; layout(); },
    // Highlight the spot being searched right now (live scan and replay).
    scanning(i) {
      const prev = scanning;
      scanning = i;
      if (prev >= 0) paint(prev, false);
      if (i >= 0) paint(i, false);
    },
    point(i) { return xy[i] ? { ...xy[i], width, height } : null; },
    destroy() { ac.abort(); },
    select(i) {
      const prev = selected;
      selected = i;
      if (prev >= 0) paint(prev, false);
      if (i >= 0) paint(i, false);
    },
  };
}

// ---------- Google Maps ----------
let configP = null;
function mapsConfig() {
  if (!configP) configP = fetch('/api/maps/config').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return configP;
}
if (typeof window !== 'undefined' && typeof fetch === 'function') mapsConfig();

let googleP = null;
let googleFailed = false;
const live = new Set();
function loadGoogle(key) {
  if (googleP) return googleP;
  googleP = new Promise((resolve) => {
    if (window.google?.maps?.importLibrary || window.google?.maps?.OverlayView) { resolve(true); return; }
    window.__rwGmaps = () => resolve(true);
    // Google calls this when the key is wrong or this address is not allowed on it.
    window.gm_authFailure = () => { googleFailed = true; resolve(false); live.forEach((m) => m.fallback()); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__rwGmaps`;
    s.async = true;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(false), 12000);
  }).then(async (ok) => {
    if (!ok) return false;
    try { if (window.google.maps.importLibrary) await window.google.maps.importLibrary('maps'); } catch { return false; }
    return !googleFailed && Boolean(window.google?.maps?.OverlayView);
  });
  return googleP;
}
const googleReady = () => !googleFailed && Boolean(window.google?.maps?.OverlayView && window.google.maps.Map);

const QUIET = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

function createGoogleMap(el, points, opts = {}) {
  const g = window.google.maps;
  el.innerHTML = '';
  el.classList.add('gmap', 'is-google');
  const holder = document.createElement('div');
  holder.className = 'gmap-g';
  el.appendChild(holder);
  const bounds = new g.LatLngBounds();
  points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
  const map = new g.Map(holder, {
    center: bounds.getCenter(), zoom: 13, disableDefaultUI: true, clickableIcons: false, keyboardShortcuts: false,
    gestureHandling: 'cooperative', styles: QUIET, backgroundColor: '#EAF1EE',
  });
  let z0 = null;
  const fit = () => {
    map.fitBounds(bounds, 36);
    g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); if (z0 == null) z0 = map.getZoom(); });
  };
  fit();
  let rankOf = opts.rankOf || defaultRankOf;
  let heatOn = Boolean(opts.heat);
  let selected = -1;
  let scanning = -1;
  let xy = [];

  const markers = points.map((pt, i) => {
    const m = document.createElement('button');
    m.type = 'button';
    m.addEventListener('click', (e) => { e.stopPropagation(); if (opts.onSelect) opts.onSelect(i); });
    return m;
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'gmap-heat';
  Object.assign(canvas.style, { right: 'auto', bottom: 'auto' });

  class Layer extends g.OverlayView {
    onAdd() {
      this.div = document.createElement('div');
      this.div.className = 'gmap-markers gmap-ov';
      markers.forEach((m) => this.div.appendChild(m));
      const panes = this.getPanes();
      panes.overlayLayer.appendChild(canvas);
      panes.overlayMouseTarget.appendChild(this.div);
      if (g.OverlayView.preventMapHitsAndGesturesFrom) g.OverlayView.preventMapHitsAndGesturesFrom(this.div);
    }
    draw() {
      const pr = this.getProjection();
      if (!pr) return;
      const div = points.map((p) => pr.fromLatLngToDivPixel(new g.LatLng(p.lat, p.lng)));
      markers.forEach((m, i) => { m.style.left = `${div[i].x}px`; m.style.top = `${div[i].y}px`; });
      xy = points.map((p) => { const q = pr.fromLatLngToContainerPixel(new g.LatLng(p.lat, p.lng)); return { x: q.x, y: q.y }; });
      const step = points.length > 1 ? Math.min(...div.slice(1).map((q) => Math.hypot(q.x - div[0].x, q.y - div[0].y)).filter((d) => d > 1)) : 60;
      el.style.setProperty('--pt', `${Math.round(Math.max(18, Math.min(38, step * 0.8)))}px`);
      this.divXY = div;
      this.step = Number.isFinite(step) ? step : 40;
      drawHeat();
    }
    onRemove() { this.div?.remove(); canvas.remove(); }
  }
  const layer = new Layer();
  layer.setMap(map);
  g.event.addListener(map, 'zoom_changed', () => el.classList.toggle('is-zoomed', z0 != null && map.getZoom() > z0));

  if (opts.controls !== false) {
    const ctl = document.createElement('div');
    ctl.className = 'gmap-ctl';
    ctl.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">&minus;</button><button type="button" data-z="fit" aria-label="Fit the grid">Fit</button>';
    ctl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      if (b.dataset.z === 'fit') fit();
      else map.setZoom(map.getZoom() + (b.dataset.z === 'in' ? 1 : -1));
    });
    el.appendChild(ctl);
  }

  // Same heat map as the tile map, drawn over the grid area only, in map pixels.
  function drawHeat() {
    const ctx = canvas.getContext && canvas.getContext('2d');
    canvas.classList.toggle('is-on', heatOn);
    const div = layer.divXY;
    if (!ctx || !heatOn || !div) return;
    const pad = (layer.step || 40) / 2;
    const xs = div.map((p) => p.x), ys = div.map((p) => p.y);
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) + pad - minX, h = Math.max(...ys) + pad - minY;
    Object.assign(canvas.style, { left: `${minX}px`, top: `${minY}px`, width: `${w}px`, height: `${h}px` });
    canvas.width = Math.max(1, Math.round(w / 4));
    canvas.height = Math.max(1, Math.round(h / 4));
    const known = points.map((p, i) => ({ x: div[i].x - minX, y: div[i].y - minY, r: rankOf(p) })).filter((k) => k.r !== undefined && k.r !== 'error');
    if (!known.length) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let cy2 = 0; cy2 < canvas.height; cy2++) {
      for (let cx2 = 0; cx2 < canvas.width; cx2++) {
        const px = cx2 * 4 + 2, py = cy2 * 4 + 2;
        let wSum = 0, vSum = 0;
        for (const k of known) {
          const d2 = (k.x - px) ** 2 + (k.y - py) ** 2 + 1;
          const wt = 1 / (d2 * d2);
          wSum += wt;
          vSum += wt * (k.r ?? 21);
        }
        const [r, gg, b] = heatColor(vSum / wSum);
        const o = (cy2 * canvas.width + cx2) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 120;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function paint(i, animate) {
    const m = markers[i];
    if (!m) return;
    const r = rankOf(points[i]);
    const band = bandOf(r);
    const was = m.dataset.band;
    m.className = `gmap-pt band-${band}${i === selected ? ' is-selected' : ''}${i === scanning ? ' is-scanning' : ''}`;
    if (animate && was === 'pending' && band !== 'pending') m.classList.add('is-new');
    m.dataset.band = band;
    m.textContent = band === 'pending' ? '' : band === 'error' ? '!' : band === 'none' ? '20+' : String(r);
    m.setAttribute('aria-label', band === 'pending' ? 'Checking' : band === 'none' ? 'Not in the top 20' : band === 'error' ? 'Check failed' : `Rank ${r}`);
  }
  points.forEach((_, i) => paint(i, false));

  return {
    get zoom() { return map.getZoom(); },
    update(i) { paint(i, true); if (heatOn) drawHeat(); },
    setRankOf(fn) { rankOf = fn || defaultRankOf; points.forEach((_, i) => paint(i, false)); drawHeat(); },
    setHeat(on) { heatOn = on; drawHeat(); },
    zoomIn() { map.setZoom(map.getZoom() + 1); },
    zoomOut() { map.setZoom(map.getZoom() - 1); },
    fit,
    scanning(i) { const prev = scanning; scanning = i; if (prev >= 0) paint(prev, false); if (i >= 0) paint(i, false); },
    point(i) { return xy[i] ? { ...xy[i], width: el.clientWidth, height: el.clientHeight } : null; },
    select(i) { const prev = selected; selected = i; if (prev >= 0) paint(prev, false); if (i >= 0) paint(i, false); },
    destroy() { layer.setMap(null); g.event.clearInstanceListeners(map); },
  };
}

// The map the app uses. Starts on Google Maps when it is ready, otherwise shows the markers right away and
// switches to Google once it loads (or to the tile map if there is no key or Google refuses it).
export function createMap(el, points, opts = {}) {
  const s = { rankOf: opts.rankOf || null, heat: Boolean(opts.heat), selected: -1, scanning: -1 };
  let impl = null;
  let kind = '';
  const start = (k) => {
    impl?.destroy?.();
    kind = k;
    impl = k === 'google' ? createGoogleMap(el, points, { ...opts, rankOf: s.rankOf || undefined, heat: s.heat })
      : createTileMap(el, points, { ...opts, rankOf: s.rankOf || undefined, heat: s.heat, tiles: k === 'tiles' });
    if (s.selected >= 0) impl.select(s.selected);
    if (s.scanning >= 0) impl.scanning(s.scanning);
  };
  const api = {
    get zoom() { return impl.zoom; },
    get engine() { return kind; },
    update(i) { impl.update(i); },
    setRankOf(fn) { s.rankOf = fn || null; impl.setRankOf(fn); },
    setHeat(on) { s.heat = on; impl.setHeat(on); },
    zoomIn() { impl.zoomIn(); },
    zoomOut() { impl.zoomOut(); },
    fit() { impl.fit(); },
    scanning(i) { s.scanning = i; impl.scanning(i); },
    point(i) { return impl.point(i); },
    select(i) { s.selected = i; impl.select(i); },
    fallback() { if (kind === 'google' && el.isConnected) start('tiles'); live.delete(api); },
  };
  if (typeof window === 'undefined' || opts.engine === 'tiles') { start('tiles'); return api; }
  if (googleReady()) { start('google'); live.add(api); return api; }
  start('blank');
  mapsConfig().then(async (cfg) => {
    if (!el.isConnected) return;
    if (!cfg.google) { start('tiles'); return; }
    const ok = await loadGoogle(cfg.google);
    if (!el.isConnected) return;
    if (ok && googleReady()) { start('google'); live.add(api); } else start('tiles');
  });
  return api;
}
