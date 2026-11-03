// Allow-list cleaner for page drafts, shared by the Worker and the browser. Pure string work (no DOM), so it runs in both.
// Keeps headings, paragraphs, lists, bold, italics, quotes and safe links. Everything else is dropped.
const KEEP = ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br', 'blockquote'];
const RENAME = { h1: 'h2', b: 'strong', i: 'em', h5: 'h4', h6: 'h4' };
const DROP_WITH_BODY = /<(script|style|iframe|object|embed|noscript|template|svg|math|form|select|textarea|title|head)\b[\s\S]*?<\/\1\s*>/gi;
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function cleanHtml(input) {
  let s = String(input || '').replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_BODY, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g, (m, rawTag, attrs) => {
    const tag = RENAME[rawTag.toLowerCase()] || rawTag.toLowerCase();
    if (!KEEP.includes(tag)) return '';
    if (m.startsWith('</')) return tag === 'br' ? '' : `</${tag}>`;
    if (tag === 'br') return '<br>';
    if (tag === 'a') {
      const h = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
      const href = (h ? (h[1] ?? h[2] ?? h[3] ?? '') : '').trim();
      return /^(https?:\/\/|tel:|mailto:|\/(?!\/)|#)/i.test(href) ? `<a href="${attr(href)}">` : '<a>';
    }
    return `<${tag}>`;
  });
  // Any "<" left that does not start a kept tag becomes text.
  s = s.replace(new RegExp(`<(?!\\/?(?:${KEEP.join('|')})\\b)`, 'gi'), '&lt;');
  return s.replace(/[–—]/g, ', ').replace(/\n{3,}/g, '\n\n').trim();
}

// Plain text of a cleaned page, for word counts and previews.
export function textOf(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
export const wordCount = (html) => (textOf(html).match(/\S+/g) || []).length;

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
}
