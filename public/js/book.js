// Public booking page: pick an open time, enter details, get a Google Meet invite.
const box = document.getElementById('bk');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const head = box.querySelector('.bk-head').outerHTML;
const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: viewerTz });

async function load() {
  let info;
  try { info = await (await fetch('/api/public/book')).json(); } catch { info = null; }
  if (!info?.ready || !info.slots?.length) {
    box.innerHTML = `${head}<div class="card"><h1 style="font-size:30px">Book your free audit</h1><p class="muted">${info?.ready ? 'No open times in the next two weeks.' : 'Online booking is not open right now.'} Call or text us and we'll find a time.</p></div>`;
    return;
  }
  const days = [];
  const byDay = new Map();
  for (const s of info.slots) { const k = dayKey(s); if (!byDay.has(k)) { byDay.set(k, []); days.push(k); } byDay.get(k).push(s); }
  let day = days[0], pick = null;
  box.innerHTML = `${head}
    <div><h1 style="font-size:clamp(28px,4vw,40px);margin-bottom:6px">${esc(info.title)}</h1>
      <p class="muted" style="margin:0">${info.minutes} minutes on Google Meet. We show you where you rank on Google Maps across your area, who is beating you, and what we would fix. No cost and no pressure.</p></div>
    <div class="bk-grid">
      <div class="card"><h2>Pick a time</h2><p class="small">Times shown in your time zone (${esc(viewerTz.replace(/_/g, ' '))}).</p><div class="days" id="days"></div><div class="times" id="times"></div></div>
      <form class="card form-grid" id="f" style="grid-template-columns:1fr">
        <h2>Your details</h2>
        <label class="field"><span>Your name</span><input name="name" autocomplete="name" required></label>
        <label class="field"><span>Business name</span><input name="business" autocomplete="organization" required></label>
        <label class="field"><span>Email (for the invite)</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Mobile phone</span><input name="phone" type="tel" autocomplete="tel" required></label>
        <label class="field"><span>Website (if you have one)</span><input name="website" inputmode="url"></label>
        <div class="row" style="gap:10px"><label class="field" style="flex:2 1 140px"><span>City</span><input name="city" autocomplete="address-level2" required></label><label class="field" style="flex:1 1 70px"><span>State</span><input name="state" maxlength="2" autocomplete="address-level1" required></label></div>
        <label class="field"><span>What do you do?</span><input name="industry" placeholder="Roofing, dental, plumbing..."></label>
        <label class="hp" aria-hidden="true">Company URL<input name="company-url" tabindex="-1" autocomplete="off"></label>
        <p class="small" id="sel">Pick a time on the left.</p>
        <button class="btn btn-primary btn-xl" type="submit" id="go" disabled>Book my audit</button>
        <p class="err-text" id="err" role="alert"></p>
      </form>
    </div>`;
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
      document.getElementById('sel').textContent = `Selected: ${new Date(pick).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: viewerTz })}`;
      document.getElementById('go').disabled = false;
    }
  });
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('go');
    btn.disabled = true; btn.textContent = 'Booking...';
    document.getElementById('err').textContent = '';
    try {
      const body = { ...Object.fromEntries(new FormData(e.target).entries()), start: pick };
      const res = await fetch('/api/public/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not book that time.');
      box.innerHTML = `${head}<div class="card" style="text-align:center;padding:40px 20px"><h1 style="font-size:32px">You're booked</h1>
        <p style="font-size:18px">${esc(new Date(data.start).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: viewerTz }))}</p>
        <p class="muted">A Google Calendar invite with the Meet link is on its way to your email.</p>${data.meet ? `<a class="btn btn-mint" href="${esc(data.meet)}">Google Meet link</a>` : ''}</div>`;
    } catch (err) {
      document.getElementById('err').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Book my audit';
      if (/taken/.test(err.message)) load();
    }
  });
}
load();
