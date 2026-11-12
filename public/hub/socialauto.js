// Social autopilot screens: the Autopilot card and "Ready to post" list in a client's Social tab, and the team wide
// "Posts to publish" page (My work, Posts). Nothing here posts anywhere. A person checks each post, copies it, puts it
// up by hand and marks it posted. The Hub then learns which kinds of posts bring leads.
import { $, $$, esc, api, toast, copy, modal, busy } from './core.js';
import { PLATFORM } from '../js/social.js';
import { ZONE_CHOICES } from '../js/apptime.js';

const when = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayName = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const chans = (ids = []) => ids.map((i) => `<span class="sp-ch" title="${esc(PLATFORM[i]?.label || i)}">${esc(PLATFORM[i]?.short || i)}</span>`).join('');

function groupLabel(ms, now) {
  if (ms < now - 3600e3) return 'Overdue';
  if (sameDay(ms, now)) return 'Today';
  if (sameDay(ms, now + 86400e3)) return 'Tomorrow';
  return dayName(ms);
}

// ---------- the list of posts waiting for a person ----------
export function queueHtml(items, { showClient = false } = {}) {
  if (!items.length) return '<p class="muted">Nothing is waiting. Stack the calendar to fill it.</p>';
  const now = Date.now();
  const groups = [];
  for (const it of items) {
    const label = groupLabel(it.scheduled_at, now);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(it); else groups.push({ label, items: [it] });
  }
  const state = (it) => (it.left.length ? `<span class="badge bad" title="${esc(it.left.join(' '))}">${esc(/photo|video/i.test(it.left.join(' ')) ? 'Needs a photo' : 'Needs a fix')}</span>`
    : it.auto && !it.verified ? '<span class="badge warn">Check it</span>' : '<span class="badge">Ready to post</span>');
  return groups.map((g) => `<h3 class="sq-day${g.label === 'Overdue' ? ' is-late' : ''}">${esc(g.label)}</h3><ul class="list">${g.items.map((it) => `<li class="item sq-row" data-id="${esc(it.id)}">
      <div class="sq-main">
        <div class="item-title">${showClient ? `<a href="#/client/${esc(it.client_id)}/social" data-stop>${esc(it.client_name)}</a>: ` : ''}${esc(it.title || 'Untitled post')}</div>
        <div class="item-sub">${esc(when(it.scheduled_at))} ${chans(it.channels)} ${state(it)}</div>
        ${it.left.length ? `<div class="small muted">${esc([...new Set(it.left.map((x) => x.replace(/^[a-z]+: /, '')))].slice(0, 2).join(' '))}</div>` : ''}
      </div>
      <div class="sq-actions">
        ${it.left.some((x) => /photo|video/i.test(x)) ? `<label class="btn btn-mint btn-sm">Add photo<input type="file" accept="image/*,video/*" multiple hidden data-up="${esc(it.id)}"></label>` : ''}
        ${it.channels.map((ch) => `<button class="btn btn-ghost btn-sm" data-copy="${esc(it.id)}:${esc(ch)}" title="Copy the ${esc(PLATFORM[ch]?.label || ch)} caption">Copy ${esc(PLATFORM[ch]?.short || ch)}</button>`).join('')}
        ${it.media.length ? `<a class="btn btn-ghost btn-sm" href="${esc(it.media[0].url)}?download=1">Photo</a>` : ''}
        ${it.auto && !it.verified ? `<button class="btn btn-mint btn-sm" data-verify="${esc(it.id)}"${it.left.length ? ' disabled' : ''}>Looks good</button>` : ''}
        <button class="btn btn-primary btn-sm" data-posted="${esc(it.id)}">Posted</button>
        <button class="btn btn-ghost btn-sm" data-skip="${esc(it.id)}" title="Delete this post">Skip</button>
      </div></li>`).join('')}</ul>`).join('');
}

export function wireQueue(host, items, { onChange, open } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  $$('[data-stop]', host).forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('[data-copy]', host).forEach((b) => b.addEventListener('click', () => {
    const [id, ch] = b.dataset.copy.split(':'); const it = byId.get(id);
    const text = it?.captions?.[ch]?.text || '';
    if (!text) { toast('No caption for that channel', true); return; }
    copy(text, `${PLATFORM[ch]?.label || ch} caption copied`);
  }));
  $$('[data-up]', host).forEach((inp) => inp.addEventListener('change', async () => {
    const files = [...inp.files]; if (!files.length) return;
    const fd = new FormData(); files.forEach((f) => fd.append('file', f));
    try { await api(`/api/social/${inp.dataset.up}/media`, { method: 'POST', form: fd }); toast('Photo added'); onChange?.(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-verify]', host).forEach((b) => b.addEventListener('click', async () => {
    busy(b, true);
    try { await api(`/api/social/${b.dataset.verify}/verify`, { method: 'POST', body: {} }); toast('Checked. It is ready to post.'); onChange?.(); } catch (e) { toast(e.message, true); busy(b, false); }
  }));
  $$('[data-skip]', host).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this post?')) return;
    try { await api(`/api/social/${b.dataset.skip}`, { method: 'DELETE' }); onChange?.(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-posted]', host).forEach((b) => b.addEventListener('click', () => {
    const it = byId.get(b.dataset.posted); if (!it) return;
    const m = modal(`<div class="card-head"><h2>Mark posted</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <p class="small muted">${esc(it.title)}. Paste the link to each post if you have it. It goes into the client's "What we did" and the monthly report.</p>
      <form id="sqpf" class="form-grid" style="grid-template-columns:1fr">${it.channels.map((ch) => `<label class="field"><span>${esc(PLATFORM[ch]?.label || ch)} link (optional)</span><input name="${esc(ch)}" placeholder="https://"></label>`).join('')}
      <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Mark posted</button></div></form>`);
    $('#sqpf', m.el).addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const btn = e.submitter; busy(btn, true);
      const links = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => /^https?:\/\//i.test(v)));
      try { await api(`/api/social/${it.id}`, { method: 'PATCH', body: { status: 'posted', post_links: links } }); m.close(); toast('Marked posted'); onChange?.(); } catch (err) { busy(btn, false); toast(err.message, true); }
    });
  }));
  if (open) $$('.sq-main', host).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('a,button')) return; open(el.closest('.sq-row').dataset.id); }));
}

// Posted in the last 3 weeks with no lead count yet. This is what teaches the autopilot which posts work.
export function scoreHtml(rows) {
  if (!rows.length) return '';
  return `<h3 style="margin:18px 0 6px">How did these do?</h3>
    <p class="small muted">Type how many calls, messages or quote requests each post brought. After 6 answers the autopilot gives more slots to the kinds that work.</p>
    <ul class="list">${rows.map((r) => `<li class="item"><div><div class="item-title">${esc(r.client_name)}: ${esc(r.title)}</div><div class="item-sub">${esc(r.pillar || '')} · posted ${esc(when(r.posted_at))}</div></div>
      <form class="row sq-score" data-score="${esc(r.id)}" style="gap:6px"><input type="number" min="0" max="1000" inputmode="numeric" name="n" placeholder="Leads" style="width:84px"><button class="btn btn-ghost btn-sm">Save</button></form></li>`).join('')}</ul>`;
}
export function wireScore(host, onChange) {
  $$('[data-score]', host).forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = f.n.value; if (v === '') return;
    try { await api(`/api/social/${f.dataset.score}/result`, { method: 'PUT', body: { leads: Number(v) } }); toast('Saved'); onChange?.(); } catch (err) { toast(err.message, true); }
  }));
}

// ---------- My work, Posts ----------
export async function postsView(view, user, tabs) {
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>Posts to publish</h1></div></div>${tabs}<div class="skeleton"></div>`;
  const load = async () => {
    let d;
    try { d = await api('/api/social/queue?days=7'); } catch (e) { view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>Posts to publish</h1></div></div>${tabs}<p class="err-text">${esc(e.message)}</p>`; return; }
    const c = d.counts;
    view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Fulfillment</p><h1>Posts to publish</h1></div></div>${tabs}
      <div class="card"><div class="sp-stats"><span class="sp-stat"><b>${c.today}</b> today</span><span class="sp-stat"><b>${c.overdue}</b> overdue</span><span class="sp-stat"><b>${c.toVerify}</b> to check</span><span class="sp-stat"><b>${c.needsPhoto}</b> need a photo</span><span class="sp-stat"><b>${c.total}</b> in the next 7 days</span></div>
      <p class="small muted">Every post here is written and timed. Check it, copy the caption, post it in the app, then tap Posted.</p>
      ${queueHtml(d.items, { showClient: true })}${scoreHtml(d.toScore)}</div>`;
    wireQueue(view, d.items, { onChange: load }); wireScore(view, load);
  };
  await load();
}

// ---------- the client's Autopilot card ----------
export async function autopilotCard(host, c, { onChange, open } = {}) {
  host.innerHTML = '<div class="skeleton"></div>';
  let a; let q;
  const load = async () => { [a, q] = await Promise.all([api(`/api/clients/${c.id}/social/autopilot`), api(`/api/social/queue?client=${encodeURIComponent(c.id)}&days=30`)]); };
  const paint = () => {
    const s = a.settings; const st = a.status;
    host.innerHTML = `<div class="card-head"><h2>Autopilot</h2><span class="badge ${s.enabled ? '' : 'gray'}">${s.enabled ? 'Keeps itself stacked' : 'Manual runs only'}</span></div>
      <p class="small muted">It plans the next ${s.weeks} weeks of posts for ${esc(c.name)}: what day and time, which service and city, the search term to cover, captions for each channel, hashtags, the Google button and a shot list. You check each one, post it by hand and tap Posted. It never posts on its own.</p>
      ${a.ready ? '' : '<p class="err-text">Add this client\'s services and cities on their profile first. Every post is built from them.</p>'}
      <div class="sp-stats"><span class="sp-stat"><b>${st.stacked}</b> stacked</span><span class="sp-stat"><b>${st.toVerify}</b> to check</span><span class="sp-stat"><b>${st.needsPhoto}</b> need a photo</span><span class="sp-stat"><b>${st.photosWaiting}</b> client photos waiting</span>${st.lastAt ? `<span class="sp-stat">covered to <b>${esc(new Date(st.lastAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</b></span>` : ''}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="aurun"${a.ready ? '' : ' disabled'}>Stack the calendar</button><button class="btn btn-ghost btn-sm" id="aupre"${a.ready ? '' : ' disabled'}>Preview first</button>${st.toVerify ? `<button class="btn btn-mint btn-sm" id="auall">Check all ready (${st.toVerify})</button>` : ''}<button class="btn btn-ghost btn-sm" id="auset">Settings</button></div>
      <p class="small muted" style="margin-top:8px">${a.ai ? 'Captions are written by Claude, a few cents for a month of posts.' : 'No Anthropic key yet, so captions come from templates. They are safe and plain. Add the key for richer ones.'} Service and city focus follows this client's scans: weak spots get more posts.${st.resultsNeeded ? ` After ${st.resultsNeeded} more posts with a lead count, it also learns which kinds work.` : ' It is now learning from your lead counts.'}</p>
      <div id="auset-box" hidden></div>
      <h3 style="margin:18px 0 6px">Ready to post</h3><div id="auq">${queueHtml(q.items)}</div>${scoreHtml(q.toScore)}`;
    $('#aurun', host)?.addEventListener('click', run);
    $('#aupre', host)?.addEventListener('click', preview);
    $('#auall', host)?.addEventListener('click', async (e) => { busy(e.currentTarget, true); try { const r = await api(`/api/clients/${c.id}/social/verify-all`, { method: 'POST', body: {} }); toast(`${r.done} checked${r.skipped ? `, ${r.skipped} still need something` : ''}`); await refresh(); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } });
    $('#auset', host).addEventListener('click', () => { const box = $('#auset-box', host); box.hidden = !box.hidden; if (!box.hidden) settingsForm(box); });
    wireQueue(host, q.items, { onChange: refresh, open }); wireScore(host, refresh);
  };
  const refresh = async () => { try { await load(); paint(); onChange?.(); } catch (e) { host.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; } };

  async function run(ev) {
    const btn = ev.currentTarget; busy(btn, true);
    try {
      const r = await api(`/api/clients/${c.id}/social/autopilot/run`, { method: 'POST', body: {} });
      toast(r.items.length ? `${r.items.length} posts stacked${r.photos ? `, ${r.photos} with a client photo` : ''}${r.ai ? '' : ' (templates)'}${r.error ? `. Claude said: ${r.error}` : ''}` : (r.message || 'Nothing to add'), Boolean(r.error));
      await refresh();
    } catch (e) { toast(e.message, true); busy(btn, false); }
  }
  async function preview(ev) {
    const btn = ev.currentTarget; busy(btn, true);
    try {
      const r = await api(`/api/clients/${c.id}/social/autopilot/run`, { method: 'POST', body: { preview: true } });
      busy(btn, false);
      const mix = Object.entries(r.summary.byPillar).map(([k, n]) => `${esc(k)} ${n}`).join(', ');
      const m = modal(`<div class="card-head"><h2>Preview</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
        <p class="small muted">${r.items.length} posts. Nothing is saved yet. Mix: ${mix || 'none'}.${r.learned ? ' Mix adjusted from your lead counts.' : ''}</p>
        <ul class="list" style="max-height:55vh;overflow:auto">${r.items.map((i) => `<li class="item"><div><div class="item-title">${esc(i.title)}</div><div class="item-sub">${esc(when(i.at))} ${chans(i.channels)}</div>
          <div class="small">Covers: <b>${esc(i.keyword)}</b>${i.reason ? ` (${esc(i.reason)})` : ''}</div><div class="small muted" style="white-space:pre-wrap">${esc(i.captions.facebook.split('\n')[0])}</div></div></li>`).join('')}</ul>
        <div class="row end" style="gap:8px;margin-top:10px"><button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" id="aupgo">Stack these</button></div>`);
      $('#aupgo', m.el).addEventListener('click', async (e) => { busy(e.currentTarget, true); m.close(); await run({ currentTarget: $('#aurun', host) || e.currentTarget }); });
    } catch (e) { toast(e.message, true); busy(btn, false); }
  }

  function settingsForm(box) {
    const s = a.settings; const zones = ZONE_CHOICES.some(([z]) => z === s.tz) ? ZONE_CHOICES : [[s.tz, s.tz], ...ZONE_CHOICES];
    box.innerHTML = `<form id="auf" class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));margin-top:12px">
      <label class="field"><span>Posts a week</span><select name="perWeek">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option${n === s.perWeek ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Of those, on the Google profile</span><select name="googlePerWeek">${[0, 1, 2, 3, 4].map((n) => `<option${n === s.googlePerWeek ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Weeks to keep stacked</span><select name="weeks">${[1, 2, 3, 4, 6, 8].map((n) => `<option${n === s.weeks ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Time zone</span><select name="tz">${zones.map(([z, n]) => `<option value="${esc(z)}"${z === s.tz ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="field"><span>Feed times (Facebook, Instagram)</span><div class="row" style="gap:6px"><input type="time" name="f1" value="${esc(s.times.feed[0] || '12:00')}"><input type="time" name="f2" value="${esc(s.times.feed[1] || s.times.feed[0] || '18:30')}"></div></label>
      <label class="field"><span>Google time, and Saturday</span><div class="row" style="gap:6px"><input type="time" name="g1" value="${esc(s.times.google[0] || '10:00')}"><input type="time" name="sat" value="${esc(s.times.saturday)}"></div></label>
      <label class="field"><span>Region for seasonal posts</span><select name="region"><option value="florida"${s.region === 'florida' ? ' selected' : ''}>South Florida</option><option value="general"${s.region === 'general' ? ' selected' : ''}>General</option></select></label>
      <div class="field"><span>Channels</span><div class="sp-chips">${['facebook', 'instagram', 'google'].map((ch) => `<label class="sp-pick"><input type="checkbox" name="ch" value="${ch}"${s.channels.includes(ch) ? ' checked' : ''}> ${esc(PLATFORM[ch].label)}</label>`).join('')}</div></div>
      <div class="field" style="grid-column:1/-1"><label class="sp-pick"><input type="checkbox" name="enabled"${s.enabled ? ' checked' : ''}> Keep the calendar stacked on its own (checks daily, only when it runs low)</label>
        <label class="sp-pick"><input type="checkbox" name="clientReview"${s.clientReview ? ' checked' : ''}> When I check a post, also send it to the client to approve</label></div>
      <div class="row end" style="gap:8px;grid-column:1/-1"><button class="btn btn-primary" type="submit">Save settings</button></div></form>
      <p class="small muted">Starting mix and times are common local business defaults, not guarantees. Change them to fit this client.</p>`;
    $('#auf', box).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target; const btn = e.submitter; busy(btn, true);
      const settings = { perWeek: Number(f.perWeek.value), googlePerWeek: Number(f.googlePerWeek.value), weeks: Number(f.weeks.value), tz: f.tz.value, region: f.region.value,
        channels: $$('[name=ch]:checked', f).map((x) => x.value), enabled: f.enabled.checked, clientReview: f.clientReview.checked, autoTopUp: true,
        times: { feed: [f.f1.value, f.f2.value].filter(Boolean), google: [f.g1.value].filter(Boolean), saturday: f.sat.value } };
      try { const r = await api(`/api/clients/${c.id}/social/autopilot`, { method: 'PUT', body: { settings } }); a.settings = r.settings; a.status = r.status; toast('Saved'); paint(); } catch (err) { toast(err.message, true); busy(btn, false); }
    });
  }

  try { await load(); paint(); } catch (e) { host.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
}
