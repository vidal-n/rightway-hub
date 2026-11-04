// Public work order page: review, sign with a typed name, then pay through Stripe.
// New orders carry the one Rightway service agreement (public/js/agreement.js); older orders keep their plan layout.
import { agreementHtml, AGREEMENT_CSS } from '/js/agreement.js';

document.head.insertAdjacentHTML('beforeend', `<style>${AGREEMENT_CSS}</style>`);
const box = document.getElementById('wo');
const token = location.hash.slice(1);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const logo = '<img class="logo-light" src="/brand/rightway-logo-light.svg" alt="Rightway Growth" width="185" height="30"><img class="logo-dark" src="/brand/rightway-logo-dark.svg" alt="Rightway Growth" width="185" height="30">';

async function load() {
  if (!token) return fail('This link is missing its code.');
  try {
    const res = await fetch(`/api/public/wo/${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the work order.');
    render(data.order);
  } catch (e) { fail(e.message); }
}

function fail(msg) {
  box.innerHTML = `<div class="wo-head">${logo}</div><div class="card"><h2>We couldn't open this work order</h2><p class="muted">${esc(msg)}</p><p class="small">Contact Rightway Growth for a new link.</p></div>`;
}

function render(o) {
  if (o.sections) return renderAgreement(o);
  const signed = o.status !== 'sent';
  box.innerHTML = `
    <div class="wo-head">${logo}<span class="badge ${signed ? '' : 'warn'}">${signed ? (o.status === 'paid' ? 'Signed and paid' : 'Signed') : 'Ready to sign'}</span></div>
    <div class="card">
      <p class="eyebrow">Work order</p>
      <h1 style="font-size:32px">${esc(o.business)}</h1>
      <p class="muted">${esc(o.plan)} plan${o.contact_name ? ` for ${esc(o.contact_name)}` : ''}</p>
      <div class="price">
        <div><b>${money(o.monthly_cents)}</b><span class="small">per month</span></div>
        <div><b>${money(o.setup_cents)}</b><span class="small">one-time setup</span></div>
        <div><b>${money(o.monthly_cents + o.setup_cents)}</b><span class="small">due today</span></div>
      </div>
    </div>
    <div class="card"><h2>What's included</h2><ul>${o.includes.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>
    <div class="card"><h2>Terms</h2><ul>${o.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    ${signed ? `
      <div class="signed"><div class="small">Signed electronically</div><div class="sig">${esc(o.signed_name)}</div>
        <div class="small">${esc(new Date(o.signed_at).toLocaleString('en-US'))}</div></div>
      <div class="row no-print">${o.pay_url ? `<a class="btn btn-primary btn-xl" style="width:auto;flex:1 1 260px" href="${esc(o.pay_url)}">Pay ${money(o.monthly_cents + o.setup_cents)} and start</a>` : ''}
        <button class="btn btn-ghost btn-xl" style="width:auto" onclick="print()">Print or save a copy</button></div>` : `
      <form class="card no-print" id="sign">
        <h2>Sign</h2>
        <label class="field"><span>Type your full name</span><input name="name" autocomplete="name" required minlength="3"></label>
        <label class="row" style="margin:14px 0;gap:10px;align-items:flex-start"><input type="checkbox" name="agree" required>
          <span>I agree to this work order and its terms, and I'm authorized to sign for ${esc(o.business)}. My typed name is my electronic signature.</span></label>
        <button class="btn btn-primary btn-xl" type="submit">Sign work order</button>
        <p class="err-text" id="err" role="alert"></p>
      </form>`}
    <p class="small" style="text-align:center">Rightway Growth LLC · Hollywood, Florida · rightwaygrowth.com</p>`;
  wireSign(box);
}

const printLogo = '<img src="/brand/rightway-logo-light.svg" alt="Rightway Growth" width="185" height="30">';

function renderAgreement(o) {
  const signed = o.status !== 'sent';
  const today = o.monthly_cents + o.setup_cents;
  box.innerHTML = `
    <div class="wo-head no-print">${logo}<span class="badge ${signed ? '' : 'warn'}">${signed ? (o.status === 'paid' ? 'Signed and paid' : 'Signed') : 'Ready to sign'}</span></div>
    ${agreementHtml({ sections: o.sections, business: o.business, contact: o.contact_name, logo: printLogo, sig: signed ? { name: o.signed_name, at: o.signed_at } : null })}
    ${signed ? `
      <div class="signed no-print"><div class="small">Signed electronically ${esc(new Date(o.signed_at).toLocaleString('en-US'))}</div><div class="sig">${esc(o.signed_name)}</div></div>
      <div class="row no-print">${o.pay_url ? `<a class="btn btn-primary btn-xl" style="width:auto;flex:1 1 260px" href="${esc(o.pay_url)}">Pay ${money(today)} and start</a>` : ''}
        <button class="btn btn-ghost btn-xl" style="width:auto" onclick="print()">Print or save a copy</button></div>` : `
      <form class="card no-print" id="sign">
        <h2>Sign</h2>
        <p class="muted">Due today: <b>${money(today)}</b> (setup ${money(o.setup_cents)} and first month ${money(o.monthly_cents)}). Then ${money(o.monthly_cents)} a month.</p>
        <label class="field"><span>Type your full name</span><input name="name" autocomplete="name" required minlength="3"></label>
        <label class="row" style="margin:14px 0;gap:10px;align-items:flex-start"><input type="checkbox" name="agree" required>
          <span>I have read and agree to this Agreement, including the three month minimum term, and I'm authorized to sign for ${esc(o.business)}. My typed name is my electronic signature.</span></label>
        <button class="btn btn-primary btn-xl" type="submit">Sign agreement</button>
        <p class="err-text" id="err" role="alert"></p>
      </form>`}`;
  wireSign(box);
}

function wireSign(root) {
  const form = root.querySelector('#sign');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const res = await fetch(`/api/public/wo/${encodeURIComponent(token)}/sign`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.name.value.trim(), agree: form.agree.checked }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not sign.');
        render(data.order);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
    });
  }
}

load();
