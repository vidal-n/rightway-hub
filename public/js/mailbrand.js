// One branded email layout for every automated email (pure, shared by the Worker and any browser preview).
// Modeled on the transactional email layouts of Calendly and Cal.com (one clear button per message, the details in plain text under it)
// and on the look of the "wants info" email in infomail.js: ink header band with the logo, mint rule, white card, small footer with the
// postal address and an opt out line. Plain text in, so every template stays editable as text in Settings. A line that is only a meeting
// link becomes a Join button, a line that is only a booking link becomes a "Pick a time" button, "- " lines become a list, other links
// are clickable. No dashes in the copy, no invented facts: this only dresses up the words it is given.
export const BRAND = { ink: '#0F1B17', mint: '#9DEBCB', strong: '#23B07E', accent: '#0A6B4C', line: '#DCE6E1', muted: '#5C6F68', paper: '#EEF3F0' };
export const COMPANY = { name: 'Rightway Growth', address: '2001 Van Buren St, Hollywood, Florida 33020', site: 'rightwaygrowth.com', phone: '(305) 507-3393', area: 'Miami and Fort Lauderdale' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function buttonFor(url) {
  if (/meet\.google\.com/.test(url)) return 'Join the Google Meet';
  if (/zoom\.us/.test(url)) return 'Join the Zoom';
  if (/teams\.microsoft\.com/.test(url)) return 'Join the meeting';
  if (/\/book\.html/.test(url)) return 'Pick a time that works';
  if (/calendar\.google\.com/.test(url)) return 'Add to Google Calendar';
  return '';
}

const para = (s) => `<p style="margin:0 0 14px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${s}</p>`;

// opts: { logoUrl, preheader, optOut (string or false), signature (string) }
export function brandedHtml(text, opts = {}) {
  const logo = /^https:\/\//.test(opts.logoUrl || '') ? opts.logoUrl : '';
  const buttons = [];
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((raw) => {
    const u = raw.trim();
    if (/^https:\/\/\S+$/.test(u) && buttonFor(u)) { buttons.push(u); return `@@BTN${buttons.length - 1}@@`; }
    return esc(raw);
  });
  const linked = (s) => s.replace(/(https:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${BRAND.accent}">$1</a>`);
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(`<ul style="margin:0 0 14px;padding-left:20px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${list.join('')}</ul>`); list = []; } };
  let block = [];
  const flushBlock = () => { if (block.length) { out.push(para(linked(block.join('<br>')))); block = []; } };
  for (const l of lines) {
    if (/^@@BTN\d+@@$/.test(l)) {
      flush(); flushBlock();
      const u = buttons[Number(l.slice(5, -2))];
      out.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:12px;background:${BRAND.accent}"><a href="${esc(u)}" style="display:inline-block;padding:14px 26px;font:700 16px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:12px">${esc(buttonFor(u))}</a></td></tr></table>`);
    } else if (l.startsWith('- ')) { flushBlock(); list.push(`<li style="margin:0 0 6px">${linked(l.slice(2))}</li>`); }
    else if (!l.trim()) { flush(); flushBlock(); }
    else { flush(); block.push(l); }
  }
  flush(); flushBlock();
  const header = `<tr><td style="background:${BRAND.ink};padding:20px 28px;border-radius:14px 14px 0 0">${logo
    ? `<a href="https://${COMPANY.site}" style="text-decoration:none"><img src="${esc(logo)}" width="170" height="28" alt="${esc(COMPANY.name)}" style="display:block;border:0;height:28px;width:170px;color:${BRAND.mint};font:700 17px Arial,sans-serif"></a>`
    : `<span style="font:700 17px Arial,sans-serif;letter-spacing:.04em;color:${BRAND.mint}">RIGHTWAY</span> <span style="font:12px Arial,sans-serif;letter-spacing:.18em;color:#9DB2A8">GROWTH</span>`}</td></tr>
<tr><td style="height:4px;background:${BRAND.mint};font-size:0;line-height:0">&nbsp;</td></tr>`;
  const optOut = opts.optOut === false ? '' : esc(opts.optOut || 'Reply "stop" and we will not email you again.');
  const sig = opts.signature ? `<p style="margin:6px 0 0;font:15px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}"><b>${esc(opts.signature)}</b><br><span style="color:${BRAND.muted}">${esc(COMPANY.name)}, ${esc(COMPANY.area)}<br>${esc(COMPANY.phone)}</span></p>` : '';
  const pre = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BRAND.paper}">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;border:1px solid ${BRAND.line}">
${header}
<tr><td style="padding:28px 28px 14px">${out.join('')}${sig}</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid ${BRAND.line};font:12px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.muted}">${esc(COMPANY.name)}, ${esc(COMPANY.address)}${optOut ? `<br>${optOut}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
