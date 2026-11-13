// Lead plays card for the Lead finder: ready-made searches (who you get, why they convert, what to expect, three budgets) that fill the form below.
// Modeled on the saved-search and filter-first flow of Scrap.io and Apollo.io; see the notes at the top of /js/plays.js. Nothing here spends money: it only fills the form.
import { $, $$, esc, toast } from './core.js';
import { PLAYS, BUDGETS, TOOLS, planFor, cleanMine } from '/js/plays.js';

const KEY = 'rw-finder-plays';
const readMine = () => { try { return (JSON.parse(localStorage.getItem(KEY) || '[]') || []).map(cleanMine); } catch { return []; } };
const saveMine = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: not saved */ } };
const money = (n) => (n >= 10 ? `$${Math.round(n)}` : `$${Number(n).toFixed(2)}`);
const dots = (n) => `<span class="dots" aria-label="${n} of 3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const GOALS = [['all', 'All plays'], ['book', 'Best for booking'], ['reach', 'Easiest to reach'], ['cheap', 'Cheapest']];
const METERS = [['book', 'Booking odds'], ['reach', 'Easy to reach'], ['deal', 'Deal size'], ['volume', 'Volume']];

// opts: { apply(play, budgetId, start), snapshot() -> {name, industries, filters, source, size, areas}, freeMode }
export function mountPlays(host, opts) {
  let goal = 'all', pick = null, budget = 'standard';
  let mine = readMine();
  const all = () => [...PLAYS, ...mine];
  const cheapest = (p) => planFor(p, 'lean').cost;

  const card = (p) => {
    const lean = p.mine ? null : planFor(p, 'lean');
    const locked = opts.freeMode && p.source === 'google';
    return `<button type="button" class="play${pick === p.id ? ' on' : ''}" data-play="${esc(p.id)}"${locked ? ' disabled title="Free lead data mode is on. This play needs Google Maps."' : ''}>
      <span class="play-top"><b>${esc(p.name)}</b><span class="badge ${p.mine ? 'gray' : ''}">${esc(p.badge)}</span></span>
      <span class="play-who">${esc(p.who)}</span>
      ${p.mine ? '' : `<span class="play-meters">${METERS.map(([k, l]) => `<span title="${l}">${l} ${dots(p.meters[k])}</span>`).join('')}</span>`}
      <span class="play-foot">${p.mine ? 'Saved on this device' : lean.free ? 'Search is free' : `From ${money(lean.cost)}`}${p.source === 'osm' ? ' · OpenStreetMap' : ''}</span></button>`;
  };

  const guide = (p) => {
    const bud = p.mine ? '' : `<div class="pg-budget"><span class="small muted">Budget</span><div class="seg" id="pgb">${BUDGETS.map((b) => {
      const pl = planFor(p, b.id);
      return `<button type="button" data-b="${b.id}" class="${b.id === budget ? 'is-on' : ''}" title="${esc(b.what)}">${esc(b.label)} <small>${pl.free ? 'free' : money(pl.cost)}</small></button>`;
    }).join('')}</div><p class="small muted" style="margin:6px 0 0" id="pgbx">${esc(BUDGETS.find((b) => b.id === budget).what)} ${(() => { const pl = planFor(p, budget); return `${p.industries.length} trades × ${pl.places} cities × ${pl.size * pl.size} map views = ${pl.requests.toLocaleString('en-US')} searches.`; })()}</p></div>`;
    const lines = (t, v) => (v ? `<div class="pg-sec"><h4>${t}</h4><p>${esc(v)}</p></div>` : '');
    return `<div class="pg">
      <div class="pg-head"><h3 style="margin:0">${esc(p.name)}</h3>${p.mine ? '<button type="button" class="btn btn-ghost btn-sm" data-del>Delete my play</button>' : ''}</div>
      <div class="pg-grid">
        ${lines('Who you will get', p.who)}${lines('Why they convert', p.why)}${lines('What to expect', p.expect)}${lines('How to open the call', p.open)}
        ${p.after?.length > 1 ? `<div class="pg-sec"><h4>After you add them</h4><ol class="small" style="margin:0;padding-left:18px">${p.after.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
        ${p.mine ? `<div class="pg-sec"><h4>What is saved</h4><p class="small">${esc(p.industries.join(', ') || 'No trades')} in ${esc(p.areas.join(', ') || 'no places')}.</p></div>` : `<div class="pg-sec"><h4>Trades it searches</h4><p class="small">${esc(p.industries.join(', '))}</p></div>`}
      </div>
      ${bud}
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary" data-act="start">Fill the form and start</button><button type="button" class="btn btn-ghost" data-act="fill">Fill the form only</button><span class="small muted">You can change anything in the form before you start.</span></div>
      ${p.refs?.length ? `<p class="ref-line">Modeled on ${p.refs.map((r) => { const t = TOOLS.find((x) => x.name === r); return t ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a> (${esc(t.what)})` : esc(r); }).join(', ')}.</p>` : ''}
    </div>`;
  };

  const draw = () => {
    const list = all().filter((p) => goal === 'all' || p.mine || p.goals.includes(goal)).sort((a, b) => (goal === 'cheap' ? cheapest(a) - cheapest(b) : 0));
    const p = all().find((x) => x.id === pick);
    host.innerHTML = `<div class="card" id="fplaycard">
      <div class="card-head"><div><h3 style="margin:0">Start from a play</h3><p class="small muted" style="margin:4px 0 0">A play is a lead type that tends to buy what we sell. Pick one and a budget, and it fills the form below. Dots are guidance from how these businesses behave, not measured numbers. Tag every run and compare tags in the Pipeline to find your best play.</p></div></div>
      <div class="seg" id="pgoal" style="margin:6px 0 12px;flex-wrap:wrap">${GOALS.map(([k, l]) => `<button type="button" data-goal="${k}" class="${k === goal ? 'is-on' : ''}">${l}</button>`).join('')}</div>
      <div class="plays-grid">${list.map(card).join('')}</div>
      ${p ? guide(p) : '<p class="small muted" style="margin:12px 0 0">Pick a play to see who it finds, why they convert, and what it costs.</p>'}
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap;align-items:flex-end" id="pgmine">
        <label class="field" style="flex:1 1 220px;margin:0"><span>Save the form as my play</span><input id="pgname" placeholder="e.g. Broward roofers, no website"></label>
        <button type="button" class="btn btn-ghost" data-act="save">Save as my play</button>
      </div>
      <p class="ref-line" style="margin-top:10px">Built on proven local lead prospecting ideas: ${TOOLS.map((t) => `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>`).join(', ')}.</p>
    </div>`;
  };
  draw();

  host.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goal]'); if (g) { goal = g.dataset.goal; draw(); return; }
    const c = e.target.closest('[data-play]'); if (c && !c.disabled) { pick = pick === c.dataset.play ? null : c.dataset.play; draw(); if (pick) $('.pg', host)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    const b = e.target.closest('[data-b]'); if (b) { budget = b.dataset.b; draw(); return; }
    const p = all().find((x) => x.id === pick);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fill' || act === 'start') { if (p) opts.apply(p, budget, act === 'start'); return; }
    if (e.target.closest('[data-del]') && p?.mine) { mine = mine.filter((x) => x.id !== p.id); saveMine(mine); pick = null; draw(); toast('Play deleted'); return; }
    if (act === 'save') {
      const name = $('#pgname', host).value.trim();
      if (!name) { toast('Give the play a name first', true); return; }
      const snap = opts.snapshot();
      if (!snap.industries.length || !snap.areas.length) { toast('Pick trades and places in the form first', true); return; }
      const p2 = cleanMine({ ...snap, name, who: `${snap.industries.slice(0, 3).join(', ')}${snap.industries.length > 3 ? ' and more' : ''} in ${snap.areas.slice(0, 3).join(', ')}${snap.areas.length > 3 ? ' and more' : ''}.` });
      mine = [...mine.filter((x) => x.name !== p2.name), p2]; saveMine(mine); pick = p2.id; draw(); toast('Saved. It is under your plays.');
    }
  });
  return { refresh: draw };
}
