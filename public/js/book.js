// Public booking page: open times in the visitor's own time zone, their details (filled in from a personal link when we have them),
// a clear prompt for anything missing, then the confirmation with Add to calendar buttons. Google sends its own invite when connected.
import { icsCalendar, googleAddUrl } from '/js/ics.js';

const box = document.getElementById('bk');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const head = box.querySelector('.bk-head').outerHTML;
const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: viewerTz });
const longWhen = (t) => new Date(t).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: viewerTz });
const token = new URLSearchParams(location.search).get('l') || '';
const MSG = { name: 'Add your name.', business: 'Add your business name.', email: 'Add your email. The invite goes there.', phone: 'Add your mobile number in case we need to reach you.', city: 'Add your city.', state: 'Add your state, like FL.', time: 'Pick a time first.' };

function fieldError(form, name, msg) {
  if (name === 'time') { const s = document.getElementById('sel'); s.textContent = msg; s.classList.add('err-text'); document.getElementById('times')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const input = form.elements[name];
  if (!input) return;
  const wrap = input.closest('.field');
  wrap.classList.add('need');
  let e = wrap.querySelector('.need-msg');
  if (!e) { e = document.createElement('span'); e.className = 'need-msg'; wrap.appendChild(e); }
  e.textContent = msg;
  input.focus();
}
function clearErrors(form) {
  form.querySelectorAll('.field.need').forEach((w) => { w.classList.remove('need'); w.querySelector('.need-msg')?.remove(); });
  const s = document.getElementById('sel'); s.classList.remove('err-text');
}
// What is still missing, in the order of the form. Matches the server's rules.
function missing(form, required, pick) {
  for (const k of required) { const el = form.elements[k]; if (el && !el.value.trim()) return [k, MSG[k] || 'This is needed.']; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) return ['email', 'That email does not look right. The invite goes there.'];
  if (form.elements.phone.value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) return ['phone', 'Enter a 10 digit mobile number.'];
  if (!pick) return ['time', MSG.time];
  return null;
}

function done(info, data) {
  const ev = { uid: `booking-${data.start}`, title: data.title || info.title || 'Rightway Growth consultation', start: data.start, minutes: data.minutes || info.minutes, location: data.meet || '', description: data.meet ? `Join: ${data.meet}` : 'We will call you at the number you gave us.' };
  const gUrl = googleAddUrl({ title: ev.title, start: ev.start, minutes: ev.minutes, details: ev.description, location: ev.location });
  box.innerHTML = `${head}<div class="card" style="text-align:center;padding:40px 20px;display:grid;gap:12px;justify-items:center"><h1 style="font-size:32px;margin:0">You're booked</h1>
    <p style="font-size:18px;margin:0">${esc(longWhen(data.start))}</p>
    <p class="muted" style="margin:0;max-width:520px">${data.google ? 'A Google Calendar invite is on its way to your email.' : 'A confirmation is on its way to your email.'} ${data.meet ? 'Join with the link below at your time.' : 'We will call you at your time on the number you gave us.'}</p>
    ${data.meet ? `<a class="btn btn-mint" href="${esc(data.meet)}" target="_blank" rel="noopener">Meeting link</a>` : ''}
    ${data.google ? '' : `<div class="row" style="justify-content:center;gap:8px"><a class="btn btn-ghost" href="${esc(gUrl)}" target="_blank" rel="noopener">Add to Google Calendar</a><button class="btn btn-ghost" type="button" id="ics">Add to Apple or Outlook</button></div>`}</div>`;
  document.getElementById('ics')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([icsCalendar([ev])], { type: 'text/calendar' }));
    a.download = 'rightway-consultation.ics';
    document.body.appendChild(a); a.click(); a.remove();
  });
}

async function load() {
  let info;
  try { info = await (await fetch(`/api/public/book${token ? `?l=${encodeURIComponent(token)}` : ''}`)).json(); } catch { info = null; }
  if (!info?.ready || !info.slots?.length) {
    box.innerHTML = `${head}<div class="card"><h1 style="font-size:30px">Book a consultation</h1><p class="muted">${info?.ready ? 'No open times in the next two weeks.' : 'Online booking is not open right now.'} Call or text us at (305) 507-3393 and we'll find a time.</p></div>`;
    return;
  }
  const required = info.required || ['name', 'business', 'email', 'phone', 'city', 'state'];
  const L = info.lead || {};
  const days = [];
  const byDay = new Map();
  for (const s of info.slots) { const k = dayKey(s); if (!byDay.has(k)) { byDay.set(k, []); days.push(k); } byDay.get(k).push(s); }
  let day = days[0], pick = null;
  const val = (k) => esc(L[k] || '');
  const gaps = info.lead ? required.filter((k) => !String(L[k] || '').trim()) : [];
  box.innerHTML = `${head}
    <div><h1 style="font-size:clamp(28px,4vw,40px);margin-bottom:6px">${esc(info.title)}</h1>
      <p class="muted" style="margin:0">${info.minutes} minutes on a screen share. We show you where you show up on Google across your area, where it is inconsistent, who is getting your calls, and what we would fix. No cost and no pressure.</p></div>
    ${L.booked ? `<div class="card bk-note"><b>You're already booked for ${esc(longWhen(L.booked))}.</b> Pick a new time below if you need to move it.</div>` : ''}
    ${info.lead ? `<div class="card bk-note">${L.name ? `Hi ${esc(String(L.name).split(' ')[0])}. ` : ''}We filled in what we already have.${gaps.length ? ' Please add the highlighted details.' : ' Check it over and pick a time.'}</div>` : ''}
    <div class="bk-grid">
      <div class="card"><h2>Pick a time</h2><p class="small">Times shown in your time zone (${esc(viewerTz.replace(/_/g, ' '))}).</p><div class="days" id="days"></div><div class="times" id="times"></div></div>
      <form class="card form-grid" id="f" style="grid-template-columns:1fr" novalidate>
        <h2>Your details</h2>
        <label class="field"><span>Your name *</span><input name="name" autocomplete="name" value="${val('name')}"></label>
        <label class="field"><span>Business name *</span><input name="business" autocomplete="organization" value="${val('business')}"></label>
        <label class="field"><span>Email (for the invite) *</span><input name="email" type="email" autocomplete="email" value="${val('email')}"></label>
        <label class="field"><span>Mobile phone *</span><input name="phone" type="tel" autocomplete="tel" value="${val('phone')}"></label>
        <label class="field"><span>Website (if you have one)</span><input name="website" inputmode="url" value="${val('website')}"></label>
        <div class="row" style="gap:10px;align-items:flex-start"><label class="field" style="flex:2 1 140px"><span>City *</span><input name="city" autocomplete="address-level2" value="${val('city')}"></label><label class="field" style="flex:1 1 70px"><span>State *</span><input name="state" maxlength="20" autocomplete="address-level1" value="${val('state')}"></label></div>
        <label class="field"><span>What do you do?</span><input name="industry" placeholder="Roofing, dental, plumbing..." value="${val('industry')}"></label>
        <label class="row small" style="gap:10px;align-items:flex-start;flex-wrap:nowrap"><input type="checkbox" name="sms_consent" value="1" style="margin-top:3px;flex:none"> <span>Text me a confirmation and reminders about this appointment from Rightway Growth. Message and data rates may apply. Reply STOP to opt out.</span></label>
        <label class="hp" aria-hidden="true">Company URL<input name="company-url" tabindex="-1" autocomplete="off"></label>
        <p class="small" id="sel">Pick a time on the left.</p>
        <button class="btn btn-primary btn-xl" type="submit" id="go">Book my consultation</button>
        <p class="err-text" id="err" role="alert"></p>
      </form>
    </div>`;
  const form = document.getElementById('f');
  for (const k of gaps) fieldError(form, k, MSG[k]);
  document.activeElement?.blur();
  const fmtDay = (k) => { const d = new Date(`${k}T12:00:00`); return `<span>${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span>`; };
  const fmtTime = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: viewerTz });
  const drawDays = () => { document.getElementById('days').innerHTML = days.map((k) => `<button type="button" class="day${k === day ? ' on' : ''}" data-day="${k}">${fmtDay(k)}</button>`).join(''); };
  const drawTimes = () => { document.getElementById('times').innerHTML = byDay.get(day).map((t) => `<button type="button" class="time${t === pick ? ' on' : ''}" data-t="${t}">${fmtTime(t)}</button>`).join(''); };
  drawDays(); drawTimes();
  box.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (d) { day = d.dataset.day; drawDays(); drawTimes(); return; }
    const t = e.target.closest('[data-t]');
    if (t) {
      pick = Number(t.dataset.t); drawTimes();
      const s = document.getElementById('sel');
      s.classList.remove('err-text');
      s.textContent = `Selected: ${longWhen(pick)}`;
    }
  });
  form.addEventListener('input', (e) => { const w = e.target.closest('.field.need'); if (w && e.target.value.trim()) { w.classList.remove('need'); w.querySelector('.need-msg')?.remove(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    document.getElementById('err').textContent = '';
    const gap = missing(form, required, pick);
    if (gap) { fieldError(form, gap[0], gap[1]); return; }
    const btn = document.getElementById('go');
    btn.disabled = true; btn.textContent = 'Booking...';
    try {
      const body = { ...Object.fromEntries(new FormData(form).entries()), sms_consent: form.elements.sms_consent.checked, start: pick, tz: viewerTz, lead_token: token };
      const res = await fetch('/api/public/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.field && data.field !== 'time') { fieldError(form, data.field, data.error); btn.disabled = false; btn.textContent = 'Book my consultation'; return; }
        throw new Error(data.error || 'Could not book that time.');
      }
      done(info, data);
    } catch (err) {
      document.getElementById('err').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Book my consultation';
      if (/taken/.test(err.message)) setTimeout(load, 1200);
    }
  });
}
load();
