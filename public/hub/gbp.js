// Client "Google profile" tab (Phase 5): link the client's Google Business Profile, then publish posts and photos, reply to
// reviews, edit the description, phone and website, and see calls, direction requests, website clicks and views.
import { $, $$, esc, api, toast, busy, fmt, icon } from './core.js';

const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
const delta = (a, b) => (b == null || a === b ? '' : `<i class="${a > b ? 'good-text' : 'bad-text'}">${a > b ? 'up' : 'down'} ${Math.abs(a - b)}</i>`);

export async function gbpTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/gbp`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  if (!d.linked) return linkView(el, c, d);
  const p = d.profile;
  const errs = Object.values(d.errors || {});
  el.innerHTML = `
    ${errs.length ? `<div class="card warn-card"><b>Google said:</b> ${esc(errs[0])}</div>` : ''}
    <div class="card"><div class="card-head"><div><p class="eyebrow">Connected profile</p><h2>${esc(p?.title || d.title || 'Google profile')}</h2></div>
      <div class="row">${p?.mapsUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">Open on Maps</a>` : ''}<button class="btn btn-ghost btn-sm" id="gunlink">Unlink</button></div></div>
      ${d.metrics ? `<div class="stats" style="margin:0">
        <div class="stat"><div class="stat-num">${d.metrics.last30.calls}</div><div class="stat-label">calls, last 30 days ${delta(d.metrics.last30.calls, d.metrics.prev30?.calls)}</div></div>
        <div class="stat"><div class="stat-num">${d.metrics.last30.directions}</div><div class="stat-label">direction requests ${delta(d.metrics.last30.directions, d.metrics.prev30?.directions)}</div></div>
        <div class="stat"><div class="stat-num">${d.metrics.last30.website}</div><div class="stat-label">website clicks ${delta(d.metrics.last30.website, d.metrics.prev30?.website)}</div></div>
        <div class="stat"><div class="stat-num">${fmt.int(d.metrics.last30.views)}</div><div class="stat-label">profile views on Search and Maps</div></div></div>` : ''}
    </div>
    ${p ? `<div class="split" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>Profile details</h2><span class="small muted">${esc(p.category)}${p.extraCategories.length ? ` + ${p.extraCategories.length} more` : ''}</span></div>
        <form id="gpf" class="form-grid">
          <label class="field"><span>Phone</span><input name="phone" value="${esc(p.phone)}"></label>
          <label class="field"><span>Website</span><input name="website" type="url" value="${esc(p.website)}"></label>
          <label class="field span-all"><span>Description <span class="muted" id="gdc">${p.description.length}/750</span></span><textarea name="description" rows="6" maxlength="750">${esc(p.description)}</textarea></label>
          <div class="span-all row end"><button class="btn btn-primary btn-sm" type="submit">Save to Google</button></div></form></div>
      <div class="card"><h2>Profile check</h2><ul class="list">${p.checks.map((x) => `<li class="item"><span class="badge ${x.ok ? '' : 'warn'}">${x.ok ? 'Good' : 'Fix'}</span><div><div class="item-title">${esc(x.label)}</div>${x.ok ? '' : `<div class="item-sub">${esc(x.fix)}</div>`}</div></li>`).join('')}</ul>
        <p class="small muted">Categories, hours and service area are edited on business.google.com for now.</p></div></div>` : ''}
    <div class="card" id="gposts"><div class="card-head"><h2>Publish a post</h2><a class="small" href="#/client/${esc(c.id)}/posts">Posts tab</a></div><div class="skeleton"></div></div>
    <div class="card" id="gphotos"><div class="card-head"><h2>Add photos</h2><span class="small muted">from the client's uploads</span></div><div class="skeleton"></div></div>
    <div class="card"><div class="card-head"><h2>Reviews</h2>${d.reviews ? `<span class="small muted">${d.reviews.average ?? '-'} stars, ${d.reviews.total ?? '-'} total</span>` : ''}</div>
      ${d.reviews?.list.length ? `<ul class="list">${d.reviews.list.map((r) => `<li class="item g-review" data-id="${esc(r.id)}"><span class="badge ${r.stars <= 3 ? 'bad' : ''}">${r.stars}★</span>
        <div><div class="item-sub">${esc(r.who)} · ${esc(fmt.date(r.at))} <span class="stars">${stars(r.stars)}</span></div><div>${esc(r.text || '(no text)')}</div>
          ${r.reply ? `<div class="reply-box"><b>Your reply:</b> ${esc(r.reply)}</div>` : `<div class="g-reply"><textarea rows="3" placeholder="Write a reply"></textarea><div class="row"><button class="btn btn-ghost btn-sm" data-draft>Draft for me</button><button class="btn btn-primary btn-sm" data-send>Post reply</button></div></div>`}</div></li>`).join('')}</ul>`
        : '<p class="muted small">No reviews came back.</p>'}</div>`;
  $('#gunlink', el).addEventListener('click', async () => { if (!confirm('Unlink this Google profile from the client?')) return; await api(`/api/clients/${c.id}/gbp`, { method: 'PUT', body: {} }); gbpTab(el, c); });
  const gpf = $('#gpf', el);
  gpf?.description.addEventListener('input', (e) => { $('#gdc', el).textContent = `${e.target.value.length}/750`; });
  gpf?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of ['phone', 'website', 'description']) if (gpf[k].value !== (p[k] || '')) body[k] = gpf[k].value;
    if (!Object.keys(body).length) return toast('Nothing changed');
    const btn = gpf.querySelector('button'); busy(btn, true);
    try { await api(`/api/clients/${c.id}/gbp/profile`, { method: 'PATCH', body }); toast('Saved to Google. It can take a few minutes to show.'); } catch (err) { toast(err.message, true); }
    busy(btn, false);
  });
  $$('.g-review', el).forEach((li) => {
    const r = d.reviews.list.find((x) => x.id === li.dataset.id);
    $('[data-draft]', li)?.addEventListener('click', async (e) => {
      busy(e.target, true);
      try { const x = await api(`/api/clients/${c.id}/review-reply`, { method: 'POST', body: { name: r.who, stars: r.stars, text: r.text } }); $('textarea', li).value = x.reply; } catch (err) { toast(err.message, true); }
      busy(e.target, false);
    });
    $('[data-send]', li)?.addEventListener('click', async (e) => {
      const comment = $('textarea', li).value.trim();
      if (!comment) return toast('Write the reply first', true);
      busy(e.target, true);
      try { await api(`/api/clients/${c.id}/gbp/reviews/${encodeURIComponent(r.id)}/reply`, { method: 'PUT', body: { comment } }); toast('Reply posted'); gbpTab(el, c); } catch (err) { toast(err.message, true); busy(e.target, false); }
    });
  });
  postsBox($('#gposts', el), c);
  photosBox($('#gphotos', el), c);
}

async function postsBox(box, c) {
  let posts = [];
  try { ({ posts } = await api(`/api/clients/${c.id}/posts`)); } catch { posts = []; }
  const ready = posts.filter((p) => p.status === 'approved' || p.status === 'draft').slice(0, 6);
  box.querySelector('.skeleton').outerHTML = ready.length ? `<ul class="list">${ready.map((p) => `<li class="item tool-post">${p.media_key ? `<img src="/api/media/${esc(p.id)}" alt="" loading="lazy">` : '<span class="badge gray">No photo</span>'}
    <div><span class="badge ${p.status === 'approved' ? '' : 'gray'}">${p.status === 'approved' ? 'Approved' : 'Draft'}</span><div class="item-sub">${esc((p.google_text || '').slice(0, 160))}</div></div>
    <button class="btn btn-primary btn-sm" data-pub="${esc(p.id)}">Publish to Google</button></li>`).join('')}</ul>` : '<p class="small muted">No posts waiting. Make one in the Posts tab.</p>';
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pub]');
    if (!b) return;
    busy(b, true);
    try { const r = await api(`/api/posts/${b.dataset.pub}/gbp`, { method: 'POST' }); toast(r.url ? 'Published. The post task is checked off with the link.' : 'Sent to Google'); b.closest('li').remove(); } catch (err) { toast(err.message, true); busy(b, false); }
  });
}

async function photosBox(box, c) {
  let assets = [];
  try { ({ assets } = await api(`/api/clients/${c.id}/onboarding`)); } catch { assets = []; }
  const imgs = (assets || []).filter((a) => /^image\//.test(a.media_type) && a.kind !== 'logo').slice(0, 30);
  box.querySelector('.skeleton').outerHTML = imgs.length ? `<div class="photo-pick">${imgs.map((a) => `<label><input type="checkbox" value="${esc(a.id)}"><img src="/api/assets/${esc(a.id)}" alt="${esc(a.name || 'Photo')}" loading="lazy"></label>`).join('')}</div>
    <div class="row end" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="gup">${icon.upload}Upload picked photos</button></div>` : `<p class="small muted">No photos uploaded yet. The client can add them in their app (Get started), or upload them in the Onboarding tab.</p>`;
  $('#gup', box)?.addEventListener('click', async (e) => {
    const ids = $$('input:checked', box).map((i) => i.value);
    if (!ids.length) return toast('Pick photos first', true);
    busy(e.target, true);
    try { const r = await api(`/api/clients/${c.id}/gbp/photos`, { method: 'POST', body: { assets: ids } }); toast(r.uploaded ? `${r.uploaded} photo${r.uploaded === 1 ? '' : 's'} sent to Google` : r.errors[0] || 'Nothing uploaded', !r.uploaded); } catch (err) { toast(err.message, true); }
    busy(e.target, false);
  });
}

async function linkView(el, c, d) {
  el.innerHTML = `<div class="card"><div class="card-head"><h2>Connect the Google profile</h2></div>
    <p>Once linked, posts, photos and review replies go straight to Google from the Hub, and the monthly report gets calls, direction requests and website clicks from the profile.</p>
    <ol class="small steps"><li>The client adds hello@rightwaygrowth.com as a Manager on their profile (Access tab has the steps).</li>
      <li>On the Google page, turn on Google Business Profile with the Google account that manages it.</li>
      <li>Google must approve Business Profile API access for the Hub's Google Cloud project (request it from the Prerequisites page of Google's Business Profile API docs), and the Business Profile APIs must be turned on in Google Cloud.</li></ol>
    ${d.ready ? '<button class="btn btn-primary" id="gfind">Find their profile</button>' : '<p class="badge warn">Google sign in is not set up yet (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare).</p>'}
    <div id="glist" style="margin-top:12px"></div></div>`;
  $('#gfind', el)?.addEventListener('click', async (e) => {
    busy(e.target, true);
    try {
      const { locations } = await api('/api/gbp/locations');
      const name = c.name.toLowerCase();
      locations.sort((a, b) => (b.title.toLowerCase().includes(name) ? 1 : 0) - (a.title.toLowerCase().includes(name) ? 1 : 0));
      $('#glist', el).innerHTML = locations.length ? `<ul class="list">${locations.map((l, i) => `<li class="item"><div><div class="item-title">${esc(l.title)}</div><div class="item-sub">${esc([l.address, l.phone, l.website].filter(Boolean).join(' · '))}</div></div><button class="btn btn-ghost btn-sm" data-i="${i}">Link</button></li>`).join('')}</ul>`
        : '<p class="muted">No profiles on this Google account. Make sure the client added you as a Manager and the invite was accepted.</p>';
      $$('[data-i]', el).forEach((b) => b.addEventListener('click', async () => {
        const l = locations[Number(b.dataset.i)];
        try { await api(`/api/clients/${c.id}/gbp`, { method: 'PUT', body: { account: l.account, location: l.location, title: l.title } }); toast('Linked'); gbpTab(el, c); } catch (err) { toast(err.message, true); }
      }));
    } catch (err) { $('#glist', el).innerHTML = `<p class="err-text">${esc(err.message)}</p>`; }
    busy(e.target, false);
  });
}
