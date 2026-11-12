// Pretend leads, research and replies for the "Test power dial" and the Training Warm up. Nothing here is a real business or a real
// number (555 01xx), nothing is saved, and nothing is dialed. `test_outcome` says how the pretend call goes:
// 'answer' (a person picks up), 'no-answer' (rings out) or 'voicemail' (a greeting plays).
export const TEST_OUTCOMES = ['answer', 'no-answer', 'answer', 'answer', 'voicemail', 'answer', 'no-answer'];

export function testLeads(now = Date.now()) {
  const d = new Date(now);
  const local = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const base = { stage: 'new', attempts: 0, next_action: '', tz_known: true, local_time: local, state: 'FL', sms_consent: 0, test: true, website: '', rating: null, reviews: null, intel_test: true };
  const L = (i, o) => ({ ...base, id: `test-${i}`, test_outcome: TEST_OUTCOMES[i - 1], ...o });
  return [
    L(1, { business: 'Test Plumbing Co', city: 'Miami', industry: 'Plumbing', phone: '(305) 555-0101', contact_name: 'Pat Sample', email: 'pat@example.com', grade: 'A', score: 82, persona: 'friendly', website: 'testplumbing.example.com', rating: 4.4, reviews: 31, tz_known: true }),
    L(2, { business: 'Test Roofing LLC', city: 'Fort Lauderdale', industry: 'Roofing', phone: '(954) 555-0102', contact_name: '', email: '', grade: 'B', score: 66, persona: 'skeptical', rating: 4.1, reviews: 12 }),
    L(3, { business: 'Test HVAC Services', city: 'Hollywood', industry: 'HVAC', phone: '(954) 555-0103', contact_name: 'Sam Example', email: 'sam@example.com', grade: 'C', score: 51, persona: 'agency', website: 'testhvac.example.com', rating: 4.8, reviews: 88 }),
    L(4, { business: 'Test Glow Med Spa', city: 'Miami Beach', industry: 'Med spa', phone: '(305) 555-0104', contact_name: '', email: 'info@example.com', grade: 'B', score: 63, persona: 'gatekeeper', website: 'testglow.example.com', rating: 4.6, reviews: 54 }),
    L(5, { business: 'Test Electric Inc', city: 'Pembroke Pines', industry: 'Electrician', phone: '(954) 555-0105', contact_name: '', email: '', grade: 'D', score: 38, persona: 'voicemail', rating: 3.9, reviews: 7 }),
    L(6, { business: 'Test Lawn and Garden', city: 'Doral', industry: 'Landscaping', phone: '(305) 555-0106', contact_name: 'Tony Test', email: '', grade: 'C', score: 48, persona: 'busy', rating: 4.2, reviews: 19 }),
    L(7, { business: 'Test Family Dental', city: 'Coral Springs', industry: 'Dentist', phone: '(954) 555-0107', contact_name: '', email: 'front@example.com', grade: 'B', score: 60, persona: 'friendly', website: 'testdental.example.com', rating: 4.5, reviews: 140 }),
  ];
}

// A believable research result so the script, "Their numbers", problems and competitor lines all fill in. Made up. No paid call.
export function testIntel(lead, now = Date.now()) {
  const kw = `${String(lead.industry || 'service').toLowerCase()} ${lead.city || 'Miami'}`;
  const ranks = [6, 9, 14, 4, 8, 12, 19, null, 11];
  const cells = ranks.map((rank, i) => ({ row: Math.floor(i / 3), col: i % 3, rank, error: false, top: [
    { title: `${lead.city || 'Miami'} Pro ${lead.industry || 'Service'}`, rank: 1, rating: 4.9, reviews: 210 },
    { title: `Best ${lead.industry || 'Service'} Co`, rank: 2, rating: 4.7, reviews: 164 },
    { title: `All Day ${lead.industry || 'Service'}`, rank: 3, rating: 4.6, reviews: 120 } ] }));
  const ranked = ranks.filter((r) => r != null);
  return {
    at: now, demo: true, test: true, depth: 'standard', found: true, keyword: kw, cost: 0,
    listing: { title: lead.business, category: lead.industry || 'Service', rating: lead.rating ?? 4.2, reviews: lead.reviews ?? 14, address: `100 Sample St, ${lead.city || 'Miami'}, FL`, phone: lead.phone, url: lead.website || null, city: lead.city || null, lat: 25.76, lng: -80.19, claimed: true },
    rank: 8,
    grid: { size: 3, radiusMiles: 2, points: 9, top3: 0, top10: ranked.filter((r) => r <= 10).length, avg: Math.round((ranked.reduce((s, r) => s + r, 0) / ranked.length) * 10) / 10, cells },
    competitors: [
      { title: `${lead.city || 'Miami'} Pro ${lead.industry || 'Service'}`, rating: 4.9, reviews: 210, wins: 9, best: 1 },
      { title: `Best ${lead.industry || 'Service'} Co`, rating: 4.7, reviews: 164, wins: 7, best: 1 },
      { title: `All Day ${lead.industry || 'Service'}`, rating: 4.6, reviews: 120, wins: 4, best: 2 },
    ],
    website: lead.website ? { ok: true, url: `https://${lead.website}`, https: true, title: `Home | ${lead.business}`, description: '', h1: 'Welcome', titleHasCity: false, titleHasService: false, schema: false, tel: false, viewport: true, mapEmbed: false, ads: [], form: true, platform: 'Wix', kb: 640 } : null,
    speed: lead.website ? { score: 34, lcp: '5.4 s', basic: false } : null,
  };
}

// The pretend owner for a text thread. Short, a little different each time you text, and only a reply to what you sent.
export function testTextReply(lead, text) {
  const t = String(text || '').toLowerCase();
  if (/\bstop\b/.test(t)) return '';
  if (/\b(\d{1,2}(:\d\d)?\s?(am|pm)|noon|tomorrow|today)\b/.test(t)) return 'That works. Talk then.';
  if (/\b(free|analysis|game ?plan)\b/.test(t)) return 'Ok, what do I have to do?';
  return `Hi, this is ${lead.contact_name ? lead.contact_name.split(' ')[0] : 'the owner'}. Who is this?`;
}
