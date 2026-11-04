// Public work order page: review, sign with a typed name, then pay through Stripe.
// New orders carry the one Rightway service agreement (public/js/agreement.js); older orders keep their plan layout.
import { agreementHtml, AGREEMENT_CSS, SIG_FONTS, SIG_FONTS_URL, initialsOf, TITLES } from '/js/agreement.js';

document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${SIG_FONTS_URL}"><style>${AGREEMENT_CSS}
.fontpick { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 6px; }
.fontpick label { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; cursor: pointer; background: var(--surface-2); display: flex; align-items: center; gap: 8px; min-height: 58px; }
.fontpick input { width: auto; min-height: 0; }
.fontpick span { font-size: 24px; line-height: 1.1; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fontpick label:has(input:checked) { border-color: var(--mint-strong); background: var(--mint-soft); }
#sign input[type=checkbox] { width: 20px; height: 20px; min-height: 0; flex: none; margin-top: 2px; }
#sign label.row { flex-wrap: nowrap; }</style>`);
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
  const title = o.title || TITLES[o.kind] || TITLES.seo;
  const draw = (preview) => agreementHtml({ sections: o.sections, title, business: o.business, contact: o.contact_name, logo: printLogo, preview,
    sig: signed ? { name: o.signed_name, at: o.signed_at, font: o.signed_font, initials: o.initials, initialsFont: o.initials_font } : null });
  const due = o.kind === 'website' ? `Due today: <b>${money(o.setup_cents)}</b> (website build fee)${o.monthly_cents ? `. Then ${money(o.monthly_cents)} a month for hosting and care.` : '.'}`
    : `Due today: <b>${money(today)}</b> (buildout ${money(o.setup_cents)} and first month ${money(o.monthly_cents)}). Then ${money(o.monthly_cents)} a month.`;
  const payNow = o.kind === 'website' ? o.setup_cents : today;
  const pick = (name, text) => `<div class="fontpick" role="radiogroup">${SIG_FONTS.map((f, i) => `<label><input type="radio" name="${name}" value="${esc(f)}"${i ? '' : ' checked'}><span style="font-family:'${esc(f)}',cursive" data-text="${name}">${esc(text)}</span></label>`).join('')}</div>`;
  box.innerHTML = `
    <div class="wo-head no-print">${logo}<span class="badge ${signed ? '' : 'warn'}">${signed ? (o.status === 'paid' ? 'Signed and paid' : 'Signed') : 'Ready to sign'}</span></div>
    <div id="doc">${draw(signed ? null : { name: o.contact_name || '', at: Date.now(), font: SIG_FONTS[0], initialsFont: SIG_FONTS[0] })}</div>
    ${signed ? `
      <div class="row no-print">${o.pay_url ? `<a class="btn btn-primary btn-xl" style="width:auto;flex:1 1 260px" href="${esc(o.pay_url)}">Pay ${money(payNow)} and start</a>` : '<p class="muted">Thank you. Your payment link is on its way from Rightway Growth.</p>'}
        <button class="btn btn-ghost btn-xl" style="width:auto" onclick="print()">Print or save a copy</button></div>` : `
      <form class="card no-print" id="sign">
        <h2>Sign</h2>
        <p class="muted">${due}</p>
        <label class="field"><span>Your full name</span><input name="name" autocomplete="name" required minlength="3" value="${esc(o.contact_name || '')}"></label>
        <div class="field" style="margin-top:14px"><span>Pick your signature</span>${pick('font', o.contact_name || 'Your Name')}</div>
        <div class="field" style="margin-top:14px"><span>Pick your initials</span>${pick('initialsFont', initialsOf(o.contact_name) || 'YN')}</div>
        <p class="small muted" style="margin-top:10px">Today's date is filled in for you.</p>
        <label class="row" style="margin:14px 0;gap:10px;align-items:flex-start"><input type="checkbox" name="agree" required>
          <span>I have read and agree to this Agreement${o.kind === 'website' ? '' : ', including the three month minimum term'}, and I'm authorized to sign for ${esc(o.business)}. My chosen signature and initials are my electronic signature.</span></label>
        <button class="btn btn-primary btn-xl" type="submit">Sign agreement</button>
        <p class="err-text" id="err" role="alert"></p>
      </form>`}`;
  const form = box.querySelector('#sign');
  if (form) {
    const update = () => {
      const name = form.elements['name'].value.trim();
      form.querySelectorAll('[data-text="font"]').forEach((el) => { el.textContent = name || 'Your Name'; });
      form.querySelectorAll('[data-text="initialsFont"]').forEach((el) => { el.textContent = initialsOf(name) || 'YN'; });
      box.querySelector('#doc').innerHTML = draw({ name, at: Date.now(), font: form.elements['font'].value, initialsFont: form.elements['initialsFont'].value, initials: initialsOf(name) });
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
  }
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
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.elements['name'].value.trim(), agree: form.elements['agree'].checked, font: form.elements['font']?.value, initialsFont: form.elements['initialsFont']?.value }),
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
