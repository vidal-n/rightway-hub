// Pieces used by both the team view and the client app: reviews, posts, rankings, activity.
import { $, $$, esc, api, toast, copy, fmt, icon, busy, resizeImage, animateNumbers } from './core.js';
import { qrSvg } from '../js/qr.js';
import { createMap } from '../js/map.js';
import { gridStats } from '../js/grid.js';
import { leaderboard } from '../js/analysis.js';
import { trendCard, scanProgress, runScanNow } from './scans.js';

// ---------- activity ----------
export function feedHtml(items, empty = 'Nothing logged yet this month.') {
  if (!items.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="feed">${items.map((a) => `
    <li><span class="dot">${a.type === 'task' ? icon.check : icon.note}</span>
      <div><div>${esc(a.text)}</div>${a.link ? `<a class="small" href="${esc(a.link)}" target="_blank" rel="noopener">View</a>` : ''}</div>
      <span class="small">${esc(fmt.ago(a.at))}</span></li>`).join('')}</ul>`;
}

// ---------- reviews ----------
export async function renderReviews(el, clientId, { staff = false, clientName = '' } = {}) {
  el.innerHTML = '<div class="skeleton"></div>';
  let data;
  try { data = await api(`/api/clients/${clientId}/reviews`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const noLink = !data.reviewUrl;
  el.innerHTML = `
    <div class="stats">
      <div class="stat hero"><div class="stat-num" data-count="${data.totals.sent}">0</div><div class="stat-label">review requests sent</div></div>
      <div class="stat"><div class="stat-num" data-count="${data.totals.clicked}">0</div><div class="stat-label">customers opened the link</div></div>
      <div class="stat"><div class="stat-num" data-count="${data.totals.kitScans}">0</div><div class="stat-label">QR code scans</div></div>
    </div>
    ${noLink ? `<div class="card"><h3>Review link not set up yet</h3><p class="muted">${staff ? 'Add the Google place ID (or a review link) in the Profile tab.' : 'The Rightway team is setting this up.'}</p></div>` : `
    <div class="card">
      <div class="card-head"><h2>Ask a customer for a review</h2></div>
      <form id="rv-form" class="form-grid">
        <label class="field"><span>Customer name</span><input name="name" autocomplete="off" placeholder="e.g. Jose Perez" maxlength="120"></label>
        <label class="field"><span>Phone or email</span><input name="contact" autocomplete="off" placeholder="Mobile number or email" maxlength="200"></label>
        <div class="span-all channel">
          <button class="btn btn-mint" type="submit" data-ch="sms">${icon.msg}Text it</button>
          <button class="btn btn-ghost" type="submit" data-ch="email">${icon.mail}Email it</button>
          <button class="btn btn-ghost" type="submit" data-ch="share">${icon.share}Share</button>
        </div>
      </form>
      <p class="small" style="margin-top:12px">Texts send from your own phone. Ask every customer, not just the happy ones, and never offer anything in return. That keeps reviews from being filtered.</p>
    </div>
    <div class="card">
      <div class="kit">
        <div class="qr">${qrSvg(data.kitUrl, { title: 'Scan to leave a Google review' })}</div>
        <div>
          <h2>Counter QR code</h2>
          <p class="muted">Customers scan it with their phone camera and land on the Google review form. Print it for the counter, invoices, or truck.</p>
          <div class="row">
            <button class="btn btn-primary" type="button" id="rv-print">Print QR code</button>
            <button class="btn btn-ghost" type="button" id="rv-copy">Copy review link</button>
          </div>
        </div>
      </div>
    </div>`}
    <div class="card">
      <div class="card-head"><h2>Requests</h2></div>
      ${data.requests.length ? `<ul class="list">${data.requests.map((r) => `
        <li class="item"><span class="badge ${r.clicks ? '' : 'gray'}">${r.clicks ? 'Opened' : 'Sent'}</span>
          <div><div class="item-title">${esc(r.customer_name || 'Customer')}</div><div class="item-sub">${esc(r.channel)} · ${esc(fmt.ago(r.created_at))}</div></div>
          <span class="small">${r.clicks ? esc(fmt.ago(r.clicked_at)) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No requests yet.</p>'}
    </div>`;
  animateNumbers(el);
  if (noLink) return;

  $('#rv-copy', el).addEventListener('click', () => copy(data.reviewUrl, 'Review link copied'));
  $('#rv-print', el).addEventListener('click', () => printKit(data.kitUrl, clientName));
  let channel = 'sms';
  $$('[data-ch]', el).forEach((b) => b.addEventListener('click', () => { channel = b.dataset.ch; }));
  $('#rv-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const contact = form.contact.value.trim();
    if (channel === 'sms' && !contact) return toast('Add their mobile number to text it.', true);
    if (channel === 'email' && !contact.includes('@')) return toast('Add their email address to email it.', true);
    const btn = form.querySelector(`[data-ch="${channel}"]`);
    busy(btn, true);
    try {
      const r = await api(`/api/clients/${clientId}/reviews`, { method: 'POST', body: { name, contact, channel, sendNow: channel === 'email' && data.canEmail } });
      if (channel === 'sms') window.location.href = `sms:${encodeURIComponent(contact)}?&body=${encodeURIComponent(r.message)}`;
      else if (channel === 'email') {
        if (r.emailed) toast('Email sent');
        else window.location.href = `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.emailBody)}`;
      } else if (navigator.share) { try { await navigator.share({ text: r.message }); } catch { /* closed */ } } else copy(r.message, 'Message copied. Paste it anywhere.');
      form.reset();
      setTimeout(() => renderReviews(el, clientId, { staff, clientName }), 600);
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}

function printKit(url, name) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print.', true);
  w.document.write(`<!doctype html><title>Review QR</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px}svg{width:340px;height:340px}h1{font-size:30px;margin:0 0 6px}p{font-size:18px;color:#33433D}</style>
    <h1>${esc(name || 'Leave us a review')}</h1><p>Scan with your phone camera to leave us a Google review. Thank you!</p>${qrSvg(url)}<script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

// ---------- posts ----------
const STATUS = { draft: ['Needs approval', 'warn'], approved: ['Approved', ''], posted: ['Posted', ''], rejected: ['Not used', 'gray'] };

export async function renderPosts(el, clientId, { staff = false, ai = false } = {}) {
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>${staff ? 'New post' : 'Send us a photo to post'}</h2>${ai ? '<span class="badge">AI captions on</span>' : '<span class="badge gray">Template captions</span>'}</div>
      <form id="pf" class="form-grid">
        <label class="drop span-all" id="pf-drop">${icon.camera}<b>Take or choose a photo</b><span class="small">Jobs, team, before and after, storefront</span>
          <input type="file" name="photo" accept="image/*" hidden></label>
        <label class="field span-all"><span>What's in the photo? (optional)</span><textarea name="note" maxlength="1000" placeholder="e.g. New roof on a 2-story home in Hollywood, finished in one day"></textarea></label>
        <div class="span-all row end"><button class="btn btn-primary btn-xl" type="submit" id="pf-send">${icon.upload}${staff ? 'Create post' : 'Send to Rightway'}</button></div>
      </form>
      <p class="small" style="margin-top:10px">We write the Google, Facebook, and Instagram captions with your services and cities worked in naturally. ${staff ? '' : 'You approve it, then we post it.'}</p>
    </div>
    <div id="pl" class="posts"></div>`;
  const form = $('#pf', el);
  const drop = $('#pf-drop', el);
  const input = form.photo;
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    drop.innerHTML = `<img src="${url}" alt="Selected photo"><span class="small">Tap to change</span>`;
    drop.appendChild(input);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    const file = input.files[0];
    if (file) fd.set('photo', await resizeImage(file));
    fd.set('note', form.note.value.trim());
    if (!file && !form.note.value.trim()) return toast('Add a photo or a note.', true);
    const btn = $('#pf-send', el);
    busy(btn, true, 'Writing captions...');
    try {
      await api(`/api/clients/${clientId}/posts`, { method: 'POST', form: fd });
      toast(staff ? 'Post created' : 'Sent! We will take it from here.');
      renderPosts(el, clientId, { staff, ai });
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  await loadPosts($('#pl', el), clientId, staff, () => renderPosts(el, clientId, { staff, ai }));
}

async function loadPosts(box, clientId, staff, refresh) {
  box.innerHTML = '<div class="skeleton"></div>';
  let posts;
  try { ({ posts } = await api(`/api/clients/${clientId}/posts`)); } catch (e) { box.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!posts.length) { box.innerHTML = '<div class="card empty"><h3>No posts yet</h3><p>Photos you send show up here with captions ready to go.</p></div>'; return; }
  box.innerHTML = posts.map((p) => postCard(p, staff)).join('');
  $$('.post', box).forEach((card) => wirePost(card, posts.find((p) => p.id === card.dataset.id), staff, refresh));
}

function postCard(p, staff) {
  const [label, tone] = STATUS[p.status] || ['Draft', 'gray'];
  const tags = safeJson(p.hashtags);
  const kws = safeJson(p.keywords);
  return `<article class="post" data-id="${esc(p.id)}">
    ${p.media_key ? `<div class="post-img"><img src="/api/media/${esc(p.id)}" alt="${esc(p.alt_text || 'Post photo')}" loading="lazy"></div>` : ''}
    <div class="post-body">
      <div class="row"><span class="badge ${tone}">${label}</span>${p.ai ? '<span class="badge gray">AI</span>' : ''}<span class="spacer"></span><span class="small">${esc(fmt.ago(p.created_at))}</span></div>
      ${p.note ? `<div class="small">Note: ${esc(p.note)}</div>` : ''}
      <div class="seg" role="tablist">
        <button type="button" class="on" data-net="google">Google</button><button type="button" data-net="facebook">Facebook</button><button type="button" data-net="instagram">Instagram</button>
      </div>
      ${staff ? `<textarea class="cap-edit" rows="7">${esc(p.google_text || '')}</textarea>` : `<div class="caption">${esc(p.google_text || '')}</div>`}
      ${kws.length ? `<div class="chips">${kws.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}
      ${tags.length ? `<div class="small">${tags.map(esc).join(' ')}</div>` : ''}
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-act="copy">Copy caption</button>
        ${p.media_key ? `<a class="btn btn-ghost btn-sm" href="/api/media/${esc(p.id)}?download=1">Download photo</a>` : ''}
        ${!staff && p.status === 'draft' ? '<button class="btn btn-primary btn-sm" data-act="approve">Approve</button>' : ''}
        ${staff ? `<button class="btn btn-ghost btn-sm" data-act="save">Save edits</button>
          <button class="btn btn-ghost btn-sm" data-act="regen">Rewrite</button>
          ${p.status === 'draft' ? '<button class="btn btn-ghost btn-sm" data-act="approve">Approve</button>' : ''}
          ${p.status !== 'posted' ? '<button class="btn btn-primary btn-sm" data-act="posted">Mark posted</button>' : ''}
          <button class="icon-btn" data-act="delete" title="Delete">${icon.trash}</button>` : ''}
      </div>
    </div></article>`;
}

function safeJson(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

function wirePost(card, p, staff, refresh) {
  let net = 'google';
  const texts = { google: p.google_text || '', facebook: p.facebook_text || '', instagram: p.instagram_text || '' };
  const area = $('.cap-edit', card);
  const view = $('.caption', card);
  $$('[data-net]', card).forEach((b) => b.addEventListener('click', () => {
    if (area) texts[net] = area.value;
    net = b.dataset.net;
    $$('[data-net]', card).forEach((x) => x.classList.toggle('on', x === b));
    if (area) area.value = texts[net]; else view.textContent = texts[net];
  }));
  card.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (area) texts[net] = area.value;
    const act = btn.dataset.act;
    try {
      if (act === 'copy') return copy(texts[net], `${net[0].toUpperCase()}${net.slice(1)} caption copied`);
      busy(btn, true);
      if (act === 'save') { await api(`/api/posts/${p.id}`, { method: 'PATCH', body: { google_text: texts.google, facebook_text: texts.facebook, instagram_text: texts.instagram } }); toast('Saved'); }
      if (act === 'regen') { await api(`/api/posts/${p.id}/regenerate`, { method: 'POST' }); toast('Rewritten'); return refresh(); }
      if (act === 'approve') { await api(`/api/posts/${p.id}`, { method: 'PATCH', body: { status: 'approved' } }); toast('Approved'); return refresh(); }
      if (act === 'posted') { await api(`/api/posts/${p.id}`, { method: 'PATCH', body: { status: 'posted' } }); toast('Marked as posted'); return refresh(); }
      if (act === 'delete') { if (!confirm('Delete this post?')) return; await api(`/api/posts/${p.id}`, { method: 'DELETE' }); return refresh(); }
    } catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
}

// ---------- rankings ----------
export async function renderRankings(el, clientId, { staff = false } = {}) {
  el.innerHTML = '<div class="skeleton"></div>';
  let scans;
  try { ({ scans } = await api(`/api/clients/${clientId}/scans`)); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const prog = staff ? '<div id="rk-prog"></div>' : await import('./reports.js').then((m) => m.clientReportsCard(clientId)).catch(() => '');
  if (!scans.length) {
    el.innerHTML = `${prog}<div class="card empty"><h3>No ranking scans yet</h3><p>${staff ? 'Run a scan now, or turn on monthly scans in Settings.' : 'Your first map scan shows up here.'}</p>
      ${staff ? `<div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="rk-run">${icon.scan}Run scan now</button><a class="btn btn-ghost" href="/scan.html?client=${esc(clientId)}">Open the scan tool</a></div>` : ''}</div>`;
  } else {
    el.innerHTML = `${prog}${trendCard(scans)}
    <div class="card" id="rk-view"><div class="skeleton"></div></div>
    <div class="card">
      <div class="card-head"><h2>All scans</h2>${staff ? `<div class="row" style="gap:8px"><button class="btn btn-ghost btn-sm" id="rk-run">${icon.scan}Run scan now</button><a class="btn btn-primary btn-sm" href="/scan.html?client=${esc(clientId)}">New scan</a></div>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Keyword</th><th>Top 3 coverage</th><th>Avg rank</th><th>At address</th></tr></thead>
      <tbody>${scans.map((s, i) => `<tr data-scan="${esc(s.id)}" style="cursor:pointer"${i === 0 ? ' class="is-you"' : ''}>
        <td>${esc(fmt.date(s.created_at))}</td><td>${esc(s.keyword)}</td><td>${s.top3Pct ?? '-'}%</td><td>${s.avgRank ?? '-'}</td><td>${s.centerRank ? `#${s.centerRank}` : '20+'}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  }
  if (staff) {
    const again = () => renderRankings(el, clientId, { staff });
    scanProgress($('#rk-prog', el), clientId, again);
    $('#rk-run', el)?.addEventListener('click', async (e) => { if (await runScanNow(clientId, e.currentTarget)) scanProgress($('#rk-prog', el), clientId, again); });
  }
  if (!scans.length) return;
  const show = async (id) => {
    $$('tr[data-scan]', el).forEach((tr) => tr.classList.toggle('is-you', tr.dataset.scan === id));
    const view = $('#rk-view', el);
    view.innerHTML = '<div class="skeleton"></div>';
    try {
      const { scan } = await api(`/api/scans/${id}`);
      const s = gridStats(scan.points);
      const board = leaderboard(scan.points, scan.target, 5);
      const rows = [board.target, ...board.rows].filter(Boolean).sort((a, b) => b.top3Points - a.top3Points || a.avgRank - b.avgRank).slice(0, 6);
      view.innerHTML = `
        <div class="card-head"><div><p class="eyebrow">Map scan, ${esc(fmt.date(Date.parse(scan.createdAt)))}</p><h2>"${esc(scan.keyword)}"</h2></div>
          <span class="badge gray">${scan.size} x ${scan.size}, ${scan.radius} mi</span></div>
        <div class="split">
          <div><div id="rk-map"></div>
            <div class="legend"><span><i style="background:#23B07E"></i>Top 3</span><span><i style="background:#F2B544"></i>4 to 10</span><span><i style="background:#E8833A"></i>11 to 20</span><span><i style="background:#D64545"></i>Not in top 20</span></div></div>
          <div>
            <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
              <div class="stat hero"><div class="stat-num" data-count="${s.top3Pct}" data-suffix="%">0</div><div class="stat-label">of the area sees you in the top 3</div></div>
              <div class="stat"><div class="stat-num" data-count="${s.avgRank ?? 0}" data-dec="1">0</div><div class="stat-label">average rank</div></div>
              <div class="stat"><div class="stat-num" data-count="${s.top10Pct}" data-suffix="%">0</div><div class="stat-label">on the first page</div></div>
              <div class="stat"><div class="stat-num">${s.centerRank ? `#${s.centerRank}` : '20+'}</div><div class="stat-label">at your address</div></div>
            </div>
            <h3>Who holds the top 3</h3>
            <div class="table-wrap"><table><thead><tr><th>Business</th><th>Top 3 share</th><th>Reviews</th></tr></thead>
              <tbody>${rows.map((b) => `<tr class="${b.isTarget ? 'is-you' : ''}"><td>${esc(b.title)}${b.isTarget ? ' (you)' : ''}</td><td>${b.sov}%</td><td>${fmt.int(b.reviews)}</td></tr>`).join('')}</tbody></table></div>
          </div>
        </div>`;
      createMap($('#rk-map', view), scan.points, {});
      animateNumbers(view);
    } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
  };
  $$('tr[data-scan]', el).forEach((tr) => tr.addEventListener('click', () => show(tr.dataset.scan)));
  show(scans[0].id);
}
