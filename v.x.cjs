const { chromium } = require('playwright');
const S = '/tmp/claude-0/-home-claude/1ba14cb1-1cbf-55bc-8b1e-47e7ac0114b2/scratchpad/pt/';
(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('JS ' + e.message)); p.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) errs.push(r.status() + ' ' + r.url()); });
  const B = 'http://localhost:8787';
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: { 'x-rw': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; }, [m, path, body]);
  await p.goto(B + '/');
  let r = await api('POST', '/api/auth/setup', { accessKey: 'owner-key-123', name: 'Vidal Newton', email: 'v@x.com', password: 'correct horse battery' });
  await api('POST', '/api/leads/import', { rows: [{ business: 'Sunrise Plumbing', contact_name: 'Mike Diaz', phone: '9545550201', city: 'Hollywood', state: 'FL', industry: 'Plumbing', source: 'csv' }, { business: 'Blue Wave Roofing', contact_name: 'Sara Lee', phone: '9545550202', city: 'Fort Lauderdale', state: 'FL', industry: 'Roofing', source: 'web' }] });
  const shots = [['#/', 'dash'], ['#/agents', 'agents'], ['#/agents/analytics', 'analytics'], ['#/training', 'training'], ['#/training/scripts/cold', 'tscript'], ['#/training/drills', 'drills'], ['#/phone', 'phone'], ['#/pipeline', 'pipeline'], ['#/clients/view', 'cview']];
  for (const [h, n] of shots) { await p.goto(B + '/' + h); await p.waitForTimeout(1800); await p.screenshot({ path: S + 'v-' + n + '.png' }); }
  await p.keyboard.press('Control+k'); await p.waitForTimeout(300); await p.keyboard.type('sun'); await p.waitForTimeout(900); await p.screenshot({ path: S + 'v-palette.png' });
  await p.keyboard.press('Escape');
  await p.click('[data-stpill]'); await p.waitForTimeout(300); await p.screenshot({ path: S + 'v-status.png' });
  await p.goto(B + '/scan.html'); await p.waitForTimeout(1200); await p.screenshot({ path: S + 'v-scan.png' });
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('M ' + e.message));
  await mp.goto(B + '/'); await mp.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'x-rw': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'v@x.com', password: 'correct horse battery' }) }));
  for (const [h, n] of [['#/', 'm-dash'], ['#/agents', 'm-agents'], ['#/training', 'm-training']]) { await mp.goto(B + '/' + h); await mp.waitForTimeout(1500); await mp.screenshot({ path: S + 'v-' + n + '.png' }); }
  await mp.goto(B + '/scan.html'); await mp.waitForTimeout(1000); await mp.screenshot({ path: S + 'v-m-scan.png' });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
