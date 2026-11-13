// Screen check (Nov 2026): shows what iOS reports about the screen on THIS device, so a short Home Screen app (iOS 26 bug, WebKit 301108)
// is settled with numbers, not guesses. Red line = where the page believes the screen ends. Blue line = where the real screen ends.
// Modeled on the on-device debug panels in Apple's own Web Inspector viewport tab, kept to one screenshot.
import { modal } from './core.js';

function insets() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(el);
  const cs = getComputedStyle(el); const o = { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft };
  el.remove(); return o;
}

function fixedHeight() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;bottom:0;width:1px;visibility:hidden;pointer-events:none';
  document.body.appendChild(el); const h = el.offsetHeight; el.remove(); return h;
}

function lengthHeight(v) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;height:${v};visibility:hidden;pointer-events:none`;
  document.body.appendChild(el); const h = el.offsetHeight; el.remove(); return h;
}

export function readScreen() {
  const de = document.documentElement; const vv = window.visualViewport; const ins = insets();
  const hub = document.querySelector('.hub')?.getBoundingClientRect(); const bar = document.getElementById('bbar'); const bb = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : null;
  const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
  const full = innerWidth > innerHeight ? short : long;
  const layout = fixedHeight();
  return {
    standalone: Boolean(navigator.standalone), displayMode: ['standalone', 'fullscreen', 'minimal-ui', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) || '?',
    screen: `${screen.width} x ${screen.height}`, inner: `${innerWidth} x ${innerHeight}`, outerH: outerHeight, visual: vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}` : 'none',
    fixedBox: layout, short: Math.round(full - layout), lvh: lengthHeight('100lvh'), dvh: lengthHeight('100dvh'), svh: lengthHeight('100svh'),
    insets: `top ${ins.t}, bottom ${ins.b}, left ${ins.l}, right ${ins.r}`, htmlHeight: Math.round(de.getBoundingClientRect().height), htmlClass: de.className,
    gapVar: de.style.getPropertyValue('--rw-gap') || '-', hubBottom: hub ? Math.round(hub.bottom) : '-', barBottom: bb ? Math.round(bb.bottom) : '-', barHeight: bb ? Math.round(bb.height) : '-',
    ua: navigator.userAgent.replace(/^Mozilla\/5.0 /, '').slice(0, 90),
  };
}

export async function screenCheck() {
  let caches_ = '-'; try { caches_ = (await caches.keys()).join(', ') || 'none'; } catch {}
  const d = readScreen(); d.cache = caches_;
  const rows = Object.entries(d).map(([k, v]) => `<tr><th>${k}</th><td>${String(v).replace(/[<>&]/g, '')}</td></tr>`).join('');
  const line = (c, bottom, label) => `<div class="sc-line" style="${bottom};background:${c}"><b style="background:${c}">${label}</b></div>`;
  const real = d.standalone ? (innerWidth > innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)) : innerHeight;
  const root = document.createElement('div'); root.className = 'sc-marks';
  root.innerHTML = line('#E5484D', 'bottom:0', 'page bottom') + line('#3E7BFA', `top:${real - 3}px`, 'screen bottom');
  document.body.appendChild(root);
  const text = Object.entries(d).map(([k, v]) => `${k}: ${v}`).join('\n');
  modal(`<div class="modal-head"><h3>Screen check</h3></div><p class="small">${d.short >= 8 ? `This phone's page ends <b>${d.short}pt</b> above the real screen bottom (iOS 26 bug). The app is working around it.` : 'The page reaches the bottom of the screen.'} Screenshot this and send it if anything looks cut off.</p>
    <div class="sc-wrap"><table class="sc-t">${rows}</table></div><div class="row" style="margin-top:12px"><button class="btn btn-sm" id="sccopy" type="button">Copy numbers</button><button class="btn btn-sm btn-ghost" data-close type="button">Close</button></div>`,
    { onClose: () => root.remove() });
  document.getElementById('sccopy').onclick = async () => { try { await navigator.clipboard.writeText(text); document.getElementById('sccopy').textContent = 'Copied'; } catch { document.getElementById('sccopy').textContent = 'Copy failed'; } };
}
