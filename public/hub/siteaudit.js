// Site audit tab: website health score, what to fix, the fix log (before and after), schema to paste, and the pages read.
import { $, $$, esc, api, toast, copy, modal, busy, fmt } from './core.js';

const SEV = { high: ['bad', 'High'], medium: ['warn', 'Medium'], low: ['gray', 'Low'] };
const DONE = {
  broken: 'Fixed a broken link', https: 'Turned on https', 'http-redirect': 'Sent http visitors to https', 'title-missing': 'Added a page title',
  'title-long': 'Shortened the page title', 'title-dupe': 'Gave the page its own title', 'desc-missing': 'Wrote a meta description', 'desc-dupe': 'Wrote a unique meta description',
  'h1-missing': 'Added an H1 heading', 'h1-many': 'Kept one H1 on the page', thin: 'Added more useful content to the page', alt: 'Added alt text to the images',
  noindex: 'Let Google show the page (removed noindex)', mixed: 'Moved insecure files to https', viewport: 'Made the home page phone friendly', tel: 'Added a tap-to-call link',
  'nap-phone': 'Matched the home page phone to the Google profile', schema: 'Added local business schema', 'home-city': 'Added the city to the home page title',
  sitemap: 'Turned on a sitemap', robots: 'Unblocked the site in robots.txt',
};
let pump = null;

export async function siteTab(el, c) {
  el.innerHTML = '<div class="skeleton"></div>';
  let d;
  try { d = await api(`/api/clients/${c.id}/site`); } catch (e) { el.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const again = () => siteTab(el, c);
  const a = d.audit;
  const run = d.running;
  const active = run && run.status !== 'failed';
  const change = a && d.previous ? a.score - d.previous.score : null;
  const pageOf = (url) => a?.pages.find((p) => p.url === url) || null;
  if (!d.website) {
    el.innerHTML = '<div class="card empty"><h3>No website on file</h3><p>Add the website on the Profile tab, then check it here.</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="card"><div class="card-head"><h2>Website health</h2>
        <button class="btn ${a ? 'btn-ghost' : 'btn-primary'} btn-sm" id="sarun"${active ? ' disabled' : ''}>${active ? 'Checking...' : a ? 'Check again' : 'Check the site'}</button></div>
      ${active ? `<div class="sa-prog"><span class="spin"></span> Reading ${esc(d.website)}: ${run.pages} of up to ${run.max} pages. You can leave this page.</div>` : ''}
      ${run?.status === 'failed' ? `<p class="err-text">Last check failed: ${esc(run.error || 'unknown error')}</p>` : ''}
      ${a ? `<div class="sa-top"><div class="sa-score ${a.score >= 80 ? 'good' : a.score >= 50 ? 'mid' : 'low'}"><b>${a.score}</b><span>of 100</span></div>
        <div><p style="margin:0"><b>${a.issues.length} thing${a.issues.length === 1 ? '' : 's'} to fix</b> across ${a.pages.length} page${a.pages.length === 1 ? '' : 's'}.
          ${change != null ? `<span class="${change >= 0 ? 'good-text' : 'bad-text'}">${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)} since the last check.</span>` : ''}</p>
          <p class="small muted" style="margin:4px 0 0">Checked ${esc(fmt.date(a.at))}. ${a.https ? 'Secure (https).' : 'Not secure.'} ${a.sitemap ? 'Sitemap found.' : 'No sitemap.'}</p>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${['high', 'medium', 'low'].map((s) => { const n = a.issues.filter((i) => i.severity === s).length; return n ? `<span class="badge ${SEV[s][0]}">${n} ${SEV[s][1].toLowerCase()}</span>` : ''; }).join('')}</div></div></div>`
        : active ? '' : `<p class="muted">Reads up to 40 pages of ${esc(d.website)} and lists what to fix: titles, descriptions, headings, thin pages, broken links, phone and schema. Free to run.</p>`}
    </div>
    ${a ? `<div class="card"><div class="card-head"><h2>What to fix</h2><span class="small muted">Highest impact first</span></div>
      ${a.issues.length ? `<ul class="list">${a.issues.map((i, n) => `<li class="item sa-issue"><span class="badge ${SEV[i.severity][0]}">${SEV[i.severity][1]}</span>
        <div><div class="item-title">${esc(i.title)}${i.count > 1 ? ` <span class="small muted">(${i.count} pages)</span>` : ''}</div>
          <div class="item-sub">${esc(i.detail)}</div><div class="small" style="margin-top:4px"><b>Fix:</b> ${esc(i.fix)}</div>
          ${i.pages.length ? `<details class="small" style="margin-top:6px"><summary>Pages</summary><ul class="sa-pages">${i.pages.map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.path)}</a></li>`).join('')}</ul></details>` : ''}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-task="${n}">Make a task</button><button class="btn btn-primary btn-sm" data-fix="${n}">Log a fix</button></div></li>`).join('')}</ul>`
        : '<p class="muted">Nothing to fix. Nice.</p>'}</div>` : ''}
    <div class="card"><div class="card-head"><h2>Fix log</h2><button class="btn btn-ghost btn-sm" id="safree">Log another fix</button></div>
      <p class="small muted">Each fix counts as this month's on-page work. The next check confirms it.</p>
      ${d.fixes.length ? `<ul class="list">${d.fixes.map((f) => `<li class="item"><span class="badge ${f.status === 'verified' ? '' : 'gray'}">${f.status === 'verified' ? 'Confirmed' : 'Fixed'}</span>
        <div><div class="item-title">${esc(f.what)}</div><div class="item-sub">${esc(fmt.date(f.at))}${f.page ? `, ${esc(f.page.replace(/^https?:\/\/[^/]+/, '') || '/')}` : ''}</div>
          ${f.before || f.after ? `<div class="sa-ba small">${f.before ? `<div><b>Before</b> ${esc(f.before)}</div>` : ''}${f.after ? `<div><b>After</b> ${esc(f.after)}</div>` : ''}</div>` : ''}</div>
        <button class="btn btn-ghost btn-sm" data-delfix="${esc(f.id)}" aria-label="Delete">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No fixes logged yet.</p>'}</div>
    <div class="card"><div class="card-head"><h2>Schema</h2><span class="badge gray">${esc(d.schema.json['@type'])}</span></div>
      <p class="small muted">Paste this into the site's header (WordPress: a header code plugin, or the SEO plugin's schema box). It tells Google the name, address, phone, area and services.${d.schema.missing.length ? ` Add the ${esc(d.schema.missing.join(', '))} on the Profile tab first for a complete version.` : ''}</p>
      <pre class="sa-code" tabindex="0">${esc(d.schema.html)}</pre>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-ghost btn-sm" id="sacopy">Copy</button>
        <a class="btn btn-ghost btn-sm" href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Test with Google</a>
        <span class="spacer"></span><button class="btn btn-primary btn-sm" id="saadded">It is on the site</button></div></div>
    ${a ? `<details class="card"><summary><b>Pages read (${a.pages.length})</b></summary><div class="table-wrap" style="margin-top:10px"><table class="small"><thead><tr><th>Page</th><th>Status</th><th>Title</th><th>Words</th><th>H1</th></tr></thead><tbody>
      ${a.pages.map((p) => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\/[^/]+/, '') || '/')}</a></td><td>${p.status || 'none'}</td><td>${esc(p.title || '')}${p.titleLen > 65 ? ' <span class="bad-text">(long)</span>' : ''}</td><td>${p.words ?? ''}</td><td>${p.h1Count ?? ''}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}`;

  $('#sarun', el)?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Starting');
    try { await api(`/api/clients/${c.id}/site/audit`, { method: 'POST' }); again(); } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
  });
  $('#sacopy', el).addEventListener('click', () => copy(d.schema.html, 'Schema copied'));
  $('#saadded', el).addEventListener('click', () => fixModal(c, { key: 'schema', kind: 'technical', what: `Added ${d.schema.json['@type']} schema to the home page`, page: a?.pages.find((p) => p.home)?.url || '', before: 'No local business schema', after: `${d.schema.json['@type']} JSON-LD with name, address, phone, area and services` }, again));
  $('#safree', el).addEventListener('click', () => fixModal(c, {}, again));
  $$('[data-fix]', el).forEach((b) => b.addEventListener('click', () => {
    const i = a.issues[Number(b.dataset.fix)];
    const p = i.pages[0] ? pageOf(i.pages[0].url) : null;
    const before = /title/.test(i.key) || i.key === 'home-city' ? p?.title : /desc/.test(i.key) ? p?.description : /h1/.test(i.key) ? p?.h1 : '';
    fixModal(c, { key: i.key, kind: i.kind, what: DONE[i.key] || `Fixed: ${i.title}`, pages: i.pages, before: before || '' }, again);
  }));
  $$('[data-task]', el).forEach((b) => b.addEventListener('click', async () => {
    const i = a.issues[Number(b.dataset.task)];
    busy(b, true);
    try {
      await api(`/api/clients/${c.id}/tasks`, { method: 'POST', body: { title: `${i.title}${i.pages.length === 1 ? ` (${i.pages[0].path})` : ''}`, kind: i.kind === 'technical' ? 'technical' : 'onpage' } });
      toast('Added to this month\'s tasks'); b.textContent = 'Task added';
    } catch (err) { busy(b, false); toast(err.message, true); }
  }));
  $$('[data-delfix]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this fix from the log?')) return;
    try { await api(`/api/site/fixes/${b.dataset.delfix}`, { method: 'DELETE' }); again(); } catch (err) { toast(err.message, true); }
  }));

  // Keep the crawl moving while this page is open.
  clearInterval(pump);
  if (active) {
    pump = setInterval(async () => {
      if (!el.isConnected) { clearInterval(pump); return; }
      try {
        await api('/api/site/tick', { method: 'POST' });
        const s = await api(`/api/clients/${c.id}/site`);
        if (!s.running || s.running.status === 'failed') { clearInterval(pump); again(); }
        else { const pr = $('.sa-prog', el); if (pr) pr.innerHTML = `<span class="spin"></span> Reading ${esc(d.website)}: ${s.running.pages} of up to ${s.running.max} pages. You can leave this page.`; }
      } catch { /* next time */ }
    }, 5000);
  }
}

function fixModal(c, pre, done) {
  const m = modal(`<h2>Log a fix</h2><form id="fxf" class="form-grid" style="grid-template-columns:1fr">
    <label class="field"><span>What was fixed</span><input name="what" required maxlength="200" value="${esc(pre.what || '')}" placeholder="Rewrote the home page title"></label>
    ${pre.pages?.length > 1 ? `<label class="field"><span>Page</span><select name="page">${pre.pages.map((p) => `<option value="${esc(p.url)}">${esc(p.path)}</option>`).join('')}<option value="">All of them</option></select></label>`
      : `<label class="field"><span>Page (optional)</span><input name="page" value="${esc(pre.page || pre.pages?.[0]?.url || '')}" placeholder="https://..."></label>`}
    <label class="field"><span>Before</span><textarea name="before" rows="2" maxlength="2000">${esc(pre.before || '')}</textarea></label>
    <label class="field"><span>After</span><textarea name="after" rows="2" maxlength="2000">${esc(pre.after || '')}</textarea></label>
    <div class="row end" style="gap:8px"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save fix</button></div></form>`);
  $('#fxf', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy($('button[type=submit]', f), true);
    try {
      const r = await api(`/api/clients/${c.id}/site/fixes`, { method: 'POST', body: { key: pre.key || '', kind: pre.kind, what: f.what.value, page: f.page.value, before: f.before.value, after: f.after.value } });
      m.close(); toast(r.task ? 'Fix logged. This month\'s on-page task is checked off.' : 'Fix logged'); done();
    } catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
  });
}
