// Password vault. Encrypted in this browser with your master password before anything is saved; the Hub only ever stores ciphertext.
// Nobody else (owners included) can open your items unless you share one with them. A forgotten master password cannot be recovered.
import { $, $$, esc, api, toast, busy, icon, modal } from './core.js';
import { staffShell } from './shell.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const C = crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

async function masterKey(password, salt, iters) {
  const base = await C.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return C.deriveKey({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const seal = async (key, bytes) => { const iv = rand(12); return { iv: b64(iv), ct: b64(await C.encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; };
const open = (key, iv, ct) => C.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
async function wrapFor(pubJwk, rawItemKey) {
  const pub = await C.importKey('jwk', pubJwk, ECDH, false, []);
  const eph = await C.generateKey(ECDH, true, ['deriveKey']);
  const shared = await C.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const { iv, ct } = await seal(shared, rawItemKey);
  return { eph: await C.exportKey('jwk', eph.publicKey), wiv: iv, wkey: ct };
}
async function unwrap(priv, ephJwk, wiv, wkey) {
  const eph = await C.importKey('jwk', typeof ephJwk === 'string' ? JSON.parse(ephJwk) : ephJwk, ECDH, false, []);
  const shared = await C.deriveKey({ name: 'ECDH', public: eph }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return open(shared, wiv, wkey);
}

// Unlocked state lives only in this tab's memory and locks itself after 10 idle minutes.
const S = { priv: null, pub: null, items: [], people: [], idle: null };
const lock = () => { S.priv = null; S.items = []; clearTimeout(S.idle); };
const touch = () => { clearTimeout(S.idle); S.idle = setTimeout(() => { lock(); if (location.hash.startsWith('#/vault')) location.reload(); }, 10 * 60e3); };

function genPassword(len = 20) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const out = sets.map(pick);
  while (out.length < len) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
const strength = (p) => { let s = 0; if (p.length >= 12) s++; if (p.length >= 16) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++; return ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][s]; };
async function copyFor30(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied. Clears in 30 seconds.`); setTimeout(() => navigator.clipboard.readText?.().then((t) => { if (t === text) navigator.clipboard.writeText(''); }).catch(() => {}), 30e3); }
  catch { toast('Copy failed. Select it and copy by hand.', true); }
}

export async function vaultPage(app, user) {
  const view = staffShell(app, user, 'vault');
  let me;
  try { me = await api('/api/vault/me'); } catch (e) { view.innerHTML = `<p class="err-text">${esc(e.message)}</p>`; return; }
  const head = `<div class="page-head"><div><p class="eyebrow">Private to you</p><h1>Password vault</h1></div>${S.priv ? `<div class="row"><button class="btn btn-ghost" id="vlock">${icon.key || ''}Lock</button><button class="btn btn-primary" id="vadd">${icon.plus}Add a login</button></div>` : ''}</div>`;
  if (!me.setup) {
    view.innerHTML = `${head}<div class="card" style="max-width:560px"><h2>Set your master password</h2>
      <p class="small">Everything is encrypted on this device with this password before it is saved. The Hub, the other owners and Claude can never read it. <b>If you forget it, nobody can recover your items.</b> Write it down somewhere safe.</p>
      <form id="vset" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>Master password (12 or more characters)</span><input type="password" name="p1" minlength="12" required autocomplete="new-password"></label>
      <label class="field"><span>Type it again</span><input type="password" name="p2" required autocomplete="new-password"></label><p class="small" id="vstr"></p>
      <button class="btn btn-primary" type="submit">Create my vault</button></form></div>`;
    const f = $('#vset', view);
    f.p1.addEventListener('input', () => { $('#vstr', view).textContent = f.p1.value ? `Strength: ${strength(f.p1.value)}` : ''; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.p1.value !== f.p2.value) return toast('The two passwords do not match.', true);
      if (f.p1.value.length < 12) return toast('Use at least 12 characters.', true);
      const btn = f.querySelector('button'); busy(btn, true);
      try {
        const salt = rand(16), iters = 310000;
        const mk = await masterKey(f.p1.value, salt, iters);
        const check = await seal(mk, enc.encode('rightway-vault'));
        const kp = await C.generateKey(ECDH, true, ['deriveKey']);
        const priv = await seal(mk, await C.exportKey('pkcs8', kp.privateKey));
        await api('/api/vault/setup', { method: 'POST', body: { salt: b64(salt), iters, check_iv: check.iv, check_ct: check.ct, priv_iv: priv.iv, priv_ct: priv.ct, pub: await C.exportKey('jwk', kp.publicKey) } });
        toast('Vault created'); vaultPage(app, user);
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    return;
  }
  if (!S.priv) {
    view.innerHTML = `${head}<div class="card" style="max-width:480px"><h2>Unlock your vault</h2>
      <form id="vun" class="form-grid" style="grid-template-columns:1fr"><label class="field"><span>Master password</span><input type="password" name="p" required autocomplete="current-password" autofocus></label>
      <button class="btn btn-primary" type="submit">Unlock</button></form>
      <details style="margin-top:14px"><summary class="small">Forgot it?</summary><p class="small">Nobody can recover it, by design. You can start over: your own items are deleted, and items others shared with you have to be shared again.</p><button class="btn btn-danger btn-sm" id="vreset">Start over with a new master password</button></details></div>`;
    $('#vun', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); busy(btn, true);
      try {
        const k = me.keys;
        const mk = await masterKey(e.target.p.value, unb64(k.salt), k.iters);
        try { await open(mk, k.check_iv, k.check_ct); } catch { throw new Error('Wrong master password.'); }
        S.priv = await C.importKey('pkcs8', await open(mk, k.priv_iv, k.priv_ct), ECDH, false, ['deriveKey']);
        S.pub = JSON.parse(k.pub);
        touch(); vaultPage(app, user);
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
    $('#vreset', view).addEventListener('click', async () => {
      const p = prompt('New master password (12 or more characters). This deletes your saved items.');
      if (!p || p.length < 12) return;
      const salt = rand(16), iters = 310000, mk = await masterKey(p, salt, iters);
      const check = await seal(mk, enc.encode('rightway-vault')); const kp = await C.generateKey(ECDH, true, ['deriveKey']); const priv = await seal(mk, await C.exportKey('pkcs8', kp.privateKey));
      try { await api('/api/vault/setup', { method: 'POST', body: { reset: true, salt: b64(salt), iters, check_iv: check.iv, check_ct: check.ct, priv_iv: priv.iv, priv_ct: priv.ct, pub: await C.exportKey('jwk', kp.publicKey) } }); toast('Vault reset'); vaultPage(app, user); }
      catch (err) { toast(err.message, true); }
    });
    return;
  }
  touch();
  const [list, ppl] = await Promise.all([api('/api/vault/items'), api('/api/vault/people').catch(() => ({ people: [] }))]);
  S.people = ppl.people;
  S.items = [];
  for (const r of list.items) {
    try {
      const raw = await unwrap(S.priv, r.eph, r.wiv, r.wkey);
      const key = await C.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
      S.items.push({ ...JSON.parse(dec.decode(await open(key, r.iv, r.ct))), id: r.id, mine: r.mine, owner: r.owner_name, sharedWith: r.sharedWith, updated: r.updated_at });
    } catch { S.items.push({ id: r.id, title: '(could not open)', broken: true, mine: r.mine }); }
  }
  let q = '';
  const draw = () => {
    const rows = S.items.filter((x) => !q || [x.title, x.username, x.url, x.folder].some((v) => String(v || '').toLowerCase().includes(q)));
    const folders = [...new Set(rows.map((x) => x.folder || 'General'))].sort();
    $('#vlist', view).innerHTML = rows.length ? folders.map((fo) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h3>${esc(fo)}</h3></div>
      ${rows.filter((x) => (x.folder || 'General') === fo).map((x) => `<div class="row v-row" data-id="${esc(x.id)}" style="flex-wrap:nowrap;gap:12px;padding:9px 0;border-top:1px solid var(--line)">
        <span class="ag-av" style="width:36px;height:36px;font-size:13px">${esc((x.title || '?').slice(0, 2).toUpperCase())}</span>
        <div style="flex:1;min-width:0"><b>${esc(x.title)}</b><div class="small">${esc([x.username, x.url && x.url.replace(/^https?:\/\//, '').split('/')[0]].filter(Boolean).join(' · '))}${x.mine ? (x.sharedWith?.length ? ` · shared with ${x.sharedWith.length}` : '') : ` · shared by ${esc(x.owner || 'a teammate')}`}</div></div>
        ${x.broken ? '' : `<button class="btn btn-ghost btn-sm" data-cu>${icon.copy || ''}User</button><button class="btn btn-primary btn-sm" data-cp>${icon.copy || ''}Password</button>${x.url ? `<a class="btn btn-ghost btn-sm" href="${esc(/^https?:/.test(x.url) ? x.url : `https://${x.url}`)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}`}
        <button class="btn btn-ghost btn-sm" data-ed>${x.mine ? 'Edit' : 'View'}</button></div>`).join('')}</div>`).join('')
      : `<div class="card empty"><h3>${q ? 'Nothing matches' : 'Your vault is empty'}</h3><p>Add logins for Google profiles, client websites, directories and tools. Share one with a teammate when they need it.</p></div>`;
    $$('.v-row', view).forEach((r) => {
      const x = S.items.find((i) => i.id === r.dataset.id);
      $('[data-cu]', r)?.addEventListener('click', () => { touch(); copyFor30(x.username || '', 'Username'); });
      $('[data-cp]', r)?.addEventListener('click', () => { touch(); copyFor30(x.password || '', 'Password'); });
      $('[data-ed]', r).addEventListener('click', () => editor(x));
    });
  };
  const saveItem = async (data, shareTo, id) => {
    const raw = rand(32);
    const key = await C.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const { iv, ct } = await seal(key, enc.encode(JSON.stringify(data)));
    const access = [{ user_id: user.id, ...(await wrapFor(S.pub, raw)) }];
    for (const uid of shareTo) { const p = S.people.find((x) => x.id === uid); if (p) access.push({ user_id: uid, ...(await wrapFor(p.pub, raw)) }); }
    await api('/api/vault/items', { method: 'POST', body: { id, iv, ct, access } });
  };
  const editor = (x) => {
    touch();
    const ro = x && !x.mine;
    const m = modal(`<div class="card-head"><h2>${x ? esc(x.title) : 'Add a login'}</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <form id="vf" class="form-grid">
        <label class="field"><span>Name</span><input name="title" value="${esc(x?.title || '')}" required ${ro ? 'readonly' : ''}></label>
        <label class="field"><span>Folder</span><input name="folder" value="${esc(x?.folder || '')}" placeholder="General, a client's name, Tools" ${ro ? 'readonly' : ''}></label>
        <label class="field"><span>Username or email</span><input name="username" value="${esc(x?.username || '')}" autocomplete="off" ${ro ? 'readonly' : ''}></label>
        <label class="field"><span>Password</span><div class="row" style="flex-wrap:nowrap;gap:6px"><input name="password" type="password" value="${esc(x?.password || '')}" autocomplete="new-password" ${ro ? 'readonly' : ''}>
          <button type="button" class="btn btn-ghost btn-sm" id="vshow">Show</button>${ro ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="vgen">New</button>'}</div><span class="small" id="vst"></span></label>
        <label class="field span-all"><span>Website</span><input name="url" value="${esc(x?.url || '')}" placeholder="https://" ${ro ? 'readonly' : ''}></label>
        <label class="field span-all"><span>Notes (2FA backup codes, PINs, security answers)</span><textarea name="notes" rows="3" ${ro ? 'readonly' : ''}>${esc(x?.notes || '')}</textarea></label>
        ${ro ? '' : `<div class="span-all"><b class="small">Share with</b>${S.people.length ? `<div class="row" style="gap:12px;margin-top:6px">${S.people.map((p) => `<label class="row small" style="gap:6px"><input type="checkbox" name="share" value="${esc(p.id)}"${x?.sharedWith?.includes(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>` : '<p class="small muted" style="margin:4px 0 0">Teammates show here once they set up their own vault.</p>'}</div>`}
        <div class="span-all row">${x?.mine ? '<button type="button" class="btn btn-danger btn-sm" id="vdel">Delete</button>' : x ? '<button type="button" class="btn btn-ghost btn-sm" id="vdel">Remove from my vault</button>' : ''}<span class="spacer"></span>${ro ? '' : '<button class="btn btn-primary" type="submit">Save</button>'}</div>
      </form>`);
    const f = $('#vf', m.el);
    const st = () => { $('#vst', m.el).textContent = f.password.value ? strength(f.password.value) : ''; };
    st(); f.password.addEventListener('input', st);
    $('#vshow', m.el).addEventListener('click', (e) => { f.password.type = f.password.type === 'password' ? 'text' : 'password'; e.target.textContent = f.password.type === 'password' ? 'Show' : 'Hide'; });
    $('#vgen', m.el)?.addEventListener('click', () => { f.password.value = genPassword(); f.password.type = 'text'; st(); });
    $('#vdel', m.el)?.addEventListener('click', async () => { try { await api(`/api/vault/items/${x.id}`, { method: 'DELETE' }); m.close(); toast('Removed'); vaultPage(app, user); } catch (err) { toast(err.message, true); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]'); busy(btn, true);
      try {
        await saveItem({ title: f.title.value.trim(), folder: f.folder.value.trim(), username: f.username.value, password: f.password.value, url: f.url.value.trim(), notes: f.notes.value }, $$('[name=share]:checked', m.el).map((c) => c.value), x?.id);
        m.close(); toast('Saved, encrypted'); vaultPage(app, user);
      } catch (err) { toast(err.message, true); busy(btn, false); }
    });
  };
  view.innerHTML = `${head}<div class="row" style="margin-bottom:14px"><input id="vq" placeholder="Search your vault" style="max-width:420px"><span class="small muted">${S.items.length} saved · locks after 10 idle minutes · encrypted on this device</span></div><div id="vlist"></div>`;
  $('#vq', view).addEventListener('input', (e) => { q = e.target.value.toLowerCase(); touch(); draw(); });
  $('#vlock', view).addEventListener('click', () => { lock(); vaultPage(app, user); });
  $('#vadd', view).addEventListener('click', () => editor(null));
  draw();
}
