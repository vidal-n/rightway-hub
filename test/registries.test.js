import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, stateCode, registryFor, registryCoverage, openDataUrl, normalizeRows, OPEN_DATA, usDate } from '../public/js/registries.js';
import { registryLookup } from '../src/freedata.js';

test('every state and DC has a registry page, and the codes are unique', () => {
  assert.equal(STATES.length, 51);
  assert.equal(new Set(STATES.map((s) => s[0])).size, 51);
  for (const [code, name, registry, url] of STATES) {
    assert.match(code, /^[A-Z]{2}$/); assert.ok(name && registry);
    assert.match(url, /^https:\/\//, code);
    assert.doesNotMatch(`${name}${registry}`, /[–—]/);
  }
  const cov = registryCoverage();
  assert.deepEqual(cov.open.sort(), ['CO', 'CT', 'NY', 'OR', 'PA']);
  assert.equal(cov.linkOnly.length, 51 - 1 - 5);
  assert.ok(!cov.linkOnly.includes('FL'));
});

test('stateCode and registryFor accept codes, full names and sloppy input', () => {
  assert.equal(stateCode('fl'), 'FL'); assert.equal(stateCode(' Florida '), 'FL'); assert.equal(stateCode('new york'), 'NY');
  assert.equal(stateCode('D.C.'), 'DC'); assert.equal(stateCode('District of Columbia'), 'DC');
  assert.equal(stateCode('Ontario'), ''); assert.equal(stateCode(''), ''); assert.equal(stateCode(null), '');
  assert.equal(registryFor('TX').mode, 'link'); assert.equal(registryFor('CO').mode, 'open'); assert.equal(registryFor('FL').mode, 'sunbiz');
  assert.equal(registryFor('zz'), null);
});

test('open data address: first three words, quotes and wildcards made safe', () => {
  const u = openDataUrl('CO', "Bob's Roofing & Gutters LLC");
  assert.match(u, /^https:\/\/data\.colorado\.gov\/resource\/4ykn-tg5h\.json\?\$where=/);
  const where = decodeURIComponent(u.split('$where=')[1].split('&')[0]);
  assert.equal(where, "upper(entityname) like '%BOB S ROOFING%'");
  assert.equal(openDataUrl('TX', 'Acme Roofing'), '');
  assert.equal(openDataUrl('CO', ''), '');
  assert.doesNotMatch(decodeURIComponent(openDataUrl('NY', "x%'; drop")), /%'; drop/);
  assert.ok(Object.keys(OPEN_DATA).every((k) => OPEN_DATA[k].name && OPEN_DATA[k].filed));
});

test('rows from each open data state become one shape', () => {
  assert.equal(usDate('2012-02-14T00:00:00.000'), '02/14/2012');
  const co = normalizeRows('CO', [{ entityname: 'MILE HIGH ROOFING LLC', entityid: '2012', entitytype: 'Limited Liability Company', entitystatus: 'Good Standing', entityformdate: '2012-02-14T00:00:00.000', principalcity: 'DENVER', agentfirstname: 'JANE', agentlastname: 'DOE' }])[0];
  assert.equal(co.name, 'MILE HIGH ROOFING LLC'); assert.equal(co.active, true); assert.equal(co.filed, '02/14/2012'); assert.ok(co.years >= 14); assert.equal(co.agent, 'Jane Doe'); assert.equal(co.city, 'Denver');
  const ct = normalizeRows('CT', [{ name: 'X LLC', status: 'Dissolved', date_registration: '2001-05-01T00:00:00' }])[0];
  assert.equal(ct.active, false);
  const ny = normalizeRows('NY', [{ current_entity_name: 'Y CORP', initial_dos_filing_date: '1999-01-02T00:00:00.000', dos_process_name: 'THE CORPORATION' }])[0];
  assert.equal(ny.active, true, 'the New York dataset only lists active companies'); assert.equal(ny.agent, 'The Corporation');
  const pa = normalizeRows('PA', [{ business_name: 'Z INC', creationdate: '2010-03-04T00:00:00' }])[0];
  assert.equal(pa.active, null, 'no status column, so it is not claimed active');
  assert.deepEqual(normalizeRows('TX', [{ a: 1 }]), []); assert.deepEqual(normalizeRows('CO', null), []);
});

test('registryLookup: open data state, link only state, unknown state, failures', async () => {
  const seen = [];
  const co = async (u) => { seen.push(String(u)); return Response.json([{ entityname: 'MILE HIGH ROOFING LLC', entityid: '1', entitystatus: 'Good Standing', entityformdate: '2012-02-14T00:00:00.000', agentorganizationname: 'REGISTERED AGENTS INC' }, { entityname: 'MILE HIGH BAKERY INC', entitystatus: 'Good Standing' }]); };
  const r = await registryLookup({ business: 'Mile High Roofing', state: 'CO' }, co);
  assert.equal(r.found, true); assert.equal(r.source, 'open'); assert.equal(r.code, 'CO'); assert.equal(r.name, 'MILE HIGH ROOFING LLC'); assert.equal(r.agent, 'Registered Agents Inc');
  assert.match(seen[0], /data\.colorado\.gov/);
  assert.equal((await registryLookup({ business: 'Totally Different Plumbing', state: 'Colorado' }, co)).found, false);
  const tx = await registryLookup({ business: 'Acme Roofing', state: 'TX' }, async () => { throw new Error('must not call'); });
  assert.equal(tx.linkOnly, true); assert.equal(tx.state, 'Texas'); assert.match(tx.searchUrl, /^https:\/\//);
  assert.deepEqual(await registryLookup({ business: 'Acme', state: 'Ontario' }, co), { skipped: 'unknown state' });
  const down = await registryLookup({ business: 'Mile High Roofing', state: 'CO' }, async () => new Response('x', { status: 500 }));
  assert.equal(down.found, false); assert.match(down.error, /500/);
  const boom = await registryLookup({ business: 'Mile High Roofing', state: 'CO' }, async () => { throw new Error('offline'); });
  assert.equal(boom.found, false);
});
