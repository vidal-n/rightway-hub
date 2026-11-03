// Content engine screens: the client's Content tab in the Hub (ideas, pages, editor, WordPress) and the client app's review screen.
import { $, $$, esc, api, toast, copy, modal, busy, fmt } from './core.js';
import { cleanHtml, wordCount } from '../js/sanitize.js';

const STATUS = {
  idea: ['gray', 'Idea'], draft: ['warn', 'Draft'], review: ['warn', 'With the client'], changes: ['bad', 'Changes asked'],
  approved: ['', 'Approved'], published: ['', 'Live'],
};
const badge = (s) => { const [c, l] = STATUS[s] || ['gray', s]; return `<span class="badge ${c}">${l}</span>`; };
const KINDS = [['service', 'Service page'], ['city', 'City page'], ['article', 'Article']];

// ---------- Hub: Content tab ----------
export async function contentTab(el, c, sub) {
  if (sub) return editor(el, c, sub);
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/content`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const q = d.quota;
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Pages and articles</h2>
        <div class="row" style="gap:8px">${q.total ? `<span class="badge ${q.done >= q.total ? '' : 'warn'}">${q.done} of ${q.total} done in ${esc(fmt.month(q.month))}</span>` : ''}<button class="btn btn-primary btn-sm" id="ctnew">New page</button></div></div>
      ${!d.ai ? '<p class="small muted">No Anthropic key yet, so drafts come as an outline for you to fill in.</p>' : ''}
      ${d.items.length ? `<ul class="list">${d.items.map((it) => `<li class="item ct-row" data-id="${esc(it.id)}" tabindex="0">${badge(it.status)}
          <div><div class="item-title">${esc(it.title)}</div><div class="item-sub">${esc(it.kindLabel)}, "${esc(it.keyword || '')}"${it.words ? `, ${it.words} words` : ''}${it.status === 'changes' && it.client_note ? `. Client: ${esc(it.client_note.slice(0, 90))}` : ''}</div></div>
          ${it.live_url ? `<a class="btn btn-ghost btn-sm" href="${esc(it.live_url)}" target="_blank" rel="noopener">View live</a>` : '<span class="small muted">Open</span>'}</li>`).join('')}</ul>`
        : '<p class="muted">No pages yet. Start from an idea below, or make your own.</p>'}
    </div>
    <div class="card" id="ctideas"><div class="card-head"><h2>Ideas</h2><span class="small muted">From their services, cities and weakest rankings</span></div><div class="skeleton"></div></div>
    <div class="card" id="ctwp"></div>`;
  $$('.ct-row', el).forEach((r) => {
    const open = () => { location.hash = `#/client/${c.id}/content/${r.dataset.id}`; };
    r.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
  $('#ctnew', el).addEventListener('click', () => newPageModal(c));
  wpCard($('#ctwp', el), c, d.wordpress);
  try {
    const r = await api(`/api/clients/${c.id}/content/ideas`);
    $('#ctideas', el).innerHTML = `<div class="card-head"><h2>Ideas</h2><span class="small muted">From their services, cities and weakest rankings</span></div>
      ${r.missing ? `<p class="muted">${esc(r.missing)}</p>` : ''}
      ${r.ideas.length ? `<ul class="list">${r.ideas.map((i, n) => `<li class="item"><span class="badge gray">${esc(KINDS.find(([k]) => k === i.kind)?.[1] || 'Page')}</span>
        <div><div class="item-title">${esc(i.title)}</div><div class="item-sub">${esc(i.reason)}. Search: "${esc(i.keyword)}"</div></div>
        <button class="btn btn-ghost btn-sm" data-idea="${n}">Start</button></li>`).join('')}</ul>` : r.missing ? '' : '<p class="muted">Every idea has a page already. Make a custom one.</p>'}`;
    $$('[data-idea]', el).forEach((b) => b.addEventListener('click', async () => {
      busy(b, true);
      try { const x = await api(`/api/clients/${c.id}/content`, { method: 'POST', body: r.ideas[Number(b.dataset.idea)] }); location.hash = `#/client/${c.id}/content/${x.item.id}`; }
      catch (e) { busy(b, false); toast(e.message, true); }
    }));
  } catch (e) { $('#ctideas', el).innerHTML = `<p class="err-text">${esc(e.message)}</p>`; }
}

function newPageModal(c) {
  const m = modal(`<h2>New page</h2><form id="npf" class="form-grid" style="grid-template-columns:1fr">
    <label class="field"><span>Type</span><select name="kind">${KINDS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label class="field"><span>Title</span><input name="title" required maxlength="140" placeholder="Tile roof repair in Hollywood"></label>
    <label class="field"><span>Main search to rank for</span><input name="keyword" maxlength="120" placeholder="tile roof repair hollywood"></label>
    <div class="row" style="gap:8px"><label class="field" style="flex:1"><span>Service</span><input name="service" maxlength="80"></label><label class="field" style="flex:1"><span>City</span><input name="city" maxlength="80"></label></div>
    <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Make the brief</button></div></form>`);
  $('#npf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), true);
    try {
      const x = await api(`/api/clients/${c.id}/content`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      m.close(); location.hash = `#/client/${c.id}/content/${x.item.id}`;
    } catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
  });
}

function wpCard(box, c, wp) {
  box.innerHTML = `<div class="card-head"><h2>WordPress</h2><span class="badge ${wp.connected ? '' : 'gray'}">${wp.connected ? 'Connected' : 'Not connected'}</span></div>
    ${wp.connected ? `<p>Pages publish to <b>${esc(wp.url)}</b> as <b>${esc(wp.user)}</b>.</p><div class="row"><button class="btn btn-ghost btn-sm" id="wpoff">Disconnect</button></div>`
      : `<p class="muted">Connect their WordPress site to publish from here. Not on WordPress (Wix, Squarespace, others)? Use Copy HTML on a page and paste it in.</p>
      <ol class="small" style="margin:8px 0 12px 18px;padding:0;line-height:1.7"><li>In their WordPress admin, open Users, then Profile (use an Editor or Administrator login).</li>
        <li>Scroll to <b>Application Passwords</b>, type "Rightway Hub", click Add, and copy the password it shows.</li><li>Paste it below with the site address and that username.</li></ol>
      <form id="wpf" class="form-grid">
        <label class="field"><span>Site address</span><input name="url" placeholder="https://theirsite.com" value="${esc(wp.url || c.website || '')}" required></label>
        <label class="field"><span>WordPress username</span><input name="user" value="${esc(wp.user || '')}" required autocomplete="off"></label>
        <label class="field"><span>Application password</span><input name="password" required autocomplete="off" placeholder="abcd efgh ijkl mnop qrst uvwx"></label>
        <div class="span-all row end"><button class="btn btn-primary" type="submit">Connect</button></div></form>`}`;
  $('#wpf', box)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.currentTarget);
    busy(btn, true, 'Checking');
    try { const r = await api(`/api/clients/${c.id}/wordpress`, { method: 'PUT', body: Object.fromEntries(new FormData(e.currentTarget)) }); toast(`Connected as ${r.name}`); wpCard(box, c, { connected: true, url: r.url, user: e.currentTarget.user.value }); }
    catch (err) { busy(btn, false); toast(err.message, true); }
  });
  $('#wpoff', box)?.addEventListener('click', async () => {
    if (!confirm('Disconnect WordPress for this client?')) return;
    try { await api(`/api/clients/${c.id}/wordpress`, { method: 'PUT', body: { disconnect: true } }); wpCard(box, c, { connected: false, url: wp.url, user: wp.user }); }
    catch (err) { toast(err.message, true); }
  });
}

// ---------- Hub: page editor ----------
async function editor(el, c, id) {
  el.innerHTML = '<div class="skeleton"></div>';
  let it, wp;
  try { [{ item: it }, { wordpress: wp }] = await Promise.all([api(`/api/content/${id}`), api(`/api/clients/${c.id}/content`)]); }
  catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const b = it.brief || {};
  const draw = () => {
    el.innerHTML = `
      <p><a href="#/client/${esc(c.id)}/content">All pages</a></p>
      <div class="ct-grid">
        <div class="card ct-main">
          <div class="card-head"><div><p class="eyebrow">${esc(it.kindLabel)}</p><h2 id="cth">${esc(it.title)}</h2></div>${badge(it.status)}</div>
          ${it.status === 'changes' && it.client_note ? `<div class="ct-note"><b>The client asked for changes:</b><br>${esc(it.client_note)}</div>` : ''}
          <form id="ctf" class="form-grid" style="grid-template-columns:1fr 1fr">
            <label class="field span-all"><span>Title (the H1 on the page)</span><input name="title" value="${esc(it.title)}" maxlength="140"></label>
            <label class="field"><span>Meta title <i class="small muted" data-count="meta_title" data-max="60"></i></span><input name="meta_title" value="${esc(it.meta_title)}" maxlength="70"></label>
            <label class="field"><span>Address (slug)</span><input name="slug" value="${esc(it.slug)}" maxlength="80"></label>
            <label class="field span-all"><span>Meta description <i class="small muted" data-count="meta_description" data-max="155"></i></span><textarea name="meta_description" rows="2" maxlength="170">${esc(it.meta_description)}</textarea></label>
          </form>
          <div class="ct-tools" role="toolbar" aria-label="Formatting">
            <button type="button" data-cmd="h2">H2</button><button type="button" data-cmd="h3">H3</button><button type="button" data-cmd="p">Text</button>
            <button type="button" data-cmd="bold"><b>B</b></button><button type="button" data-cmd="list">List</button><button type="button" data-cmd="link">Link</button>
            <span class="spacer"></span><span class="small muted" id="ctwc"></span><button type="button" data-cmd="html" id="cthtml">HTML</button>
          </div>
          <div class="ct-body" id="ctbody" contenteditable="true" spellcheck="true">${it.html ? cleanHtml(it.html) : '<p></p>'}</div>
          <textarea id="ctsrc" class="ct-src" hidden spellcheck="false"></textarea>
          <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-ghost" id="ctai">${it.html ? 'Rewrite with AI' : 'Write the draft'}</button>
            <span class="spacer"></span><button class="btn btn-primary" id="ctsave">Save</button>
          </div>
        </div>
        <div class="ct-side">
          <div class="card" id="ctnext"></div>
          <div class="card"><div class="card-head"><h2>Brief</h2></div>
            <dl class="ct-brief">
              <dt>Main search</dt><dd>"${esc(it.keyword || b.keyword || '')}"</dd>
              ${b.words ? `<dt>Length</dt><dd>About ${b.words} words</dd>` : ''}
              ${b.outline?.length ? `<dt>Sections</dt><dd><ol>${b.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ol></dd>` : ''}
              ${b.faqs?.length ? `<dt>Questions to answer</dt><dd><ul>${b.faqs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></dd>` : ''}
              ${b.mustInclude?.length ? `<dt>Must include</dt><dd><ul>${b.mustInclude.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></dd>` : ''}
              ${b.competitors?.length ? `<dt>Ranking now</dt><dd>${b.competitors.map(esc).join(', ')}</dd>` : ''}
            </dl></div>
          <button class="btn btn-ghost btn-sm" id="ctdel" style="justify-self:start">Delete this page</button>
        </div>
      </div>`;
    bindEditor();
  };

  const body = () => $('#ctbody', el);
  const src = () => $('#ctsrc', el);
  const currentHtml = () => (src().hidden ? body().innerHTML : src().value);
  let dirty = false;
  const fields = () => { const f = $('#ctf', el); return { title: f.title.value, meta_title: f.meta_title.value, meta_description: f.meta_description.value, slug: f.slug.value, html: currentHtml() }; };
  const save = async (quiet = false) => {
    const r = await api(`/api/content/${it.id}`, { method: 'PUT', body: fields() });
    it = r.item; dirty = false;
    if (!quiet) toast('Saved');
    return it;
  };

  const nextStep = () => {
    const box = $('#ctnext', el);
    const s = it.status;
    const hasBody = wordCount(currentHtml()) >= 60;
    box.innerHTML = `<div class="card-head"><h2>Next step</h2></div>
      ${['idea', 'draft', 'changes'].includes(s) ? `<p class="small muted">${hasBody ? 'When it reads right, send it to the client. They approve it in their app.' : 'Write the draft first.'}</p>
        <button class="btn btn-primary btn-block" data-go="review"${hasBody ? '' : ' disabled'}>Send to the client</button>
        <button class="btn btn-ghost btn-sm btn-block" data-go="approve" style="margin-top:8px"${hasBody ? '' : ' disabled'}>They approved it another way</button>` : ''}
      ${s === 'review' ? `<p class="small">Waiting on the client to approve it in their app.</p><button class="btn btn-ghost btn-sm btn-block" data-go="approve">Mark as approved</button>` : ''}
      ${['approved', 'published'].includes(s) ? `
        ${wp.connected ? `<button class="btn btn-primary btn-block" data-go="wp-publish">${s === 'published' && it.wp_id ? 'Update on WordPress' : 'Publish on WordPress'}</button>
          ${s !== 'published' ? `<button class="btn btn-ghost btn-sm btn-block" data-go="wp-draft" style="margin-top:8px">${it.wp_id ? 'Update the WordPress draft' : 'Send to WordPress as a draft'}</button>` : ''}
          ${it.wp_id && s !== 'published' ? '<p class="small muted" style="margin-top:8px">It is in WordPress as a draft.</p>' : ''}` : '<p class="small muted">No WordPress connection. Copy the page into their site, then mark it published.</p>'}
        <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-go="copy">Copy HTML</button><button class="btn btn-ghost btn-sm" data-go="download">Download</button></div>
        ${s !== 'published' ? `<form id="ctlive" class="row" style="gap:6px;margin-top:12px"><input name="url" placeholder="Live address (optional)" style="flex:1;min-width:0"><button class="btn btn-ghost btn-sm" type="submit">Mark live</button></form>` : ''}
        ${it.live_url ? `<p class="small" style="margin-top:10px">Live: <a href="${esc(it.live_url)}" target="_blank" rel="noopener">${esc(it.live_url)}</a></p>` : ''}` : ''}`;
    $$('[data-go]', box).forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.go, btn)));
    $('#ctlive', box)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { if (dirty) await save(true); const r = await api(`/api/content/${it.id}/publish`, { method: 'POST', body: { manual: true, url: e.currentTarget.url.value } }); it = r.item; toast('Marked live. The page task is checked off.'); draw(); }
      catch (err) { toast(err.message, true); }
    });
  };

  const go = async (what, btn) => {
    if (what === 'copy') return copy(fields().html, 'HTML copied');
    if (what === 'download') {
      const f = fields();
      const doc = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(f.meta_title || f.title)}</title><meta name="description" content="${esc(f.meta_description)}"></head>\n<body>\n<h1>${esc(f.title)}</h1>\n${f.html}\n</body></html>`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
      a.download = `${f.slug || 'page'}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    busy(btn, true);
    try {
      if (dirty || what === 'review') await save(true);
      if (what === 'review') { const r = await api(`/api/content/${it.id}/review`, { method: 'POST' }); it = r.item; toast(r.emailed ? 'Sent. The client got an email.' : 'Sent to the client app.'); }
      if (what === 'approve') { const r = await api(`/api/content/${it.id}/approve`, { method: 'POST' }); it = r.item; toast('Approved'); }
      if (what === 'wp-draft' || what === 'wp-publish') {
        const r = await api(`/api/content/${it.id}/publish`, { method: 'POST', body: { status: what === 'wp-publish' ? 'publish' : 'draft' } });
        it = r.item;
        toast(what === 'wp-publish' ? 'Live on their site. The page task is checked off.' : 'Saved in WordPress as a draft');
      }
      draw();
    } catch (err) { busy(btn, false); toast(err.message, true); }
  };

  const bindEditor = () => {
    const f = $('#ctf', el);
    const counts = () => {
      $$('[data-count]', el).forEach((i) => { const n = f[i.dataset.count].value.length; i.textContent = `${n} of ${i.dataset.max}`; i.classList.toggle('bad-text', n > Number(i.dataset.max)); });
      const n = wordCount(currentHtml());
      $('#ctwc', el).textContent = `${n} words${b.words ? ` of about ${b.words}` : ''}`;
      $$('[data-go="review"], [data-go="approve"]', el).forEach((x) => { x.disabled = n < 60; });
    };
    counts();
    f.addEventListener('input', () => { dirty = true; counts(); });
    body().addEventListener('input', () => { dirty = true; counts(); });
    src().addEventListener('input', () => { dirty = true; counts(); });
    // Paste as plain text so nothing odd comes in from Word or Google Docs.
    body().addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    $$('[data-cmd]', el).forEach((btn) => btn.addEventListener('mousedown', (e) => e.preventDefault()));
    $$('[data-cmd]', el).forEach((btn) => btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'html') {
        if (src().hidden) { src().value = body().innerHTML.replace(/(<\/(h2|h3|h4|p|ul|ol|li|blockquote)>)/g, '$1\n'); src().hidden = false; body().hidden = true; btn.classList.add('on'); }
        else { body().innerHTML = cleanHtml(src().value); src().hidden = true; body().hidden = false; btn.classList.remove('on'); }
        return;
      }
      if (!src().hidden) return;
      body().focus();
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'list') document.execCommand('insertUnorderedList');
      else if (cmd === 'link') { const u = prompt('Link address (https://...)'); if (u && /^(https?:\/\/|tel:|mailto:|\/)/i.test(u.trim())) document.execCommand('createLink', false, u.trim()); }
      else document.execCommand('formatBlock', false, cmd);
      dirty = true; counts();
    }));
    $('#ctsave', el).addEventListener('click', async (e) => { busy(e.currentTarget, true); try { await save(); draw(); } catch (err) { busy(e.currentTarget, false); toast(err.message, true); } });
    $('#ctai', el).addEventListener('click', async (e) => {
      if (wordCount(currentHtml()) > 30 && !confirm('Replace the current text with a new draft?')) return;
      busy(e.currentTarget, true, 'Writing, about 30 seconds');
      try { if (dirty) await save(true); const r = await api(`/api/content/${it.id}/draft`, { method: 'POST' }); it = r.item; toast(r.ai ? 'Draft written. Read it through and edit.' : 'Outline ready. Fill in each section.'); draw(); }
      catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
    });
    $('#ctdel', el).addEventListener('click', async () => {
      if (!confirm('Delete this page from the Hub? It stays on their website if it was published.')) return;
      try { await api(`/api/content/${it.id}`, { method: 'DELETE' }); location.hash = `#/client/${c.id}/content`; } catch (err) { toast(err.message, true); }
    });
    nextStep();
  };
  window.addEventListener('beforeunload', (e) => { if (dirty && el.isConnected) { e.preventDefault(); e.returnValue = ''; } }, { once: true });
  draw();
}

// ---------- client app ----------
const CLIENT_LABEL = { review: ['warn', 'Needs your OK'], changes: ['gray', 'We are making your changes'], approved: ['', 'Approved'], published: ['', 'Live on your site'] };

export async function waitingCount(clientId) {
  try { const { items } = await api(`/api/clients/${clientId}/content`); return items.filter((i) => i.status === 'review').length; } catch { return 0; }
}

export async function clientContent(v, c, sub) {
  v.innerHTML = '<div class="skeleton"></div>';
  if (sub) {
    let it;
    try { ({ item: it } = await api(`/api/content/${sub}`)); } catch (e) { v.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    const [cls, label] = CLIENT_LABEL[it.status] || ['gray', it.status];
    v.innerHTML = `<p style="margin:4px 0 0"><a href="#/content">All pages</a></p>
      <article class="card ct-read"><span class="badge ${cls}">${label}</span><h1>${esc(it.title)}</h1>${cleanHtml(it.html)}</article>
      ${it.status === 'review' ? `<div class="card"><h2>Does this look right?</h2><p class="muted">Check that the facts about your business are correct. We publish it once you approve.</p>
        <button class="btn btn-mint btn-xl" id="cpok">Approve this page</button>
        <form id="cpch" style="margin-top:14px"><label class="field"><span>Or tell us what to change</span><textarea name="note" rows="4" maxlength="2000" placeholder="We also do tile roofs. Please add that."></textarea></label>
          <button class="btn btn-ghost btn-xl" type="submit" style="margin-top:8px">Send changes</button></form></div>` : ''}
      ${it.live_url ? `<a class="btn btn-ghost btn-xl" href="${esc(it.live_url)}" target="_blank" rel="noopener">See it on your website</a>` : ''}`;
    $('#cpok', v)?.addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { await api(`/api/content/${it.id}/approve`, { method: 'POST' }); toast('Approved. Thank you!'); location.hash = '#/content'; } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
    });
    $('#cpch', v)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/content/${it.id}/changes`, { method: 'POST', body: { note: e.currentTarget.note.value } }); toast('Got it. We will update the page.'); location.hash = '#/content'; } catch (err) { toast(err.message, true); }
    });
    return;
  }
  let items;
  try { ({ items } = await api(`/api/clients/${c.id}/content`)); } catch (e) { v.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  v.innerHTML = items.length ? `<div class="card"><ul class="list">${items.map((it) => { const [cls, label] = CLIENT_LABEL[it.status] || ['gray', it.status]; return `<li class="item">
      <span class="badge ${cls}">${label}</span><div><div class="item-title">${esc(it.title)}</div><div class="item-sub">${esc(fmt.date(it.updated_at))}</div></div>
      <a class="btn ${it.status === 'review' ? 'btn-primary' : 'btn-ghost'} btn-sm" href="#/content/${esc(it.id)}">${it.status === 'review' ? 'Check it' : 'Open'}</a></li>`; }).join('')}</ul></div>`
    : '<div class="card empty"><h3>No pages yet</h3><p>New pages for your website show up here for you to check before they go live.</p></div>';
}
