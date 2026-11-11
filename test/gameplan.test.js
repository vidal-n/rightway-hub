import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, SCRIPT_GROUPS } from '../public/js/leadintel.js';
import { scriptSteps, PRINT_VARS } from '../public/js/scriptprint.js';

test('Game Plan script: own group, filled with rep, company and business', () => {
  assert.ok(SCRIPT_GROUPS.find((g) => g[0] === 'plan'));
  const s = buildScript({ business: 'Joe Plumbing', contact_name: 'Joe Smith' }, null, { rep: 'Sam', voice: 'I' });
  const call = s.steps.find((x) => x.id === 'g_call').lines.join(' ');
  assert.match(call, /Hi Joe\? It's Sam with Rightway Growth\./);
  assert.match(call, /Joe Plumbing/);
  assert.match(call, /website audit/);
  assert.doesNotMatch(call, /Josh|Wavepoint/i);
  assert.equal(scriptSteps('plan').length, 3);
  assert.ok(PRINT_VARS.company && PRINT_VARS.rep);
});
