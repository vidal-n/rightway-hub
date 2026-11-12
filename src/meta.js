// Meta connect (Facebook, Instagram, ads). Staff make a private link per client. The client opens /connect.html#<token>, signs in with
// Facebook, ticks their Pages, linked Instagram accounts and ad accounts, and we keep the access Meta gives us (long lived user token and
// Page tokens, sealed). Nothing here posts anywhere yet; this is the connection and its health. Meta needs its app reviewed before
// anyone outside our own app roles can grant these permissions, see CLAUDE.md.
import { HttpError, json } from './util.js';
import { all, first, run, newId, token, now, getSettings, setSetting } from './db.js';
import { route } from './router.js';
import { requireStaff, requireAdmin, requireClientAccess } from './auth.js';
import { seal, unseal, unb64u } from './seal.js';
import { notify } from './notify.js';
import { SCOPES, GRAPH_VERSION, permissionState, assetsFrom, connectionLine, problems, fbDialogUrl } from '../public/js/meta.js';

const LINK_DAYS = 30;
const STATE_TTL = 15 * 60e3;
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const text = (v, max) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const version = (env) => env.META_GRAPH_VERSION || GRAPH_VERSION;

// ---------- Meta Graph API ----------
class MetaError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

// Meta's errors are terse. Say what happened and what to do.
export function explainMeta(e) {
  const m = String(e?.message || e || '');
  const c = e?.code;
  if (c === 190 || /access token|session has expired|invalid oauth/i.test(m)) return 'The Facebook sign-in ended or was removed. Ask the client to open the link again.';
  if (c === 4 || c === 17 || c === 32 || c === 613) return 'Meta is limiting requests right now. Try again in a few minutes.';
  if (c === 10 || c === 200 || c === 299) return 'Meta says this login does not have permission for that. Run the link again and leave every box ticked.';
  if (/App not active|not setup for the user|developers/i.test(m)) return 'Meta says the app is not live yet, so only people added as testers or developers on the app can sign in. Switch the app to Live in Meta, or add this person as a tester.';
  if (/redirect_uri|Can't load URL|domain of this URL/i.test(m)) return 'Meta does not accept the return address. Add the Hub callback address under Facebook Login, Settings, Valid OAuth Redirect URIs.';
  if (/client secret|Error validating application|Invalid app/i.test(m)) return 'Meta rejected the app id or secret. Check them in the Social tab, Meta app setup.';
  return m.replace(/^\(#\d+\)\s*/, '').slice(0, 240) || 'Meta did not answer. Try again.';
}

async function graph(env, path, { token: tok, params = {}, method = 'GET' } = {}) {
  const u = new URL(path.startsWith('http') ? path : `https://graph.facebook.com/${version(env)}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  if (tok) u.searchParams.set('access_token', tok);
  const res = await fetch(u.toString(), { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new MetaError(data?.error?.message || `Meta answered ${res.status}.`, data?.error?.code, res.status);
  return data;
}
// Follows paging.next for lists (Pages, ad accounts), capped so one slow account can not eat the request.
async function graphAll(env, path, opts, cap = 4) {
  const out = [];
  let r = await graph(env, path, opts);
  for (let i = 0; i < cap; i++) {
    out.push(...(r.data || []));
    if (!r.paging?.next) break;
    r = await graph(env, r.paging.next);
  }
  return out;
}

// ---------- the app ----------
export async function appConfig(env, sets) {
  const s = sets || await getSettings(env);
  const id = String(env.META_APP_ID || s.meta_app_id || '').trim();
  let secret = String(env.META_APP_SECRET || '').trim();
  if (!secret && s.meta_app_secret) secret = await unseal(env, s.meta_app_secret).catch(() => '');
  return { id, secret, ok: Boolean(id && secret), name: s.meta_app_name || '', businessId: s.meta_business_id || '', businessName: s.meta_business_name || '', configId: s.meta_config_id || '' };
}
const appToken = (cfg) => `${cfg.id}|${cfg.secret}`;

route('GET', '/api/meta/app', async ({ env, user, url }) => {
  requireStaff(user);
  const cfg = await appConfig(env);
  const base = { configured: cfg.ok, businessId: cfg.businessId, businessName: cfg.businessName };
  if (user.role !== 'admin') return json(base);
  return json({
    ...base, appId: cfg.id, appName: cfg.name, hasSecret: Boolean(cfg.secret), configId: cfg.configId, scopes: SCOPES,
    redirect: `${url.origin}/api/meta/callback`, deauth: `${url.origin}/api/public/meta/deauth`, deletion: `${url.origin}/api/public/meta/delete`,
    privacy: `${url.origin}/privacy.html`, connect: `${url.origin}/connect.html`,
  });
});

route('PUT', '/api/meta/app', async ({ env, user, body, url }) => {
  requireAdmin(user);
  const b = await body();
  const prev = await appConfig(env);
  const id = 'appId' in b ? text(b.appId, 30) : prev.id;
  if (!/^\d{5,24}$/.test(id)) throw new HttpError('The App ID is a long number from the top of the app in developers.facebook.com.');
  const secret = text(b.secret, 80) || prev.secret;
  if (!/^[a-f0-9]{20,64}$/i.test(secret)) throw new HttpError('Paste the App Secret (App settings, Basic, click Show). It is letters and numbers.');
  // Ask Meta about the app with these credentials, so a typo is caught here and not by a client.
  let name = '';
  try { name = (await graph(env, `/${id}`, { token: `${id}|${secret}`, params: { fields: 'name' } })).name || ''; } catch (e) { throw new HttpError(explainMeta(e)); }
  const bid = text(b.businessId ?? prev.businessId, 30);
  if (bid && !/^\d{5,24}$/.test(bid)) throw new HttpError('The Business ID is a number (Business settings, Business info).');
  const cfgId = text(b.configId ?? prev.configId, 30);
  if (cfgId && !/^\d{5,24}$/.test(cfgId)) throw new HttpError('The Configuration ID is a number from Facebook Login for Business. Leave it empty to use the normal permission list.');
  await setSetting(env, 'meta_app_id', id);
  await setSetting(env, 'meta_app_secret', await seal(env, secret));
  await setSetting(env, 'meta_app_name', name);
  await setSetting(env, 'meta_business_id', bid);
  await setSetting(env, 'meta_business_name', text(b.businessName ?? prev.businessName, 80));
  await setSetting(env, 'meta_config_id', cfgId);
  if (!/localhost|127\./.test(url.origin)) await setSetting(env, 'hub_origin', url.origin);
  return json({ ok: true, appName: name });
});

// ---------- staff: links and connections ----------
async function loadClient(env, id) {
  const c = await first(env, 'SELECT id, name FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError('Client not found.', 404);
  return c;
}
const shapeAsset = (a) => ({ id: a.id, kind: a.kind, ext_id: a.ext_id, name: a.name, extra: parse(a.extra, {}), can_post: Boolean(a.can_post) });
const shapeConn = (c, assets) => {
  const perms = permissionState([...parse(c.granted, []).map((permission) => ({ permission, status: 'granted' })), ...parse(c.declined, []).map((permission) => ({ permission, status: 'declined' }))]);
  const list = assets.filter((a) => a.connection_id === c.id).map(shapeAsset);
  return { id: c.id, fb_name: c.fb_name, status: c.status, note: c.note, expires_at: c.expires_at, checked_at: c.checked_at, created_at: c.created_at, updated_at: c.updated_at,
    granted: perms.granted, declined: perms.declined, missing: perms.missingNeeded, assets: list, line: connectionLine(list, perms), problems: problems(list, perms) };
};
async function clientState(env, clientId, origin) {
  const cfg = await appConfig(env);
  const links = await all(env, 'SELECT token, label, created_at, expires_at, views, last_seen, revoked FROM meta_links WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', clientId);
  const conns = await all(env, 'SELECT * FROM meta_connections WHERE client_id = ? ORDER BY created_at', clientId);
  const assets = await all(env, 'SELECT * FROM meta_assets WHERE client_id = ?', clientId);
  return {
    configured: cfg.ok, businessId: cfg.businessId, businessName: cfg.businessName,
    links: links.map((l) => ({ ...l, revoked: Boolean(l.revoked), expired: l.expires_at < now(), url: `${origin}/connect.html#${l.token}` })),
    connections: conns.map((c) => shapeConn(c, assets)),
  };
}

route('GET', '/api/clients/:id/meta', async ({ env, user, params, url }) => {
  requireStaff(user);
  await loadClient(env, params.id);
  return json(await clientState(env, params.id, url.origin));
});

route('POST', '/api/clients/:id/meta/link', async ({ env, user, params, body, url }) => {
  requireStaff(user);
  const b = await body();
  await loadClient(env, params.id);
  const cfg = await appConfig(env);
  if (!cfg.ok) throw new HttpError('Save the Meta app first (Meta app setup, owners only). The link needs the app to sign people in.');
  const t = token(18);
  await run(env, 'INSERT INTO meta_links (token, client_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', t, params.id, text(b?.label, 80) || null, user.id, now(), now() + LINK_DAYS * 864e5);
  return json({ token: t, url: `${url.origin}/connect.html#${t}` });
});

// What the client app shows: which accounts are connected and what is still missing. Never tokens.
export async function clientMeta(env, clientId) {
  const cfg = await appConfig(env);
  const conns = await all(env, "SELECT * FROM meta_connections WHERE client_id = ? AND status != 'revoked' ORDER BY created_at", clientId);
  const assets = await all(env, 'SELECT * FROM meta_assets WHERE client_id = ?', clientId);
  const shaped = conns.map((x) => shapeConn(x, assets));
  const mine = shaped.flatMap((x) => x.assets);
  return {
    configured: cfg.ok, businessId: cfg.businessId,
    connected: shaped.map((x) => ({ name: x.fb_name, status: x.status, line: x.line, problems: x.problems, assets: x.assets.map((a) => ({ kind: a.kind, name: a.name, can_post: a.can_post })) })),
    counts: { pages: mine.filter((a) => a.kind === 'page').length, instagram: mine.filter((a) => a.kind === 'instagram').length, ads: mine.filter((a) => a.kind === 'adaccount').length },
  };
}

// A client who is logged in to the app makes their own connect link, so they never wait for us to send one.
route('POST', '/api/clients/:id/meta/self-link', async ({ env, user, params, url }) => {
  requireClientAccess(user, params.id);
  await loadClient(env, params.id);
  const cfg = await appConfig(env);
  if (!cfg.ok) throw new HttpError('We are still finishing this setup on our side. Your team will message you when it is ready.');
  const t = token(18);
  await run(env, 'INSERT INTO meta_links (token, client_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', t, params.id, 'From the client app', user.id, now(), now() + 2 * 864e5);
  return json({ token: t, url: `${url.origin}/connect.html#${t}` });
});

route('DELETE', '/api/meta/links/:token', async ({ env, user, params }) => {
  requireStaff(user);
  await run(env, 'UPDATE meta_links SET revoked = 1 WHERE token = ?', params.token);
  return json({ ok: true });
});

// Ask Meta again: is the sign-in still good, which permissions are still granted, which Pages and accounts still come back.
async function recheck(env, cfg, conn) {
  const tok = conn.user_token ? await unseal(env, conn.user_token).catch(() => '') : '';
  if (!tok) { await run(env, "UPDATE meta_connections SET status = 'expired', note = ?, checked_at = ? WHERE id = ?", 'The Facebook sign-in is gone. Send the link again.', now(), conn.id); return; }
  let dbg;
  try { dbg = (await graph(env, '/debug_token', { token: appToken(cfg), params: { input_token: tok } })).data || {}; } catch (e) { await run(env, 'UPDATE meta_connections SET note = ?, checked_at = ? WHERE id = ?', explainMeta(e), now(), conn.id); return; }
  if (!dbg.is_valid) {
    await run(env, "UPDATE meta_connections SET status = 'expired', note = ?, checked_at = ? WHERE id = ?", 'The Facebook sign-in ended (the client changed their password, removed the app, or it ran out). Send the link again.', now(), conn.id);
    return;
  }
  await pullAndSave(env, conn.client_id, conn.link_token, tok, { id: conn.fb_user_id, name: conn.fb_name }, dbg.expires_at ? dbg.expires_at * 1000 : null, conn.id);
}

route('POST', '/api/clients/:id/meta/check', async ({ env, user, params, url }) => {
  requireStaff(user);
  await loadClient(env, params.id);
  const cfg = await appConfig(env);
  if (!cfg.ok) throw new HttpError('Save the Meta app first (Meta app setup, owners only).');
  for (const c of await all(env, "SELECT * FROM meta_connections WHERE client_id = ? AND status != 'revoked'", params.id)) await recheck(env, cfg, c);
  return json(await clientState(env, params.id, url.origin));
});

route('DELETE', '/api/meta/connections/:id', async ({ env, user, params }) => {
  requireStaff(user);
  const c = await first(env, 'SELECT * FROM meta_connections WHERE id = ?', params.id);
  if (!c) throw new HttpError('Connection not found.', 404);
  // Best effort: also take our app off their Facebook account, so the access is really gone and not just forgotten by us.
  const tok = c.user_token ? await unseal(env, c.user_token).catch(() => '') : '';
  if (tok) await graph(env, `/${c.fb_user_id}/permissions`, { token: tok, method: 'DELETE' }).catch(() => {});
  await run(env, 'DELETE FROM meta_assets WHERE connection_id = ?', c.id);
  await run(env, 'DELETE FROM meta_connections WHERE id = ?', c.id);
  return json({ ok: true });
});

// ---------- the client's side ----------
async function loadLink(env, tok) {
  const l = await first(env, 'SELECT * FROM meta_links WHERE token = ?', tok);
  if (!l || l.revoked) throw new HttpError('This link is not valid any more. Ask your Rightway Growth contact to send a new one.', 404);
  if (l.expires_at < now()) throw new HttpError('This link has expired. Ask your Rightway Growth contact to send a new one.', 410);
  return l;
}

route('GET', '/api/public/meta/:token', async ({ env, params }) => {
  const l = await loadLink(env, params.token);
  const cfg = await appConfig(env);
  const c = await first(env, 'SELECT name FROM clients WHERE id = ?', l.client_id);
  await run(env, 'UPDATE meta_links SET views = views + 1, last_seen = ? WHERE token = ?', now(), l.token);
  const conns = await all(env, "SELECT * FROM meta_connections WHERE client_id = ? AND status != 'revoked' ORDER BY created_at", l.client_id);
  const assets = await all(env, 'SELECT * FROM meta_assets WHERE client_id = ?', l.client_id);
  const shaped = conns.map((x) => shapeConn(x, assets));
  return json({
    business: c?.name || '', company: 'Rightway Growth', configured: cfg.ok, businessId: cfg.businessId, businessName: cfg.businessName,
    connected: shaped.map((x) => ({ name: x.fb_name, status: x.status, line: x.line, problems: x.problems, assets: x.assets.map((a) => ({ kind: a.kind, name: a.name, can_post: a.can_post })) })),
  });
}, { public: true });

route('GET', '/api/public/meta/:token/start', async ({ env, params, url }) => {
  const back = (msg) => Response.redirect(`${url.origin}/connect.html?err=${encodeURIComponent(msg)}#${params.token}`, 302);
  let l;
  try { l = await loadLink(env, params.token); } catch (e) { return back(e.message); }
  const cfg = await appConfig(env);
  if (!cfg.ok) return back('The connection is not switched on yet. Tell your Rightway Growth contact.');
  await run(env, 'DELETE FROM meta_states WHERE at < ?', now() - STATE_TTL);
  const state = token(24);
  await run(env, 'INSERT INTO meta_states (state, link_token, at) VALUES (?, ?, ?)', state, l.token, now());
  return Response.redirect(fbDialogUrl({ appId: cfg.id, redirect: `${url.origin}/api/meta/callback`, state, version: version(env), configId: cfg.configId }), 302);
}, { public: true });

// Pull everything we are allowed to see, save it, and say what is thin.
async function pullAndSave(env, clientId, linkToken, userToken, who, expiresAt, connId) {
  const permsRaw = await graph(env, '/me/permissions', { token: userToken }).then((r) => r.data).catch(() => []);
  const pages = await graphAll(env, '/me/accounts', { token: userToken, params: { fields: 'id,name,category,tasks,access_token,instagram_business_account{id,username,name}', limit: 100 } }).catch(() => []);
  const ads = await graphAll(env, '/me/adaccounts', { token: userToken, params: { fields: 'id,account_id,name,account_status,business{name}', limit: 100 } }).catch(() => []);
  const perms = permissionState(permsRaw);
  const assets = assetsFrom(pages, ads);
  const issues = problems(assets, perms);
  const tokens = new Map(pages.map((p) => [String(p.id), p.access_token]));
  const t = now();
  const existing = connId ? { id: connId } : await first(env, 'SELECT id FROM meta_connections WHERE client_id = ? AND fb_user_id = ?', clientId, who.id);
  const id = existing?.id || newId('mc_');
  const sealedUser = await seal(env, userToken);
  const status = issues.length ? 'thin' : 'ok';
  if (existing) {
    await run(env, "UPDATE meta_connections SET fb_name = ?, user_token = ?, expires_at = ?, granted = ?, declined = ?, status = ?, note = ?, checked_at = ?, updated_at = ?, link_token = COALESCE(?, link_token) WHERE id = ?",
      who.name || null, sealedUser, expiresAt, JSON.stringify(perms.granted), JSON.stringify(perms.declined), status, issues.join(' ') || null, t, t, linkToken || null, id);
    await run(env, 'DELETE FROM meta_assets WHERE connection_id = ?', id);
  } else {
    await run(env, 'INSERT INTO meta_connections (id, client_id, link_token, fb_user_id, fb_name, user_token, expires_at, granted, declined, status, note, checked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, clientId, linkToken || null, who.id, who.name || null, sealedUser, expiresAt, JSON.stringify(perms.granted), JSON.stringify(perms.declined), status, issues.join(' ') || null, t, t, t);
  }
  for (const a of assets) {
    const pageId = a.kind === 'page' ? a.ext_id : a.kind === 'instagram' ? a.extra.page_id : null;
    const pt = pageId && tokens.get(pageId) ? await seal(env, tokens.get(pageId)) : null;
    await run(env, 'INSERT INTO meta_assets (id, client_id, connection_id, kind, ext_id, name, extra, page_token, can_post, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('ma_'), clientId, id, a.kind, a.ext_id, a.name, JSON.stringify(a.extra), pt, a.can_post ? 1 : 0, t);
  }
  return { id, assets, perms, issues };
}

route('GET', '/api/meta/callback', async ({ env, url, defer }) => {
  const st = await first(env, 'SELECT * FROM meta_states WHERE state = ?', url.searchParams.get('state') || '');
  const tok = st?.link_token || '';
  const back = (q) => Response.redirect(`${url.origin}/connect.html?${q}#${tok}`, 302);
  if (st) await run(env, 'DELETE FROM meta_states WHERE state = ?', st.state);
  if (!st || now() - st.at > STATE_TTL) return Response.redirect(`${url.origin}/connect.html?err=${encodeURIComponent('That sign-in took too long. Open your link again and start over.')}`, 302);
  if (url.searchParams.get('error')) return back(`err=${encodeURIComponent('You closed Facebook before finishing. Click the button again when you are ready.')}`);
  try {
    const l = await loadLink(env, tok);
    const cfg = await appConfig(env);
    if (!cfg.ok) throw new HttpError('The connection is not switched on yet.');
    const redirect_uri = `${url.origin}/api/meta/callback`;
    const short = await graph(env, '/oauth/access_token', { params: { client_id: cfg.id, client_secret: cfg.secret, redirect_uri, code: url.searchParams.get('code') || '' } });
    // Swap for the long lived token (about 60 days). Page tokens made from it do not expire.
    let access = short.access_token; let expiresIn = short.expires_in;
    try {
      const long = await graph(env, '/oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: cfg.id, client_secret: cfg.secret, fb_exchange_token: short.access_token } });
      access = long.access_token || access; expiresIn = long.expires_in ?? expiresIn;
    } catch { /* the short token still works for now */ }
    const me = await graph(env, '/me', { token: access, params: { fields: 'id,name' } });
    const r = await pullAndSave(env, l.client_id, l.token, access, me, expiresIn ? now() + Number(expiresIn) * 1000 : null);
    const c = await first(env, 'SELECT name FROM clients WHERE id = ?', l.client_id);
    // Shows in the client's "What we did" list.
    await run(env, 'INSERT INTO log (id, client_id, text, at, by) VALUES (?, ?, ?, ?, ?)', newId('l_'), l.client_id, `Facebook and Instagram connected. ${connectionLine(r.assets, r.perms)}`, now(), null).catch(() => {});
    defer?.(notify(env, { to: { client: l.client_id }, kind: 'client', title: `${c?.name || 'A client'} connected Facebook and Instagram`, body: connectionLine(r.assets, r.perms) + (r.issues.length ? ` ${r.issues[0]}` : ''), url: `/#/client/${l.client_id}/social` }).catch(() => {}));
    return back('done=1');
  } catch (e) {
    return back(`err=${encodeURIComponent(explainMeta(e))}`);
  }
}, { public: true });

// ---------- Meta required callbacks ----------
// Meta posts a signed_request (signature.payload, base64url, HMAC SHA-256 with the app secret) when someone removes the app or asks us to delete their data.
export async function readSignedRequest(signed, secret) {
  const [sig, payload] = String(signed || '').split('.');
  if (!sig || !payload || !secret) throw new HttpError('Bad request.', 400);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, unb64u(sig), new TextEncoder().encode(payload));
  if (!ok) throw new HttpError('Bad signature.', 400);
  return JSON.parse(new TextDecoder().decode(unb64u(payload)));
}
async function signedFrom(request, env) {
  const form = await request.formData().catch(() => null);
  const cfg = await appConfig(env);
  return readSignedRequest(form?.get('signed_request'), cfg.secret);
}

route('POST', '/api/public/meta/deauth', async ({ env, request, defer }) => {
  const p = await signedFrom(request, env);
  const uid = String(p.user_id || '');
  if (!uid) throw new HttpError('No user.', 400);
  const rows = await all(env, 'SELECT id, client_id, fb_name FROM meta_connections WHERE fb_user_id = ?', uid);
  for (const c of rows) {
    await run(env, 'DELETE FROM meta_assets WHERE connection_id = ?', c.id);
    await run(env, "UPDATE meta_connections SET status = 'revoked', user_token = NULL, note = ?, updated_at = ? WHERE id = ?", 'They removed the Hub from their Facebook settings. Send the link again to reconnect.', now(), c.id);
    defer?.(notify(env, { to: { client: c.client_id }, kind: 'client', title: `${c.fb_name || 'A client'} disconnected Facebook`, body: 'They removed the Hub from their Facebook settings.', url: `/#/client/${c.client_id}/social` }).catch(() => {}));
  }
  return json({ ok: true });
}, { public: true });

route('POST', '/api/public/meta/delete', async ({ env, request, url }) => {
  const p = await signedFrom(request, env);
  const uid = String(p.user_id || '');
  if (!uid) throw new HttpError('No user.', 400);
  for (const c of await all(env, 'SELECT id FROM meta_connections WHERE fb_user_id = ?', uid)) {
    await run(env, 'DELETE FROM meta_assets WHERE connection_id = ?', c.id);
    await run(env, 'DELETE FROM meta_connections WHERE id = ?', c.id);
  }
  const code = token(12);
  return json({ url: `${url.origin}/connect.html?deleted=${code}`, confirmation_code: code });
}, { public: true });

// Used by the publish step later: the sealed Page token for a Page or the Page behind an Instagram account.
export async function pageTokenFor(env, clientId, assetId) {
  const a = await first(env, "SELECT * FROM meta_assets WHERE id = ? AND client_id = ? AND kind IN ('page', 'instagram')", assetId, clientId);
  if (!a?.page_token) return null;
  return { asset: a, token: await unseal(env, a.page_token) };
}
