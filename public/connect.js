// Client connect page: /connect.html#<token>. No login. They sign in with Facebook and choose what to share; the Hub keeps the access.
import { PERMISSIONS, KIND, partnerSteps, PAGE_STEPS } from '/js/meta.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const root = $('#sr');
const token = decodeURIComponent(location.hash.slice(1));
const q = new URLSearchParams(location.search);
const head = '<div class="sr-head"><span><img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth"></span><span class="small muted">Private link. Please do not share it.</span></div>';
const foot = '<p class="small muted cn-foot">You can remove our access any time in Facebook: Settings, Business integrations. <a href="/privacy.html">How we use your information</a>.</p>';

if (q.get('deleted')) {
  root.innerHTML = `${head}<div class="card cn-ok"><h2>Your information was deleted</h2><p>We removed the Facebook and Instagram access you gave Rightway Growth, and what we saved from it. Confirmation code: <span class="cn-code">${esc(q.get('deleted'))}</span></p></div>${foot}`;
} else if (!token) {
  root.innerHTML = `${head}<div class="card cn-err"><h2>${q.get('err') ? 'That did not finish' : 'This link is missing something'}</h2><p>${esc(q.get('err') || 'Open the whole link we sent you, or ask your Rightway Growth contact to send it again.')}</p>${q.get('err') ? '<p class="small muted">Open the link we sent you again to start over.</p>' : ''}</div>`;
} else {
  let d;
  try {
    const res = await fetch(`/api/public/meta/${encodeURIComponent(token)}`);
    d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'This link is not working.');
  } catch (e) {
    root.innerHTML = `${head}<div class="card cn-err"><h2>This link is not working</h2><p>${esc(e.message)}</p></div>`;
    d = null;
  }
  if (d) paint(d);
}

function paint(d) {
  const err = q.get('err');
  const done = q.get('done');
  const start = `/api/public/meta/${encodeURIComponent(token)}/start`;
  const conns = d.connected || [];
  const have = conns.length > 0;
  const thin = conns.some((c) => c.problems.length);
  const steps = partnerSteps(d.businessId, d.company);
  root.innerHTML = `${head}
    <div class="sr-hero"><div class="eyebrow">${esc(d.company)}</div><h1>${have ? (thin ? 'Almost done' : 'Your accounts are connected') : `Connect ${esc(d.business || 'your business')} to Facebook and Instagram`}</h1>
      <p>${have ? (thin ? 'We got most of it. One more step below.' : 'Thank you. We can take it from here.') : 'It takes about two minutes. You sign in to Facebook yourself. We never see your password.'}</p></div>
    ${err ? `<div class="card cn-err"><b>That did not finish</b><p style="margin:4px 0 0">${esc(err)}</p></div>` : ''}
    ${done && !have ? '<div class="card cn-warn"><p style="margin:0">Facebook sent you back, but nothing came through yet. Reload this page in a moment.</p></div>' : ''}
    ${conns.map((c) => `<div class="card ${c.problems.length ? 'cn-warn' : 'cn-ok'}"><b>${esc(c.name || 'Facebook login')}</b><p style="margin:4px 0 0">${esc(c.line)}</p>
      <ul class="cn-as">${c.assets.map((a) => `<li><span>${esc(a.name)}</span><span class="small muted">${esc(KIND[a.kind] || a.kind)}</span></li>`).join('')}</ul>
      ${c.problems.length ? `<p style="margin:10px 0 0"><b>To finish:</b></p><ul>${c.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>`).join('')}
    ${d.configured ? `<div class="card cn-go">
      ${have ? '<b>Need to add another Page or account?</b>' : '<b>Sign in once and choose what to share</b>'}
      <a class="btn btn-primary" href="${esc(start)}">${have ? 'Connect again' : 'Continue with Facebook'}</a>
      <p class="small muted" style="margin:0">Use the Facebook login that runs your business Page. When Facebook asks which Pages and Instagram accounts to share, choose all of them and leave every box ticked.</p></div>` : '<div class="card cn-warn"><b>Almost ready</b><p style="margin:4px 0 0">We are finishing a setup step on our side. Use the partner option below, or check back soon.</p></div>'}
    ${have ? '' : `<div class="card"><h2>What happens</h2><ol class="cn-steps">
      <li><span>Click the button and sign in to Facebook.</span></li>
      <li><span>Pick the Facebook Page and Instagram account for ${esc(d.business || 'your business')}, plus your ad account if you have one.</span></li>
      <li><span>Facebook brings you back here. That is it.</span></li></ol></div>
    <div class="card"><h2>What this lets us do</h2><ul class="cn-do">${PERMISSIONS.map((p) => `<li>${esc(p.why)}</li>`).join('')}</ul>
      <p class="small muted" style="margin:10px 0 0">We only use this for ${esc(d.business || 'your business')}. You can take it away any time.</p></div>`}
    <details class="card"><summary>Rather not sign in? Add us as a partner instead</summary>
      <p class="small">Same result, done inside your own Meta Business account.</p>
      <ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${d.businessId ? `<p>Our Business ID: <span class="cn-code">${esc(d.businessId)}</span></p>` : '<p class="small muted">Ask us for our Business ID before you start.</p>'}
      <p class="small"><b>No Meta Business account?</b> Add one of our team to your Facebook Page directly:</p>
      <ol>${PAGE_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="small muted">Facebook changes these menus now and then. If something looks different, tell us and we will walk you through it.</p></details>
    ${foot}`;
}
