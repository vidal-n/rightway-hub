// Small secrets the Hub stores in settings (Slack tokens, the push key) are sealed with AES-GCM, keyed on ACCESS_KEY.
const enc = new TextEncoder();
export const b64u = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));

async function sealKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`rw-notify:${env.ACCESS_KEY || 'rightway-hub'}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, textValue) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(env), enc.encode(textValue));
  return `${b64u(iv)}.${b64u(ct)}`;
}
export async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || '').split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await sealKey(env), unb64u(ct)));
}
