// The "Wants info first" email inside the result window: who it goes to (editable, in case the address on file is wrong), a preview
// they can edit, and the callback time. Sending happens when they press Save (dispoPanel). Modeled on requested-info follow-up
// emails in Apollo.io sequences. The email itself is built by public/js/infomail.js, the same code the Worker sends with.
import { $, esc, api, toast, modal } from './core.js';
import { infoEmail, EMAIL_RE } from '../js/infomail.js';


// Fills `box` and returns { get(), via } (get is null until the lead's details load).
export async function mountInfo(box, lead, getWhen) {
  box.innerHTML = '<div class="small muted">Loading their details...</div>';
  let d;
  try { d = await api(`/api/leads/${lead.id}/info-email`); } catch (e) { box.innerHTML = `<div class="small err-text">${esc(e.message)}</div>`; return { get: () => null }; }
  const st = { on: !d.dnc && Boolean(d.via), subject: d.subject, intro: d.intro };
  const note = d.dnc ? 'On the do not call list, so no email.' : !d.via ? 'Email is not set up yet. Connect your Gmail on the Google page, or ask an owner to add the email key.' : '';
  box.innerHTML = `
    <label class="dp-infochk"><input type="checkbox" id="dpinfoon"${st.on ? ' checked' : ''}${st.on || !note ? '' : ' disabled'}> <span>Email them our info when I save</span></label>
    <div class="dp-inforow"><input type="email" id="dpmail" value="${esc(d.to)}" placeholder="their email address" autocomplete="off" aria-label="Their email address" title="Wrong address? Change it here. The new one is saved on the lead."><button type="button" class="btn btn-ghost btn-sm" id="dpprev">Preview and edit</button></div>
    ${note || !d.to ? `<div class="small muted dp-infohelp">${esc(note || 'No email on file. Type it here and it is saved on the lead.')}</div>` : ''}`;
  const on = $('#dpinfoon', box), mail = $('#dpmail', box);
  on.addEventListener('change', () => { st.on = on.checked; box.classList.toggle('off', !st.on); });
  box.classList.toggle('off', !st.on);
  const build = () => infoEmail({ first: d.first, business: d.business, industry: d.industry, rep: d.rep, repFirst: d.repFirst, subject: st.subject, intro: st.intro, bookUrl: d.bookUrl, logoUrl: d.logoUrl, callbackAt: getWhen ? Number(new Date(getWhen())) || 0 : 0, tz: d.tz });
  $('#dpprev', box).addEventListener('click', () => {
    const m = modal(`<div class="card-head"><h2>Info email</h2></div>
      <div class="info-edit"><div>
        <label class="field"><span>Subject</span><input id="imsub" value="${esc(st.subject)}"></label>
        <label class="field"><span>Opening paragraph (the rest is our standard info)</span><textarea id="imint" rows="8">${esc(st.intro)}</textarea></label>
        <div class="small muted" style="margin-top:8px">It goes out from ${esc(d.via === 'gmail' ? 'your Gmail' : 'Rightway Growth, with your name and reply address')}. The Pick a time button opens their own booking page.</div>
        <div class="row end" style="margin-top:12px"><button type="button" class="btn btn-primary" id="imdone">Done</button></div>
      </div><iframe class="info-frame" id="imframe" title="Email preview" sandbox=""></iframe></div>`, { onClose: () => {} });
    const paint = () => { $('#imframe', m.el).srcdoc = build().html; };
    paint();
    $('#imsub', m.el).addEventListener('input', (e) => { st.subject = e.target.value; });
    $('#imint', m.el).addEventListener('input', (e) => { st.intro = e.target.value; paint(); });
    $('#imdone', m.el).addEventListener('click', () => m.close());
  });
  return {
    via: d.via,
    get() {
      if (!st.on) return null;
      const to = mail.value.trim().toLowerCase();
      if (!EMAIL_RE.test(to)) { mail.focus(); throw new Error(to ? `"${to}" does not look like an email address.` : 'Add their email address, or untick the email box.'); }
      return { to, subject: st.subject, intro: st.intro };
    },
  };
}
