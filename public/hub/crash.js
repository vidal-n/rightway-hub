// Crash reporter. When the page throws an error nobody caught, a small box asks "Report it?". Send puts the details in Settings, Bug reports
// (owners read it there and paste it to Claude). Nothing leaves the browser until the person presses Send.
const seen = new Set();
let shown = 0, open = null;
const recent = [];   // the last few failed server calls, for context
const MAX_PROMPTS = 4;

// Noise that is not a bug in the Hub: browser quirks, extensions, a dropped connection.
const IGNORE = /ResizeObserver loop|Script error\.?$|AbortError|The operation was aborted|NetworkError|Failed to fetch|Load failed|cancelled|ChunkLoadError.*extension|chrome-extension|moz-extension|Non-Error promise rejection|The user aborted|play\(\) request was interrupted|NotAllowedError/i;

const orig = window.fetch;
window.fetch = function (...a) {
  const url = String(a[0]?.url || a[0] || '');
  return orig.apply(this, a).then((r) => { if (!r.ok && r.status >= 500 && url.includes('/api/')) { recent.push(`${r.status} ${url.replace(location.origin, '').slice(0, 80)}`); if (recent.length > 6) recent.shift(); } return r; });
};

export function reportBody(message, stack, extra = {}) {
  return { message, stack, where: `${location.hash || '#/'} ${location.pathname}`.slice(0, 280), ua: navigator.userAgent, extra: { ...extra, failedCalls: recent.slice(), online: navigator.onLine, size: `${innerWidth}x${innerHeight}`, hidden: document.hidden } };
}
export async function sendReport(message, stack, extra) {
  const r = await window.fetch('/api/crash', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rw': '1' }, body: JSON.stringify(reportBody(message, stack, extra)) });
  if (!r.ok) throw new Error('Could not send the report.');
}

function prompt(message, stack, extra) {
  if (open) return;
  open = document.createElement('div');
  open.className = 'crash-box';
  open.setAttribute('role', 'alertdialog');
  open.setAttribute('aria-label', 'Something broke');
  open.innerHTML = '<b>Something broke on this page.</b><p>Do you want to report it so it can get fixed? The error and what page you were on are sent. Nothing else.</p><div class="crash-row"><button type="button" class="btn btn-primary btn-sm" data-send>Report it</button><button type="button" class="btn btn-ghost btn-sm" data-no>No thanks</button></div>';
  const close = () => { open?.remove(); open = null; };
  open.querySelector('[data-no]').onclick = close;
  open.querySelector('[data-send]').onclick = async (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Sending...';
    try { await sendReport(message, stack, extra); open.innerHTML = '<b>Sent. Thank you.</b><p>It is in Settings, Bug reports.</p>'; setTimeout(close, 2500); }
    catch { open.innerHTML = '<b>Could not send it.</b><p>Check your connection and try again later.</p>'; setTimeout(close, 3000); }
  };
  document.body.appendChild(open);
}

function caught(message, stack, extra) {
  message = String(message || '').trim();
  if (!message || IGNORE.test(message) || document.body.classList.contains('presenting')) return;
  const key = message.slice(0, 120);
  if (seen.has(key) || shown >= MAX_PROMPTS) return;
  seen.add(key); shown++;
  prompt(message.slice(0, 500), String(stack || '').slice(0, 3000), extra);
}

window.addEventListener('error', (e) => {
  if (e.target && e.target !== window && (e.target.src || e.target.href)) return; // a missing picture or file is not a crash
  const file = String(e.filename || '').replace(location.origin, '');
  if (e.filename && !String(e.filename).startsWith(location.origin)) return; // someone else's script
  caught(e.message, e.error?.stack || `${file}:${e.lineno}:${e.colno}`, { file });
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  caught(r?.message || String(r), r?.stack, { rejected: true });
});
