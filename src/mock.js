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

export function mockRank(q) {
  const scored = COMPETITORS.map((c, i) => ({
    biz: c,
    score: miles(q.lat, q.lng, c.lat, c.lng) * 0.9 - Math.log10(c.reviews + 1) * 1.6 + noise(q.lat, q.lng, i) * 1.5,
  }));
  const isTarget = q.cid === 'demo-target' || q.place_id === 'demo-place-target';
  if (isTarget) {
    const d = miles(q.lat, q.lng, CENTER.lat, CENTER.lng);
    scored.push({ biz: target('Demo business', 'Hollywood, FL'), score: d * 1.7 - 1.9 + noise(q.lat, q.lng, 99) * 1.2 });
  }
  scored.sort((a, b) => a.score - b.score);
  // Pad the list to 20 with filler listings so ranks beyond the known set exist.
  const list = scored.map((s, i) => ({ ...s.biz, rank: i + 1 }));
  const targetPos = list.findIndex((b) => b.cid === 'demo-target');
  let rank = targetPos >= 0 ? targetPos + 1 : null;
  if (rank !== null) {
    // Push the target further down at the edges so the demo grid looks realistic.
    const d = miles(q.lat, q.lng, CENTER.lat, CENTER.lng);
    rank = Math.round(rank + d * 1.8 * (0.6 + noise(q.lat, q.lng, 7)));
    if (rank > 20) rank = null;
  }
  const top = list.filter((b) => b.cid !== 'demo-target').slice(0, 5).map((b, i) => ({ ...b, rank: i + 1 }));
  if (rank !== null && rank <= 5) {
    top.splice(rank - 1, 0, { ...target('Demo business', 'Hollywood, FL'), rank });
    top.forEach((b, i) => (b.rank = i + 1));
    top.length = 5;
  }
  return { rank, top, cost: 0 };
}

export function mockPageSpeed(url) {
  return { url, score: 41, lcp: '6.8 s', cls: '0.21', tbt: '920 ms', speedIndex: '7.4 s' };
}
