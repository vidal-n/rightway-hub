// A sample client with realistic data, so the team can see the client app and reports before the first real client.
// It is flagged sample = 1 and left out of revenue and work totals.
import { json } from './util.js';
import { all, first, run, batch, newId, now } from './db.js';
import { requireStaff } from './auth.js';
import { tasksForMonth, monthKey } from './plans.js';
import { route } from './router.js';
import { gridPoints } from '../public/js/grid.js';
import { saveReport } from './reports.js';
import { demoReviews } from './reputation.js';
import { quarterOf } from './quarterly.js';

const CENTER = { lat: 26.0112, lng: -80.1495 }; // Hollywood, FL
const COMPETITORS = [
  { title: 'Harborline Roofing', rating: 4.9, reviews: 212, cid: 'sample-c1', category: 'Roofing contractor', domain: 'harborlineroofing.example' },
  { title: 'Bluewater Roof Co', rating: 4.8, reviews: 167, cid: 'sample-c2', category: 'Roofing contractor', domain: 'bluewaterroof.example' },
  { title: 'Keystone Shingle Works', rating: 4.7, reviews: 131, cid: 'sample-c3', category: 'Roofing contractor', domain: 'keystoneshingle.example' },
  { title: 'Northpoint Roofing', rating: 4.6, reviews: 88, cid: 'sample-c4', category: 'Roofer', domain: '' },
  { title: 'Seabreeze Roof Repair', rating: 4.5, reviews: 64, cid: 'sample-c5', category: 'Roofing contractor', domain: 'seabreezeroof.example' },
];
export const SAMPLE = {
  name: 'Sunrise Roofing (Sample)', plan: 'growth', contact_name: 'Maria Lopez', contact_email: 'maria@sunriseroofing.example', phone: '(954) 555-0142',
  website: 'https://sunriseroofing.example', address: '2600 Hollywood Blvd, Hollywood, FL 33020', lat: CENTER.lat, lng: CENTER.lng, cid: 'sample-target',
  category: 'Roofing contractor', services: 'Roof repair, roof replacement, tile roofs, shingle roofs, flat roofs, storm damage', cities: 'Hollywood, Pembroke Pines, Hallandale Beach, Dania Beach',
  keywords: 'roof repair, roofer, roof replacement', review_url: 'https://search.google.com/local/writereview?placeid=sample', brand_voice: 'Friendly, local, family owned since 2009',
};

// Small seeded random so the sample looks the same every time.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function sampleScan(keyword, { size = 7, radius = 3, boost = 0, seed = 7, at = Date.now() } = {}) {
  const r = rng(seed);
  const target = { title: SAMPLE.name.replace(' (Sample)', ''), cid: SAMPLE.cid, place_id: '', lat: CENTER.lat, lng: CENTER.lng, address: SAMPLE.address, rating: 4.8, reviews: 41 + boost * 3, category: SAMPLE.category };
  const half = (size - 1) / 2;
  const points = gridPoints(CENTER.lat, CENTER.lng, size, radius).map((p) => {
    const d = Math.hypot(p.row - half, p.col - half);
    const base = 2 + d * 3.2 + r() * 4 - boost;
    const rank = base > 20 ? null : Math.max(1, Math.round(base));
    const others = COMPETITORS.map((c, i) => ({ ...c, rank: 0, sort: i + r() * 2.5 })).sort((a, b) => a.sort - b.sort);
    const list = [];
    let k = 1;
    for (const c of others) { if (k === rank) list.push({ ...target, rank: k++ }); list.push({ title: c.title, cid: c.cid, rating: c.rating, reviews: c.reviews, category: c.category, domain: c.domain, rank: k++ }); }
    if (rank && rank >= k) list.push({ ...target, rank });
    return { ...p, status: 'done', rank, top: list.slice(0, 10) };
  });
  return { version: 2, createdAt: new Date(at).toISOString(), completedAt: new Date(at).toISOString(), demo: true, sample: true, target, keyword, size, radius, source: 'local', device: 'desktop', zoom: 13, points, details: {}, cost: 0 };
}

function sampleIntel() {
  const scan = sampleScan('roof repair', { size: 3, radius: 2, boost: 0, seed: 3 });
  const cells = scan.points.map(({ row, col, rank, top }) => ({ row, col, rank, error: false, top: top.slice(0, 3).map((t) => ({ title: t.title, rank: t.rank, rating: t.rating, reviews: t.reviews })) }));
  const ranked = cells.filter((c) => c.rank != null);
  return {
    at: now() - 92 * 864e5, demo: false, sample: true, found: true, keyword: 'roof repair',
    listing: { title: 'Sunrise Roofing', rating: 4.8, reviews: 41, category: 'Roofing contractor', additional_categories: ['Roofer'], claimed: true, photos: 14, hours: true, url: SAMPLE.website, phone: SAMPLE.phone, address: SAMPLE.address, city: 'Hollywood', lat: CENTER.lat, lng: CENTER.lng, cid: SAMPLE.cid },
    rank: cells[4].rank,
    grid: { size: 3, radiusMiles: 2, points: cells.length, top3: ranked.filter((c) => c.rank <= 3).length, avg: Math.round((ranked.reduce((s, c) => s + c.rank, 0) / Math.max(1, ranked.length)) * 10) / 10, cells },
    competitors: COMPETITORS.slice(0, 5).map((c, i) => ({ ...c, wins: 9 - i * 2, best: 1 + i })),
    website: { ok: true, https: true, titleHasService: true, titleHasCity: false, tel: true, schema: false, viewport: true, form: true, platform: 'WordPress' },
    speed: { score: 46, lcp: '5.1 s' },
  };
}

route('POST', '/api/sample-client', async ({ env, user }) => {
  requireStaff(user);
  const existing = await first(env, 'SELECT id FROM clients WHERE sample = 1 LIMIT 1');
  if (existing) return json({ id: existing.id, existed: true });
  const id = newId('c_');
  const t = now();
  const month = monthKey();
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 3);
  const c = { ...SAMPLE, id, status: 'active', start_date: start.toISOString().slice(0, 10), created_at: t - 95 * 864e5, sample: 1, notes: 'Sample client for testing the client app. Not a real business.',
    baseline: JSON.stringify(sampleIntel()), intake_at: t - 90 * 864e5,
    intake: JSON.stringify({ legal_name: 'Sunrise Roofing LLC', public_name: 'Sunrise Roofing', phone: SAMPLE.phone, email: SAMPLE.contact_email, address: SAMPLE.address, service_area: 'Broward County',
      hours: 'Mon to Fri 8 to 6, Sat 9 to 1', services: SAMPLE.services, top_services: 'Tile roof repair, full replacements', cities: SAMPLE.cities,
      description: 'Family owned roofing company serving Hollywood and south Broward since 2009.', differentiators: 'Same week inspections, licensed and insured, 25 year workmanship warranty',
      avg_job: '9500', capacity: 'Can take 6 more replacement jobs a month', competitors: 'Harborline Roofing, Bluewater Roof Co', review_contact: 'Office manager texts after each job',
      gbp_access: true, website_access: true, facebook_access: true, analytics_access: false, notes: 'Wants more replacement jobs, fewer small repairs.' }) };
  const cols = Object.keys(c);
  const items = [[`INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((k) => c[k])]];
  // This month's tasks, about 60% done.
  const tasks = tasksForMonth({ ...c, has_setup: true }, month);
  const r = rng(11);
  tasks.forEach((tk, i) => {
    const done = r() < 0.6;
    items.push(['INSERT INTO tasks (id, client_id, month, kind, title, status, done_at, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId('t_'), id, month, tk.kind, tk.title, done ? 'done' : 'todo', done ? t - Math.round(r() * 20) * 864e5 : null, i, t]);
  });
  // Work log.
  const log = ['Fixed the business hours and added holiday hours on Google', 'Published Google post: tile roof repair in Hollywood', 'Built the Pembroke Pines roof repair page', 'Listed on Apple Business Connect and Bing Places',
    'Replied to 4 new Google reviews', 'Added 12 job photos to the Google profile', 'Fixed phone number mismatch on Yelp', 'Monthly ranking scan saved'];
  log.forEach((text, i) => items.push(['INSERT INTO log (id, client_id, text, at) VALUES (?, ?, ?, ?)', newId('l_'), id, text, t - (i * 3 + 1) * 864e5]));
  // Spread "this month" activity between the 1st and now, so the sample looks alive on any day of the month.
  const m0 = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1);
  const inMonth = (f) => Math.round(m0 + (t - m0) * f);
  // Review requests this month.
  ['James P.', 'Ana R.', 'Mike D.', 'Lisa K.', 'Carlos M.', 'Dana W.', 'Tom B.', 'Grace H.', 'Rob S.', 'Nina V.', 'Paul T.', 'Eve L.'].forEach((n, i) => {
    const clicked = i % 3 !== 2;
    items.push(['INSERT INTO review_requests (id, client_id, token, customer_name, contact, channel, created_at, clicks, clicked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('rr_'), id, `smp${id.slice(-6)}${i}`, n, '', i % 2 ? 'sms' : 'share', inMonth(1 - i / 12), clicked ? 1 : 0, clicked ? inMonth(1 - i / 12) : null]);
  });
  // Posts.
  const posts = [
    ['posted', 'Fresh tile roof repair in Hollywood after last week\'s storm. Cracked tiles replaced and sealed, no more leaks. Need a roof check? Call Sunrise Roofing.'],
    ['posted', 'Full shingle roof replacement in Pembroke Pines, done in two days. Clean site, new underlayment, 25 year warranty.'],
    ['posted', 'Hurricane season tip: check for lifted shingles and loose flashing. We do free roof inspections across Hollywood.'],
    ['approved', 'Flat roof coating on a Hallandale Beach business. Cooler building, lower power bills.'],
    ['draft', 'Before and after: tile roof restoration in Dania Beach.'],
  ];
  posts.forEach(([status, text], i) => items.push(['INSERT INTO posts (id, client_id, note, google_text, facebook_text, instagram_text, hashtags, status, created_at, approved_at, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('p_'), id, 'Job photo', text, text, `${text} #roofing #hollywoodfl`, '#roofing #hollywoodfl #roofrepair', status, inMonth(1 - (i + 1) / 6), status !== 'draft' ? inMonth(1 - i / 6) : null, status === 'posted' ? inMonth(1 - i / 6) : null]));
  // Scans: a baseline three months ago and this month, for each keyword.
  ['roof repair', 'roofer', 'roof replacement'].forEach((kw, k) => {
    for (const [ago, boost, seed] of [[90, 0, 5 + k], [2, 6, 9 + k]]) {
      const scan = sampleScan(kw, { boost: boost - k, seed, at: t - ago * 864e5 });
      const pts = scan.points; const done = pts.length; const ranked = pts.filter((p) => p.rank != null);
      const summary = { keyword: kw, size: 7, radius: 3, source: 'local', top3Pct: Math.round((100 * ranked.filter((p) => p.rank <= 3).length) / done), top10Pct: Math.round((100 * ranked.filter((p) => p.rank <= 10).length) / done),
        avgRank: Math.round((pts.reduce((s, p) => s + (p.rank ?? 21), 0) / done) * 10) / 10, centerRank: pts[Math.floor(done / 2)].rank, done, date: scan.createdAt };
      items.push(['INSERT INTO scans (id, client_id, keyword, created_at, summary, data) VALUES (?, ?, ?, ?, ?, ?)', newId('s_'), id, kw, t - ago * 864e5, JSON.stringify(summary), JSON.stringify(scan)]);
    }
  });
  await batch(env, items);
  // Onboarding marks so the checklist and citations look mid-flight.
  await run(env, 'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', `onb:${id}`,
    JSON.stringify({ 'gbp:claimed': true, 'gbp:category': true, 'gbp:hours': true, 'gbp:nap': true, 'gbp:services': true, 'gbp:logo': true,
      'cit:Apple Business Connect': 'ok', 'cit:Bing Places': 'created', 'cit:Yelp': 'fixed', 'cit:Facebook page': 'ok', 'cit:Better Business Bureau': 'ok', 'cit:Nextdoor': 'created', 'cit:Angi': 'wrong' }));
  await seedMore(env, id, c, t, month);
  return json({ id, existed: false });
});

// The rest of what a client sees in the app: reports, listings and links, website health, reputation, calls, social posts and the quarterly plan.
// Each part is separate so one failing never stops the sample client from being made.
async function seedMore(env, id, c, t, month) {
  const tryIt = async (fn) => { try { await fn(); } catch { /* sample data is best effort */ } };
  const d = new Date(t); const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  await tryIt(async () => {
    for (const m of [prevKey, month]) {
      const r = await saveReport(env, { ...c, id }, m, { force: true });
      await run(env, "UPDATE reports SET status = 'sent', sent_at = ?, sent_to = ? WHERE id = ?", t - (m === month ? 1 : 28) * 864e5, c.contact_email, r.id);
    }
  });
  await tryIt(async () => {
    const results = [{ name: 'Yelp', status: 'match' }, { name: 'Facebook page', status: 'match' }, { name: 'Better Business Bureau', status: 'match' }, { name: 'Angi', status: 'mismatch', detail: 'Phone differs' }, { name: 'Nextdoor', status: 'none' }];
    await run(env, 'INSERT INTO citation_audits (id, client_id, results, counts, cost, demo, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)', newId('ca_'), id, JSON.stringify(results), JSON.stringify({ match: 3, mismatch: 1, none: 1 }), t - 6 * 864e5);
    const links = [['citation', 'Apple Business Connect', 'https://businessconnect.apple.com', 'live', 50], ['citation', 'Bing Places', 'https://www.bingplaces.com', 'live', 40], ['citation', 'Yelp', 'https://www.yelp.com', 'live', 30],
      ['link', 'Hollywood Chamber of Commerce', 'https://hollywoodchamber.example/members/sunrise-roofing', 'live', 20], ['link', 'Broward Roofing Association', 'https://browardroofers.example/members', 'live', 10], ['link', 'Local home service guide', 'https://southfloridahomes.example', 'submitted', 5]];
    for (const [type, name, url, status, ago] of links) {
      await run(env, 'INSERT INTO link_log (id, client_id, type, name, url, target, kind, status, cost_cents, month, created_at, live_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
        newId('ll_'), id, type, name, url, SAMPLE.website, type === 'link' ? 'association' : null, status, month, t - ago * 864e5, status === 'live' ? t - (ago - 1) * 864e5 : null);
    }
  });
  await tryIt(async () => {
    await run(env, "INSERT INTO site_audits (id, client_id, start_url, status, data, result, pages, score, issues, created_at, finished_at) VALUES (?, ?, ?, 'done', '{}', '{}', 18, 78, 9, ?, ?)", newId('sa_'), id, SAMPLE.website, t - 3 * 864e5, t - 3 * 864e5);
    const fixes = [['Added a title that names the service and city', '/', 'Home', 'Roof repair and replacement in Hollywood, FL | Sunrise Roofing', 'verified', 9], ['Wrote unique descriptions for the service pages', '/services', 'Missing', 'Added', 'verified', 14],
      ['Added a click to call phone link to the header', '/', 'Plain text number', 'Tap to call link', 'fixed', 2], ['Added alt text to job photos', '/gallery', '11 photos had none', 'All photos described', 'fixed', 4]];
    for (const [what, page, before, after, status, ago] of fixes) {
      await run(env, 'INSERT INTO site_fixes (id, client_id, page_url, what, before_text, after_text, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId('sf_'), id, page, what, before, after, 'onpage', status, t - ago * 864e5);
    }
  });
  await tryIt(async () => {
    await run(env, "INSERT INTO review_pulls (id, client_id, status, reviews, rating, total, cost, demo, created_at, finished_at) VALUES (?, ?, 'done', ?, 4.7, 58, 0, 1, ?, ?)", newId('rv_'), id, JSON.stringify(demoReviews(t)), t - 864e5, t - 864e5);
  });
  await tryIt(async () => {
    const nid = newId('tn_');
    await run(env, "INSERT INTO tracking_numbers (id, client_id, number, source, forward_to, record, alert_to, status, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 'active', ?)", nid, id, '+19545550199', 'Google profile', SAMPLE.phone, SAMPLE.contact_email, t - 60 * 864e5);
    const m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const at = (f) => Math.round(m0 + (t - m0) * f);
    const rows = [['+17865550111', 'Miami', 'answered', 214, 0, 1], ['+19545550122', 'Hollywood', 'answered', 96, 0, 0.9], ['+19545550133', 'Pembroke Pines', 'missed', 0, 1, 0.8], ['+17865550144', 'Hallandale Beach', 'answered', 305, 1, 0.65],
      ['+19545550155', 'Dania Beach', 'voicemail', 0, 1, 0.5], ['+19545550166', 'Hollywood', 'answered', 148, 0, 0.35], ['+17865550177', 'Miramar', 'answered', 77, 1, 0.2]];
    for (const [i, [from, city, status, dur, fresh, f]] of rows.entries()) await items_insert(env, [id, nid, `smpcall${id.slice(-5)}${i}`, from, city, status, dur, fresh, at(f), SAMPLE.phone, i < 4 ? 'Google profile' : 'Website']);
  });
  await tryIt(async () => {
    const posts = [['Storm season roof checks', 'posted', ['facebook', 'instagram'], -6], ['Before and after: tile restoration', 'scheduled', ['google', 'facebook'], 2], ['Meet our crew', 'review', ['facebook', 'instagram'], 4], ['Why leaks start at the flashing', 'approved', ['google', 'facebook', 'instagram'], 7]];
    for (const [title, status, channels, days] of posts) {
      const caps = Object.fromEntries(channels.map((ch) => [ch, { text: `${title}. Sunrise Roofing, family owned in Hollywood since 2009. Call (954) 555-0142.` }]));
      await run(env, 'INSERT INTO social_items (id, client_id, title, status, channels, captions, media, scheduled_at, posted_at, post_links, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId('si_'), id, title, status, JSON.stringify(channels), JSON.stringify(caps), '[]', t + days * 864e5, status === 'posted' ? t + days * 864e5 : null, '{}', t - 8 * 864e5, t - 864e5);
    }
  });
  await tryIt(async () => {
    const data = {
      goals: [{ label: 'First page (top 10) coverage for "roof repair"', now: '58%', target: '73%' }, { label: 'Google reviews', now: '58', target: '70' }, { label: 'Calls from tracked numbers per month', now: '7', target: '12' }, { label: 'Website health score', now: '78', target: '90' }],
      focus: ['Lift "roof replacement": on the first page in less than half of your area today.', 'Close the review gap with Harborline Roofing.', 'Fix the Angi listing, which shows a different phone number.'],
      months: [{ label: 'Month 1', items: ['4 Google posts', 'Replies to every new review', 'Fix the Angi listing', 'New page: Roof replacement in Pembroke Pines'] }, { label: 'Month 2', items: ['4 Google posts', '2 new local links', 'Website fix: service page descriptions'] }, { label: 'Month 3', items: ['4 Google posts', 'New page: Tile roof repair in Dania Beach', 'Quarterly review call'] }],
      notes: 'Sample plan for the Sample client.' };
    await run(env, "INSERT INTO quarterly_plans (id, client_id, quarter, data, status, token, created_at, updated_at, shared_at) VALUES (?, ?, ?, ?, 'shared', ?, ?, ?, ?)", newId('qp_'), id, quarterOf(), JSON.stringify(data), `smpplan${id.slice(-8)}`, t, t, t);
  });
}
function items_insert(env, v) {
  return run(env, "INSERT INTO tracked_calls (id, client_id, number_id, call_sid, from_num, from_city, from_state, to_num, source, status, duration, started_at, ended_at, first_time) VALUES (?, ?, ?, ?, ?, ?, 'FL', ?, ?, ?, ?, ?, ?, ?)",
    newId('tc_'), v[0], v[1], v[2], v[3], v[4], '+19545550199', v[10], v[5], v[6], v[8], v[8] + v[6] * 1000, v[7]);
}

route('DELETE', '/api/sample-client', async ({ env, user }) => {
  requireStaff(user);
  const rows = await all(env, 'SELECT id FROM clients WHERE sample = 1');
  for (const { id } of rows) {
    await batch(env, ['tasks', 'log', 'review_requests', 'posts', 'scans', 'kit_scans', 'assets', 'reports', 'citation_audits', 'link_log', 'site_audits', 'site_fixes', 'review_pulls', 'tracking_numbers', 'tracked_calls', 'social_items', 'quarterly_plans'].map((tb) => [`DELETE FROM ${tb} WHERE client_id = ?`, id])
      .concat([['DELETE FROM settings WHERE k = ? OR k = ?', `onb:${id}`, `latest:${id}`], ['DELETE FROM clients WHERE id = ?', id]]));
  }
  return json({ removed: rows.length });
});
