// The Hub tour: a spotlight walk through the menu and the top bar, fitted to the person's job (closer, scheduler, appointment setter)
// or owner. Offered once to everyone who has not done it, replayable any time from Training. Progress lives with the training
// progress (key tour:hub), so it follows the person to any device.
import { $, esc, api, toast } from './core.js';
import { can, jobLabel } from '/js/jobs.js';

const MARK = '<svg class="t-hero" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="22.5" fill="#9DEBCB"/><path d="M48 81C48 81 24 58.5 24 40.5C24 27.3 34.8 16.5 48 16.5C61.2 16.5 72 27.3 72 40.5C72 58.5 48 81 48 81Z" fill="#0F1B17"/><path d="M39.3 49.2L55.5 33M44.4 32.4H56.1V44.1" fill="none" stroke="#9DEBCB" stroke-width="6.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Every stop: key, where it points (a menu item key or a CSS selector), title, what to say, and who sees it.
export function tourSteps(user) {
  const first = String(user?.name || '').split(' ')[0] || 'there';
  const admin = user?.role === 'admin';
  const steps = [
    { key: 'welcome', title: 'Welcome to Rightway Hub', body: `Hi ${first}. You're set up as ${admin ? 'an owner' : jobLabel(user).toLowerCase() === 'closer' ? 'a closer' : `${/^[aeiou]/i.test(jobLabel(user)) ? 'an' : 'a'} ${jobLabel(user).toLowerCase()}`}. Here's a quick look at where everything lives. It takes about a minute.` },
    { key: 'home', nav: 'home', title: 'Dashboard', body: 'Your day at a glance: dials, meetings, callbacks due and the pipeline.' },
    { key: 'phone', nav: 'phone', title: 'Phone', body: "The dialer and power dial, dial out, texts, calls and voicemail, and recordings. Calls run through your computer's mic and speakers." },
    { key: 'pipeline', nav: 'pipeline', title: 'Pipeline', body: 'Every lead. Call lists line up who to call first from the scrubbed data. Open a lead for call prep, the script and booking.' },
    { key: 'calendar', nav: 'calendar', title: 'Calendar', body: can(user, 'schedule') ? "Every booked audit and appointment on the team, so nobody gets double booked. You can move or hand over anyone's call." : 'Your booked audits and appointments. Whoever books picks the closer, or the first free one gets it.' },
    { key: 'agents', nav: 'agents', title: 'Agents', body: admin ? 'Who is available, on a call or on break. Listen, whisper or barge on live calls, and see the call numbers.' : 'Who is available, on a call or on break, and your call numbers.' },
    { key: 'work', nav: 'work', title: 'My work', body: 'Your client tasks for the month, each with a step by step guide and the proof it needs.', cap: 'deliver' },
    { key: 'clients', nav: 'clients', title: 'Clients', body: 'Every client: rankings, reviews, posts, reports, and the client app the way they see it.', cap: 'deliver' },
    { key: 'scan', nav: 'scan', title: 'Scan tool', body: 'The local rank grid for any business. You run it live on clarity audits.', cap: 'close' },
    { key: 'training', nav: 'training', title: 'Training', body: 'Scripts, objection drills and playbooks. This tour lives here too, so you can replay it any time.' },
    { key: 'settings', nav: 'settings', title: 'Settings', body: 'Agents and their jobs, online booking, phone setup, Stripe, budget and files.', owner: true },
    { key: 'search', sel: '#cmdk', title: 'Search', body: 'Find any lead by name or phone number, or jump to a page. Press Ctrl K or / from anywhere.' },
    { key: 'status', sel: '[data-stpill]', title: 'Your status', body: 'Available, break, lunch, training. It shows on the team floor, and Available means calls can ring you.' },
    { key: 'alerts', sel: '#notifbtn', title: 'Notifications', body: 'Calls, texts, new leads, tasks and bookings land here. Turn on phone alerts on the Notifications page.' },
    { key: 'profile', sel: '[data-pbub]', title: 'Your profile', body: 'Your photo, settings and log out. Connect your own Google from Settings so invites and Meet links come from your calendar.' },
    { key: 'done', title: "You're all set", body: admin ? 'Next: open Settings, Agents and give everyone their job. Then check the Online booking card.'
      : can(user, 'close') ? 'Next: read both scripts in Training, then check your appointments on the Calendar.'
        : 'Next: read the cold call script in Training, then open Phone and start dialing.' },
  ];
  return steps.filter((s) => (!s.cap || can(user, s.cap)) && (!s.owner || admin));
}

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
function targetOf(step) {
  if (step.sel) return [...document.querySelectorAll(step.sel)].find(visible) || null;
  if (step.nav) return [...document.querySelectorAll(`#side [data-nav="${step.nav}"], #bbar [data-nav="${step.nav}"]`)].find(visible) || null;
  return null;
}

let open = null;
export function startTour(user, { at = 0, onEnd } = {}) {
  open?.close(false);
  const steps = tourSteps(user);
  let i = Math.max(0, Math.min(at, steps.length - 1));
  const root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card" tabindex="-1"></div>';
  document.body.appendChild(root);
  const spot = $('.tour-spot', root), card = $('.tour-card', root);
  const place = () => {
    const s = steps[i];
    const t = targetOf(s);
    const center = !t;
    card.classList.toggle('center', center);
    spot.classList.toggle('none', center);
    if (center) { card.style.left = ''; card.style.top = ''; return; }
    t.scrollIntoView?.({ block: 'nearest' });
    const r = t.getBoundingClientRect(), pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = card.offsetWidth || 340, ch = card.offsetHeight || 200, gap = 16;
    let left, top;
    if (r.right + gap + cw < innerWidth - 8) { left = r.right + gap; top = r.top + r.height / 2 - ch / 2; }
    else if (r.bottom + gap + ch < innerHeight - 8) { left = r.left + r.width / 2 - cw / 2; top = r.bottom + gap; }
    else if (r.top - gap - ch > 8) { left = r.left + r.width / 2 - cw / 2; top = r.top - gap - ch; }
    else { left = r.left - gap - cw; top = r.top; }
    card.style.left = `${Math.max(12, Math.min(left, innerWidth - cw - 12))}px`;
    card.style.top = `${Math.max(12, Math.min(top, innerHeight - ch - 12))}px`;
  };
  const draw = () => {
    const s = steps[i];
    const last = i === steps.length - 1;
    const missing = (s.nav || s.sel) && !targetOf(s);
    card.innerHTML = `${s.key === 'welcome' || last ? MARK : ''}${s.key === 'welcome' ? '' : `<p class="t-step">${i} of ${steps.length - 1}</p>`}
      <h3>${esc(s.title)}</h3><p class="t-body">${esc(s.body)}${missing ? ' <span class="small muted">(On a phone: tap More in the bottom bar to find it.)</span>' : ''}</p>
      <div class="t-dots" aria-hidden="true">${steps.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="t-row">${s.key === 'welcome'
    ? '<button class="btn btn-ghost btn-sm" data-t="later">Later</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-t="skip">No thanks</button><button class="btn btn-primary btn-sm" data-t="next">Start the tour</button>'
    : last ? '<a class="btn btn-ghost btn-sm" href="#/training" data-t="finish">Open Training</a><span class="spacer"></span><button class="btn btn-primary btn-sm" data-t="finish">Done</button>'
      : '<button class="btn btn-ghost btn-sm" data-t="skip">Skip tour</button><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-t="back">Back</button><button class="btn btn-primary btn-sm" data-t="next">Next</button>'}</div>`;
    requestAnimationFrame(place);
    card.focus({ preventScroll: true });
  };
  const close = (finished, later) => {
    if (!open) return;
    open = null;
    removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (later) { try { localStorage.setItem(`rw-tour-later-${user.id}`, String(Date.now() + 3 * 864e5)); } catch { /* ignore */ } }
    else if (finished !== false) markDone();
    onEnd?.();
  };
  const go = (d) => { i = Math.max(0, Math.min(steps.length - 1, i + d)); draw(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('a,button'))) { e.preventDefault(); if (i < steps.length - 1) go(1); else close(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };
  card.addEventListener('click', (e) => {
    const a = e.target.closest('[data-t]')?.dataset.t;
    if (a === 'next') go(1); else if (a === 'back') go(-1);
    else if (a === 'skip' || a === 'finish') close(true);
    else if (a === 'later') close(false, true);
  });
  addEventListener('resize', place);
  document.addEventListener('keydown', onKey, true);
  open = { close };
  draw();
}

async function markDone() {
  try {
    const cur = new Set((await api('/api/me/training')).done || []);
    if (cur.has('tour:hub')) return;
    cur.add('tour:hub');
    await api('/api/me/training', { method: 'PUT', body: { done: [...cur] } });
  } catch (e) { toast(e.message, true); }
}

// Offered once per page load to staff who have not taken it (or said Later in the last 3 days). Waits for the opening animation.
let asked = false;
export async function maybeTour(user) {
  if (asked || !user || !['admin', 'team'].includes(user.role) || matchMedia('print').matches) return;
  asked = true;
  try { if (Number(localStorage.getItem(`rw-tour-later-${user.id}`) || 0) > Date.now()) return; } catch { /* ignore */ }
  let done;
  try { done = (await api('/api/me/training')).done || []; } catch { return; }
  if (done.includes('tour:hub')) return;
  await (window.__rwIntro || Promise.resolve());
  setTimeout(() => { if (!document.querySelector('.tour, .modal-wrap, .modal')) startTour(user); }, 450);
}
