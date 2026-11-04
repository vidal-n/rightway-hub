// Gmail inside the Hub. Every call uses the asking person's own Google account, so nobody reads anyone else's mail.
// Threads, labels, search, read, send, reply, archive, star, trash and attachments, plus the Hub bits that make it
// worth having here: a thread shows the lead or client it belongs to, and mail you send is logged on their timeline.
import { HttpError, json } from './util.js';
import { all } from './db.js';
import { requireStaff } from './auth.js';
import { route } from './router.js';
import { accessToken, hasScope, APP_SCOPES } from './google.js';
import { ownFor } from './googleapps.js';
import { logActivity } from './crm.js';
import { threadRow, fullMessage, buildRaw, addrList, labelName } from '../public/js/gmailparse.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Cloudflare caps how many outside calls one request may make, so a page of threads stays small.
const PAGE = 20;

async function gmail(env, row, path, { method = 'GET', body, raw = false } = {}) {
  const t = await accessToken(env, row);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new HttpError('Gmail needs to be turned on again on the Google page.', 400);
    throw new HttpError(`Gmail: ${msg}`, res.status === 401 || res.status === 403 ? 400 : 502);
  }
  return data;
}

// Leads and clients that share an address with this thread, so mail is tied to the pipeline.
async function matchPeople(env, emails) {
  const list = [...new Set((emails || []).map((e) => String(e || '').toLowerCase()).filter(Boolean))].slice(0, 25);
  if (!list.length) return { leads: [], clients: [] };
  const marks = list.map(() => '?').join(',');
  const [leads, clients] = await Promise.all([
    all(env, `SELECT id, business, contact_name, email, stage FROM leads WHERE lower(email) IN (${marks}) LIMIT 5`, ...list),
    all(env, `SELECT id, name, contact_name, contact_email FROM clients WHERE lower(contact_email) IN (${marks}) LIMIT 5`, ...list),
  ]);
  return { leads, clients };
}

route('GET', '/api/google/mail/labels', async ({ env, user }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const d = await gmail(env, me, '/labels');
  const labels = (d.labels || [])
    .filter((l) => l.labelListVisibility !== 'labelHide' && l.id !== 'CHAT')
    .map((l) => ({ id: l.id, name: labelName(l), system: l.type === 'system' }));
  return json({ labels, email: me.google_email || null });
});

route('GET', '/api/google/mail/threads', async ({ env, user, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const label = url.searchParams.get('label') || 'INBOX';
  const q = (url.searchParams.get('q') || '').slice(0, 300);
  const cursor = url.searchParams.get('cursor') || '';
  const params = new URLSearchParams({ maxResults: String(PAGE) });
  if (label && label !== 'ALL') params.set('labelIds', label);
  if (q) params.set('q', q);
  if (cursor) params.set('pageToken', cursor);
  const list = await gmail(env, me, `/threads?${params}`);
  const ids = (list.threads || []).map((t) => t.id);
  const metaParams = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';
  const full = await Promise.all(ids.map((id) => gmail(env, me, `/threads/${id}?${metaParams}`).catch(() => null)));
  const rows = full.filter(Boolean).map((t) => threadRow(t, me.google_email));
  return json({ threads: rows, cursor: list.nextPageToken || null, email: me.google_email || null });
});

route('GET', '/api/google/mail/threads/:id', async ({ env, user, params, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const t = await gmail(env, me, `/threads/${params.id}?format=full`);
  const messages = (t.messages || []).map(fullMessage);
  if (url.searchParams.get('read') !== '0' && messages.some((m) => m.labels.includes('UNREAD'))) {
    await gmail(env, me, `/threads/${params.id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } }).catch(() => {});
    messages.forEach((m) => { m.labels = m.labels.filter((l) => l !== 'UNREAD'); });
  }
  const who = await matchPeople(env, messages.flatMap((m) => [...addrList(m.from), ...addrList(m.to), ...addrList(m.cc)]).map((a) => a.email));
  return json({ id: t.id, messages, me: me.google_email || null, ...who });
});

route('POST', '/api/google/mail/threads/:id/modify', async ({ env, user, params, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const b = await body();
  const ok = (x) => Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, 10) : [];
  await gmail(env, me, `/threads/${params.id}/modify`, { method: 'POST', body: { addLabelIds: ok(b.add), removeLabelIds: ok(b.remove) } });
  return json({ ok: true });
});

route('POST', '/api/google/mail/threads/:id/trash', async ({ env, user, params }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  await gmail(env, me, `/threads/${params.id}/trash`, { method: 'POST' });
  return json({ ok: true });
});

route('POST', '/api/google/mail/send', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const b = await body();
  const to = addrList(b.to);
  if (!to.length) throw new HttpError('Who is this going to?');
  const files = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10)
    .map((f) => ({ name: String(f.name || 'file').slice(0, 120), type: String(f.type || 'application/octet-stream').slice(0, 100), data: String(f.data || '') }));
  const bytes = files.reduce((n, f) => n + f.data.length * 0.75, 0);
  if (bytes > 6e6) throw new HttpError('Those files add up to more than 6 MB. Send a Drive link instead.');
  const raw = buildRaw({
    from: me.google_email ? `${user.name || ''} <${me.google_email}>` : '',
    to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html,
    inReplyTo: b.inReplyTo, references: b.references, attachments: files,
  });
  const sent = await gmail(env, me, '/messages/send', { method: 'POST', body: { raw, ...(b.threadId ? { threadId: b.threadId } : {}) } });
  // Mail to a lead or a client shows up on their timeline, so the history is in one place.
  const who = await matchPeople(env, to.map((a) => a.email));
  const line = `Email: ${String(b.subject || '(no subject)').slice(0, 120)}`;
  for (const l of who.leads) await logActivity(env, { lead_id: l.id, type: 'email', body: line, by: user.id });
  for (const c of who.clients) await logActivity(env, { client_id: c.id, type: 'email', body: line, by: user.id });
  return json({ ok: true, id: sent.id, threadId: sent.threadId, logged: who.leads.length + who.clients.length });
});

route('GET', '/api/google/mail/att/:msgId/:attId', async ({ env, user, params, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const d = await gmail(env, me, `/messages/${params.msgId}/attachments/${params.attId}`);
  const s = String(d.data || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const name = (url.searchParams.get('name') || 'attachment').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return new Response(bytes, {
    headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
});

// Addresses to suggest while composing: the Hub's own leads, clients and teammates.
route('GET', '/api/google/mail/people', async ({ env, user, url }) => {
  requireStaff(user);
  const q = `%${(url.searchParams.get('q') || '').toLowerCase().slice(0, 60)}%`;
  const [leads, clients, team] = await Promise.all([
    all(env, "SELECT business AS name, contact_name, email FROM leads WHERE email IS NOT NULL AND email != '' AND (lower(business) LIKE ? OR lower(email) LIKE ? OR lower(contact_name) LIKE ?) LIMIT 8", q, q, q),
    all(env, "SELECT name, contact_name, contact_email AS email FROM clients WHERE contact_email IS NOT NULL AND contact_email != '' AND (lower(name) LIKE ? OR lower(contact_email) LIKE ?) LIMIT 8", q, q),
    all(env, "SELECT name, email FROM users WHERE email LIKE ? OR lower(name) LIKE ? LIMIT 5", q, q),
  ]);
  const out = [
    ...leads.map((l) => ({ email: l.email, name: l.contact_name || l.name, note: l.name, kind: 'Lead' })),
    ...clients.map((c) => ({ email: c.email, name: c.contact_name || c.name, note: c.name, kind: 'Client' })),
    ...team.map((t) => ({ email: t.email, name: t.name, note: 'Rightway Growth', kind: 'Team' })),
  ];
  const seen = new Set();
  return json({ people: out.filter((p) => p.email && !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase())).slice(0, 12) });
});

// Unread count for the menu dot.
export async function mailUnread(env, userRow) {
  if (!userRow?.google_token) return 0;
  try {
    const d = await gmail(env, userRow, '/labels/INBOX');
    return Number(d.threadsUnread || 0);
  } catch { return 0; }
}

// Everything this person has mailed with a lead or client, for the client and lead pages.
route('GET', '/api/google/mail/with', async ({ env, user, url }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new HttpError('Which address?');
  const list = await gmail(env, me, `/threads?${new URLSearchParams({ q: `from:${email} OR to:${email}`, maxResults: '8' })}`);
  const ids = (list.threads || []).map((t) => t.id);
  const metaParams = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';
  const full = await Promise.all(ids.map((id) => gmail(env, me, `/threads/${id}?${metaParams}`).catch(() => null)));
  return json({ threads: full.filter(Boolean).map((t) => threadRow(t, me.google_email)) });
});

// Keep an attachment: it goes straight into Drive, no download and re-upload by hand.
route('POST', '/api/google/mail/att/:msgId/:attId/drive', async ({ env, user, body }) => {
  requireStaff(user);
  const me = await ownFor(env, user, 'mail');
  const b = await body();
  const d = await gmail(env, me, `/messages/${encodeURIComponent(b.msgId || '')}/attachments/${encodeURIComponent(b.attId || '')}`);
  const { saveToDrive } = await import('./gdrive.js');
  const file = await saveToDrive(env, user, { name: b.name || 'attachment', mime: b.type || 'application/octet-stream', b64: d.data, parent: b.parent });
  return json({ file });
});

// Send one message from a person's own Gmail (used when email through Resend is not set up). Returns false if they have no Gmail access.
export async function sendGmail(env, userRow, { to, subject, html, text }) {
  if (!userRow?.google_token || !hasScope(userRow.google_scopes, APP_SCOPES.mail)) return false;
  const raw = buildRaw({ from: userRow.google_email ? `${userRow.name || 'Rightway Growth'} <${userRow.google_email}>` : '', to: Array.isArray(to) ? to.join(', ') : to, subject, html, text });
  await gmail(env, userRow, '/messages/send', { method: 'POST', body: { raw } });
  return true;
}
