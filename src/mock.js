// Demo data used when DataForSEO credentials are not set, so the app can be tried for free.
// Every demo response is flagged with demo: true and the UI shows a banner.

const CENTER = { lat: 26.0112, lng: -80.1495 }; // Hollywood, FL

const COMPETITORS = [
  { title: 'Demo Competitor: Summit Roofing', category: 'Roofing contractor', additional_categories: ['Gutter service', 'Roof repair service', 'Siding contractor'], rating: 4.8, reviews: 212, photos: 140, claimed: true, hours: true, url: 'https://example.com/summit', dLat: 0.03, dLng: 0.02 },
  { title: 'Demo Competitor: Coastal Roof Pros', category: 'Roofing contractor', additional_categories: ['Roof repair service', 'Contractor'], rating: 4.7, reviews: 156, photos: 88, claimed: true, hours: true, url: 'https://example.com/coastal', dLat: -0.04, dLng: 0.01 },
  { title: 'Demo Competitor: Bayside Roofing', category: 'Roofing contractor', additional_categories: ['Gutter service'], rating: 4.5, reviews: 97, photos: 51, claimed: true, hours: true, url: 'https://example.com/bayside', dLat: 0.01, dLng: -0.05 },
  { title: 'Demo Competitor: Ace Roof Repair', category: 'Roof repair service', additional_categories: ['Roofing contractor'], rating: 4.9, reviews: 64, photos: 33, claimed: true, hours: false, url: '', dLat: -0.02, dLng: -0.03 },
  { title: 'Demo Competitor: Atlantic Exteriors', category: 'Roofing contractor', additional_categories: ['Siding contractor', 'Window installation service'], rating: 4.4, reviews: 120, photos: 70, claimed: false, hours: true, url: 'https://example.com/atlantic', dLat: 0.05, dLng: 0.04 },
  { title: 'Demo Competitor: Palm Roof Co', category: 'Roofing contractor', additional_categories: [], rating: 4.6, reviews: 41, photos: 19, claimed: true, hours: true, url: 'https://example.com/palm', dLat: -0.05, dLng: -0.01 },
].map((c, i) => ({
  rank: null,
  title: c.title,
  cid: `demo-comp-${i + 1}`,
  place_id: `demo-place-comp-${i + 1}`,
  category: c.category,
  additional_categories: c.additional_categories,
  rating: c.rating,
  reviews: c.reviews,
  address: 'Demo address, Hollywood, FL',
  phone: '(954) 555-01' + String(10 + i),
  url: c.url,
  domain: c.url ? new URL(c.url).hostname : '',
  lat: CENTER.lat + c.dLat,
  lng: CENTER.lng + c.dLng,
  claimed: c.claimed,
  photos: c.photos,
  hours: c.hours,
}));

function target(name, location) {
  return {
    rank: 1,
    title: name,
    cid: 'demo-target',
    place_id: 'demo-place-target',
    category: 'Roofing contractor',
    additional_categories: ['Roof repair service'],
    rating: 4.6,
    reviews: 38,
    address: `123 Demo St, ${location}`,
    phone: '(954) 555-0100',
    url: '',
    domain: '',
    lat: CENTER.lat,
    lng: CENTER.lng,
    claimed: true,
    photos: 12,
    hours: true,
  };
}

function noise(lat, lng, salt) {
  const s = Math.sin(lat * 12.9898 + lng * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s); // 0..1
}

function miles(aLat, aLng, bLat, bLng) {
  const dLat = (aLat - bLat) * 69.0;
  const dLng = (aLng - bLng) * 69.172 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function mockSearch({ name, location }) {
  const t = target(name, location);
  return {
    results: [t, { ...COMPETITORS[2], rank: 2 }, { ...COMPETITORS[5], rank: 3 }],
    cost: 0,
  };
}

const FILLER = Array.from({ length: 16 }, (_, i) => ({
  rank: null, title: `Demo Listing ${i + 1}`, cid: `demo-fill-${i + 1}`, place_id: '', category: 'Roofing contractor',
  additional_categories: [], rating: 4 + ((i * 7) % 10) / 10, reviews: 10 + ((i * 37) % 90), address: '', phone: '', url: '', domain: '',
  lat: CENTER.lat + (((i * 13) % 11) - 5) * 0.012, lng: CENTER.lng + (((i * 17) % 11) - 5) * 0.012, claimed: true, photos: 5 + i, hours: true,
}));

export function mockRank(q) {
  const pool = [...COMPETITORS, ...FILLER].map((c, i) => ({
    biz: c,
    score: miles(q.lat, q.lng, c.lat, c.lng) * 0.9 - Math.log10((c.reviews || 0) + 1) * 1.6 + noise(q.lat, q.lng, i) * 1.5,
  }));
  pool.sort((a, b) => a.score - b.score);
  const list = pool.slice(0, 20).map((s) => s.biz);

  let rank = null;
  if (q.cid === 'demo-target' || q.place_id === 'demo-place-target') {
    const d = miles(q.lat, q.lng, CENTER.lat, CENTER.lng);
    const r = Math.round(1 + d * 2.2 * (0.6 + noise(q.lat, q.lng, 7)) + noise(q.lat, q.lng, 3) * 2);
    if (r <= 20) {
      rank = r;
      list.splice(r - 1, 0, target('Demo business', 'Hollywood, FL'));
      list.length = 20;
    }
  }
  const top = list.map((b, i) => ({ rank: i + 1, title: b.title, cid: b.cid, place_id: b.place_id, category: b.category,
    rating: b.rating, reviews: b.reviews, domain: b.domain, lat: b.lat, lng: b.lng }));
  return { rank, top, count: top.length, types: ['local_pack'], cost: 0 };
}

export function mockDetails(q) {
  const hit = [...COMPETITORS, ...FILLER].find((c) => c.cid === q.cid) || null;
  return { business: hit, cost: 0 };
}

export function mockPageSpeed(url) {
  return { url, score: 41, lcp: '6.8 s', cls: '0.21', tbt: '920 ms', speedIndex: '7.4 s' };
}

// Demo web results: a seeded mix of found, mismatched and missing listings, plus a few local link ideas.
export function mockWeb(keyword) {
  let h = 0;
  for (const ch of keyword) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const site = (keyword.match(/site:(\S+)/) || [])[1];
  const name = (keyword.match(/"([^"]+)"/) || [])[1] || 'Business';
  if (site) {
    const roll = h % 10;
    if (roll < 3) return { results: [], cost: 0 };
    const phone = roll < 8 ? '(954) 555-0142' : '(954) 555-0999';
    return { results: [{ url: `https://www.${site.split('/')[0]}/biz/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: `${name} - Hollywood, FL`, snippet: roll < 6 ? `${name}. 2600 Hollywood Blvd, Hollywood, FL 33020. Call ${phone}.` : `${name} in Hollywood, FL. See photos and reviews.`, domain: site }], cost: 0 };
  }
  const base = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { results: [0, 1, 2].map((i) => ({ url: `https://www.${base.slice(0, 14)}${i}.example/`, title: `${keyword} (example ${i + 1})`, snippet: 'Demo result. Connect DataForSEO for real results.', domain: `${base.slice(0, 14)}${i}.example` })), cost: 0 };
}

// ---------- lead finder demo ----------
// A fixed world of businesses on a lattice (one possible business every 0.012 degrees), so neighbouring map views see some of the same
// ones, the way real Google results overlap. Deterministic: the same keyword and view always give the same list.
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const FIRST = ['Sunshine', 'Coastal', 'Palm', 'Bayside', 'Gulf', 'Magic City', 'Atlantic', 'Everglades', 'Biscayne', 'Tropic', 'Royal', 'Ace', 'Premier', 'Sunset', 'Island'];
const CITY = ['Miami', 'Hialeah', 'Coral Gables', 'Miami Beach', 'Doral', 'Hollywood', 'Fort Lauderdale', 'Miramar'];
const STEP = 0.012;
export function mockFinder({ keyword, lat, lng, zoom = 14 }) {
  const word = String(keyword || 'business').replace(/\b\w/g, (c) => c.toUpperCase());
  const spanDeg = Math.max(0.01, (1000 * 156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / 111320 / 2);
  const results = [];
  const i0 = Math.floor((lat - spanDeg) / STEP), i1 = Math.ceil((lat + spanDeg) / STEP);
  const j0 = Math.floor((lng - spanDeg) / STEP), j1 = Math.ceil((lng + spanDeg) / STEP);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const h = hash(`${keyword}|${i}|${j}`);
      if (h % 5 > 1) continue; // about two in five sites have one
      const n = hash(`n|${keyword}|${i}|${j}`);
      const name = `${FIRST[n % FIRST.length]} ${word.split(' ')[0]} ${['Pros', 'Co', 'Services', 'Experts', 'Group'][(n >>> 4) % 5]}`;
      const exch = 2 + (n % 8), line = String(1000 + ((n >>> 3) % 9000));
      const hasSite = (n >>> 6) % 3 !== 0;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      results.push({
        title: name, cid: `demo-${i}-${j}`, place_id: `demo-place-${i}-${j}`, category: word, cats: [], rating: Math.round((3 + ((n >>> 8) % 20) / 10) * 10) / 10,
        reviews: (n >>> 10) % 400, address: `${100 + (n % 900)} Demo St, ${CITY[(n >>> 2) % CITY.length]}, FL 331${String(10 + ((n >>> 5) % 80))}`,
        city: CITY[(n >>> 2) % CITY.length], state: 'Florida', zip: `331${String(10 + ((n >>> 5) % 80))}`, phone: `(305) ${exch}${String(10 + ((n >>> 12) % 89))}-${line}`,
        website: hasSite ? `https://www.${slug}.example` : '', domain: hasSite ? `${slug}.example` : '', lat: i * STEP, lng: j * STEP,
        claimed: (n >>> 14) % 4 !== 0, photos: (n >>> 16) % 60, hours: true,
      });
    }
  }
  return { results: results.slice(0, 100), cost: 0 };
}
