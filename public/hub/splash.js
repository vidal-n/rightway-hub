// The client's logo as an animated opening screen. Plays when they send in their logo, and once each time they open the app.
import { api } from './core.js';

let playing = false;
export async function showLogoSplash(clientId, { force = false, name = '' } = {}) {
  if (playing || !clientId) return;
  try { if (!force && sessionStorage.getItem(`rw-splash-${clientId}`)) return; } catch { /* ignore */ }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && !force) return;
  const src = `/api/clients/${clientId}/logo?t=${force ? Date.now() : ''}`;
  // Load the logo first, so a client with none never sees an empty screen.
  const img = new Image();
  const ok = await new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = src; });
  if (!ok) return;
  playing = true;
  try { sessionStorage.setItem(`rw-splash-${clientId}`, '1'); } catch { /* ignore */ }
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Loading your app');
  el.innerHTML = `<div class="splash-in"><div class="splash-ring"></div><img class="splash-logo" alt="" src="${src}">${name ? `<p class="splash-name">${String(name).replace(/[<>&"]/g, '')}</p>` : ''}<div class="splash-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  const done = () => { el.classList.add('out'); setTimeout(() => { el.remove(); playing = false; }, 450); };
  el.addEventListener('click', done);
  setTimeout(done, force ? 2400 : 1900);
}
