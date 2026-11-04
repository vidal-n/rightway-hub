const { chromium } = require('playwright');
const S = '/tmp/claude-0/-home-claude/1ba14cb1-1cbf-55bc-8b1e-47e7ac0114b2/scratchpad/pt/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; const watch = (pg, t) => { pg.on('pageerror', (e) => errs.push(t + ' JS ' + e.message)); pg.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) errs.push(t + ' ' + r.status() + ' ' + r.url()); }); };
  watch(p, 'hub');
  const B = 'http://localhost:8787';
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: { 'x-rw': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, d: await r.json().catch(() => ({})) }; }, [m, path, body]);
  await p.goto(B + '/');
  await api('POST', '/api/auth/login', { email: 'v@x.com', password: 'correct horse battery' });
  console.log('sample', (await api('POST', '/api/sample-client')).s);
  await p.goto(B + '/#/clients/view'); await p.waitForTimeout(3000); await p.screenshot({ path: S + 'w-cview.png' });
  const leads = (await api('GET', '/api/leads')).d.leads; const lead = leads.find((l) => l.business === 'Sunrise Plumbing');
  console.log('research', (await api('POST', `/api/leads/${lead.id}/research`, {})).s, 'listings', (await api('POST', `/api/leads/${lead.id}/listings`)).s);
  // Scan tool from the lead: run, save to lead
  const sp = await ctx.newPage(); watch(sp, 'scan');
  await sp.goto(B + `/scan.html?lead=${lead.id}`); await sp.waitForTimeout(2500);
  await sp.screenshot({ path: S + 'w-scanlead.png' });
  const runBtn = await sp.$('#scan-btn, #run-btn, button:has-text("Run scan")');
  console.log('run button', !!runBtn);
  if (runBtn) { await runBtn.click(); await sp.waitForTimeout(9000); }
  await sp.screenshot({ path: S + 'w-scandone.png', fullPage: false });
  const save = await sp.$('#r-save button');
  console.log('save button', save ? await save.textContent() : 'none');
  if (save) { await save.click(); await sp.waitForTimeout(1200); console.log('after save', await save.textContent()); }
  const d = (await api('GET', `/api/leads/${lead.id}`)).d.lead;
  console.log('deep saved', !!d.deep_scan, d.deep_scan ? JSON.parse(d.deep_scan).scans.map((x) => x.keyword + ' ' + x.size + ' ' + x.top10 + '/' + x.points).join(' | ') : '');
  // Presentation scan slide
  const pp = await ctx.newPage(); watch(pp, 'present');
  await pp.goto(B + `/present.html#${lead.id}`); await pp.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await pp.keyboard.press('ArrowRight'); await pp.waitForTimeout(400); }
  await pp.waitForTimeout(2500); await pp.screenshot({ path: S + 'w-pscan.png' });
  const keys = await pp.evaluate(() => [...document.querySelectorAll('.slide')].map((s) => s.querySelector('.kicker')?.textContent || ''));
  const appI = keys.findIndex((k) => /You see everything/.test(k));
  for (let i = 3; i < appI; i++) { await pp.keyboard.press('ArrowRight'); await pp.waitForTimeout(150); }
  await pp.waitForTimeout(4000); await pp.screenshot({ path: S + 'w-papp.png' });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
