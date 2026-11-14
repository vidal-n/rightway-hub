// The quick links bar under the top bar: each person picks the Hub pages they want one tap away, in their own order.
import { $, $$, esc, toast, modal } from './core.js';
import { quickLinks, saveQuick, ensurePrefs } from './nav.js';

const DEFAULTS = ['#/pipeline', '#/phone', '#/calendar'];
// The Pipeline is step one, the dialer step two (Nov 2026, V): a saved list that has the dialer right before the Pipeline gets them swapped.
const pipelineFirst = (l) => { if (!l) return l; const a = l.indexOf('#/phone'), b = l.indexOf('#/pipeline'); if (a < 0 || b < 0 || b < a) return l; const o = l.slice(); o[a] = '#/pipeline'; o[b] = '#/phone'; return o; };
const same = (href) => { const h = location.hash || '#/'; return href === h || (href !== '#/' && href.startsWith('#') && h.startsWith(href) && (h.length === href.length || '/?'.includes(h[href.length]))); };

export function mountQuickBar(host, user, pages) {
  if (!host) return;
  const ok = (href) => pages.some((p) => p[1] === href);
  const draw = () => {
    const mine = pipelineFirst(quickLinks() || DEFAULTS).filter(ok);
    const rows = mine.map((href) => pages.find((p) => p[1] === href)).filter(Boolean);
    host.innerHTML = `<span class="qb-cap">Quick</span>${rows.map(([name, href]) => `<a class="qb-chip${same(href) ? ' is-on' : ''}" href="${esc(href)}">${esc(String(name).split(':')[0])}</a>`).join('')}<button type="button" class="qb-edit" aria-label="Edit quick links" title="Choose your quick links">+ Edit</button>`;
    $('.qb-edit', host).onclick = edit;
  };
  const edit = () => {
    let list = pipelineFirst(quickLinks() || DEFAULTS).filter(ok);
    const m = modal(`<div class="card-head"><h2>Your quick links</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <p class="small muted" style="margin:0 0 10px">Tick the pages you want in the bar at the top. Move them to put them in your order. Only you see this.</p>
      <ul class="list cust-list" id="ql"></ul>
      <div class="row end" style="margin-top:12px"><button class="btn btn-ghost" id="qlreset">Reset</button><button class="btn btn-primary" id="qlsave">Save</button></div>`);
    const paint = () => {
      const rest = pages.filter((p) => !list.includes(p[1]));
      const rowsOf = [...list.map((h) => pages.find((p) => p[1] === h)).filter(Boolean), ...rest];
      $('#ql', m.el).innerHTML = rowsOf.map(([name, href]) => { const on = list.includes(href); const i = list.indexOf(href);
        return `<li class="item"><label class="row" style="gap:10px"><input type="checkbox" data-h="${esc(href)}"${on ? ' checked' : ''}><span>${esc(name)}</span></label><span class="spacer"></span>${on ? `<button class="icon-btn" data-up="${i}"${i === 0 ? ' disabled' : ''} aria-label="Move up">&uarr;</button><button class="icon-btn" data-down="${i}"${i === list.length - 1 ? ' disabled' : ''} aria-label="Move down">&darr;</button>` : ''}</li>`; }).join('');
    };
    paint();
    $('#ql', m.el).addEventListener('change', (e) => { const h = e.target.dataset.h; if (!h) return; if (e.target.checked) { if (list.length >= 12) { e.target.checked = false; return toast('Up to 12 quick links.', true); } list.push(h); } else list = list.filter((x) => x !== h); paint(); });
    $('#ql', m.el).addEventListener('click', (e) => {
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]');
      if (up) { const i = Number(up.dataset.up); [list[i - 1], list[i]] = [list[i], list[i - 1]]; paint(); }
      if (dn) { const i = Number(dn.dataset.down); [list[i + 1], list[i]] = [list[i], list[i + 1]]; paint(); }
    });
    const save = async (l) => { try { await saveQuick(l); m.close(); draw(); toast('Quick links saved'); } catch (err) { toast(err.message, true); } };
    $('#qlsave', m.el).onclick = () => save(list);
    $('#qlreset', m.el).onclick = () => save(DEFAULTS.filter(ok));
  };
  draw();
  ensurePrefs().then(draw).catch(() => {});
  window.addEventListener('hashchange', draw, { once: true });
}
