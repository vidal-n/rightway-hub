// Stripe webhook signing secret and the ids the Hub created in Stripe.
// The secret can come from Cloudflare (STRIPE_WEBHOOK_SECRET, wins if set) or from one click setup, which stores it sealed
// with AES-GCM keyed on the Stripe secret key. If the Stripe key is rotated the stored secret cannot be opened and counts as missing.
import { first, now, setSetting } from './db.js';

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`rw-stripe:${env.STRIPE_SECRET_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealStripe(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unsealStripe(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

export const keyMode = (env) => (/_live_/.test(env.STRIPE_SECRET_KEY || '') ? 'live' : /_test_/.test(env.STRIPE_SECRET_KEY || '') ? 'test' : 'unknown');

export async function storedWebhookSecret(env) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const row = await first(env, "SELECT v FROM settings WHERE k = 'stripe_webhook_secret'").catch(() => null);
  if (!row?.v) return null;
  try { return await unsealStripe(env, row.v); } catch { return null; }
}
export async function webhookSecret(env) {
  return env.STRIPE_WEBHOOK_SECRET || (await storedWebhookSecret(env));
}
export async function saveWebhookSecret(env, secret) {
  await setSetting(env, 'stripe_webhook_secret', await sealStripe(env, secret));
}

// What the Hub has created in Stripe: { mode, products: {plan: id}, prices: {'plan:month': id}, links: {key: id}, webhook: id, portal: id, at }
export async function readSetup(env) {
  const row = await first(env, "SELECT v FROM settings WHERE k = 'stripe_setup'").catch(() => null);
  let s = {};
  try { s = row?.v ? JSON.parse(row.v) : {}; } catch { s = {}; }
  return { products: {}, prices: {}, links: {}, ...s };
}
export async function saveSetup(env, state) {
  await setSetting(env, 'stripe_setup', JSON.stringify({ ...state, at: now() }));
}
