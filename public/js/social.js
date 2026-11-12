// Social planner basics, pure and shared by the Worker, the Hub and the client review page (tested in Node).
// A "post" is one card: a title, the channels it goes to, one caption per channel, media, a date and a status.

export const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', short: 'FB', max: 63206, needsMedia: false, hashtags: 5 },
  { id: 'instagram', label: 'Instagram', short: 'IG', max: 2200, needsMedia: true, hashtags: 30 },
  { id: 'google', label: 'Google profile', short: 'GBP', max: 1500, needsMedia: false, hashtags: 0 },
  { id: 'linkedin', label: 'LinkedIn', short: 'IN', max: 3000, needsMedia: false, hashtags: 5 },
  { id: 'tiktok', label: 'TikTok', short: 'TT', max: 2200, needsMedia: true, video: true, hashtags: 10 },
  { id: 'youtube', label: 'YouTube', short: 'YT', max: 5000, needsMedia: true, video: true, hashtags: 15 },
  { id: 'x', label: 'X', short: 'X', max: 280, needsMedia: false, hashtags: 3 },
  { id: 'threads', label: 'Threads', short: 'TH', max: 500, needsMedia: false, hashtags: 1 },
  { id: 'pinterest', label: 'Pinterest', short: 'PIN', max: 500, needsMedia: true, hashtags: 5 },
];
export const PLATFORM = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
export const platformIds = PLATFORMS.map((p) => p.id);

// The path a post takes. The client sees review, changes, approved, scheduled and posted.
export const STATUSES = [
  { id: 'idea', label: 'Idea', tone: 'gray' },
  { id: 'draft', label: 'Draft', tone: 'gray' },
  { id: 'review', label: 'With client', tone: 'warn' },
  { id: 'changes', label: 'Changes asked', tone: 'bad' },
  { id: 'approved', label: 'Approved', tone: 'ok' },
  { id: 'scheduled', label: 'Scheduled', tone: 'ok' },
  { id: 'posted', label: 'Posted', tone: 'ok' },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const statusIds = STATUSES.map((s) => s.id);
export const CLIENT_SEES = ['review', 'changes', 'approved', 'scheduled', 'posted'];
export const visibleToClient = (status) => CLIENT_SEES.includes(status);

const str = (v, max) => String(v ?? '').replace(/\u0000/g, '').slice(0, max);
const hashtagCount = (t) => (String(t).match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;

// Clean what a person typed: only known channels and statuses, trimmed text, a real date or none.
export function cleanItem(b = {}) {
  const out = {};
  if ('title' in b) out.title = str(b.title, 160).trim();
  if ('project' in b) out.project = str(b.project, 80).trim() || null;
  if ('notes' in b) out.notes = str(b.notes, 4000).trim() || null;
  if ('status' in b) { if (!statusIds.includes(b.status)) throw new Error('Pick a status from the list.'); out.status = b.status; }
  if ('channels' in b) out.channels = [...new Set((Array.isArray(b.channels) ? b.channels : []).filter((c) => platformIds.includes(c)))];
  if ('captions' in b) {
    const c = {};
    for (const id of platformIds) {
      const v = b.captions?.[id];
      if (!v) continue;
      const text = str(typeof v === 'string' ? v : v.text, 5000);
      const first = str(typeof v === 'string' ? '' : v.first_comment, 2200);
      if (text.trim() || first.trim()) c[id] = { text, first_comment: first };
    }
    out.captions = c;
  }
  if ('scheduled_at' in b) {
    if (b.scheduled_at === null || b.scheduled_at === '') out.scheduled_at = null;
    else { const t = Number(b.scheduled_at); if (!Number.isFinite(t) || t < 946684800000) throw new Error('That date is not valid.'); out.scheduled_at = Math.round(t); }
  }
  if ('assignee' in b) out.assignee = str(b.assignee, 60).trim() || null;
  if ('post_links' in b) {
    const l = {};
    for (const id of platformIds) { const u = str(b.post_links?.[id], 500).trim(); if (/^https?:\/\//i.test(u)) l[id] = u; }
    out.post_links = l;
  }
  return out;
}

// What is wrong with a caption for a channel (empty list = ready). Never blocks saving, only warns.
export function captionIssues(platform, text, media = []) {
  const p = PLATFORM[platform];
  if (!p) return [];
  const t = String(text || '');
  const issues = [];
  if (!t.trim()) issues.push('No caption yet.');
  if (t.length > p.max) issues.push(`${t.length - p.max} characters over the ${p.max} limit.`);
  if (p.hashtags && hashtagCount(t) > p.hashtags) issues.push(`Many hashtags (${hashtagCount(t)}). ${p.label} works best with ${p.hashtags} or fewer.`);
  if (platform === 'google' && (/https?:\/\//i.test(t) || /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(t))) issues.push('Google posts cannot carry phone numbers or links in the text.');
  if (p.needsMedia && !media.length) issues.push(`${p.label} needs a ${p.video ? 'video' : 'photo or video'}.`);
  if (p.video && media.length && !media.some((m) => /^video\//.test(m.type || ''))) issues.push(`${p.label} needs a video.`);
  return issues;
}

// Ready to send to the client: has a title, a channel, a caption for each channel and no hard problems.
export function readyForReview(item) {
  const reasons = [];
  if (!String(item.title || '').trim()) reasons.push('Add a title.');
  const ch = item.channels || [];
  if (!ch.length) reasons.push('Pick at least one channel.');
  for (const id of ch) {
    const issues = captionIssues(id, item.captions?.[id]?.text, item.media || []).filter((i) => !/^Many hashtags/.test(i));
    for (const i of issues) reasons.push(`${PLATFORM[id].label}: ${i}`);
  }
  return reasons;
}

// Other channels start from the three we write for: Facebook, Instagram and Google.
export function fillCaptions(base, channels) {
  const fb = String(base.facebook || base.instagram || base.google || '').trim();
  const ig = String(base.instagram || base.facebook || '').trim();
  const g = String(base.google || base.facebook || '').trim();
  const clip = (t, n) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
  const noTags = (t) => t.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const map = {
    facebook: fb, instagram: ig, google: noTags(g).replace(/https?:\/\/\S+/g, '').trim(),
    linkedin: noTags(fb), tiktok: clip(ig, 2200), youtube: noTags(fb),
    x: clip(noTags(fb), 280), threads: clip(noTags(fb), 500), pinterest: clip(noTags(g), 500),
  };
  const out = {};
  for (const id of channels) if (map[id] != null) out[id] = { text: map[id], first_comment: '' };
  return out;
}

export const monthKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
export const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Group posts by the day they are planned for. Posts with no date go under ''.
export function byDay(items) {
  const m = new Map();
  for (const it of items) {
    const k = it.scheduled_at ? dayKey(it.scheduled_at) : '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  for (const list of m.values()) list.sort((a, b) => (a.scheduled_at || 0) - (b.scheduled_at || 0));
  return m;
}

// Counts for the strip above the planner.
export function summary(items) {
  const s = Object.fromEntries(statusIds.map((id) => [id, 0]));
  for (const it of items) if (s[it.status] != null) s[it.status] += 1;
  s.unscheduled = items.filter((i) => !i.scheduled_at && !['idea', 'posted'].includes(i.status)).length;
  s.waiting = s.review;
  return s;
}

// Starter ideas without Claude: services and cities from the profile, a content mix that fits a local business.
export const IDEA_KINDS = [
  ['Before and after', 'Show the job before and after. Say what was wrong and what you did.'],
  ['Meet the team', 'Introduce one person: name, role, what they like about the work.'],
  ['Customer win', 'A real customer result, with their permission. What they asked for, what changed.'],
  ['Quick tip', 'One useful tip a homeowner can use today. Keep it to three sentences.'],
  ['Common question', 'Answer a question customers ask all the time, in plain words.'],
  ['Behind the scenes', 'A day on a job site or in the shop. Real photos, no staging.'],
  ['Local love', 'Something happening in the area: an event, a neighbourhood, a local shop.'],
  ['Seasonal reminder', 'Something to do this time of year before it becomes a bigger problem.'],
];
export function templateIdeas(client, count = 8) {
  const list = (s) => String(s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const services = list(client.services); const cities = list(client.cities);
  const out = [];
  for (let i = 0; i < count; i++) {
    const [kind, how] = IDEA_KINDS[i % IDEA_KINDS.length];
    const service = services.length ? services[i % services.length] : (client.category || 'our work');
    const city = cities.length ? cities[i % cities.length] : '';
    out.push({ title: `${kind}: ${service}${city ? ` in ${city}` : ''}`, notes: how });
  }
  return out;
}

// Numbers for the client app and the monthly report. `items` are posts (the client's own list is already filtered to what they can see).
// A post counts once in the month it went out, and once per channel it went to.
export function progress(items, nowMs = Date.now(), months = 6) {
  const list = Array.isArray(items) ? items : [];
  const cur = monthKey(nowMs);
  const postedAt = (i) => i.posted_at || i.scheduled_at || i.updated_at || 0;
  const posted = list.filter((i) => i.status === 'posted');
  const perMonth = new Map();
  for (const i of posted) { const k = monthKey(postedAt(i)); perMonth.set(k, (perMonth.get(k) || 0) + 1); }
  const thisMonth = posted.filter((i) => monthKey(postedAt(i)) === cur);
  const byChannel = {};
  for (const i of thisMonth) for (const ch of i.channels || []) byChannel[ch] = (byChannel[ch] || 0) + 1;
  const upcoming = list.filter((i) => ['scheduled', 'approved'].includes(i.status))
    .sort((a, b) => (a.scheduled_at || 9e15) - (b.scheduled_at || 9e15));
  const last = [...posted].sort((a, b) => postedAt(b) - postedAt(a))[0] || null;
  return {
    month: cur,
    postedThisMonth: thisMonth.length,
    postedTotal: posted.length,
    byChannel: Object.entries(byChannel).map(([id, n]) => ({ id, label: PLATFORM[id]?.label || id, n })).sort((a, b) => b.n - a.n),
    waiting: list.filter((i) => i.status === 'review').length,
    changes: list.filter((i) => i.status === 'changes').length,
    upcoming: upcoming.length,
    next: upcoming[0] ? { id: upcoming[0].id, title: upcoming[0].title, scheduled_at: upcoming[0].scheduled_at, channels: upcoming[0].channels || [] } : null,
    last: last ? { id: last.id, title: last.title, at: postedAt(last) } : null,
    months: Array.from({ length: months }, (_, n) => { const k = shiftMonth(cur, n - (months - 1)); return { key: k, label: monthLabel(k).split(' ')[0].slice(0, 3), posted: perMonth.get(k) || 0 }; }),
  };
}
