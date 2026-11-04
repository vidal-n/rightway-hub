// Profile pictures: show one (falls back to initials), and pick a new one. The photo is cropped to a square and shrunk
// to 256 pixels in the browser before it is sent, so it is small and loads fast.
import { esc, toast } from './core.js';

export const avatarUrl = (id, v) => `/api/avatar/${encodeURIComponent(id)}?v=${encodeURIComponent(v || 1)}`;

// Initials, with the picture on top when there is one. If the picture fails to load it removes itself and the initials show.
export function avatarHtml(u, init) {
  return `${esc(init)}${u?.avatar_at ? `<img class="pimg" src="${avatarUrl(u.id, u.avatar_at)}" alt="" width="46" height="46">` : ''}`;
}
export function wireAvatars(root = document) {
  root.querySelectorAll('img.pimg').forEach((i) => i.addEventListener('error', () => i.remove(), { once: true }));
}
// A small round picture for lists (agent cards, team floor).
export function miniAvatar(person, cls = '') {
  const init = String(person.name || person.email || '?').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<span class="mav ${cls}">${esc(init)}${person.avatar ? `<img src="${avatarUrl(person.id, person.avatar)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that photo.'))), 'image/jpeg', 0.9));
}

export function pickAvatar(user, init, done) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/*';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const blob = await squareJpeg(f);
      const res = await fetch('/api/me/avatar', { method: 'PUT', headers: { 'x-rw': '1', 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Could not save the photo (HTTP ${res.status}).`);
      user.avatar_at = d.avatar_at;
      repaint(user, init);
      toast('Profile photo saved');
      done?.();
    } catch (e) { toast(e.message || 'Could not use that photo.', true); }
  });
  input.click();
}
export async function removeAvatar(user, init, done) {
  try {
    const res = await fetch('/api/me/avatar', { method: 'DELETE', headers: { 'x-rw': '1' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not remove the photo.');
    user.avatar_at = null; repaint(user, init); toast('Photo removed'); done?.();
  } catch (e) { toast(e.message, true); }
}
function repaint(user, init) {
  document.querySelectorAll('[data-pbub], .pbub.big').forEach((b) => { b.innerHTML = avatarHtml(user, init); });
  wireAvatars();
}
