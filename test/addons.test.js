import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_LIST, WEBSITE_SERVICE_IDS } from '../public/js/plancopy.js';
import { cleanScope, monthlyTasks, setupTasks, scopeFromPlan, tierOf, effort, scopeLine } from '../public/js/scope.js';
import { DEFAULT_GUIDES, ACCESS_ITEMS, guideFor, dueDate } from '../public/js/guides.js';
import { servicesFor, allServicesFor, quoteFor } from '../public/js/leadintel.js';
import { refFor, refLines } from '../public/js/planref.js';
import { WEB_MIN, CARE_MONTHLY, WEB_TIERS, webTierFor, webValue, bundleFor, projection, webLines, OWNERSHIP_TEXT } from '../public/js/webprice.js';
import { agreementSections, AGREEMENT_VERSION } from '../public/js/agreement.js';
import { tasksForMonth, workloadOf } from '../src/plans.js';
import { defaultScope } from '../src/scopeof.js';
import worker from '../src/worker.js';

const kinds = (sc) => monthlyTasks(sc).map((r) => r[0]);

test('Yelp, social and website care are services we can check off', () => {
  for (const id of ['yelp', 'social', 'webcare']) assert.ok(SERVICE_LIST.find((s) => s.id === id)?.extra, id);
  const sc = cleanScope([{ id: 'profile' }, { id: 'yelp', qty: 6 }, { id: 'social', qty: 16 }, { id: 'webcare' }]);
  assert.deepEqual(sc.map((s) => [s.id, s.qty]), [['profile', 1], ['yelp', 6], ['social', 16], ['webcare', 1]]);
  const rows = monthlyTasks(sc);
  assert.deepEqual(rows.filter((r) => ['yelp', 'social', 'webcare'].includes(r[0])).map((r) => [r[0], r[2]]), [['yelp', 6], ['social', 16], ['webcare', 1]]);
  assert.match(scopeLine({ id: 'social', qty: 12 }), /Facebook and Instagram posts \(12 social posts a month\)/);
  assert.ok(setupTasks(sc).includes('Yelp business page claimed and details matched'));
});

test('a client only gets these tasks when they are checked off', () => {
  const base = cleanScope([{ id: 'profile' }, { id: 'posts', qty: 4 }, { id: 'report' }]);
  assert.ok(!kinds(base).some((k) => ['yelp', 'social', 'webcare'].includes(k)));
  const t = tasksForMonth({ scope: JSON.stringify(cleanScope([...base, { id: 'yelp', qty: 4 }])), start_date: '2026-01-01', has_setup: true }, '2026-11');
  assert.equal(t.filter((x) => x.kind === 'yelp').length, 4);
  assert.equal(t.filter((x) => x.kind === 'social').length, 0);
  assert.match(t.find((x) => x.kind === 'yelp').title, /Yelp page post \(1 of 4\)/);
});

test('add-ons are never recommended, defaulted or put on older clients', () => {
  const lead = { business: 'A', industry: 'plumbing', city: 'Miami' };
  assert.ok(!servicesFor(lead, null).some((s) => s.extra || ['yelp', 'social', 'webcare'].includes(s.id)));
  assert.ok(!defaultScope(lead, null).some((s) => ['yelp', 'social', 'webcare'].includes(s.id)));
  assert.ok(!quoteFor(lead, null).services.some((s) => ['yelp', 'social', 'webcare'].includes(s.id)));
  // the pickers still list everything we can do
  assert.deepEqual(['yelp', 'social', 'webcare'].filter((id) => !allServicesFor(lead, null).some((s) => s.id === id)), []);
  for (const plan of ['starter', 'growth', 'authority', 'leader']) assert.ok(!scopeFromPlan(plan, []).some((s) => ['yelp', 'social', 'webcare'].includes(s.id)), plan);
  // an older client with no saved scope keeps the fixed task list
  const w = workloadOf({ plan: 'growth' });
  assert.ok(!w.monthly.some((r) => ['yelp', 'social', 'webcare'].includes(r[0])));
});

test('the add-ons do not change the workload tier, and have guides and delivery time', () => {
  const a = cleanScope([{ id: 'profile' }, { id: 'posts', qty: 4 }]);
  assert.equal(tierOf([...a, { id: 'yelp' }, { id: 'webcare' }]), tierOf(a));
  for (const k of ['yelp', 'social', 'webcare']) { assert.ok(DEFAULT_GUIDES[k], k); assert.ok(guideFor(k).steps.length >= 4); assert.ok(guideFor(k).minutes > 0); }
  assert.ok(ACCESS_ITEMS.some((i) => i.key === 'yelp'));
  assert.ok(effort([...a, { id: 'social', qty: 12 }]).monthly > effort(a).monthly);
  assert.match(dueDate('social', '2026-11', 2, 12), /^2026-11-\d\d$/);
  assert.ok(WEBSITE_SERVICE_IDS.includes('webcare'));
});

test('the plan guide follows the chart for Yelp and social, and website care does not move it', () => {
  assert.equal(refFor([{ id: 'social', qty: 12 }]).key, 'growth');
  assert.equal(refFor([{ id: 'social', qty: 16 }]).key, 'authority');
  assert.equal(refFor([{ id: 'social', qty: 20 }]).key, 'leader');
  assert.equal(refFor([{ id: 'yelp', qty: 4 }]).key, 'starter');
  assert.equal(refFor([{ id: 'posts', qty: 4 }, { id: 'webcare' }]).key, 'starter');
  assert.match(refLines([{ id: 'posts', qty: 4 }]).join(' '), /check them off in the scope/);
});

test('website pricing: the floor, the 7 to 10 page model and the residual', () => {
  assert.equal(WEB_MIN, 798);
  assert.equal(CARE_MONTHLY, 149);
  const biz = webTierFor(8);
  assert.deepEqual([biz.build, biz.care], [1788, 149]);
  assert.deepEqual(webTierFor(3).build, 798);
  assert.equal(webTierFor(16), null);
  assert.ok(WEB_TIERS.every((t, i) => !i || t.build > WEB_TIERS[i - 1].build));
  assert.ok(WEB_TIERS.every((t) => t.build >= WEB_MIN));
  const v = webValue(1788);
  assert.equal(v.yearOne, 1788 + 149 * 12);
  assert.equal(bundleFor(549).monthly, 698);
  assert.equal(bundleFor(549).annual, 698 * 12);
});

test('the projection matches the spreadsheet defaults', () => {
  const p = projection({ sitesPerMonth: 2, build: 1788, care: 149, careRate: 1, seoNew: 2, seoMonthly: 549, churn: 0, months: 24 });
  assert.equal(p[11].mrr, 16752);
  assert.equal(p[23].mrr, 33504);
  assert.equal(Math.round(p[23].cumulative), 504624);
});

test('website guide lines are plain, internal and carry the ownership terms', () => {
  const t = webLines(8).join(' ');
  assert.match(t, /\$1,788/); assert.match(t, /\$149 a month/); assert.match(t, /\$798/); assert.match(t, /12 months/);
  assert.ok(!/[–—]/.test(t + OWNERSHIP_TEXT));
});

test('the website agreement says the client owns the site after 12 months of care', () => {
  assert.equal(AGREEMENT_VERSION, 3);
  const withCare = JSON.stringify(agreementSections({ kind: 'website', setupCents: 178800, monthlyCents: 14900, scope: ['7 pages'] }));
  assert.ok(withCare.includes('After 12 months of paid hosting and care'));
  const noCare = JSON.stringify(agreementSections({ kind: 'website', setupCents: 79800, monthlyCents: 0, scope: ['3 pages'] }));
  assert.ok(!noCare.includes('After 12 months') && noCare.includes('paid in full'));
  assert.ok(!/[–—]/.test(withCare + noCare));
});

test('the pricing spreadsheet is only served to closers and owners', async () => {
  const env = { ASSETS: { fetch: async () => new Response('xlsx') } };
  const res = await worker.fetch(new Request('https://hub.test/training/pricing/Rightway-Pricing-Reference.xlsx'), env, {});
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const other = await worker.fetch(new Request('https://hub.test/training/RightWay-Growth-Cold-Call-Script.pdf'), env, {});
  assert.equal(other.status, 200);
});

test('the pricing folder is configured so the Worker runs first (static files would otherwise be public)', async () => {
  const { readFile } = await import('node:fs/promises');
  const cfg = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(cfg, /"run_worker_first":\s*\[\s*"\/training\/pricing\/\*"\s*\]/);
});
