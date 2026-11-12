// Social autopilot, pure and shared by the Worker, the Hub and the tests.
// It stacks a month of posts per client: which day and time, which channel, what kind of post, which service and city,
// the keyword the post should cover, the caption for each channel, hashtags, a Google button and a shot list.
// Nothing here posts anywhere. A person verifies each post and publishes it by hand.
//
// What drives the choices, in order of how real the data is:
//  1. The client's own scans: services and cities where they are weakest on the first page get posted about more.
//  2. The client's own results: when a person logs how many leads a posted item brought, kinds of posts that bring more get more slots.
//  3. Common local business practice (the starting mix, days, times, hashtag counts). These are defaults, not promises, and every one is editable.
import { zonedToUtc } from './apptime.js';

export const PILLARS = [
  // weight = starting share of the mix. google = fits a Google profile post. photo = needs a real photo to be worth posting.
  { id: 'service', label: 'Service spotlight', weight: 5, google: true, photo: false, goal: 'Calls and quote requests for one service in one city.' },
  { id: 'proof', label: 'Before and after', weight: 5, google: true, photo: true, goal: 'Shows the work. The strongest trust builder for a local service.' },
  { id: 'review', label: 'Customer review', weight: 2, google: true, photo: false, goal: 'Real words from a real customer.' },
  { id: 'faq', label: 'Common question', weight: 3, google: true, photo: false, goal: 'Answers what people ask before they call.' },
  { id: 'tip', label: 'Quick tip', weight: 3, google: false, photo: false, goal: 'Useful, shareable, keeps the page active.' },
  { id: 'seasonal', label: 'Seasonal reminder', weight: 3, google: true, photo: false, goal: 'Timely, so people act now.' },
  { id: 'team', label: 'Meet the team', weight: 2, google: false, photo: true, goal: 'Trust. People hire people.' },
  { id: 'local', label: 'Local love', weight: 2, google: false, photo: false, goal: 'Ties the business to the neighbourhoods it serves.' },
];
export const PILLAR = Object.fromEntries(PILLARS.map((p) => [p.id, p]));

export const DEFAULTS = {
  enabled: false,
  perWeek: 4,          // post cards a week (each card goes to its channels)
  googlePerWeek: 2,    // how many of those also go to the Google profile
  weeks: 4,            // how far ahead to keep stacked
  channels: ['facebook', 'instagram', 'google'],
  tz: 'America/New_York',
  times: { feed: ['12:00', '18:30'], google: ['10:00'], saturday: '09:30' },
  startInDays: 1,      // never schedule sooner than this, so a person has time to verify
  clientReview: false, // also send verified posts to the client for approval
  autoTopUp: true,     // the cron keeps the stack full
  region: 'florida',   // seasonal reminders
};

const DAY_SETS = { 1: [3], 2: [2, 4], 3: [2, 4, 6], 4: [1, 2, 4, 6], 5: [1, 2, 3, 4, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const clamp = (n, lo, hi, d) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const okTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
const okZone = (z) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };
const CHANNELS = ['facebook', 'instagram', 'google'];

export function cleanSettings(b = {}) {
  const d = DEFAULTS;
  const perWeek = clamp(b.perWeek, 1, 7, d.perWeek);
  const times = (list, fallback) => { const l = (Array.isArray(list) ? list : []).filter(okTime).slice(0, 4); return l.length ? l : fallback; };
  const ch = (Array.isArray(b.channels) ? b.channels : d.channels).filter((c) => CHANNELS.includes(c));
  return {
    enabled: Boolean(b.enabled),
    perWeek,
    googlePerWeek: clamp(b.googlePerWeek, 0, perWeek, Math.min(d.googlePerWeek, perWeek)),
    weeks: clamp(b.weeks, 1, 8, d.weeks),
    channels: ch.length ? [...new Set(ch)] : d.channels,
    tz: okZone(b.tz) ? b.tz : d.tz,
    times: { feed: times(b.times?.feed, d.times.feed), google: times(b.times?.google, d.times.google), saturday: okTime(b.times?.saturday) ? b.times.saturday : d.times.saturday },
    startInDays: clamp(b.startInDays, 0, 14, d.startInDays),
    clientReview: Boolean(b.clientReview),
    autoTopUp: b.autoTopUp === undefined ? d.autoTopUp : Boolean(b.autoTopUp),
    region: ['florida', 'general'].includes(b.region) ? b.region : d.region,
  };
}

const list = (s) => (Array.isArray(s) ? s : String(s || '').split(/[\n,;]+/)).map((x) => String(x).trim()).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lower = (s) => String(s || '').toLowerCase();
const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());
const noDash = (s) => String(s || '').replace(/\s*[–—]\s*/g, ', ');

export function clientInfo(c = {}) {
  const services = [...new Set(list(c.services))].slice(0, 8);
  const cities = [...new Set(list(c.cities))].slice(0, 12);
  return { name: String(c.name || 'our team').trim(), category: String(c.category || '').trim(), services: services.length ? services : [String(c.category || '').trim() || 'our services'], cities, keywords: list(c.keywords) };
}

// ---------- dates ----------
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const g = (t) => Number(f.find((p) => p.type === t).value);
  return { y: g('year'), m: g('month'), d: g('day') };
}
export const localDayKey = (ms, tz) => { const p = localParts(ms, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

// The days and clock times to fill. `taken` is a Set of local day keys that already have a post.
export function postingSlots(settings, nowMs, taken = new Set()) {
  const s = cleanSettings(settings);
  const set = DAY_SETS[s.perWeek];
  const t0 = localParts(nowMs, s.tz);
  const out = [];
  let feedN = 0; let googleN = 0;
  const days = s.weeks * 7 + s.startInDays;
  for (let k = s.startInDays; k < days; k++) {
    const dt = new Date(Date.UTC(t0.y, t0.m - 1, t0.d + k));
    const y = dt.getUTCFullYear(); const m = dt.getUTCMonth() + 1; const d = dt.getUTCDate(); const dow = dt.getUTCDay();
    if (!set.includes(dow)) continue;
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const clock = dow === 6 ? s.times.saturday : s.times.feed[feedN++ % s.times.feed.length];
    const [h, mi] = clock.split(':').map(Number);
    if (taken.has(key)) continue;
    out.push({ key, dow, at: zonedToUtc(y, m, d, h, mi, s.tz), week: Math.floor((Date.UTC(y, m - 1, d) - ((dow + 6) % 7) * 86400000) / 86400000) });
  }
  return out;
}

// ---------- weighted picking ----------
// Smooth weighted round robin: steady, repeatable, and every option gets its share over time (tests can check it).
function picker(items, weightOf) {
  const credit = new Map(items.map((i) => [i, 0]));
  return (avoid = () => false) => {
    const total = items.reduce((s, i) => s + weightOf(i), 0);
    for (const i of items) credit.set(i, credit.get(i) + weightOf(i));
    let best = null;
    for (const i of items) if (!avoid(i) && (best === null || credit.get(i) > credit.get(best))) best = i;
    if (best === null) best = items.reduce((a, b) => (credit.get(b) > credit.get(a) ? b : a), items[0]);
    credit.set(best, credit.get(best) - total);
    return best;
  };
}

// Kinds of posts that brought more leads for this client get more slots. Needs 6 posted items with a lead count; below that the starting mix stands.
export function pillarWeights(history = [], base = PILLARS) {
  const rows = history.filter((h) => PILLAR[h.pillar] && Number.isFinite(Number(h.leads)));
  const w = Object.fromEntries(base.map((p) => [p.id, p.weight]));
  if (rows.length < 6) return { weights: w, learned: false };
  const overall = rows.reduce((s, r) => s + Number(r.leads), 0) / rows.length;
  if (overall <= 0) return { weights: w, learned: false };
  for (const p of base) {
    const mine = rows.filter((r) => r.pillar === p.id);
    if (mine.length < 2) continue;
    const avg = mine.reduce((s, r) => s + Number(r.leads), 0) / mine.length;
    w[p.id] = Math.max(0.5, Math.min(10, p.weight * (0.5 + avg / overall)));
  }
  return { weights: w, learned: true };
}

// The weakest first page coverage for a service in a city, from the client's own scans: [{keyword, top10Pct}].
export function scanFor(scans, service, city) {
  const words = norm(`${service} ${city}`).split(' ');
  let weak = null;
  for (const s of scans || []) {
    const kw = norm(s.keyword).split(' ').filter((w) => w.length > 3);
    if (kw.length && kw.every((w) => words.some((x) => x.startsWith(w.slice(0, 5)))) && (!weak || s.top10Pct < weak.top10Pct)) weak = s;
  }
  return weak;
}

// Which service + city to talk about. Home city counts double, weak scan spots count more.
export function pairs(info, scans) {
  const cities = info.cities.length ? info.cities : [''];
  const out = [];
  info.services.forEach((service, si) => cities.forEach((city, ci) => {
    const weak = scanFor(scans, service, city);
    const keyword = info.keywords.find((k) => norm(k).includes(norm(service).split(' ')[0].slice(0, 5)) && (!city || norm(k).includes(norm(city).split(' ')[0]))) || `${lower(service)}${city ? ` ${lower(city)}` : ''}`;
    out.push({ service, city, keyword: lower(keyword), weak, weight: (ci === 0 ? 2 : 1) * (si === 0 ? 1.5 : 1) * (1 + (weak ? (100 - weak.top10Pct) / 25 : 0)) });
  }));
  return out;
}

// ---------- seasonal ----------
const GROUPS = [
  ['roof', /roof|gutter|shingle/], ['hvac', /hvac|air condition|a\/c|\bac\b|heating|cooling/], ['plumb', /plumb|drain|water heater|sewer/], ['pest', /pest|termite|exterminat|mosquito|rodent/],
  ['lawn', /lawn|landscap|tree|irrigation|sprinkler|yard/], ['pool', /pool|spa\b/], ['clean', /clean|maid|janitor|pressure wash|power wash/], ['paint', /paint/], ['elec', /electric/],
];
export const groupOf = (category, services = []) => { const t = lower(`${category} ${services.join(' ')}`); return (GROUPS.find(([, re]) => re.test(t)) || ['general'])[0]; };

// [months, region, text]. Plain, true for the season and place, no offers or claims.
const SEASON = {
  roof: [[[6, 7, 8, 9, 10, 11], 'florida', 'Hurricane season runs through November. A roof check now beats a leak in the middle of a storm.'], [[12, 1, 2, 3], 'florida', 'Dry season is a good time to fix small roof issues before the summer rains return.'], [[3, 4, 5], 'florida', 'Get the roof checked before the rainy season starts.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'After any big storm, look for missing, cracked or curled shingles and stains on your ceilings.']],
  hvac: [[[5, 6, 7, 8, 9, 10], 'florida', 'Air conditioners work hardest from May to October. A tune up now helps avoid a breakdown on the hottest day.'], [[11, 12, 1, 2, 3, 4], 'florida', 'Mild weather is the easy time to service your system before summer.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'A clogged air filter makes your system work harder. Check yours every month.']],
  plumb: [[[6, 7, 8, 9, 10, 11], 'florida', 'Heavy summer rain can overload drains. Know where your main shut off valve is before you need it.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Slow drains and a rising water bill are early signs of a leak. Do not wait for it to get worse.']],
  pest: [[[5, 6, 7, 8, 9, 10], 'florida', 'Rainy season pushes ants, roaches and mosquitoes indoors and into standing water.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Fix leaks and clear standing water. Moisture is what many pests are looking for.']],
  lawn: [[[6, 7, 8, 9, 10], 'florida', 'Summer rain and heat make grass and weeds grow fast. Keep up with the mowing and trimming.'], [[11, 12, 1, 2, 3], 'florida', 'Cooler months are a good time to plant and shape up the yard.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Water early in the morning, deeply and less often. It helps roots grow stronger.']],
  pool: [[[5, 6, 7, 8, 9, 10], 'florida', 'Pools use more chemicals in the heat and rain. Test the water every week.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'A clear pool starts with balanced water and clean filters.']],
  clean: [[[11, 12, 1, 2, 3, 4], 'florida', 'Busy season is here and guests are coming. A deep clean makes the home ready.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'A regular cleaning schedule is easier than a big catch up.']],
  paint: [[[11, 12, 1, 2, 3, 4], 'florida', 'Dry, mild weather is the best time for exterior painting.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Peeling or chalky paint is a sign it is time for a fresh coat.']],
  elec: [[[6, 7, 8, 9, 10, 11], 'florida', 'Storm season is a good time to check your panel, surge protection and generator hookup.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Flickering lights and warm outlets are signs to call a licensed electrician.']],
  general: [[[6, 7, 8, 9, 10, 11], 'florida', 'Hurricane season runs through November. Plan ahead so you are not rushing when a storm is on the way.'], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'any', 'Small problems are cheaper to fix early than late.']],
};
export function seasonHook(category, services, month, region = 'florida') {
  const rows = SEASON[groupOf(category, services)] || SEASON.general;
  return (rows.find(([ms, r]) => ms.includes(month) && (r === 'any' || r === region)) || rows[rows.length - 1])[2];
}

const TIPS = {
  roof: ['After a big storm, look for missing, cracked or curled shingles and stains on your ceilings.', 'Keep gutters and valleys clear of leaves. Water that cannot drain finds a way in.', 'Trim branches that touch the roof. They scrape shingles and drop debris.'],
  hvac: ['Change your air filter every 1 to 3 months. A clogged filter makes the system work harder.', 'Keep the outdoor unit clear of leaves and plants, at least two feet around it.', 'Set the thermostat and leave it. Big swings make the system run longer.'],
  plumb: ['Know where your main water shut off valve is, so you can stop a leak fast.', 'Do not pour grease down the drain. It hardens and blocks the line.', 'Check under sinks now and then for damp spots or drips.'],
  pest: ['Fix leaks and clear standing water. Moisture is what many pests are looking for.', 'Seal gaps around doors, windows and pipes where pests get in.', 'Keep food in sealed containers and take the trash out often.'],
  lawn: ['Water early in the morning, deeply and less often.', 'Do not cut the grass too short. Taller grass shades out weeds.', 'Keep mulch a few inches away from tree trunks.'],
  pool: ['Test the water every week and keep the filter clean.', 'Brush the walls and steps so algae cannot get started.', 'Keep leaves out of the skimmer basket.'],
  clean: ['Clean top to bottom so dust does not land on what you already did.', 'Let cleaner sit a few minutes before wiping. It does the work for you.', 'Wipe the things everyone touches, like handles and switches, each week.'],
  paint: ['Wash the surface before painting. Paint sticks to clean walls.', 'Fix cracks and peeling spots first. New paint will not hide them.', 'Paint on a dry day with mild temperatures.'],
  elec: ['Test your smoke detectors every month.', 'Do not overload one outlet with power strips.', 'Flickering lights or warm outlets are a reason to call a licensed electrician.'],
  general: ['Ask for a written estimate that lists exactly what is included.', 'Ask if the business is licensed and insured, and ask to see proof.', 'Get more than one quote, but do not pick on price alone. Ask what the job includes.'],
};

// ---------- hashtags ----------
const tag = (s) => `#${String(s).replace(/&/g, 'and').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')}`;
// Specific beats generic: service + city, city, category + city, the brand. No #love or #instagood.
export function hashtagsFor(info, slot, n = 8) {
  const svc = slot.service; const city = slot.city;
  const near = info.cities.filter((c) => c !== city).slice(0, 2);
  const pool = [
    city && `${svc} ${city}`, city && `${city} ${info.category || 'local business'}`, svc, city, info.category && city && `${info.category} ${city}`,
    info.category, info.name, ...near.map((c) => `${svc} ${c}`), city && `${city} homeowners`, city && `support local ${city}`,
  ].filter(Boolean).map(tag).filter((t) => t.length > 3 && t.length < 40);
  return [...new Set(pool)].slice(0, n);
}

// ---------- captions ----------
const BUTTON = { service: 'CALL', proof: 'LEARN_MORE', review: 'LEARN_MORE', faq: 'LEARN_MORE', seasonal: 'CALL', tip: 'LEARN_MORE', team: 'LEARN_MORE', local: 'LEARN_MORE' };
const BUTTON_TEXT = { CALL: 'Tap Call now to reach us.', LEARN_MORE: 'Tap Learn more to see what we do.', BOOK: 'Tap Book to pick a time.' };

const SHOT = {
  service: 'A clear photo or a short video of a recent job of this type. Shoot a 15 to 30 second Reel if you can.',
  proof: 'Two photos from the same angle: before and after. Add a third of the finished job if you have one.',
  review: 'No photo needed. A screenshot of the review works, with the customer name cropped if they asked.',
  faq: 'A photo of the team at work or a simple text image with the question.',
  tip: 'A short clip of someone showing the tip, or a photo of the thing the tip is about.',
  seasonal: 'A photo from a job this season, or the team at work.',
  team: 'A real photo of one team member at work, smiling, with their first name.',
  local: 'A photo of the neighbourhood or a recent job nearby.',
};

export function reviewText(r) {
  const t = String(r?.text || r?.review_text || r?.snippet || '').replace(/\s+/g, ' ').trim();
  const rating = Number(r?.rating?.value ?? r?.rating ?? 0);
  const name = String(r?.author || r?.name || r?.profile_name || '').trim().split(/\s+/)[0] || '';
  return { text: t, rating, name };
}

function variants(slot, info, i) {
  const { service, city, pillar } = slot; const svc = lower(service); const where = city ? ` in ${city}` : '';
  const n = info.name; const pick = (a) => a[i % a.length];
  switch (pillar) {
    case 'service': return pick([
      { fb: `Need ${svc}${where}? ${n} takes care of it from the first call to the last cleanup. Message us for a clear quote.`, ig: `${cap(svc)}${where}, done right. Send us a message and we will take it from there.`, g: `${n} offers ${svc}${where}. We explain the job, give a clear quote and clean up when we finish.` },
      { fb: `Thinking about ${svc}${where}? Here is how it works with ${n}: you tell us what is going on, we look at it, and we give you a plain quote. No pressure.`, ig: `How ${svc} works with us${where}: you tell us, we look, you get a plain quote.`, g: `Thinking about ${svc}${where}? ${n} looks at the job, explains the options and gives a plain quote.` },
      { fb: `${cap(svc)}${where} is what we do every day at ${n}. If you have a question about your own place, send it over.`, ig: `${cap(svc)} is what we do every day${where}. Questions about your place? Send them over.`, g: `${cap(svc)}${where} is what ${n} does every day. Ask us about your job and we will point you in the right direction.` },
    ]);
    case 'proof': return pick([
      { fb: `Before and after: ${svc}${where}. Swipe to see the difference. Want the same for your place? Message us.`, ig: `Before and after. ${cap(svc)}${where}. Swipe to see it.`, g: `A recent ${svc} job${where}. The first photo is before, the next is after.` },
      { fb: `One more finished job: ${svc}${where}. We like to show the work, so here it is. Questions? Ask away.`, ig: `Finished: ${svc}${where}. We like to show the work.`, g: `Finished ${svc} work${where} by ${n}. See the photos for the before and after.` },
    ]);
    case 'faq': return pick([
      { fb: `Question we hear a lot: how long does ${svc} take?\n\nIt depends on the size and the condition of the job. Send us a few photos and we will give you a real answer for your place.`, ig: `How long does ${svc} take? It depends on the job. Send photos and we will tell you for yours.`, g: `How long does ${svc} take? It depends on the size and the condition of the job. Contact ${n} and we will give you a real answer.` },
      { fb: `Question we hear a lot: how much does ${svc} cost${where}?\n\nThere is no honest one number, because every job is different. We look at what you need and give you a clear quote before any work starts.`, ig: `How much does ${svc} cost${where}? Every job is different. We give a clear quote before work starts.`, g: `How much does ${svc} cost${where}? Every job is different, so ${n} gives a clear quote before any work starts.` },
      { fb: `Question we hear a lot: do you serve ${city || 'my area'}?\n\nWe work in ${info.cities.slice(0, 5).join(', ') || 'your area'}. If you are close by, message us and we will let you know.`, ig: `Do we serve ${city || 'your area'}? ${info.cities.length ? `We work in ${info.cities.slice(0, 4).join(', ')}.` : 'Message us to check.'}`, g: `Does ${n} serve ${city || 'your area'}? We work in ${info.cities.slice(0, 5).join(', ') || 'the local area'}. Contact us to check your address.` },
    ]);
    case 'tip': {
      const tips = TIPS[groupOf(info.category, info.services)] || TIPS.general; const t = tips[i % tips.length];
      return [{ fb: `Quick tip: ${t}\n\nNeed a hand with ${svc}${where}? We are a message away.`, ig: `Quick tip: ${t}`, g: `Quick tip from ${n}: ${t}` }];
    }
    case 'seasonal': {
      const t = slot.season || seasonHook(info.category, info.services, slot.month || 1, slot.region);
      return [{ fb: `${t}\n\nIf you need ${svc}${where}, ${n} can help. Send us a message.`, ig: `${t}`, g: `${t} ${n} can help with ${svc}${where}.` }];
    }
    case 'review': {
      const r = slot.review || {}; const q = r.text.length > 240 ? `${r.text.slice(0, 237).replace(/\s+\S*$/, '')}...` : r.text; const by = r.name ? ` - ${r.name}, Google review` : ' - Google review';
      return [{ fb: `"${q}"${by}\n\nThank you. It means a lot.`, ig: `"${q}"${by}\n\nThank you.`, g: `"${q}"${by}` }];
    }
    case 'team': return [{ fb: `Say hello to the team at ${n}. This is one of the people who will answer your call or show up at your door${where}. Tell us who you want to hear about next.`, ig: `Meet the team at ${n}${where}. Real people, real work.`, g: `Meet the team at ${n}${where}. Real people who take care of every job.` }];
    default: return pick([
      { fb: `${city || 'Our area'} is home. We love working here, and we see the same streets, schools and shops our customers do. What is your favorite spot in ${city || 'town'}?`, ig: `${city || 'Our area'} is home. What is your favorite local spot?`, g: `${n} is proud to serve ${city || 'the local area'}. We work where we live.` },
      { fb: `Proud to serve ${city || 'our neighbours'} with ${svc}. If we have helped you, thank you. If you have a question, we are here.`, ig: `Proud to serve ${city || 'our neighbours'}.`, g: `${n} serves ${city || 'the local area'} with ${svc}.` },
    ]);
  }
}

// One slot to captions for every channel it goes to. Uses only what we know. No offers, awards, prices or years.
export function templateCaptions(slot, info, i = 0) {
  const v = variants(slot, info, i);
  const base = Array.isArray(v) ? v : [v];
  const x = base[i % base.length];
  const tags = hashtagsFor(info, slot, 8);
  const btn = BUTTON_TEXT[slot.google_button] || BUTTON_TEXT.LEARN_MORE;
  return {
    facebook: noDash(`${x.fb}${tags.length ? `\n\n${tags.slice(0, 2).join(' ')}` : ''}`),
    instagram: noDash(`${x.ig}\n\n${tags.join(' ')}`),
    google: noDash(`${x.g} ${btn}`),
    hashtags: tags,
    alt_text: noDash(`${cap(slot.service)}${slot.city ? ` in ${slot.city}` : ''} by ${info.name}`).slice(0, 200),
    ai: false,
  };
}

// Internal note for the person who verifies: why this post, what to shoot, what to check. The client never sees it.
export function postNote(slot, caps) {
  const lines = [
    `Autopilot: ${PILLAR[slot.pillar].label}. Goal: ${PILLAR[slot.pillar].goal}`,
    `Search term this post covers: ${slot.keyword}.${slot.reason ? ` ${slot.reason}.` : ''}`,
    `Photo or video: ${SHOT[slot.pillar]}`,
    slot.channels.includes('google') ? `Google profile button: ${({ CALL: 'Call now', LEARN_MORE: 'Learn more', BOOK: 'Book' })[slot.google_button] || 'Learn more'}. No phone number or link in the text.` : null,
    caps?.alt_text ? `Alt text: ${caps.alt_text}` : null,
    'Check before posting: every fact is true for this business, the photo matches the caption.',
  ].filter(Boolean);
  return noDash(lines.join('\n'));
}

// ---------- the plan ----------
// o: { client, settings, scans: [{keyword, top10Pct}], history: [{pillar, leads}], existing: [{scheduled_at, status, auto}], reviews: [], now }
export function planQueue(o = {}) {
  const s = cleanSettings(o.settings);
  const info = clientInfo(o.client);
  const nowMs = o.now ?? Date.now();
  const taken = new Set((o.existing || []).filter((e) => e.scheduled_at && e.status !== 'idea').map((e) => localDayKey(e.scheduled_at, s.tz)));
  const slots = postingSlots(s, nowMs, taken);
  const { weights, learned } = pillarWeights(o.history || []);
  const goodReviews = (o.reviews || []).map(reviewText).filter((r) => r.text.length >= 40 && r.rating >= 4);
  const usable = PILLARS.filter((p) => p.id !== 'review' || goodReviews.length);
  const pickPillar = picker(usable, (p) => weights[p.id]);
  const pickPair = picker(pairs(info, o.scans), (p) => p.weight);
  const recent = []; const lastPillars = []; let reviewN = 0;
  const googleThisWeek = new Map();
  const items = [];
  for (const sl of slots) {
    const pillar = pickPillar((p) => lastPillars[lastPillars.length - 1] === p.id || (p.id === 'review' && lastPillars.slice(-4).includes('review')) || (p.id === 'team' && lastPillars.slice(-6).includes('team')));
    lastPillars.push(pillar.id);
    const back = Math.min(8, info.services.length * Math.max(1, info.cities.length) - 1);
    const pair = pickPair((p) => (back > 0 && recent.slice(-back).includes(p)) || (info.cities.length > 1 && recent.length > 0 && recent[recent.length - 1].city === p.city));
    recent.push(pair);
    const g = googleThisWeek.get(sl.week) || 0;
    const google = s.channels.includes('google') && pillar.google && g < s.googlePerWeek;
    if (google) googleThisWeek.set(sl.week, g + 1);
    const feed = s.channels.filter((c) => c !== 'google');
    const channels = [...feed, ...(google ? ['google'] : [])];
    if (!channels.length) continue;
    const month = Number(sl.key.slice(5, 7));
    const slot = {
      pillar: pillar.id, service: pair.service, city: pair.city, keyword: pair.keyword, reason: pair.weak && pair.weak.top10Pct < 70 ? `First page (top 10) in only ${pair.weak.top10Pct}% of the area for "${pair.weak.keyword}"` : '',
      channels, at: sl.at, key: sl.key, month, region: s.region, google_button: BUTTON[pillar.id],
      review: pillar.id === 'review' ? goodReviews[reviewN++ % goodReviews.length] : undefined,
    };
    const caps = templateCaptions(slot, info, items.length);
    const titleCity = slot.city ? ` in ${slot.city}` : '';
    items.push({
      ...slot, title: noDash(pillar.id === 'review' ? `Customer review: ${slot.review.name || 'a customer'}` : pillar.id === 'seasonal' ? `Seasonal: ${slot.service}${titleCity}` : `${pillar.label}: ${slot.service}${titleCity}`),
      captions: caps, note: postNote(slot, caps), needsPhoto: pillar.photo || s.channels.includes('instagram'),
    });
  }
  return { settings: s, items, learned, pillarWeights: weights, summary: summarize(items) };
}

export function summarize(items) {
  const byPillar = {}; const byCity = {};
  for (const i of items) { byPillar[i.pillar] = (byPillar[i.pillar] || 0) + 1; if (i.city) byCity[i.city] = (byCity[i.city] || 0) + 1; }
  return { count: items.length, byPillar, byCity };
}

// ---------- Claude batch ----------
export function batchPrompt(client, items) {
  const info = clientInfo(client);
  const rows = items.map((it, n) => `${n + 1}. kind: ${PILLAR[it.pillar].label}; service: ${it.service}; city: ${it.city || 'none'}; search term to cover once, naturally: ${it.keyword}; channels: ${it.channels.join(', ')}${it.pillar === 'seasonal' ? `; season note: ${it.season || seasonHook(info.category, info.services, it.month, it.region)}` : ''}${it.pillar === 'review' ? `; real review to quote exactly: "${it.review.text}" by ${it.review.name || 'a customer'}` : ''}`).join('\n');
  return `You write social media posts for a local business. Write one post per line below.

Business: ${info.name}
Category: ${info.category || 'not given'}
Services: ${info.services.join(', ')}
Cities served: ${info.cities.join(', ') || 'not given'}
Brand voice: ${client.brand_voice || 'friendly, local, confident, no hype'}

Posts:
${rows}

For each post write:
- "facebook": 40 to 90 words, conversational, ends with a clear next step (message us or call). At most 2 hashtags.
- "instagram": 30 to 70 words, a hook in the first line, then a blank line, then 6 to 10 specific hashtags (service, city, nearby areas, niche). No generic tags like #love or #instagood.
- "google": only if google is in the channels. 80 to 150 words. Name the service and the city once each. No phone numbers, no links, no hashtags, no emojis. End by pointing at the post button.
- "alt_text": one plain sentence describing the photo that should go with it.

Rules: never invent facts, awards, prices, offers, years in business, license claims or reviews. For a review post, quote the review exactly and do not change a word. The photo is not visible to you, so write about the job in general terms and do not describe what a photo shows. Plain words. No em dashes or en dashes. Vary the openings so the posts do not sound alike.
Reply with only a JSON array of ${items.length} objects, in order: {"facebook": "...", "instagram": "...", "google": "...", "alt_text": "..."}. Use "" for a channel that is not listed for that post.`;
}

export function parseBatch(raw, n) {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) throw new Error('No JSON in the reply');
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr) || arr.length < n) throw new Error('The reply had too few posts');
  const s = (v, max) => noDash(String(v || '')).slice(0, max).trim();
  return arr.slice(0, n).map((a) => ({ facebook: s(a.facebook, 2000), instagram: s(a.instagram, 2200), google: s(a.google, 1500), alt_text: s(a.alt_text, 200) }));
}

// Mix Claude's text into the template item, keeping the template for any empty channel. Google never keeps links or phone numbers.
export function mergeCaptions(item, ai) {
  const t = item.captions;
  const clean = (g) => g.replace(/https?:\/\/\S+/g, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, '').replace(/[ \t]+/g, ' ').trim();
  const out = { ...t, ai: true };
  if (ai?.facebook) out.facebook = ai.facebook;
  if (ai?.instagram) out.instagram = ai.instagram;
  if (ai?.google) out.google = clean(ai.google) || t.google;
  if (ai?.alt_text) out.alt_text = ai.alt_text;
  if (item.pillar === 'review') { out.facebook = t.facebook; out.instagram = t.instagram; out.google = t.google; } // quotes stay exactly as the customer wrote them
  return out;
}

// What to show next to a queued post: ready, or what is missing. `media` is the post's files.
export function readiness(item, issuesOf) {
  const left = [];
  for (const id of item.channels || []) for (const msg of issuesOf(id, item.captions?.[id]?.text, item.media || [])) left.push(`${id}: ${msg}`);
  return { ready: left.length === 0, left };
}
