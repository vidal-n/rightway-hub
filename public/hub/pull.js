// Pull down at the top of the page to refresh (touch screens). It re-draws the page you are on, it does not reload the app,
// so the phone, a live call and your place in the Hub are not lost. It is skipped while a call or a window is open.
import { toast } from './core.js';

const THRESHOLD = 64;     // px of finger travel after resistance
const MAX = 96;

const busy = () => Boolean(
  document.querySelector('.callbar, .modal-bg, .pd, .pal-wrap, .ai-panel.open')
  || document.body.classList.contains('pdx')
  || /Power dialing/i.test(document.getElementById('pdgo')?.textContent || ''));

export function mountPull(scroller) {
  if (!scroller || scroller.dataset.ptr) return;
  scroller.dataset.ptr = '1';
  const deck = scroller.parentElement;
  const tip = document.createElement('div');
  tip.className = 'ptr'; tip.setAttribute('aria-hidden', 'true');
  tip.innerHTML = '<span class="ptr-i"></span><span class="ptr-t">Pull to refresh</span>';
  deck.appendChild(tip);
  tip.style.top = (scroller.offsetTop + 8) + 'px';
  const content = scroller.firstElementChild;
  let y0 = 0, x0 = 0, pull = 0, on = false, spin = false;
  const paint = (p, label) => {
    tip.style.setProperty('--p', String(p));
    tip.style.opacity = spin ? '1' : String(Math.min(1, Math.max(0, (p - 8) / 36)));
    tip.classList.toggle('ready', p >= THRESHOLD);
    tip.querySelector('.ptr-t').textContent = label || (p >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh');
    if (content) content.style.transform = p ? `translateY(${p}px)` : '';
  };
  const reset = () => { on = false; pull = 0; if (content) content.style.transition = 'transform .22s ease'; paint(0); setTimeout(() => { if (content) content.style.transition = ''; }, 260); };
  const nestedScrolled = (el) => { for (let n = el; n && n !== scroller; n = n.parentElement) { if (n.scrollTop > 0) return true; } return false; };
  scroller.addEventListener('touchstart', (e) => {
    on = false; pull = 0;
    if (spin || e.touches.length !== 1 || scroller.scrollTop > 0) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable], .zoomable, iframe, .board, .tabs, .qbar')) return;
    if (nestedScrolled(t)) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; on = true;
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!on) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (dy <= 0 || Math.abs(dx) > dy * 0.8 || scroller.scrollTop > 0) { if (pull) reset(); on = dy > 0 && on; return; }
    if (e.cancelable) e.preventDefault();
    pull = Math.min(MAX, dy * 0.5);
    paint(pull);
  }, { passive: false });
  const end = () => {
    if (!on) return;
    const go = pull >= THRESHOLD;
    on = false;
    if (!go) return reset();
    if (busy()) { reset(); toast('Finish the call or close the window first.', true); return; }
    spin = true; tip.classList.add('spin'); paint(THRESHOLD, 'Refreshing...');
    // Re-draw this page (the same thing a link to it does) and tell the dots and lists to reload.
    setTimeout(() => { try { window.dispatchEvent(new Event('hashchange')); document.dispatchEvent(new Event('rw-badges')); } catch { /* ignore */ } }, 120);
    setTimeout(() => { spin = false; tip.classList.remove('spin'); reset(); }, 900);
  };
  scroller.addEventListener('touchend', end, { passive: true });
  scroller.addEventListener('touchcancel', () => { if (on) reset(); }, { passive: true });
}
