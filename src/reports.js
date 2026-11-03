// Monthly client reports. A report is a snapshot (rankings now vs before and vs where they started, reviews, work done,
// posts, QR scans, what comes next) saved per client per month, shown at a private link /report.html#<token>,
// and emailed to the client when the team sends it. Made automatically when a client's monthly scans finish.
import { HttpError, json } from './util.js';
import { all, first, run, newId, token, now } from './db.js';
import { requireStaff, requireClientAccess } from './auth.js';
import { route } from './router.js';
import { PLANS, monthKey } from './plans.js';
import { canEmail, sendEmail } from './email.js';
import { leaderboard } from '../public/js/analysis.js';
import { callStats } from './calltrack.js';
import { linksForMonth } from './citations.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const range = (m) => { const [y, mo] = m.split('-').map(Number); return [Date.UTC(y, mo - 1, 1), Date.UTC(y, mo, 1)]; };
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const KIND = {
  setup: 'Setup', post: 'Google posts', photos: 'Photos', replies: 'Review replies', qa: 'Q&A', page: 'Local pages', content: 'Content',
  link: 'Links and citations', onpage: 'Website fixes', technical: 'Technical and schema', competitors: 'Competitor checks', calls: 'Calls and leads',
  monitor: 'Review monitoring', reputation: 'Reputation', reviews: 'Reviews', report: 'Report', meeting: 'Meeting', planning: 'Quarterly plan', custom: 'Other',
};
const splitList = (t) => String(t || '').split(/[,\n;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// Ranks only, row by row: a number 1 to 20, 0 = not in the top 20, -1 = no answer for that spot.
const ranksOf = (points) => points.map((p) => (p.status === 'done' ? (p.rank ?? 0) : -1));
function snap(row, data) {
  const s = JSON.parse(row.summary || '{}');
  return {
    date: row.created_at, size: s.size ?? data?.size ?? null, radius: s.radius ?? data?.radius ?? null,
    top3Pct: s.top3Pct ?? 0, top10Pct: s.top10Pct ?? 0, avgRank: s.avgRank ?? null, centerRank: s.centerRank ?? null,
    ranks: data?.points ? ranksOf(data.points) : null,
  };
}
const loadData = async (env, id) => { const r = await first(env, 'SELECT data FROM scans WHERE id = ?', id); try { return r?.data ? JSON.parse(r.data) : null; } catch { return null; } };

export async function buildReport(env, client, month) {
  const [a, b] = range(month);
  const rows = await all(env, 'SELECT id, keyword, created_at, summary FROM scans WHERE client_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 300', client.id, b);
  const groups = new Map();
  for (const r of rows) {
    const k = String(r.keyword || '').toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  // Keywords on the profile first, then ones scanned this month, newest first. Up to 5.
  const wanted = splitList(client.keywords);
  const order = [...groups.keys()].sort((x, y) => {
    const wx = wanted.indexOf(x), wy = wanted.indexOf(y);
    const inX = groups.get(x)[0].created_at >= a, inY = groups.get(y)[0].created_at >= a;
    return (wx < 0) - (wy < 0) || (wx >= 0 && wy >= 0 ? wx - wy : 0) || inY - inX || groups.get(y)[0].created_at - groups.get(x)[0].created_at;
  }).slice(0, 5);

  const keywords = [];
  let leadData = null;
  let startTarget = null;
  for (const k of order) {
    const list = groups.get(k);
    const nowRow = list[0];
    const before = list[1] || null;
    const start = list.length > 2 ? list[list.length - 1] : before;
    const nowData = await loadData(env, nowRow.id);
    const startData = start ? await loadData(env, start.id) : null;
    if (!leadData && nowData) { leadData = nowData; startTarget = startData?.target || null; }
    keywords.push({
      keyword: nowRow.keyword, inMonth: nowRow.created_at >= a,
      now: snap(nowRow, nowData),
      before: before ? snap(before, null) : null,
      start: start ? snap(start, startData) : null,
      startIsBefore: Boolean(start && before && start.id === before.id),
    });
  }

  let leaders = [];
  if (leadData?.points && leadData.target) {
    const lb = leaderboard(leadData.points, leadData.target, 3);
    leaders = [lb.target, ...lb.rows].filter(Boolean).sort((x, y) => y.top3Points - x.top3Points || x.avgRank - y.avgRank).slice(0, 4)
      .map((r) => ({ title: r.title, sov: r.sov, isTarget: Boolean(r.isTarget), reviews: r.reviews ?? null, rating: r.rating ?? null }));
  }

  const tracked = await first(env, 'SELECT COUNT(*) AS n FROM tracking_numbers WHERE client_id = ? AND created_at < ?', client.id, b).catch(() => null);
  const calls = tracked?.n ? await callStats(env, client.id, a, b) : null;
  const links = await linksForMonth(env, client.id, a, b);
  const [rr, tasks, posts, qr] = await Promise.all([
    first(env, 'SELECT COUNT(*) AS sent, SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END) AS clicked FROM review_requests WHERE client_id = ? AND created_at >= ? AND created_at < ?', client.id, a, b),
    all(env, 'SELECT kind, title, status, client_visible FROM tasks WHERE client_id = ? AND month = ? ORDER BY sort, created_at', client.id, month),
    first(env, 'SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND posted_at >= ? AND posted_at < ?', client.id, a, b),
    first(env, 'SELECT COUNT(*) AS n FROM kit_scans WHERE client_id = ? AND at >= ? AND at < ?', client.id, a, b),
  ]);
  const done = tasks.filter((t) => t.status === 'done');
  const byKind = new Map();
  for (const t of done) byKind.set(t.kind, (byKind.get(t.kind) || 0) + 1);
  const plan = PLANS[client.plan] || null;

  return {
    v: 1, month, monthLabel: monthLabel(month), at: now(),
    client: { name: client.name, plan: client.plan, planName: plan?.name || client.plan, city: (String(client.address || '').split(',').slice(-2, -1)[0] || '').trim() },
    keywords,
    reviews: {
      rating: leadData?.target?.rating ?? null, count: leadData?.target?.reviews ?? null,
      startRating: startTarget?.rating ?? null, startCount: startTarget?.reviews ?? null,
      requestsSent: rr?.sent || 0, requestsClicked: rr?.clicked || 0,
    },
    leaders,
    work: {
      done: done.length, total: tasks.length,
      byKind: [...byKind.entries()].map(([kind, n]) => ({ kind, label: KIND[kind] || kind, n })).sort((x, y) => y.n - x.n),
      items: done.filter((t) => t.client_visible).slice(0, 14).map((t) => t.title),
    },
    posts: posts?.n || 0,
    qrScans: qr?.n || 0,
    calls,
    links,
    next: plan ? plan.monthly.map(([, title, n]) => (n > 1 ? `${n} x ${title}` : title)) : [],
  };
}

// Create or refresh the report for a month. A report already sent is left alone unless force is set.
export async function saveReport(env, client, month, { force = false } = {}) {
  const existing = await first(env, 'SELECT * FROM reports WHERE client_id = ? AND month = ?', client.id, month);
  if (existing && existing.status === 'sent' && !force) return existing;
  const data = JSON.stringify(await buildReport(env, client, month));
  if (existing) {
    await run(env, 'UPDATE reports SET data = ?, updated_at = ? WHERE id = ?', data, now(), existing.id);
    return first(env, 'SELECT * FROM reports WHERE id = ?', existing.id);
  }
  const id = newId('rp_');
  await run(env, "INSERT INTO reports (id, client_id, month, token, data, status, views, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', 0, ?, ?)",
    id, client.id, month, token(18), data, now(), now());
  return first(env, 'SELECT * FROM reports WHERE id = ?', id);
}

// ---------- email ----------
const fmtChange = (a, b, lowerBetter = false, unit = '') => {
  if (a == null || b == null || a === b) return '';
  const better = lowerBetter ? a < b : a > b;
  return ` (${better ? 'up' : 'down'} from ${b}${unit})`;
};
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function reportEmail(rep, url, note = '') {
  const d = rep;
  const first = (d.client.name || '').split(' ')[0];
  const kwRows = d.keywords.map((k) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #DCE6E1">${h(k.keyword)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #DCE6E1;text-align:right"><b>${k.now.top3Pct}%</b>${h(fmtChange(k.now.top3Pct, k.before?.top3Pct, false, '%'))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #DCE6E1;text-align:right">${k.now.centerRank ? `#${k.now.centerRank}` : '20+'}</td></tr>`).join('');
  const text = [
    `Your ${d.monthLabel} report from Rightway Growth`, '',
    note ? `${note}\n` : '',
    ...d.keywords.map((k) => `${k.keyword}: top 3 in ${k.now.top3Pct}% of your area${fmtChange(k.now.top3Pct, k.before?.top3Pct, false, '%')}, ${k.now.centerRank ? `#${k.now.centerRank}` : 'not in the top 20'} at your address`),
    d.reviews.count != null ? `Google reviews: ${d.reviews.count}${d.reviews.rating ? ` (${d.reviews.rating} stars)` : ''}` : '',
    d.calls ? `Calls: ${d.calls.total} (${d.calls.firstTime} new callers, ${d.calls.missed} missed)` : '',
    `Work done this month: ${d.work.done} task${d.work.done === 1 ? '' : 's'}${d.posts ? `, ${d.posts} Google post${d.posts === 1 ? '' : 's'}` : ''}`,
    '', `See the full report: ${url}`, '', 'Rightway Growth',
  ].filter((l) => l !== '').join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F3F7F5;font-family:Arial,Helvetica,sans-serif;color:#0F1B17">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0F1B17;color:#fff;border-radius:16px 16px 0 0;padding:22px 24px">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9DEBCB">Rightway Growth</div>
      <div style="font-size:24px;font-weight:700;margin-top:6px">${h(d.monthLabel)} report</div>
      <div style="font-size:15px;color:#CFE9DD;margin-top:4px">${h(d.client.name)}</div>
    </div>
    <div style="background:#fff;border:1px solid #DCE6E1;border-top:0;border-radius:0 0 16px 16px;padding:22px 24px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.5">Hi${first ? ` ${h(first)}` : ''}, here is how your Google Maps visibility moved this month.</p>
      ${note ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;background:#EAF8F1;border-radius:10px;padding:12px 14px">${h(note).replace(/\n/g, '<br>')}</p>` : ''}
      ${d.keywords.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>
        <th style="text-align:left;padding:6px 10px;color:#5B6B65;font-weight:600;font-size:12px">Search</th>
        <th style="text-align:right;padding:6px 10px;color:#5B6B65;font-weight:600;font-size:12px">Top 3 coverage</th>
        <th style="text-align:right;padding:6px 10px;color:#5B6B65;font-weight:600;font-size:12px">At your address</th></tr></thead><tbody>${kwRows}</tbody></table>` : ''}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#33443E">
        ${d.reviews.count != null ? `Google reviews: <b>${d.reviews.count}</b>${d.reviews.rating ? `, ${d.reviews.rating} stars` : ''}<br>` : ''}
        ${d.calls ? `Calls: <b>${d.calls.total}</b> (${d.calls.firstTime} new caller${d.calls.firstTime === 1 ? '' : 's'}, ${d.calls.missed} missed)<br>` : ''}
        Work done this month: <b>${d.work.done}</b> task${d.work.done === 1 ? '' : 's'}${d.posts ? `, <b>${d.posts}</b> Google post${d.posts === 1 ? '' : 's'}` : ''}</p>
      <p style="margin:22px 0 4px"><a href="${h(url)}" style="display:inline-block;background:#0F1B17;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">See the full report</a></p>
    </div>
    <p style="font-size:12px;color:#5B6B65;text-align:center;margin-top:14px">Rightway Growth, Hollywood FL</p>
  </div></body></html>`;
  return { subject: `Your ${d.monthLabel} Google Maps report`, text, html };
}

async function markSent(env, rep, { to = null, by = null } = {}) {
  await run(env, "UPDATE reports SET status = 'sent', sent_at = ?, sent_to = ?, sent_by = ? WHERE id = ?", now(), to, by, rep.id);
  // The report is also the lead report when it has tracked calls.
  const kinds = JSON.parse(rep.data || '{}').calls ? "('report','calls')" : "('report')";
  await run(env, `UPDATE tasks SET status = 'done', done_at = ?, done_by = ? WHERE client_id = ? AND month = ? AND kind IN ${kinds} AND status != 'done'`, now(), by, rep.client_id, rep.month);
  await run(env, 'INSERT INTO log (id, client_id, text, link, at, by) VALUES (?, ?, ?, ?, ?, ?)', newId('l_'), rep.client_id,
    `${monthLabel(rep.month)} report sent${to ? ` to ${to}` : ''}`, `/report.html#${rep.token}`, now(), by);
}

export async function sendReport(env, rep, { to, origin, by = null, fetchImpl } = {}) {
  const data = JSON.parse(rep.data);
  const url = `${origin}/report.html#${rep.token}`;
  const mail = reportEmail(data, url, rep.note || '');
  await sendEmail(env, { to, ...mail }, fetchImpl);
  await markSent(env, rep, { to, by });
  return url;
}

// After a client's scans finish: refresh this month's draft, and send it if the owner turned on automatic sending.
export async function autoReport(env, clientId, at, { autoSend = false, origin = null } = {}) {
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', clientId);
  if (!c || c.sample) return null;
  const rep = await saveReport(env, c, monthKey(new Date(at)));
  if (autoSend && rep.status !== 'sent' && c.contact_email && canEmail(env) && origin) {
    try { await sendReport(env, rep, { to: c.contact_email, origin }); } catch (e) { console.error('report email', e); }
  }
  return rep;
}

// ---------- routes ----------
const out = (r, staff) => {
  const d = JSON.parse(r.data || '{}');
  return {
    id: r.id, month: r.month, monthLabel: monthLabel(r.month), status: r.status, url: `/report.html#${r.token}`,
    views: staff ? r.views : undefined, sent_at: r.sent_at || null, sent_to: staff ? r.sent_to : undefined, note: staff ? r.note || '' : undefined,
    updated_at: r.updated_at, keywords: (d.keywords || []).length, work: d.work?.done ?? 0,
  };
};

route('GET', '/api/clients/:id/reports', async ({ env, user, params }) => {
  requireClientAccess(user, params.id);
  const staff = user.role !== 'client';
  const rows = await all(env, `SELECT * FROM reports WHERE client_id = ? ${staff ? '' : "AND status = 'sent'"} ORDER BY month DESC LIMIT 36`, params.id);
  return json({ reports: rows.map((r) => out(r, staff)), email: canEmail(env) });
});

route('POST', '/api/clients/:id/reports', async ({ env, user, params, body }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM clients WHERE id = ?', params.id);
  if (!c) throw new HttpError('Client not found.', 404);
  const b = await body();
  const month = b.month || monthKey();
  if (!validMonth(month)) throw new HttpError('Pick a month.');
  const r = await saveReport(env, c, month, { force: Boolean(b.refresh) });
  return json({ report: out(r, true) });
});

route('PATCH', '/api/reports/:id', async ({ env, user, params, body }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT * FROM reports WHERE id = ?', params.id);
  if (!r) throw new HttpError('Report not found.', 404);
  const b = await body();
  if ('note' in b) await run(env, 'UPDATE reports SET note = ?, updated_at = ? WHERE id = ?', String(b.note || '').slice(0, 2000), now(), r.id);
  return json({ report: out(await first(env, 'SELECT * FROM reports WHERE id = ?', r.id), true) });
});

route('POST', '/api/reports/:id/send', async ({ env, user, params, body, url }) => {
  requireStaff(user);
  const r = await first(env, 'SELECT * FROM reports WHERE id = ?', params.id);
  if (!r) throw new HttpError('Report not found.', 404);
  const b = await body();
  if (b.manual) { await markSent(env, r, { by: user.id }); return json({ ok: true, emailed: false }); }
  const to = String(b.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError('Enter the email address to send it to.');
  if (!canEmail(env)) throw new HttpError('Email is not set up yet. Copy the link and send it yourself, then mark it as sent.', 400);
  await sendReport(env, r, { to, origin: url.origin, by: user.id });
  return json({ ok: true, emailed: true });
});

route('DELETE', '/api/reports/:id', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'DELETE FROM reports WHERE id = ?', params.id);
  return json({ ok: true });
});

// The private report page. Anyone with the link can open it (like a shared doc), so the token is long and random.
route('GET', '/api/public/report/:token', async ({ env, params }) => {
  const r = await first(env, 'SELECT * FROM reports WHERE token = ?', params.token);
  if (!r) throw new HttpError('This report link is not valid.', 404);
  await run(env, 'UPDATE reports SET views = views + 1 WHERE id = ?', r.id);
  return json({ report: JSON.parse(r.data), note: r.note || '', status: r.status });
}, { public: true });
