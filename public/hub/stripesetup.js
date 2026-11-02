// Settings: one click Stripe setup (owners). Shows what is connected and creates the webhook, payment links and client portal.
import { $, $$, esc, api, toast, modal, busy, copy } from './core.js';

const money = (cents) => `$${(cents / 100).toLocaleString('en-US')}`;
const pill = (on, yes = 'Ready', no = 'Not yet') => `<span class="badge ${on ? '' : 'gray'}">${on ? yes : no}</span>`;

const KEY_STEPS = `
  <ol class="small" style="margin:8px 0 0 18px;padding:0;line-height:1.7">
    <li>In Stripe, open Developers, then API keys, then <b>Create restricted key</b>.</li>
    <li>Give it <b>Read</b> on: Balance, Charges, Customers, Invoices, Payouts, Subscriptions.</li>
    <li>Give it <b>Write</b> on: Products, Prices, Payment Links, Webhook Endpoints, Customer portal.</li>
    <li>Copy the key into Cloudflare, Build, Variables and secrets, as <span class="mono">STRIPE_SECRET_KEY</span>, then ask Claude to rebuild.</li>
  </ol>
  <p class="small muted" style="margin-top:8px">Start in Stripe's test mode if you want to try it first. The Hub makes everything in whichever mode the key belongs to.</p>`;

export async function stripeSetup(box, user) {
  if (!box) return;
  const isOwner = user.role === 'admin';
  if (!isOwner) { box.innerHTML = ''; return; }
  const draw = async (last = null) => {
    let d;
    try { d = await api('/api/stripe/setup'); } catch (e) { box.innerHTML = `<div class="card"><div class="card-head"><h2>Stripe setup</h2></div><p class="err-text">${esc(e.message)}</p></div>`; return; }
    const have = d.links.filter((l) => l.url).length;
    const done = d.keyed && d.webhook.secret && have === d.links.length && d.portal;
    const needSecret = last?.results?.some((r) => r.needsSecret);
    box.innerHTML = `<div class="card"><div class="card-head"><h2>Stripe setup</h2>
        ${d.keyed ? `<span class="badge ${d.mode === 'live' ? '' : 'warn'}">${d.mode === 'live' ? 'Live mode' : d.mode === 'test' ? 'Test mode' : 'Connected'}</span>` : '<span class="badge gray">Key needed</span>'}</div>
      ${!d.keyed ? `<p class="muted">The Hub can set up the webhook, all five payment links, and the client billing portal for you in one click. It needs a Stripe key first.</p>${KEY_STEPS}` : `
        <ul class="list">
          <li class="item">${pill(d.webhook.secret, 'Ready', 'Not set up')}<div><div class="item-title">Webhook</div>
            <div class="item-sub">Tells the Hub when a client pays, so the deal is won and the client is created on its own. ${d.webhook.secret === 'cloudflare' ? 'Signing secret is in Cloudflare.' : ''}</div></div><span></span></li>
          <li class="item">${pill(have === d.links.length, 'All 5 made', `${have} of ${d.links.length}`)}<div><div class="item-title">Payment links</div>
            <div class="item-sub">${d.links.map((l) => `${esc(l.label)} ${money(l.firstCharge)}${l.url ? '' : ' (missing)'}`).join(', ')}</div></div><span></span></li>
          <li class="item">${pill(d.portal, 'On', 'Not set up')}<div><div class="item-title">Client billing portal</div>
            <div class="item-sub">The Billing button in the client app: invoices, card updates, contact details. No cancelling there.</div></div><span></span></li>
        </ul>
        ${last ? `<ul class="list" style="margin-top:12px">${last.results.map((r) => `<li class="item"><span class="badge ${r.ok ? '' : 'bad'}">${r.ok ? 'Done' : 'Problem'}</span><div class="item-sub" style="color:inherit">${esc(r.message)}</div><span></span></li>`).join('')}</ul>` : ''}
        ${needSecret || (d.keyed && !d.webhook.secret) ? `<form id="whsec" class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
          <label class="field" style="flex:1;min-width:240px"><span>Already made the webhook in Stripe? Paste its signing secret</span><input name="s" placeholder="whsec_..." autocomplete="off"></label>
          <button class="btn btn-ghost" type="submit" style="align-self:end">Save secret</button></form>` : ''}
        <div class="row end" style="margin-top:14px;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="whurl" data-url="${esc(d.webhook.url)}">Copy webhook address</button>
          <button class="btn btn-primary" id="runsetup">${done ? 'Check Stripe again' : 'Set up Stripe'}</button>
        </div>`}
    </div>`;
    $('#whurl', box)?.addEventListener('click', (e) => copy(e.currentTarget.dataset.url, 'Copied'));
    $('#whsec', box)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', e.currentTarget);
      busy(btn, true, 'Saving');
      try { const r = await api('/api/stripe/setup', { method: 'POST', body: { steps: ['webhook'], webhookSecret: e.currentTarget.s.value } }); busy(btn, false); draw(r); }
      catch (err) { busy(btn, false); toast(err.message, true); }
    });
    $('#runsetup', box)?.addEventListener('click', () => confirmRun(d));
  };

  const confirmRun = (d) => {
    const missing = d.links.filter((l) => !l.url);
    const m = modal(`<h2>Set up Stripe${d.mode === 'live' ? ' (live)' : d.mode === 'test' ? ' (test mode)' : ''}</h2>
      <p class="muted">${d.mode === 'live' ? 'This is your live Stripe account. ' : ''}The Hub will make these in Stripe. Anything that already exists is left alone, so it is safe to run again.</p>
      <ul style="margin:10px 0 0 18px;padding:0;line-height:1.7">
        ${d.webhook.secret ? '' : `<li>A webhook at <span class="mono small">${esc(d.webhook.url)}</span> for payments, subscriptions and invoices</li>`}
        ${missing.length ? `<li>${missing.length} payment link${missing.length === 1 ? '' : 's'}, each with the monthly price and the one time setup fee: ${missing.map((l) => esc(l.label)).join(', ')}</li>` : ''}
        ${d.portal ? '' : '<li>The client billing portal (invoices, card updates, contact details, no cancelling)</li>'}
        ${!d.webhook.secret || missing.length || !d.portal ? '' : '<li>Nothing new. It will just check that everything is still in place.</li>'}
      </ul>
      ${d.links.some((l) => l.url) ? '<label class="row small" style="gap:6px;margin-top:12px"><input type="checkbox" id="repl"> Replace the payment links I already saved with new ones</label>' : ''}
      <div class="row end" style="margin-top:16px;gap:8px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="go">Set it up</button></div>`);
    $('#go', m.el).addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Setting up');
      try {
        const r = await api('/api/stripe/setup', { method: 'POST', body: { replace: Boolean($('#repl', m.el)?.checked) } });
        m.close();
        await draw(r);
        toast(r.results.every((x) => x.ok) ? 'Stripe is set up' : 'Some steps need attention', !r.results.every((x) => x.ok));
      } catch (err) { busy(e.currentTarget, false); toast(err.message, true); }
    });
  };

  await draw();
}
