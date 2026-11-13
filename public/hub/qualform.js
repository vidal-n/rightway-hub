// Lead panel parts for the Lead database: the call history roll up ("Call intelligence") and the qualification form.
// Qualification follows ANUM on the cold call (authority first) and GPCTBA/C&I, NEAT and FAINT questions on the audit call (fields in public/js/leaddb.js).
import { $, $$, esc, api, toast, busy, fmt } from './core.js';
import { QUAL, answeredLabel, objectionLabel, comboLabel, engageTier, reachTier, anum } from '../js/leaddb.js';

const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;
const parseQ = (q) => { if (q && typeof q === 'object') return q; try { return JSON.parse(q || '{}') || {}; } catch { return {}; } };

export function callIntelHtml(l) {
  const rows = [
    ['Dials', l.r_dials || 0], ['A person picked up', l.r_connects || 0], ['Reached the owner', l.r_owner ? `${l.r_owner}${l.r_to_owner ? ` (first on dial ${l.r_to_owner})` : ''}` : 0],
    ['Owner talks over 60s', l.r_convs || 0], ['Staff or answering service', l.r_staff || 0], ['Phone menus', l.r_menu || 0], ['Voicemail', l.r_vm || 0], ['No answer', l.r_noans || 0],
    ['Dead or wrong number', (l.r_dead || 0) + (l.r_wrong || 0)], ['Hung up in 10 seconds', l.r_fast_hangs || 0], ['Total talk', mmss(l.r_talk)], ['Longest call', mmss(l.r_longest)],
    ['Last call reached', l.r_last_by ? answeredLabel(l.r_last_by) : 'Not called yet'], ['Last result', l.r_last_dispo || ''], ['Last objection', l.r_obj ? objectionLabel(l.r_obj) : ''],
    ['First dialed', l.r_first_at ? fmt.date(l.r_first_at) : ''], ['Calls in the last 24 hours', l.r_24h || 0],
  ];
  const tip = `Fit ${l.grade || 'not scored'}, engagement ${l.engage_score ?? 0} (tier ${engageTier(l.engage_score || 0)}), reach ${l.reach_score ?? 0} (tier ${reachTier(l.reach_score || 0)})`;
  return `<div class="ci">
    <div class="ci-scores"><span class="db-combo g-${esc((l.grade || 'x').toLowerCase())}" title="${esc(tip)}">${esc(comboLabel(l.grade, l.engage_score))}</span>
      <span><b class="mono">${l.score ?? '-'}</b> fit</span><span><b class="mono">${l.reach_score ?? '-'}</b> reach</span><span><b class="mono">${l.engage_score ?? '-'}</b> engagement</span></div>
    ${l.menu_path ? `<p class="small" style="margin:6px 0"><b>Phone menu:</b> ${esc(l.menu_path)}</p>` : ''}
    <dl class="ci-dl">${rows.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>
    <p class="small muted" style="margin:6px 0 0">Grade letter is fit, the number is engagement (1 is hottest), and reach says how likely the owner answers. Updated after every saved result.</p></div>`;
}

function input(q, v) {
  const name = `q_${q.k}`;
  if (q.type === 'text') return `<label class="field"><span>${esc(q.label)}</span><input name="${name}" maxlength="300" value="${esc(v || '')}"></label>`;
  if (q.type === 'num') return `<label class="field"><span>${esc(q.label)}</span><input name="${name}" inputmode="numeric" value="${esc(v ?? '')}"></label>`;
  if (q.type === 'pick') return `<label class="field"><span>${esc(q.label)}</span><select name="${name}"><option value="">Not asked</option>${q.options.map(([k, n]) => `<option value="${k}"${v === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  const on = new Set(Array.isArray(v) ? v : []);
  return `<div class="field qf-multi"><span>${esc(q.label)}</span><div>${q.options.map(([k, n]) => `<label><input type="checkbox" name="${name}" value="${k}"${on.has(k) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div></div>`;
}

export function mountQual(box, l, onSaved) {
  let q = parseQ(l.qual);
  const draw = () => {
    const a = anum(q);
    const flag = (k, n) => `<span class="badge ${a[k] == null ? 'gray' : a[k] ? 'ok' : 'bad'}">${n} ${a[k] == null ? '?' : a[k] ? 'yes' : 'no'}</span>`;
    box.innerHTML = `<form class="qf">
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${flag('authority', 'Authority')}${flag('need', 'Need')}${flag('urgency', 'Urgency')}${flag('money', 'Money')}</div>
      <h4>On the cold call (ANUM: authority first)</h4><div class="qf-grid">${QUAL.filter((x) => x.stage === 'call').map((x) => input(x, q[x.k])).join('')}</div>
      <details class="qf-audit"${QUAL.some((x) => x.stage === 'audit' && q[x.k] != null) ? ' open' : ''}><summary>On the audit call (goals, plans, money, who decides)</summary>
        <div class="qf-grid">${QUAL.filter((x) => x.stage === 'audit').map((x) => input(x, q[x.k])).join('')}</div></details>
      <div class="row end" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="submit">Save answers</button></div></form>`;
    $('form', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget, out = {};
      for (const x of QUAL) {
        if (x.type === 'multi') { const l2 = $$(`[name="q_${x.k}"]:checked`, f).map((i) => i.value); if (l2.length) out[x.k] = l2; }
        else { const v = f[`q_${x.k}`]?.value?.trim(); if (v) out[x.k] = v; }
      }
      busy($('button[type=submit]', f), true);
      try { const r = await api(`/api/leads/${l.id}/qual`, { method: 'PUT', body: { qual: out } }); q = r.qual; toast(`Saved ${r.qual_n} answer${r.qual_n === 1 ? '' : 's'}`); draw(); onSaved?.(); }
      catch (err) { busy($('button[type=submit]', f), false); toast(err.message, true); }
    });
  };
  draw();
}
