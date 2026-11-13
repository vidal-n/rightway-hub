// Makes the printable script PDFs in public/training/ from the same builder the Training page uses (docHtml in public/js/scriptprint.js),
// so paper and screen can never drift apart. Layout is V's doc: Letter, 1 inch margins, Arial 14, one blank line between lines,
// centered bold underlined headings, italic underlined notes, bold offer words. Branding is only the header logo, a mint rule and the footer.
// Run by hand when a script changes (needs Playwright's Chromium, which is not a dependency of the app):  node scripts/script-pdfs.mjs
// The sandbox has no Arial, so Chromium falls back to Liberation Sans, which has identical letter widths.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { docHtml } from '../public/js/scriptprint.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'training');
const logo = `data:image/svg+xml;base64,${readFileSync(join(ROOT, 'public', 'brand', 'rightway-logo-light.svg')).toString('base64')}`;

const FILES = {
  cold: 'RightWay-Growth-Cold-Call-Script', analysis: 'RightWay-Growth-Competitor-Analysis-Script',
  plan: 'RightWay-Growth-Game-Plan-Script', clarity: 'RightWay-Growth-Google-Clarity-Audit-Script', question: 'RightWay-Growth-Question-Opener-Script',
};
const NAMES = { question: 'Question opener script', cold: 'Cold call script', analysis: 'Competitor analysis script', plan: 'Game Plan script', clarity: 'Google clarity audit script' };

const CSS = `
@page { size: Letter; margin: 1in; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font: 400 14pt/1.15 Arial, 'Liberation Sans', Helvetica, sans-serif; }
.d-title, .d-h { margin: 0; font-size: 14pt; font-weight: 700; text-align: center; text-decoration: underline; break-after: avoid; }
.d-h { margin: 1.7em 0 1.15em; }
.d-title + .d-h { margin-top: 1.7em; }
p { margin: 0 0 1.15em; orphans: 2; widows: 2; }
b { font-weight: 700; }
.d-q { break-after: avoid; }
.d-cue { font-style: italic; text-decoration: underline; }
`;
const page = (body, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;

const header = `<div style="-webkit-print-color-adjust:exact;width:100%;margin:0 1in;padding-top:0.38in"><div style="border-bottom:1.5px solid #9DEBCB;padding-bottom:7px"><img src="${logo}" style="height:22px;display:block"></div></div>`;
const footer = (label) => `<div style="width:100%;margin:0 1in;font:9px Arial,'Liberation Sans',sans-serif;color:#33433D;display:flex;justify-content:space-between;padding-bottom:0.3in"><span>Rightway Growth &middot; ${label} &middot; Miami and Fort Lauderdale</span><span><span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

const browser = await chromium.launch();
const p = await browser.newPage();
for (const voice of ['I', 'we']) {
  for (const g of Object.keys(FILES).filter((k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k))) {
    const name = `${FILES[g]}${voice === 'we' ? '-Team' : ''}.pdf`;
    await p.setContent(page(docHtml(g, { voice, objections: true }), NAMES[g]));
    await p.pdf({ path: join(OUT, name), format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: header, footerTemplate: footer(NAMES[g]), margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' } });
    console.log('wrote', name);
  }
}
await browser.close();
