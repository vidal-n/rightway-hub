// "Wants info first" email (pure, shared by the Worker that sends it and the browser that previews it).
// Modeled on the requested-info follow-up pattern that sales email tools like Apollo.io and Outreach sequences use, and on Calendly's
// booking button: say who you are and why they are getting it in the first line, give a short plain "what we do and why it could help",
// one main button (pick a time), one low friction alternative (reply with a time, or we call back at a time they chose), a real
// postal address and an opt out line. Honest by rule: only facts the research really found, no ranking promises, no made up numbers,
// no fake deadlines or scarcity, no dashes in the copy.
import { whenIn } from './apptime.js';

export const COMPANY = {
  name: 'Rightway Growth',
  address: '2001 Van Buren St, Hollywood, Florida 33020',
  site: 'rightwaygrowth.com',
  phone: '(305) 507-3393',
  area: 'Miami and Fort Lauderdale',
};
const BRAND = { ink: '#0F1B17', mint: '#9DEBCB', strong: '#23B07E', accent: '#0A6B4C', line: '#DCE6E1', muted: '#5C6F68' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s) => String(s ?? '').replace(/[–—]/g, ',').replace(/\s+/g, ' ').trim();
export const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

// The trade in plain words for the email ("plumbers", "roofing companies"). Unknown trades read as "local service businesses".
export function tradeWord(industry) {
  const t = clean(industry).toLowerCase();
  if (!t) return 'local service businesses';
  if (/plumb/.test(t)) return 'plumbers';
  if (/roof/.test(t)) return 'roofing companies';
  if (/hvac|air condition|heating|cooling/.test(t)) return 'HVAC companies';
  if (/electric/.test(t)) return 'electricians';
  if (/landscap|lawn/.test(t)) return 'landscapers';
  if (/pest/.test(t)) return 'pest control companies';
  if (/clean|maid/.test(t)) return 'cleaning companies';
  if (/dent/.test(t)) return 'dental practices';
  if (/law|attorney/.test(t)) return 'law firms';
  if (/paint/.test(t)) return 'painters';
  if (/pool/.test(t)) return 'pool companies';
  if (/auto|car |mechanic|repair/.test(t)) return 'auto shops';
  return `${t.replace(/s$/, '')} businesses`;
}

// Up to two honest facts from what we really know about the lead. Nothing is said that the data does not show.
export function infoFacts(lead = {}, intel = null) {
  const out = [];
  const biz = clean(lead.business);
  const rank = intel && intel.rank_checked !== false && intel.found !== false ? Number(intel.rank) : NaN;
  const kw = clean(intel?.keyword);
  if (Number.isFinite(rank) && rank > 3 && kw) out.push(`When I searched "${kw}" near ${biz || 'you'}, your listing came up around spot ${Math.round(rank)}. The top three are what most people see first.`);
  const rev = lead.reviews == null || lead.reviews === '' ? NaN : Number(lead.reviews);
  if (Number.isFinite(rev) && rev < 25) out.push(`Your Google listing shows ${rev} review${rev === 1 ? '' : 's'}, and reviews are one of the things Google and customers both look at.`);
  if (!clean(lead.website) && lead.website !== undefined && out.length < 2) out.push('I did not see a website linked on your Google listing.');
  return out.slice(0, 2);
}

// Starting text for the one paragraph a rep can edit. Short and personal.
export function defaultIntro(lead = {}, { first = '', repFirst = '', facts = [] } = {}) {
  const hi = first ? `Hi ${first},` : 'Hi there,';
  const who = repFirst ? `This is ${repFirst} from ${COMPANY.name}.` : `This is ${COMPANY.name}.`;
  const why = facts.length
    ? `You asked for more info, so here it is in one place. I called because I looked at ${clean(lead.business) || 'your business'} on Google first. ${facts[0]}`
    : `You asked for more info, so here it is in one place. I called because we are giving local owners a free look at how their business shows up on Google, and where a few competitors are ahead.`;
  return `${hi}\n\nThanks for taking my call. ${who} ${why}`;
}

export function defaultSubject(lead = {}, first = '') {
  const biz = clean(lead.business);
  return first ? `${first}, the info you asked for` : biz ? `The info you asked for, ${biz}` : 'The info you asked for';
}

const WHAT = [
  ['Your Google profile', 'We clean it up and keep it active with fresh posts and photos, so it looks alive to customers and to Google.'],
  ['Reviews', 'A simple way to ask happy customers for reviews from your phone, and replies to the ones that come in.'],
  ['Listings that match', 'Your name, address and phone the same everywhere they appear, so nothing contradicts your Google profile.'],
  ['A report you can read', 'Every month you see what we did and where you show up on the map, in plain words.'],
];
const WHY = [
  'People who search "near me" on their phone mostly pick from the first few businesses they see.',
  'Reviews, a complete profile and consistent listings are things you control, and they are what we work on.',
  'You see the work every month, and after the first 3 months it is month to month.',
];

// The email. `callbackAt` is a ms timestamp when the rep set a callback time, shown in the lead's own zone.
export function infoEmail(p = {}) {
  const first = clean(p.first);
  const biz = clean(p.business);
  const rep = clean(p.rep) || 'The Rightway Growth team';
  const repFirst = clean(p.repFirst) || rep.split(' ')[0];
  const intro = String(p.intro || '').replace(/\r/g, '').trim() || defaultIntro({ business: biz }, { first, repFirst });
  const subject = clean(p.subject) || defaultSubject({ business: biz }, first);
  const trade = tradeWord(p.industry);
  const bookUrl = /^https:\/\//.test(p.bookUrl || '') ? p.bookUrl : '';
  const logo = /^https:\/\//.test(p.logoUrl || '') ? p.logoUrl : '';
  const cb = Number(p.callbackAt) || 0;
  const cbText = cb ? whenIn(cb, p.tz || 'America/New_York') : '';
  const cbZone = cb ? (new Intl.DateTimeFormat('en-US', { timeZone: p.tz || 'America/New_York', timeZoneName: 'short' }).formatToParts(cb).find((x) => x.type === 'timeZoneName') || {}).value || '' : '';

  const callbackLine = cb
    ? `I will call you ${cbText} ${cbZone} (your time). If that changes, just reply to this email with a better time.`
    : `Rather have me call you? Reply with a time that works, or text ${COMPANY.phone}, and I will call you then.`;

  const what = `Here is what we do for ${trade} in ${COMPANY.area}`;
  const callHeading = 'What the call is';
  const callBody = `A short, free Google clarity audit. We show you how ${biz || 'your business'} appears in the map results around you, who is ahead and exactly why, and what we would fix first. You keep the audit either way. No pressure.`;
  const honest = 'Nobody can promise a spot on Google, and we do not. We do the work on the things you control, and show you proof of it every month.';

  // Plain text version.
  const text = [
    intro, '',
    `${what}:`, ...WHAT.map(([h, b]) => `- ${h}: ${b}`), '',
    'Why it could help:', ...WHY.map((w) => `- ${w}`), '',
    `${callHeading}: ${callBody}`, '',
    honest, '',
    bookUrl ? `Pick a time that works: ${bookUrl}` : '',
    callbackLine, '',
    `${rep}`, `${COMPANY.name}, ${COMPANY.area}`, COMPANY.phone, '',
    `P.S. The easiest way is to reply with the word "call" and a time. I will take care of the rest.`, '',
    `${COMPANY.name}, ${COMPANY.address}`,
    'You are getting this because you asked for more info on our call. Reply "stop" and we will not email you again.',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');

  const p0 = (s) => `<p style="margin:0 0 14px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${s}</p>`;
  const introHtml = intro.split(/\n{2,}/).map((x) => p0(esc(x).replace(/\n/g, '<br>'))).join('');
  const li = (h, b) => `<tr><td valign="top" style="padding:0 12px 12px 0;width:22px"><div style="width:22px;height:22px;border-radius:11px;background:${BRAND.mint};color:${BRAND.ink};font:700 13px/22px Arial,sans-serif;text-align:center">&#10003;</div></td><td style="padding:0 0 12px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}"><b>${esc(h)}.</b> ${esc(b)}</td></tr>`;
  const dot = (t) => `<tr><td valign="top" style="padding:0 10px 8px 0;width:14px;font:15px/1.5 Arial,sans-serif;color:${BRAND.strong}">&bull;</td><td style="padding:0 0 8px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(t)}</td></tr>`;
  const h = (t) => `<h2 style="margin:26px 0 12px;font:700 13px/1.2 Arial,Helvetica,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${BRAND.accent}">${esc(t)}</h2>`;
  const header = `<tr><td style="background:${BRAND.ink};padding:22px 28px;border-radius:14px 14px 0 0">${logo
    ? `<a href="https://${COMPANY.site}" style="text-decoration:none"><img src="${esc(logo)}" width="170" height="28" alt="${esc(COMPANY.name)}" style="display:block;border:0;height:28px;width:170px;color:${BRAND.mint};font:700 16px Arial,sans-serif"></a>`
    : `<span style="font:700 17px Arial,sans-serif;letter-spacing:.04em;color:${BRAND.mint}">RIGHTWAY</span> <span style="font:12px Arial,sans-serif;letter-spacing:.18em;color:#9DB2A8">GROWTH</span>`}</td></tr>
    <tr><td style="height:4px;background:${BRAND.mint};font-size:0;line-height:0">&nbsp;</td></tr>`;
  const button = bookUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="border-radius:12px;background:${BRAND.accent}"><a href="${esc(bookUrl)}" style="display:inline-block;padding:15px 28px;font:700 16px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:12px">Pick a time that works</a></td></tr></table>` : '';
  const cbBox = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:14px 0 4px"><tr><td style="background:#F2F8F5;border:1px solid ${BRAND.line};border-radius:12px;padding:14px 16px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${cb ? `<b style="color:${BRAND.accent}">Your call back:</b> ${esc(cbText)} ${esc(cbZone)}<br>` : '<b style="color:' + BRAND.accent + '">Prefer a call back?</b><br>'}${esc(callbackLine)}</td></tr></table>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF3F0"><div style="display:none;max-height:0;overflow:hidden;opacity:0">The info you asked for, and a free Google clarity audit for ${esc(biz || 'your business')}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;border:1px solid ${BRAND.line}">
${header}
<tr><td style="padding:28px 28px 8px">
${introHtml}
${h(what)}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${WHAT.map(([a, b]) => li(a, b)).join('')}</table>
${h('Why it could help ' + (biz || 'you'))}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${WHY.map(dot).join('')}</table>
${h(callHeading)}
${p0(esc(callBody))}
${p0(`<span style="color:${BRAND.muted}">${esc(honest)}</span>`)}
${button}
${cbBox}
<p style="margin:22px 0 4px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}"><b>${esc(rep)}</b><br><span style="color:${BRAND.muted}">${esc(COMPANY.name)}, ${esc(COMPANY.area)}<br>${esc(COMPANY.phone)}</span></p>
<p style="margin:18px 0 20px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}"><b>P.S.</b> The easiest way is to reply with the word "call" and a time. I will take care of the rest.</p>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid ${BRAND.line};font:12px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.muted}">${esc(COMPANY.name)}, ${esc(COMPANY.address)}<br>You are getting this because you asked for more info on our call. Reply "stop" and we will not email you again.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
