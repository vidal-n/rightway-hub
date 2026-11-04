// Opening animation: the Rightway mark and wordmark, once per browser session when the Hub opens or right after logging in.
// It sits on top while the page renders underneath, so it never slows anything down. Skipped for people who ask for reduced motion.
import { REDUCED } from './core.js';

const MARK = `<svg class="ri-mark" viewBox="0 0 96 96" aria-hidden="true">
  <rect class="ri-sq" x="0" y="0" width="96" height="96" rx="22.5" fill="#9DEBCB"/>
  <path class="ri-pin" d="M48 81C48 81 24 58.5 24 40.5C24 27.3 34.8 16.5 48 16.5C61.2 16.5 72 27.3 72 40.5C72 58.5 48 81 48 81Z" fill="#0F1B17"/>
  <path class="ri-arrow" d="M39.3 49.2L55.5 33M44.4 32.4H56.1V44.1" fill="none" stroke="#9DEBCB" stroke-width="6.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function playIntro() {
  if (window.__rwIntro) return window.__rwIntro;
  let seen = false;
  try { seen = sessionStorage.getItem('rw-intro') === '1'; sessionStorage.setItem('rw-intro', '1'); } catch { seen = false; }
  if (seen || REDUCED) { window.__rwIntro = Promise.resolve(); return window.__rwIntro; }
  const el = document.createElement('div');
  el.className = 'rintro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="ri-glow"></div><div class="ri-stack">${MARK}<div class="ri-word">Rightway <b>Hub</b></div><div class="ri-line"><span></span></div><p class="ri-tag">Rightway Growth</p></div>`;
  document.body.appendChild(el);
  window.__rwIntro = new Promise((done) => {
    setTimeout(() => el.classList.add('ri-out'), 1500);
    setTimeout(() => { el.remove(); done(); }, 2050);
    el.addEventListener('click', () => { el.classList.add('ri-out'); setTimeout(() => { el.remove(); done(); }, 380); }, { once: true });
  });
  return window.__rwIntro;
}
