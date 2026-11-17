// One scroll rule guard (Nov 2026, V: no scroll inside a scroll, ever). The Hub frame scrolls only in #vscroll.
// A CSS rule that gives a box BOTH a vertical scroll (overflow auto or scroll) AND a height cap (max-height or a fixed height in
// px, rem, vh) makes a second scroll bar inside the page. Only the selectors below may do that: floating things that sit on top of the
// page (popovers, menus, modals, the call window, the command palette), the fixed rails, and the phone full screen sheets.
// Anything new that needs a scroll inside the page must fill the rest of #vscroll with flex (see Slack and Gmail), not use a number.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILES = ['hub.css', 'hub5.css', 'hub6.css', 'styles.css', 'scanshell.css', 'audit.css', 'dealdesk.css', 'present.css'];
const ALLOW = [
  /^\.rail$/, /^\.sx-rail$/, /^\.pal-list$/, /^\.modal$/, /^\.sl-ac$/, /^\.sl-menu/, /^\.sl-emo-grid$/, /^\.sl-pp-list$/, /^\.sl-pick-list$/,
  /^\.gm-sug$/, /^\.ms-list$/, /^\.dlayout-body$/, /^\.callbar$/, /^\.pm-pick$/, /^body\.pdx/, /^html:not\(\.is-phone\) \.(callbar|pd)/,
  /^\.modal-bg\.win \.modal$/, /^\.cmp-on\.cmp-open$/, /^\.xpop$/,
];
const rules = (css) => {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(css))) out.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
  return out;
};

test('no page content has a vertical scroll box with a height cap', () => {
  const bad = [];
  for (const f of FILES) {
    const p = new URL(`../public/${f}`, import.meta.url);
    if (!fs.existsSync(p)) continue;
    for (const [sel, body] of rules(fs.readFileSync(p, 'utf8'))) {
      const scroll = /overflow(-y)?\s*:\s*(auto|scroll)/.test(body);
      const cap = /(max-height|(^|[;\s])height)\s*:\s*[^;]*(vh|dvh|svh|px|rem)/.test(body) && !/max-height\s*:\s*none/.test(body);
      if (!scroll || !cap) continue;
      for (const one of sel.split(',').map((x) => x.trim())) if (!ALLOW.some((a) => a.test(one))) bad.push(`${f}: ${one}`);
    }
  }
  assert.deepEqual(bad, [], 'These add a scroll inside the page. Let the page grow instead, or fill #vscroll with flex.');
});

test('inline styles in the Hub never cap a height and scroll', () => {
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) { if (!/vendor|training/.test(e.name)) walk(p); } else if (/\.js$/.test(e.name)) {
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/style="([^"]*)"/g)) if (/overflow(-y)?\s*:\s*(auto|scroll)/.test(m[1]) && /max-height\s*:\s*[^;]*(vh|px)/.test(m[1])) bad.push(`${p}: ${m[1].slice(0, 80)}`);
  } } };
  walk(new URL('../public/hub', import.meta.url).pathname);
  assert.deepEqual(bad, []);
});
