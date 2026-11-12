import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactFromImport, titleLike } from '../public/js/names.js';
import { whoIs, personOf } from '../public/js/leadintel.js';

// mapRows lives in the browser module (imports DOM helpers), so its header rules are checked through a copy of the table's behavior here.
test('import contact names: people stay, job titles and business labels go', () => {
  const biz = 'Canyon Plumbing LLC';
  assert.equal(contactFromImport('Mike Diaz', biz), 'Mike Diaz');
  assert.equal(contactFromImport('Dr. Jane Doe, DDS', 'Smile Dental'), 'Jane Doe');
  assert.equal(contactFromImport('Mike', biz), 'Mike');
  assert.equal(contactFromImport('Zbigniew Kowalczyk', biz), 'Zbigniew Kowalczyk');   // unknown first name, plain two words
  for (const bad of ['Owner', 'Owner Operator', 'Plumbing Manager', 'Canyon Plumbing', 'Canyon Plumbing LLC', 'President', 'CEO & Founder', 'Customer Service', 'Office Manager', 'Canyon Smith', 'Founder at Canyon', '305-555-0101', '']) {
    assert.equal(contactFromImport(bad, biz), '', bad);
  }
  assert.equal(titleLike('Owner Operator', biz), true);
  assert.equal(titleLike('Canyon Plumbing LLC', biz), true);
  assert.equal(titleLike('Mike', biz), false);
  assert.equal(titleLike('Mike Diaz', biz), false);
});

test('the dialer never shows a job title or the business as the person (power dial cards)', () => {
  for (const c of ['owner', 'owner/founder', 'vice president', 'Owner', 'Canyon Plumbing']) {
    const w = whoIs({ business: 'Canyon Plumbing', contact_name: c });
    assert.equal(w.name, '', c);
    assert.equal(w.line, 'Ask for the owner');
  }
  assert.equal(personOf({ business: 'Canyon Plumbing', contact_name: 'Mike' }), 'Mike');
  assert.equal(personOf({ business: 'Canyon Plumbing', contact_name: 'vice president', owner_name: 'Mike Diaz' }), 'Mike Diaz');
});
