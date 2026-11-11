// One click Stripe setup (owners only): the webhook and the client billing portal. Payment links are made per client from the typed price.
// Nothing is created until the owner presses the button. Every step is separate, so one missing permission only fails that step.
// Ids are remembered (settings.stripe_setup) and Stripe idempotency keys are used, so running it twice never makes duplicates.
import { HttpError, json } from './util.js';
import { getSettings, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { stripe } from './billing.js';
import { route } from './router.js';
import { keyMode, webhookSecret, saveWebhookSecret, readSetup, saveSetup } from './stripekeys.js';

export const EVENTS = [
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
];

const indexed = (name, list) => Object.fromEntries(list.map((v, i) => [`${name}[${i}]`, v]));
const once = (env, ...parts) => ({ 'Idempotency-Key': `rw-${keyMode(env)}-${parts.join('-')}` });

async function stepWebhook(env, origin, body) {
  const url = `${origin}/api/stripe/webhook`;
  if (body.webhookSecret) {
    const v = String(body.webhookSecret).trim();
    if (!/^whsec_[A-Za-z0-9]{16,}$/.test(v)) throw new HttpError('That does not look like a signing secret. It starts with whsec_.');
    await saveWebhookSecret(env, v);
    return { ok: true, message: 'Saved the signing secret.' };
  }
  const eps = (await stripe(env, 'GET', '/webhook_endpoints', { limit: '100' })).data || [];
  const mine = eps.find((e) => e.url === url);
  const have = await webhookSecret(env);
  if (mine) {
    const events = mine.enabled_events || [];
    const covered = events.includes('*') || EVENTS.every((e) => events.includes(e));
    if (!covered) await stripe(env, 'POST', `/webhook_endpoints/${mine.id}`, indexed('enabled_events', EVENTS));
    if (have) return { ok: true, message: covered ? 'Webhook was already set up.' : 'Webhook was already set up. Added the events it was missing.' };
    return { ok: false, needsSecret: true, message: 'Stripe already has this webhook, but shows its signing secret only in the Stripe dashboard. Open the webhook, click Reveal under Signing secret, and paste it below.' };
  }
  if (env.STRIPE_WEBHOOK_SECRET) {
    return { ok: false, message: 'STRIPE_WEBHOOK_SECRET is set in Cloudflare, but Stripe has no webhook for this address. Remove that secret from Cloudflare and run setup again.' };
  }
  const made = await stripe(env, 'POST', '/webhook_endpoints', { url, description: 'Rightway Hub', ...indexed('enabled_events', EVENTS) });
  if (!made.secret) throw new HttpError('Stripe made the webhook but did not return its signing secret. Open it in Stripe, Reveal the secret, and paste it here.');
  await saveWebhookSecret(env, made.secret);
  const state = await readSetup(env);
  await saveSetup(env, { ...state, mode: keyMode(env), webhook: made.id });
  return { ok: true, message: 'Created the webhook and saved its signing secret.' };
}

async function stepPortal(env) {
  const state = await readSetup(env);
  const found = await stripe(env, 'GET', '/billing_portal/configurations', { is_default: 'true', limit: '1' });
  if (found.data?.[0]) {
    if (!state.portal) await saveSetup(env, { ...state, mode: keyMode(env), portal: found.data[0].id });
    return { ok: true, message: 'Client billing portal was already on in Stripe. Left as it is.' };
  }
  if (state.portal) return { ok: true, message: 'Client billing portal was already set up by the Hub.' };
  const made = await stripe(env, 'POST', '/billing_portal/configurations', {
    'business_profile[headline]': 'Rightway Growth billing',
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[customer_update][enabled]': 'true',
    ...indexed('features[customer_update][allowed_updates]', ['email', 'address', 'phone']),
    'features[subscription_cancel][enabled]': 'false',
  });
  await saveSetup(env, { ...state, mode: keyMode(env), portal: made.id });
  return { ok: true, message: 'Turned on the client billing portal: invoices, card updates and contact details. Clients cannot cancel there.' };
}

export async function setupStatus(env, origin) {
  const [s, state] = await Promise.all([getSettings(env), readSetup(env)]);
  const secret = env.STRIPE_WEBHOOK_SECRET ? 'cloudflare' : (await webhookSecret(env)) ? 'hub' : null;
  return {
    keyed: Boolean(env.STRIPE_SECRET_KEY), mode: keyMode(env),
    webhook: { url: `${origin}/api/stripe/webhook`, secret, events: EVENTS },
    portal: Boolean(state.portal),
    custom: parseList(s.stripe_custom_links),
  };
}
const parseList = (v) => { try { return v ? JSON.parse(v) : []; } catch { return []; } };

route('GET', '/api/stripe/setup', async ({ env, user, url }) => {
  requireAdmin(user);
  return json(await setupStatus(env, url.origin));
});

route('POST', '/api/stripe/setup', async ({ env, user, url, body }) => {
  requireAdmin(user);
  if (!env.STRIPE_SECRET_KEY) throw new HttpError('Add STRIPE_SECRET_KEY in Cloudflare first, then rebuild.', 503);
  const b = (await body()) || {};
  const steps = Array.isArray(b.steps) && b.steps.length ? b.steps : ['webhook', 'portal'];
  const results = [];
  const attempt = async (step, fn) => {
    try { const r = await fn(); (Array.isArray(r) ? r : [r]).forEach((x) => results.push({ step, ...x })); }
    catch (e) { results.push({ step, ok: false, message: e.message }); }
  };
  if (steps.includes('webhook')) await attempt('webhook', () => stepWebhook(env, url.origin, b));
  if (steps.includes('portal')) await attempt('portal', () => stepPortal(env));
  return json({ results, status: await setupStatus(env, url.origin) });
});

// A one off payment link made from the Hub: any name, a monthly price, a one time fee, or both.
const dollars = (v, label) => {
  const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '') || 0) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new HttpError(`${label} must be a dollar amount.`);
  return n;
};
route('POST', '/api/stripe/links', async ({ env, user, body }) => {
  requireAdmin(user);
  if (!env.STRIPE_SECRET_KEY) throw new HttpError('Add STRIPE_SECRET_KEY in Cloudflare first, then rebuild.', 503);
  const b = (await body()) || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError('Give the link a name.');
  const monthly = dollars(b.monthly, 'Monthly price');
  const once = dollars(b.setup, 'One time fee');
  if (!monthly && !once) throw new HttpError('Enter a monthly price, a one time fee, or both.');
  const product = await stripe(env, 'POST', '/products', { name, 'metadata[rw_custom]': '1' });
  const items = [];
  if (monthly) items.push((await stripe(env, 'POST', '/prices', { product: product.id, currency: 'usd', unit_amount: String(monthly), 'recurring[interval]': 'month', nickname: `${name} monthly` })).id);
  if (once) items.push((await stripe(env, 'POST', '/prices', { product: product.id, currency: 'usd', unit_amount: String(once), nickname: `${name} one time` })).id);
  const params = { 'metadata[rw_custom]': '1' };
  items.forEach((id, i) => { params[`line_items[${i}][price]`] = id; params[`line_items[${i}][quantity]`] = '1'; });
  const link = await stripe(env, 'POST', '/payment_links', params);
  const s = await getSettings(env);
  const list = [{ id: link.id, name, monthly, setup: once, url: link.url, at: Date.now() }, ...parseList(s.stripe_custom_links)].slice(0, 30);
  await setSetting(env, 'stripe_custom_links', JSON.stringify(list));
  return json({ link: list[0], custom: list });
});
