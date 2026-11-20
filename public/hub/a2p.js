// Settings, A2P texting (owners). Modeled on Twilio's Trust Hub A2P 10DLC registration screens: brand, Messaging Service, campaign.
// The Hub reads Twilio's status and hands over the exact text to paste; V submits it in the Twilio console (it needs the EIN).
import { $, $$, esc, api, toast, copy } from './core.js';
import { staffShell, settingsTabs } from './staff.js';
import { STATE_TEXT } from '/js/a2p.js';

const tone = { registered: '', pending: 'warn', failed: 'warn', nocampaign: 'warn', unattached: 'gray' };
const field = ([k, v]) => `<li class="item"><div style="min-width:0;flex:1"><div class="item-title">${esc(k)}</div><div class="item-sub" style="white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink)">${esc(v)}</div></div><button class="btn btn-ghost btn-sm" data-copy="${esc(v)}">Copy</button></li>`;

export async function a2pPage(app, user) {
  const view = staffShell(app, user, 'settings');
  view.innerHTML = `<div class="page-head"><div><p class="eyebrow">Settings</p><h1>A2P texting</h1></div><button class="btn btn-ghost btn-sm" id="a2r">Check Twilio again</button></div>${settingsTabs('a2p', user)}<div id="a2b"><div class="skeleton"></div></div>`;
  const draw = async () => {
    const host = $('#a2b', view);
    let d;
    try { d = await api('/api/a2p'); } catch (e) { host.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
    host.innerHTML = `<div class="card"><div class="card-head"><h2>Where you are</h2></div>
        <p style="margin:0 0 10px"><b>${esc(d.next)}</b></p>
        ${d.numbers.length ? `<ul class="list">${d.numbers.map((n) => `<li class="item"><div><div class="item-title mono">${esc(n.number)} <span class="badge ${tone[n.state] || 'gray'}">${esc(STATE_TEXT[n.state])}</span></div><div class="item-sub">${esc(n.label || '')}${n.service ? ` · ${esc(n.service)}` : ''}${n.reason ? ` · ${esc(n.reason)}` : ''}</div></div></li>`).join('')}</ul>` : `<p class="small muted">${d.ready ? 'No numbers came back from Twilio.' : 'Twilio is not connected yet.'}</p>`}
        ${d.brands.length ? `<p class="small" style="margin:10px 0 0">Brand: ${d.brands.map((b) => `${esc(b.type || 'brand')} <b>${esc(b.status)}</b>${b.failure ? ` (${esc(b.failure)})` : ''}`).join(', ')}</p>` : ''}
        ${d.errors.length ? `<p class="small muted" style="margin:10px 0 0">Twilio did not answer some questions: ${d.errors.map(esc).join(' · ')}. Twilio only shows these to the right account permissions.</p>` : ''}
        <p class="small muted" style="margin:10px 0 0">The Hub only reads. Until a number shows Registered, carriers block its texts (error 30034) and Automations stays on Email only.</p></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>Have these ready</h2></div><ul class="list">${d.checklist.map(([k, v]) => `<li class="item"><div><div class="item-title">${esc(k)}</div><div class="item-sub">${esc(v)}</div></div></li>`).join('')}</ul></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>1. Brand (the company)</h2></div><p class="small muted">Twilio, Messaging, Regulatory Compliance, A2P 10DLC. Menu names can change. The one time brand fee and the monthly campaign fee are shown on screen before you submit.</p><ul class="list">${d.packet.brand.map(field).join('')}</ul></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>2. Messaging Service</h2></div><p class="small muted">Create one called Rightway Growth, add every number in the list above to its sender pool, and turn on the default STOP and HELP handling. Do not add call tracking numbers.</p></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>3. Campaign (what we text and how people agree)</h2></div><ul class="list">${d.packet.campaign.map(field).join('')}</ul></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>Sample messages</h2></div><p class="small muted">Five samples, written from what the Hub really sends. The first text to anyone carries the company name and the opt out line automatically.</p><ul class="list">${d.packet.samples.map((s) => field(['Sample', s])).join('')}</ul></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>Keywords</h2></div><ul class="list">${d.packet.keywords.map(field).join('')}</ul></div>
      <div class="card" style="margin-top:12px"><div class="card-head"><h2>Before you submit</h2></div><ul class="small" style="margin:0;padding-left:18px;line-height:1.6">
        <li>Open <a href="/terms.html" target="_blank" rel="noopener">/terms.html</a> and <a href="/privacy.html" target="_blank" rel="noopener">/privacy.html</a>. Put the same two pages on rightwaygrowth.com and link them in the footer. Have a lawyer read them.</li>
        <li>The request form on rightwaygrowth.com needs an unticked checkbox with the consent text above, so a reviewer can see the opt in. The booking page already has it.</li>
        <li>Texts to people you only cold called are the likeliest thing for a reviewer to reject. The campaign text above describes opt in from the web forms and from people who text first, which is what carriers accept. Whether a spoken yes on a call is enough is a question for your lawyer, and the text will not describe it.</li>
        <li>If Twilio rejects the campaign, the reason shows here after you press Check Twilio again.</li></ul></div>`;
    $$('[data-copy]', host).forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, 'Copied')));
  };
  $('#a2r', view).onclick = () => draw();
  draw();
}
