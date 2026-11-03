// Gmail message plumbing. Pure string work (no DOM, no network), so the Worker, the browser and Node tests all share it.
// Gmail hands back MIME trees with base64url bodies; these helpers turn one into something a page can show,
// and turn a compose form back into the raw RFC 822 message Gmail wants.

// ---------- base64 (url-safe, UTF-8 aware) ----------
export function decodeB64(data, charset = 'utf-8') {
  const s = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!s) return '';
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try { return new TextDecoder(charset).decode(u8); } catch { return new TextDecoder('utf-8').decode(u8); }
}
export function encodeB64(text) {
  const u8 = new TextEncoder().encode(String(text ?? ''));
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const b64url = (text) => encodeB64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => Uint8Array.from(atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s || '').length / 4) * 4, '=')), (c) => c.charCodeAt(0));

// ---------- headers ----------
export function headerOf(payload, name) {
  const want = String(name).toLowerCase();
  const h = (payload?.headers || []).find((x) => String(x.name).toLowerCase() === want);
  return h ? String(h.value || '') : '';
}

// "Jane Doe <jane@x.com>" and the quoted, bare and angle-only shapes mail clients send.
export function addr(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)<([^>]+)>\s*$/);
  let name = m ? m[1].trim() : '';
  const email = (m ? m[2] : s).trim().toLowerCase();
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) name = name.slice(1, -1).trim();
  name = decodeWord(name);
  return { name: name || email.split('@')[0] || '', email };
}
// Splits on commas that are not inside quotes or angle brackets.
export function addrList(raw) {
  const out = []; let cur = ''; let q = false; let ang = false;
  for (const ch of String(raw || '')) {
    if (ch === '"') q = !q;
    else if (ch === '<') ang = true;
    else if (ch === '>') ang = false;
    if (ch === ',' && !q && !ang) { if (cur.trim()) out.push(addr(cur)); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(addr(cur));
  return out.filter((a) => a.email);
}

// RFC 2047 encoded words ("=?UTF-8?B?...?=") show up in subjects and names from other mail clients.
export function decodeWord(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') return decodeB64(text, cs);
      const bin = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
      return new TextDecoder(cs).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch { return text; }
  }).replace(/\?=\s+=\?/g, '');
}
export function encodeWord(s) {
  const t = String(s ?? '');
  return /^[\x20-\x7E]*$/.test(t) ? t : `=?UTF-8?B?${encodeB64(t)}?=`;
}

// ---------- body ----------
export function flatten(payload, out = []) {
  if (!payload) return out;
  out.push(payload);
  for (const p of payload.parts || []) flatten(p, out);
  return out;
}
const charsetOf = (mime) => (String(mime || '').match(/charset="?([\w-]+)"?/i) || [])[1] || 'utf-8';
const nameOf = (part) => decodeWord(part.filename || (headerOf(part, 'content-disposition').match(/filename="?([^";]+)"?/i) || [])[1] || '');

export function bodyOf(payload) {
  const parts = flatten(payload);
  const pick = (type) => parts.find((p) => String(p.mimeType || '').startsWith(type) && p.body?.data && !nameOf(p));
  const html = pick('text/html');
  const text = pick('text/plain');
  if (html) return { html: decodeB64(html.body.data, charsetOf(html.mimeType)), text: text ? decodeB64(text.body.data, charsetOf(text.mimeType)) : '' };
  if (text) { const t = decodeB64(text.body.data, charsetOf(text.mimeType)); return { html: textToHtml(t), text: t }; }
  return { html: '', text: '' };
}

export function attachmentsOf(payload) {
  return flatten(payload)
    .filter((p) => p.body?.attachmentId && nameOf(p))
    .map((p) => ({ id: p.body.attachmentId, name: nameOf(p), type: p.mimeType || 'application/octet-stream', size: p.body.size || 0, inline: /inline/i.test(headerOf(p, 'content-disposition')) }));
}

export function textToHtml(t) {
  const esc = String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
}

// ---------- safety ----------
// Mail HTML is shown inside a sandboxed iframe (no scripts allowed by the sandbox), and this strips the
// obvious attack surface anyway: scripts, frames, forms, event handlers and javascript: links.
const KILL_BLOCK = /<(script|style|iframe|frame|frameset|object|embed|applet|form|noscript|svg|title)\b[\s\S]*?<\/\1\s*>/gi;
const KILL_TAG = /<\/?(script|style|iframe|frame|frameset|object|embed|applet|form|meta|link|base|noscript|svg|title|html|head|body)\b[^>]*>/gi;
// Mail is shown inside the page, so anything that could break out of its box is taken off the style attribute.
const RISKY_CSS = /(position|z-index|top|left|right|bottom|opacity|visibility|transform|pointer-events|content)\s*:[^;"']*;?/gi;
export function safeMailHtml(html, { images = false } = {}) {
  let s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(KILL_BLOCK, '').replace(KILL_TAG, '');
  s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (m, css) => ` style="${css.replace(RISKY_CSS, '').replace(/"/g, '')}"`);
  s = s.replace(/\sstyle\s*=\s*'([^']*)'/gi, (m, css) => ` style="${css.replace(RISKY_CSS, '').replace(/["']/g, '')}"`);
  s = s.replace(/(href|src|background)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, '$1="#"');
  if (!images) {
    s = s.replace(/<img\b([^>]*)>/gi, (m, a) => `<img${String(a).replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')} data-blocked="1" alt="">`);
    s = s.replace(/\sbackground\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/url\((?:&quot;|["']|)\s*https?:[^)]*\)/gi, 'none');
  }
  return s.replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"');
}
export const hasRemoteImages = (html) => /<img\b[^>]*\ssrc\s*=\s*(?:"|')?https?:/i.test(String(html || ''));

// ---------- building a message to send ----------
const CRLF = '\r\n';
const fold = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();
const addrHeader = (v) => addrList(v).map((a) => (a.name && a.name !== a.email.split('@')[0] ? `${encodeWord(a.name)} <${a.email}>` : a.email)).join(', ');

export function buildRaw({ from, to, cc, bcc, subject, html, text, inReplyTo, references, attachments = [] }) {
  const bound = `rw${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const alt = `alt${bound}`;
  const head = [];
  if (from) head.push(`From: ${addrHeader(from)}`);
  head.push(`To: ${addrHeader(to)}`);
  if (cc) head.push(`Cc: ${addrHeader(cc)}`);
  if (bcc) head.push(`Bcc: ${addrHeader(bcc)}`);
  head.push(`Subject: ${encodeWord(fold(subject))}`);
  if (inReplyTo) head.push(`In-Reply-To: ${fold(inReplyTo)}`, `References: ${fold(references || inReplyTo)}`);
  head.push('MIME-Version: 1.0');
  const plain = text || String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const bodyAlt = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', chunk(encodeB64(plain)),
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', chunk(encodeB64(html || textToHtml(plain))),
    `--${alt}--`,
  ].join(CRLF);
  if (!attachments.length) return b64url([...head, bodyAlt].join(CRLF));
  const files = attachments.map((f) => [
    `--${bound}`,
    `Content-Type: ${fold(f.type || 'application/octet-stream')}; name="${fold(f.name)}"`,
    `Content-Disposition: attachment; filename="${fold(f.name)}"`,
    'Content-Transfer-Encoding: base64', '', chunk(String(f.data || '')),
  ].join(CRLF));
  return b64url([...head, `Content-Type: multipart/mixed; boundary="${bound}"`, '', `--${bound}`, bodyAlt, ...files, `--${bound}--`].join(CRLF));
}
const chunk = (s) => (String(s).match(/.{1,76}/g) || []).join(CRLF);

// ---------- reply helpers ----------
export function replyTo(msg, me, all = false) {
  const from = addr(msg.from);
  const replyHeader = msg.replyTo ? addrList(msg.replyTo) : [];
  const to = replyHeader.length ? replyHeader : [from];
  const mine = String(me || '').toLowerCase();
  const cc = all ? [...addrList(msg.to), ...addrList(msg.cc)].filter((a) => a.email !== mine && !to.some((t) => t.email === a.email)) : [];
  const seen = new Set();
  return {
    to: to.filter((a) => a.email && !seen.has(a.email) && seen.add(a.email)).map((a) => a.email).join(', '),
    cc: cc.filter((a) => !seen.has(a.email) && seen.add(a.email)).map((a) => a.email).join(', '),
    subject: /^re:/i.test(msg.subject || '') ? msg.subject : `Re: ${msg.subject || ''}`.trim(),
    inReplyTo: msg.messageId || '',
    references: [msg.references, msg.messageId].filter(Boolean).join(' ').trim(),
  };
}
export function quoted(msg) {
  const when = msg.date ? new Date(msg.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const who = addr(msg.from);
  const head = `On ${when}, ${who.name || who.email} &lt;${who.email}&gt; wrote:`;
  return `<br><br><div class="gm-quote">${head}<blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${msg.html || ''}</blockquote></div>`;
}

// ---------- list rows ----------
export function threadRow(thread, me = '') {
  const msgs = thread.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const mine = String(me || '').toLowerCase();
  const uniq = (list) => [...new Map(list.filter((p) => p.email).map((p) => [p.email, p])).values()];
  // Who the thread is with: everyone who wrote in it apart from me, or who I wrote to in a thread of my own.
  const froms = uniq(msgs.map((m) => addr(headerOf(m.payload, 'From'))));
  const tos = uniq(msgs.flatMap((m) => addrList(headerOf(m.payload, 'To'))));
  const others = froms.filter((p) => p.email !== mine);
  const shown = others.length ? others : (tos.filter((p) => p.email !== mine).length ? tos.filter((p) => p.email !== mine) : froms);
  return {
    id: thread.id,
    who: shown.map((n) => n.name).join(', ') || '(unknown)',
    count: msgs.length,
    subject: decodeWord(headerOf(last.payload, 'Subject')) || '(no subject)',
    snippet: decodeWord(last.snippet || thread.snippet || ''),
    date: Number(last.internalDate || 0),
    unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
    starred: msgs.some((m) => (m.labelIds || []).includes('STARRED')),
    attach: msgs.some((m) => attachmentsOf(m.payload).some((a) => !a.inline)),
    labels: [...new Set(msgs.flatMap((m) => m.labelIds || []))],
    emails: [...new Set(msgs.flatMap((m) => [...addrList(headerOf(m.payload, 'From')), ...addrList(headerOf(m.payload, 'To'))]).map((a) => a.email))],
  };
}

export function fullMessage(m) {
  const body = bodyOf(m.payload);
  return {
    id: m.id, threadId: m.threadId, date: Number(m.internalDate || 0), labels: m.labelIds || [],
    from: headerOf(m.payload, 'From'), to: headerOf(m.payload, 'To'), cc: headerOf(m.payload, 'Cc'),
    replyTo: headerOf(m.payload, 'Reply-To'), messageId: headerOf(m.payload, 'Message-ID'),
    references: headerOf(m.payload, 'References'),
    subject: decodeWord(headerOf(m.payload, 'Subject')),
    html: body.html, text: body.text, snippet: decodeWord(m.snippet || ''),
    attachments: attachmentsOf(m.payload).filter((a) => !a.inline || a.name),
    remoteImages: hasRemoteImages(body.html),
  };
}

// Friendly label names. Gmail's own ids are shouty and prefixed.
export const SYSTEM_LABELS = {
  INBOX: 'Inbox', STARRED: 'Starred', SENT: 'Sent', DRAFT: 'Drafts', SPAM: 'Spam', TRASH: 'Trash',
  IMPORTANT: 'Important', UNREAD: 'Unread', CHAT: 'Chat',
  CATEGORY_PERSONAL: 'Personal', CATEGORY_SOCIAL: 'Social', CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates', CATEGORY_FORUMS: 'Forums',
};
export const labelName = (l) => SYSTEM_LABELS[l.id] || decodeWord(l.name || l.id);
