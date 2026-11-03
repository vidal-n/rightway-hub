// Automatic ranking scans: the Settings card (owners turn it on), the progress strip and "Run scan now" on a client's
// Rankings tab, and the keyword trend (this scan vs the one before). The page nudges the queue while jobs are waiting,
// so scans keep moving even if the cron is slow.
import { $, $$, esc, api, toast, busy, fmt } from './core.js';

const COST = 0.004;
const est = (n, c) => Math.round(n * c.keywords * c.size * c.size * COST * (30 / c.everyDays) * 100) / 100;
const STATUS = { queued: ['gray', 'Waiting'], running: ['warn', 'Scanning'], done: ['', 'Done'], failed: ['bad', 'Failed'] };
const pct = (j) => (j.total ? Math.round((100 * j.done) / j.total) : 0);

let pump = null;
// While jobs are waiting, ask the server to work on them every few seconds. Stops when the queue is empty or the page changes.
function keepQueueMoving(onTick, el) {
  clearInterval(pump);
  pump = setInterval(async () => {
    if (!el.isConnected) { clearInterval(pump); pump = null; return; }
    try {
      const r = await api('/api/autoscan/tick', { method: 'POST' });
      await onTick(r);
      if (!r.queued) { clearInterval(pump); pump = null; }
    } catch { /* try again next time */ }
  }, 6000);
}

const jobLine = (j, withClient) => {
  const [cls, label] = STATUS[j.status] || ['gray', j.status];
  return `<li class="item"><span class="badge ${cls}">${label}${j.status === 'running' ? ` ${pct(j)}%` : ''}</span>
    <div><div class="item-title">${withClient && j.client ? `<a href="#/client/${esc(j.client_id)}/rankings">${esc(j.client)}</a>: ` : ''}"${esc(j.keyword)}"</div>
    <div class="item-sub">${j.error ? `<span class="bad-text">${esc(j.error)}</span>` : j.finished_at ? `Finished ${esc(fmt.date(j.finished_at))}` : `Added ${esc(fmt.date(j.created_at))}`}</div></div><span></span></li>`;
};

// ---------- Settings card ----------
export async function autoScanCard(box, user) {
  if (!box) return;
  const owner = user.role === 'admin';
  const draw = async () => {
    let d;
    try { d = await api('/api/autoscan'); } catch (e) { box.innerHTML = `<div class="card"><p class="err-text">${esc(e.message)}</p></div>`; return; }
    const c = d.config;
    const dis = owner ? '' : ' disabled';
    box.innerHTML = `<div class="card"><div class="card-head"><h2>Monthly ranking scans</h2>
        <label class="switch" title="${c.enabled ? 'On' : 'Off'}"><input type="checkbox" id="asOn"${c.enabled ? ' checked' : ''}${dis} aria-label="Monthly scans on or off"><span></span></label></div>
      <p class="muted">${c.enabled ? 'On.' : 'Off.'} The Hub re-runs a map scan for every active client on a schedule, using the target keywords on each client's profile. Results land on the client's Rankings tab and in their app, and feed the monthly report.</p>
      <form id="asf" class="form-grid" style="margin-top:12px">
        <label class="field"><span>Grid size</span><select name="size"${dis}>${[3, 5, 7, 9, 11, 13].map((n) => `<option value="${n}"${n === c.size ? ' selected' : ''}>${n} x ${n} (${n * n} spots)</option>`).join('')}</select></label>
        <label class="field"><span>Radius (miles)</span><input name="radius" type="number" min="0.5" max="30" step="0.5" value="${esc(c.radius)}"${dis}></label>
        <label class="field"><span>Keywords per client</span><select name="keywords"${dis}>${[1, 2, 3, 4, 5].map((n) => `<option${n === c.keywords ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Scan every (days)</span><input name="everyDays" type="number" min="7" max="60" value="${esc(c.everyDays)}"${dis}></label>
        <label class="span-all row small" style="gap:8px"><input type="checkbox" name="autoSend"${c.autoSend ? ' checked' : ''}${dis}> Email each client's monthly report as soon as it is ready (otherwise it waits as a draft for you to check)</label>
        <label class="span-all row small" style="gap:8px"><input type="checkbox" name="crawl"${c.crawl !== false ? ' checked' : ''}${dis}> Also check each client's website on the same schedule (free, reads up to 40 pages)</label>
        <p class="span-all small" id="ascost"></p>
        ${owner ? `<div class="span-all row end" style="gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" type="button" id="asall">Scan all clients now</button><button class="btn btn-primary" type="submit">Save</button></div>` : ''}
      </form>
      ${d.demo ? '<p class="small muted" style="margin-top:8px">DataForSEO is not connected, so scans use demo data.</p>' : ''}
      ${d.drafts?.length ? `<h3 style="margin-top:18px">Reports waiting to send <span class="badge warn">${d.drafts.length}</span></h3>
        <ul class="list">${d.drafts.map((r) => `<li class="item"><span class="badge warn">Draft</span><div><div class="item-title"><a href="#/client/${esc(r.client_id)}/reports">${esc(r.name)}</a></div><div class="item-sub">${esc(r.month)}</div></div><a class="btn btn-ghost btn-sm" href="#/client/${esc(r.client_id)}/reports">Check and send</a></li>`).join('')}</ul>` : ''}
      <h3 style="margin-top:18px">Recent scans${d.queued ? ` <span class="badge warn">${d.queued} waiting</span>` : ''}</h3>
      ${d.jobs.length ? `<ul class="list">${d.jobs.slice(0, 10).map((j) => jobLine(j, true)).join('')}</ul>` : '<p class="muted">None yet.</p>'}
    </div>`;
    const f = $('#asf', box);
    const cost = () => {
      const v = { size: Number(f.size.value), keywords: Number(f.keywords.value), everyDays: Math.max(7, Number(f.everyDays.value) || 30) };
      $('#ascost', box).textContent = `About $${est(d.clients, v).toFixed(2)} a month in DataForSEO for ${d.clients} active client${d.clients === 1 ? '' : 's'} (${v.keywords} x ${v.size * v.size} spots each, every ${v.everyDays} days).`;
    };
    cost();
    f.addEventListener('input', cost);
    const save = async (extra = {}) => api('/api/autoscan', { method: 'PUT', body: { size: f.size.value, radius: f.radius.value, keywords: f.keywords.value, everyDays: f.everyDays.value, autoSend: f.autoSend.checked, crawl: f.crawl.checked, ...extra } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await save(); toast('Saved'); draw(); } catch (err) { toast(err.message, true); }
    });
    $('#asOn', box)?.addEventListener('change', async (e) => {
      try { await save({ enabled: e.target.checked }); toast(e.target.checked ? 'Monthly scans are on' : 'Monthly scans are off'); draw(); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
    });
    $('#asall', box)?.addEventListener('click', async (e) => {
      if (!confirm(`Scan every active client now? About $${(est(d.clients, { ...c, everyDays: 30 })).toFixed(2)} in DataForSEO.`)) return;
      busy(e.currentTarget, true, 'Queuing');
      try {
        const r = await api('/api/autoscan/run-all', { method: 'POST' });
        toast(`${r.queued} scan${r.queued === 1 ? '' : 's'} queued${r.skipped ? `. ${r.skipped} client${r.skipped === 1 ? '' : 's'} need an address, Google listing or keywords first.` : ''}`);
        draw();
      } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
    });
    if (d.queued) keepQueueMoving(() => draw(), box);
  };
  await draw();
}

// ---------- Rankings tab: progress strip and Run scan now ----------
export async function scanProgress(box, clientId, onFinished) {
  if (!box) return;
  let wasBusy = false;
  const draw = async () => {
    let jobs = [];
    try { ({ jobs } = await api(`/api/clients/${clientId}/autoscan`)); } catch { return; }
    const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
    const failed = jobs.filter((j) => j.status === 'failed');
    if (!active.length && wasBusy) { wasBusy = false; onFinished?.(); return; }
    box.innerHTML = active.length || failed.length ? `<div class="card scanprog"><div class="card-head"><h2>${active.length ? 'Scanning now' : 'Last scan run'}</h2>
        ${active.length ? '<span class="small muted">You can leave this page. It keeps going.</span>' : ''}</div>
      <ul class="list">${[...active, ...failed.slice(0, 2)].map((j) => jobLine(j, false)).join('')}</ul></div>` : '';
    if (active.length) { wasBusy = true; keepQueueMoving(draw, box); }
  };
  await draw();
  return draw;
}

export async function runScanNow(clientId, btn) {
  busy(btn, true, 'Queuing');
  try {
    const r = await api(`/api/clients/${clientId}/autoscan`, { method: 'POST', body: {} });
    toast(r.queued ? `Scanning ${r.queued} keyword${r.queued === 1 ? '' : 's'}` : 'Those keywords are already being scanned');
    return true;
  } catch (err) { toast(err.message, true); return false; } finally { busy(btn, false); }
}

// ---------- keyword trend: latest scan vs the one before, per keyword ----------
export function trendCard(scans) {
  const by = new Map();
  for (const s of scans) {
    const k = String(s.keyword || '').toLowerCase();
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  if (!by.size) return '';
  const rows = [...by.values()].map((list) => ({ now: list[0], before: list[1] || null, count: list.length }));
  const delta = (a, b, lowerIsBetter, unit = '') => {
    if (a == null || b == null) return '';
    const d = Math.round((a - b) * 10) / 10;
    if (!d) return '<span class="small muted">no change</span>';
    const better = lowerIsBetter ? d < 0 : d > 0;
    return `<span class="small ${better ? 'good-text' : 'bad-text'}">${better ? 'better' : 'worse'} by ${Math.abs(d)}${unit}</span>`;
  };
  return `<div class="card"><div class="card-head"><h2>Keyword trend</h2><span class="small muted">latest scan vs the one before</span></div>
    <div class="table-wrap"><table><thead><tr><th>Keyword</th><th>First page (top 10)</th><th>Average rank</th><th>At address</th><th>Last scan</th></tr></thead><tbody>
    ${rows.map(({ now, before }) => `<tr><td>${esc(now.keyword)}</td>
      <td><b>${now.top10Pct ?? 0}%</b> ${before ? delta(now.top10Pct, before.top10Pct, false, ' pts') : ''}</td>
      <td><b>${now.avgRank ?? '-'}</b> ${before ? delta(now.avgRank, before.avgRank, true) : ''}</td>
      <td>${now.centerRank ? `#${now.centerRank}` : '20+'}${before && now.centerRank && before.centerRank && now.centerRank !== before.centerRank ? ` <span class="small muted">was #${before.centerRank}</span>` : ''}</td>
      <td>${esc(fmt.date(now.created_at))}${now.auto ? ' <span class="badge gray">auto</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
