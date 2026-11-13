import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wsFor, wsTabs, wsList, WORKSPACES } from '../public/js/workspaces.js';
import { can } from '../public/js/jobs.js';

test('workspaces: every route lands in the right place', () => {
  const cases = { '#/': 'home', '#/calendar': 'home', '#/phone': 'sell', '#/phone/texts': 'inbox', '#/phone/texts/abc': 'inbox', '#/phone/history/missed': 'inbox',
    '#/phone/out': 'inbox', '#/phone/recordings': 'sell', '#/pipeline': 'sell', '#/pipeline/xyz123': 'sell', '#/pipeline/database': 'sell', '#/pipeline/insights': 'insights',
    '#/agents/analytics': 'insights', '#/agents': 'sell', '#/client/c1/overview': 'clients', '#/clients/view/c1': 'clients', '#/work/posts': 'deliver', '#/settings/budget': 'money',
    '#/settings': 'settings', '#/settings/files': 'settings', '#/google/mail': 'inbox', '#/google/drive': 'automate', '#/dialer': 'sell', '#/notifications': 'home', '#/alerts': 'home' };
  for (const [h, ws] of Object.entries(cases)) assert.equal(wsFor(h).ws, ws, h);
  assert.equal(wsFor('#/pipeline/database').tab, '#/pipeline/database');
  assert.equal(wsFor('#/pipeline/abc').tab, '#/pipeline');
});

test('workspaces: agents only see what their job allows', () => {
  const owner = { role: 'admin' }, setter = { role: 'team', job: 'setter' };
  assert.equal(wsList(owner, can).length, WORKSPACES.length);
  const names = wsList(setter, can).map((w) => w[0]);
  assert.ok(!names.includes('money') && !names.includes('clients'));
  assert.ok(!wsTabs(setter, 'sell', can).some((t) => t[1] === '#/finder'));
  assert.ok(wsTabs(setter, 'deliver', can).some((t) => t[1] === '#/work/schedule'));
});
