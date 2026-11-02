// One click Stripe setup (owners only): the webhook, a payment link per plan, and the client billing portal.
// Nothing is created until the owner presses the button. Every step is separate, so one missing permission only fails that step.
// Ids are remembered (settings.stripe_setup) and Stripe idempotency keys are used, so running it twice never makes duplicates.
import { HttpError, json } from './util.js';
import { getSettings, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { PLANS, MONTHLY_CENTS, SETUP_CENTS } from './plans.js';
import { stripe } from './billing.js';
import { route } from './router.js';
import { keyMode, webhookSecret, saveWebhookSecret, readSetup, saveSetup } from './stripekeys.js';

export const EVENTS = [
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
];

// The five payment links. First charge = setup + first month, which is how the webhook tells the plan from a payment.
export const LINKS = [
  { key: 'starter', plan: 'starter', label: 'Starter', setup: SETUP_CENTS.starter },
  { key: 'starter_reduced', plan: 'starter', label: 'Starter, reduced setup', setup: 29700 },
  { key: 'growth', plan: 'growth', label: 'Growth', setup: SETUP_CENTS.growth },
  { key: 'authority', plan: 'authority', label: 'Authority', setup: SETUP_CENTS.authority },
  { key: 'leader', plan: 'leader', label: 'Market Leader', setup: SETUP_CENTS.leader },
].map((l) => ({ ...l, firstCharge: MONTHLY_CENTS[l.plan] + l.setup }));

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

async function stepLinks(env, body) {
  const mode = keyMode(env);
  let state = await readSetup(env);
  if (state.mode && state.mode !== mode) state = { ...state, products: {}, prices: {}, links: {}, mode };
  state.mode = mode;
  const settings = await getSettings(env);
  const out = [];
  for (const l of LINKS) {
    const have = settings[`pay_link_${l.key}`];
    if (have && !body.replace) { out.push({ key: l.key, ok: true, skipped: true, message: `${l.label}: already has a link, left alone.` }); continue; }
    try {
      const name = PLANS[l.plan].name;
      if (!state.products[l.plan]) {
        state.products[l.plan] = (await stripe(env, 'POST', '/products', { name: `Rightway Growth ${name}`, 'metadata[rw_plan]': l.plan }, fetch, once(env, 'prod', l.plan))).id;
        await saveSetup(env, state);
      }
      const product = state.products[l.plan];
      const monthKey = `${l.plan}:month`;
      if (!state.prices[monthKey]) {
        state.prices[monthKey] = (await stripe(env, 'POST', '/prices', {
          product, currency: 'usd', unit_amount: String(MONTHLY_CENTS[l.plan]), 'recurring[interval]': 'month', nickname: `${name} monthly`,
        }, fetch, once(env, 'month', l.plan, MONTHLY_CENTS[l.plan]))).id;
        await saveSetup(env, state);
      }
      const setupKey = `${l.plan}:setup:${l.setup}`;
      if (!state.prices[setupKey]) {
        state.prices[setupKey] = (await stripe(env, 'POST', '/prices', {
          product, currency: 'usd', unit_amount: String(l.setup), nickname: `${name} setup fee`,
        }, fetch, once(env, 'setup', l.plan, l.setup))).id;
        await saveSetup(env, state);
      }
      if (have && body.replace && state.links[l.key]) {
        await stripe(env, 'POST', `/payment_links/${state.links[l.key]}`, { active: 'false' }).catch(() => null);
      }
      const link = await stripe(env, 'POST', '/payment_links', {
        'line_items[0][price]': state.prices[monthKey], 'line_items[0][quantity]': '1',
        'line_items[1][price]': state.prices[setupKey], 'line_items[1][quantity]': '1',
        'metadata[rw_plan]': l.key, 'subscription_data[metadata][rw_plan]': l.key,
      });
      state.links[l.key] = link.id;
      await setSetting(env, `pay_link_${l.key}`, link.url);
      await saveSetup(env, state);
      out.push({ key: l.key, ok: true, message: `${l.label}: link created ($${(l.firstCharge / 100).toLocaleString('en-US')} first charge).` });
    } catch (e) {
      out.push({ key: l.key, ok: false, message: `${l.label}: ${e.message}` });
    }
  }
  return out;
}

async function stepPortal(env) {
  const state = await readSetup(env);
  const found = await stripe(env, 'GET', '/billing_portal/configurations', { is_default: 'true', limit: '1' });
  if (found.data?.[0]) return { ok: true, message: 'Client billing portal was already on.' };
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
    links: LINKS.map((l) => ({ key: l.key, label: l.label, firstCharge: l.firstCharge, url: s[`pay_link_${l.key}`] || '' })),
    portal: Boolean(state.portal),
  };
}

route('GET', '/api/stripe/setup', async ({ env, user, url }) => {
  requireAdmin(user);
  return json(await setupStatus(env, url.origin));
});

route('POST', '/api/stripe/setup', async ({ env, user, url, body }) => {
  requireAdmin(user);
  if (!env.STRIPE_SECRET_KEY) throw new HttpError('Add STRIPE_SECRET_KEY in Cloudflare first, then rebuild.', 503);
  const b = (await body()) || {};
  const steps = Array.isArray(b.steps) && b.steps.length ? b.steps : ['webhook', 'links', 'portal'];
  const results = [];
  const attempt = async (step, fn) => {
    try { const r = await fn(); (Array.isArray(r) ? r : [r]).forEach((x) => results.push({ step, ...x })); }
    catch (e) { results.push({ step, ok: false, message: e.message }); }
  };
  if (steps.includes('webhook')) await attempt('webhook', () => stepWebhook(env, url.origin, b));
  if (steps.includes('links')) await attempt('links', () => stepLinks(env, b));
  if (steps.includes('portal')) await attempt('portal', () => stepPortal(env));
  return json({ results, status: await setupStatus(env, url.origin) });
});
