// Client app: #/social. What we posted, what is coming, posts waiting for your OK, and whether Facebook and Instagram are connected.
import { $, $$, esc, api, toast, busy } from './core.js';
import { PLATFORM } from '../js/social.js';
import { KIND } from '../js/meta.js';

const when = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date to be set');
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const chips = (list) => (list || []).map((id) => `<span class="badge gray">${esc(PLATFORM[id]?.label || id)}</span>`).join(' ');

// The home card. Returns html or '' (nothing yet to show).
export async function socialCard(clientId) {
  let d;
  try { d = await api(`/api/clients/${clientId}/social/overview`); } catch { return ''; }
  const p = d.progress;
  const live = d.meta.connected.length > 0;
  if (!d.items.length && !live && !d.meta.configured) return '';
  const bits = [];
  if (p.waiting) bits.push(`<b>${p.waiting} post${p.waiting === 1 ? '' : 's'} to check</b>`);
  else bits.push(`<b>${p.postedThisMonth} post${p.postedThisMonth === 1 ? '' : 's'} this month</b>`);
  const sub = p.waiting ? 'Read them and approve, or tell us what to change.'
    : [p.upcoming ? `${p.upcoming} coming up` : '', live ? 'Facebook and Instagram connected' : 'Connect Facebook and Instagram'].filter(Boolean).join('. ') + '.';
  return `<a class="card start-card" href="#/social">${bits.join('')}<span>${esc(sub)}</span></a>`;
}

export async function clientSocial(el, client) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  const load = async () => { d = await api(`/api/clients/${client.id}/social/overview`); };
  try { await load(); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const tabs = {};

  const paint = () => {
    const p = d.progress;
    const waiting = d.items.filter((i) => i.status === 'review');
    const changes = d.items.filter((i) => i.status === 'changes');
    const upcoming = d.items.filter((i) => ['approved', 'scheduled'].includes(i.status)).sort((a, b) => (a.scheduled_at || 9e15) - (b.scheduled_at || 9e15));
    const posted = d.items.filter((i) => i.status === 'posted').sort((a, b) => (b.posted_at || b.scheduled_at || 0) - (a.posted_at || a.scheduled_at || 0)).slice(0, 12);
    const max = Math.max(1, ...p.months.map((m) => m.posted));
    el.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
        <div class="stat hero"><div class="stat-num">${p.postedThisMonth}</div><div class="stat-label">post${p.postedThisMonth === 1 ? '' : 's'} published this month${p.byChannel.length ? ` (${p.byChannel.map((x) => `${esc(x.label)} ${x.n}`).join(', ')})` : ''}</div></div>
        <div class="stat"><div class="stat-num">${p.upcoming}</div><div class="stat-label">coming up${p.next ? `, next ${esc(day(p.next.scheduled_at) || 'soon')}` : ''}</div></div>
        <div class="stat"><div class="stat-num">${p.waiting}</div><div class="stat-label">waiting for your OK</div></div>
        <div class="stat"><div class="stat-num">${p.postedTotal}</div><div class="stat-label">posted since we started</div></div>
      </div>
      <div class="card"><div class="card-head"><h2>Posts by month</h2></div>
        <div class="sc-bars" role="img" aria-label="Posts published in the last ${p.months.length} months">${p.months.map((m) => `<div class="sc-bar"><b>${m.posted}</b><span style="height:${Math.round((100 * m.posted) / max)}%"></span><i>${esc(m.label)}</i></div>`).join('')}</div></div>
      <div class="card" id="scconn"></div>
      ${waiting.length ? `<div class="card"><div class="card-head"><h2>Waiting for you</h2><span class="badge warn">${waiting.length}</span></div><p class="small muted">Read each post, then approve it or tell us what to change.</p><div class="sc-list">${waiting.map(post).join('')}</div></div>` : ''}
      ${changes.length ? `<div class="card"><div class="card-head"><h2>Changes you asked for</h2></div><p class="small muted">We are working on these.</p><ul class="list">${changes.map((i) => `<li class="item"><div><div class="item-title">${esc(i.title || 'Post')}</div><div class="item-sub">${i.comments.length ? esc(i.comments[i.comments.length - 1].body) : ''}</div></div></li>`).join('')}</ul></div>` : ''}
      <div class="card"><div class="card-head"><h2>Coming up</h2></div>${upcoming.length ? `<ul class="list">${upcoming.map((i) => `<li class="item"><div><div class="item-title">${esc(i.title || 'Post')}</div><div class="item-sub">${esc(when(i.scheduled_at))}</div></div><div class="sc-chips">${chips(i.channels)}</div></li>`).join('')}</ul>` : '<p class="muted">Nothing scheduled yet. We will add posts here as they are lined up.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Posted</h2></div>${posted.length ? `<ul class="list">${posted.map((i) => `<li class="item"><div><div class="item-title">${esc(i.title || 'Post')}</div><div class="item-sub">${esc(day(i.posted_at || i.scheduled_at))}</div></div><div class="sc-chips">${linkChips(i)}</div></li>`).join('')}</ul>` : '<p class="muted">Your first posts show up here once they go out.</p>'}</div>`;
    connCard($('#scconn', el));
    wirePosts();
  };

  const linkChips = (i) => (i.channels || []).map((ch) => {
    const u = i.post_links?.[ch];
    const label = esc(PLATFORM[ch]?.label || ch);
    return /^https?:\/\//.test(u || '') ? `<a class="badge ok" href="${esc(u)}" target="_blank" rel="noopener">${label}</a>` : `<span class="badge gray">${label}</span>`;
  }).join(' ');

  function post(i) {
    const tab = tabs[i.id] && i.channels.includes(tabs[i.id]) ? tabs[i.id] : i.channels[0];
    const cap = i.captions?.[tab]?.text || '';
    return `<article class="sc-post" data-id="${esc(i.id)}">
      <div class="item-title">${esc(i.title || 'Post')}</div>
      ${i.media.length ? `<div class="sc-media">${i.media.slice(0, 4).map((m) => (m.type?.startsWith('video') ? `<video src="${esc(m.url)}" controls preload="metadata" playsinline></video>` : `<img src="${esc(m.url)}" alt="" loading="lazy">`)).join('')}</div>` : ''}
      ${i.channels.length > 1 ? `<div class="sc-tabs">${i.channels.map((ch) => `<button type="button" class="${ch === tab ? 'is-on' : ''}" data-tab="${esc(ch)}">${esc(PLATFORM[ch]?.label || ch)}</button>`).join('')}</div>` : `<div>${chips(i.channels)}</div>`}
      <div class="sc-cap">${esc(cap) || '<span class="muted">No caption for this channel.</span>'}</div>
      <div class="small muted">${i.scheduled_at ? `Planned for ${esc(when(i.scheduled_at))}` : 'No date set yet'}</div>
      ${i.comments.length ? i.comments.map((c) => `<div class="sc-cm${c.kind === 'staff' ? ' staff' : ''}"><b>${esc(c.author)}</b> <span class="small muted">${esc(day(c.created_at))}</span><p>${esc(c.body)}</p></div>`).join('') : ''}
      <label class="field"><span>Your note (needed if you want changes)</span><textarea rows="3" data-note maxlength="2000" placeholder="Anything to change or add?"></textarea></label>
      <div class="sc-btns"><button class="btn btn-primary" data-act="approve">Approve</button><button class="btn btn-ghost" data-act="changes">Ask for changes</button></div>
    </article>`;
  }

  function wirePosts() {
    $$('.sc-post', el).forEach((card) => {
      const id = card.dataset.id; const item = d.items.find((x) => x.id === id);
      $$('[data-tab]', card).forEach((b) => b.addEventListener('click', () => { tabs[id] = b.dataset.tab; const cap = item.captions?.[b.dataset.tab]?.text || ''; $('.sc-cap', card).textContent = cap || 'No caption for this channel.'; $$('[data-tab]', card).forEach((x) => x.classList.toggle('is-on', x === b)); }));
      $$('[data-act]', card).forEach((b) => b.addEventListener('click', async () => {
        const note = $('[data-note]', card).value.trim();
        if (b.dataset.act === 'changes' && !note) { toast('Tell us what to change first.', true); $('[data-note]', card).focus(); return; }
        busy(b, true);
        try {
          await api(`/api/clients/${client.id}/social/items/${id}/${b.dataset.act}`, { method: 'POST', body: { body: note } });
          toast(b.dataset.act === 'approve' ? 'Approved. Thank you.' : 'Sent. We will make the changes.');
          await load(); paint();
        } catch (e) { busy(b, false); toast(e.message, true); }
      }));
    });
  }

  function connCard(host) {
    const m = d.meta; const live = m.connected;
    host.innerHTML = `<div class="card-head"><h2>Facebook and Instagram</h2>${live.length ? (live.some((c) => c.problems.length) ? '<span class="badge warn">One more step</span>' : '<span class="badge ok">Connected</span>') : '<span class="badge gray">Not connected</span>'}</div>
      ${live.length ? live.map((c) => `<p class="small" style="margin:4px 0">${esc(c.line)}</p><ul class="list">${c.assets.map((a) => `<li class="item"><div class="item-title">${esc(a.name)}</div><span class="small muted">${esc(KIND[a.kind] || a.kind)}</span></li>`).join('')}</ul>${c.problems.length ? `<ul class="small err-text" style="margin:8px 0 0 18px">${c.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`).join('')
    : '<p class="small">Connect your accounts once so we can post and report for you. It takes about two minutes and you sign in to Facebook yourself.</p>'}
      ${m.configured ? `<button class="btn ${live.length ? 'btn-ghost' : 'btn-primary'} btn-xl" id="scgo" style="margin-top:10px">${live.length ? 'Connect again or add an account' : 'Connect Facebook and Instagram'}</button>` : '<p class="small muted">We are finishing this setup. Your team will message you when it is ready.</p>'}`;
    $('#scgo', host)?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { const r = await api(`/api/clients/${client.id}/meta/self-link`, { method: 'POST' }); location.href = r.url; }
      catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
    });
  }

  paint();
}
