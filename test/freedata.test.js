import test from 'node:test';
import assert from 'node:assert/strict';
import {
  osmFilters, nameStem, overpassQuery, osmRecord, textLines, entityName, sunbizSearchUrl, parseSunbizResults, pickEntity, personName,
  parseSunbizDetail, yearsSince, pickOwner, extractProfile, mergeProfiles,
} from '../public/js/freedata.js';

test('keywords map to OpenStreetMap tags and name stems', () => {
  assert.deepEqual(osmFilters('roofing contractor').slice(0, 1), ['craft=roofer']);
  assert.ok(osmFilters('roofing contractor').includes('craft=builder'));
  assert.deepEqual(osmFilters('plumbers'), ['craft=plumber']);
  assert.ok(osmFilters('AC repair').includes('craft=hvac'));
  assert.deepEqual(osmFilters('zzz'), []);
  assert.equal(nameStem('roofing contractor'), 'roof');
  assert.equal(nameStem('plumbers near me'), 'plumb');
  assert.equal(nameStem('a'), '');
});

test('overpass query covers tags and names, within the radius', () => {
  const q = overpassQuery({ keyword: 'roofing contractor', lat: 25.76, lng: -80.19, miles: 5 });
  assert.match(q, /^\[out:json\]\[timeout:25\];\(/);
  assert.match(q, /around:8045,25\.76000,-80\.19000/);
  assert.match(q, /\[craft=roofer\]\[name\]/);
  assert.match(q, /\["name"~"roof",i\]/);
  assert.match(q, /out center tags 400;$/);
  assert.equal(overpassQuery({ keyword: '', lat: 1, lng: 1 }), '');
  assert.match(overpassQuery({ keyword: 'plumber', lat: 1, lng: 1, miles: 999 }), /around:48270/, 'radius is capped');
});

test('an OpenStreetMap element becomes a finder record', () => {
  const r = osmRecord({ type: 'node', id: 42, lat: 25.77, lon: -80.2, tags: { name: 'Bayside Roofing', craft: 'roofer', phone: '+1 305-555-0111', website: 'https://www.baysideroofing.com/', 'addr:housenumber': '12', 'addr:street': 'NW 5th St', 'addr:city': 'Miami', 'addr:state': 'FL', 'addr:postcode': '33130', opening_hours: 'Mo-Fr 08:00-17:00', 'contact:email': 'INFO@baysideroofing.com', 'contact:facebook': 'baysideroofing' } });
  assert.equal(r.title, 'Bayside Roofing');
  assert.equal(r.category, 'Roofer');
  assert.equal(r.address, '12 NW 5th St, Miami, FL 33130');
  assert.equal(r.domain, 'baysideroofing.com');
  assert.equal(r.email, 'info@baysideroofing.com');
  assert.equal(r.socials.facebook, 'https://www.facebook.com/baysideroofing');
  assert.equal(r.rating, null);
  assert.equal(r.hours, true);
  assert.equal(r.osm, 'node/42');
  assert.equal(osmRecord({ tags: { craft: 'roofer' } }), null, 'no name, no business');
  assert.equal(osmRecord({ type: 'way', id: 1, center: { lat: 1, lon: 2 }, tags: { name: 'X' } }).lat, 1);
});

// A detail page shaped like Sunbiz's (labels and order as on the real site).
const DETAIL_LLC = `<html><body><div class="searchResultDetail"><div class="detailSection corporationName"><p>Detail by Entity Name</p><p>Florida Limited Liability Company</p><p>BAYSIDE ROOFING LLC</p></div>
<div class="detailSection filingInformation"><label>Filing Information</label><div><span>Document Number</span><span>L12000012345</span></div><div><span>FEI/EIN Number</span><span>45-1234567</span></div>
<div><span>Date Filed</span><span>02/14/2012</span></div><div><span>State</span><span>FL</span></div><div><span>Status</span><span>ACTIVE</span></div></div>
<div class="detailSection"><span>Principal Address</span><div><div>12 NW 5TH ST</div><div>MIAMI, FL 33130</div></div><span>Changed: 04/01/2020</span></div>
<div class="detailSection"><span>Mailing Address</span><div><div>PO BOX 55</div><div>MIAMI, FL 33101</div></div></div>
<div class="detailSection"><span>Registered Agent Name &amp; Address</span><div><div>LOPEZ, MARIA</div><div>12 NW 5TH ST</div><div>MIAMI, FL 33130</div></div></div>
<div class="detailSection"><span>Authorized Person(s) Detail</span><div><span>Name &amp; Address</span></div><div><span>Title MGR</span></div><div><div>LOPEZ, MARIA R</div><div>12 NW 5TH ST</div><div>MIAMI, FL 33130</div></div>
<div><span>Title AMBR</span></div><div><div>LOPEZ, CARLOS</div><div>12 NW 5TH ST</div></div></div>
<div class="detailSection"><span>Annual Reports</span><table><tr><td>2023</td><td>03/10/2023</td></tr><tr><td>2024</td><td>02/20/2024</td></tr></table></div></div></body></html>`;

test('sunbiz detail page: filing facts, agent and people', () => {
  const d = parseSunbizDetail(DETAIL_LLC);
  assert.equal(d.name, 'BAYSIDE ROOFING LLC');
  assert.equal(d.docNo, 'L12000012345');
  assert.equal(d.filed, '02/14/2012');
  assert.equal(d.status, 'ACTIVE');
  assert.equal(d.state, 'FL');
  assert.equal(d.principal, '12 NW 5TH ST, MIAMI, FL 33130');
  assert.equal(d.agent.name, 'Maria Lopez');
  assert.deepEqual(d.people.map((p) => `${p.name}|${p.title}`), ['Maria R Lopez|Manager', 'Carlos Lopez|Authorized Member']);
  assert.deepEqual(d.annualReports, ['2023', '2024']);
  assert.equal(pickOwner(d).name, 'Maria R Lopez');
  assert.ok(yearsSince(d.filed, Date.UTC(2026, 10, 11)) >= 14);
});

test('sunbiz detail page: corporation with officers in text form', () => {
  const html = '<h2>Detail by Entity Name</h2><div>Florida Profit Corporation</div><div>ACME PLUMBING INC</div><div>Document Number</div><div>P99000012345</div><div>Date Filed</div><div>01/19/1999</div><div>Status</div><div>INACTIVE</div><div>Officer/Director Detail</div><div>Name &amp; Address</div><div>Title P</div><div>SMITH, JOHN A</div><div>1 MAIN ST</div><div>Title VP</div><div>SMITH, JANE</div><div>Annual Reports</div>';
  const d = parseSunbizDetail(html);
  assert.equal(d.status, 'INACTIVE');
  assert.deepEqual(d.people.map((p) => `${p.name}|${p.title}`), ['John A Smith|President', 'Jane Smith|Vice President']);
  assert.equal(pickOwner(d).name, 'John A Smith');
});

test('sunbiz detail page: nothing found is empty, not a crash', () => {
  const d = parseSunbizDetail('<html><body>No records found</body></html>');
  assert.equal(d.people.length, 0);
  assert.equal(pickOwner(d), null);
  assert.equal(parseSunbizDetail('').name, '');
  assert.equal(yearsSince('not a date'), null);
});

test('sunbiz search results and picking the right entity', () => {
  const html = `<table><tr><th>Entity Name</th><th>Document Number</th><th>Status</th></tr>
    <tr><td class="large-width"><a href="/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=EntityName&amp;aggregateId=domp-l12000012345-abc&amp;searchTerm=bayside">BAYSIDE ROOFING LLC</a></td><td class="medium-width">L12000012345</td><td class="small-width">Active</td></tr>
    <tr><td><a href="/Inquiry/CorporationSearch/SearchResultDetail?aggregateId=2">BAYSIDE ROOFING OF TAMPA INC</a></td><td>P1</td><td>Inactive</td></tr>
    <tr><td><a href="/Inquiry/CorporationSearch/SearchResultDetail?aggregateId=3">BAYSIDE PAINTING LLC</a></td><td>L2</td><td>Active</td></tr></table>`;
  const rs = parseSunbizResults(html);
  assert.equal(rs.length, 3);
  assert.equal(rs[0].active, true);
  assert.match(rs[0].url, /aggregateId=domp-l12000012345-abc/);
  assert.equal(pickEntity(rs, { business: 'Bayside Roofing' }).name, 'BAYSIDE ROOFING LLC');
  assert.equal(pickEntity(rs, { business: 'Totally Different Co' }), null);
  assert.equal(pickEntity([], { business: 'x' }), null);
  assert.equal(entityName('Bayside Roofing & Sheet Metal, LLC'), 'bayside roofing sheet metal');
  assert.match(sunbizSearchUrl('Bayside Roofing LLC'), /EntityName\/Bayside%20Roofing%20LLC\/Page1\?searchNameOrder=BAYSIDEROOFINGLLC/);
});

test('person names read like people, companies are not people', () => {
  assert.equal(personName('SMITH, JOHN A'), 'John A Smith');
  assert.equal(personName("O'BRIEN, PAT"), "Pat O'Brien");
  assert.equal(personName('ACME HOLDINGS LLC'), '');
  assert.equal(personName(''), '');
  assert.equal(pickOwner({ people: [{ name: 'Registered Agent Solutions', title: 'Manager' }, { name: 'Dana Cruz', title: 'Secretary' }] }).name, 'Dana Cruz');
  assert.equal(textLines('<div>A&amp;B</div><p> x   y </p>').join('|'), 'A&B|x y');
});

test('website profile: what a business says about itself', () => {
  const html = `<html><head><meta name="description" content="Family owned roofing company serving Miami and Broward since 2004. Free estimates, licensed and insured."><script>var x = "roofing"</script></head><body>
    <h1>Bayside Roofing</h1><p>Serving Miami, Hialeah, Coral Gables and Doral. Over 18 years of experience. License #CCC1330123.</p>
    <p>Roof repair, roof replacement, tile roof, gutter installation and leak repair. Free estimate. 24/7 emergency service. Financing available. Lifetime warranty.</p>
    <p>Mon - Fri 8am to 5pm</p><p>Maria Lopez, Owner</p><form action="/contact"></form><script src="/wp-content/x.js"></script><p>What our customers say</p></body></html>`;
  const p = extractProfile(html);
  assert.match(p.description, /^Family owned roofing company/);
  assert.ok(p.services.includes('roof repair') && p.services.includes('gutter'));
  assert.ok(p.areas.includes('Miami') && p.areas.includes('Doral'));
  assert.equal(p.years, 18);
  assert.equal(p.founded, 2004);
  assert.equal(p.license, 'CCC1330123');
  assert.match(p.hours, /Mon/);
  assert.deepEqual(p.team, ['Maria Lopez (Owner)']);
  assert.equal(p.family, true); assert.equal(p.emergency, true); assert.equal(p.freeEstimate, true); assert.equal(p.financing, true); assert.equal(p.warranty, true);
  assert.equal(p.cms, 'WordPress'); assert.equal(p.hasForm, true); assert.equal(p.reviewsOnSite, true);
  const empty = extractProfile('');
  assert.deepEqual([empty.services, empty.areas, empty.team], [[], [], []]);
  assert.equal(empty.years, null);
});

test('profiles from several pages merge without losing facts', () => {
  const a = { description: '', services: ['roofing'], areas: ['Miami'], years: null, founded: null, license: '', hours: '', team: [], hasForm: false };
  const b = { description: 'About us', services: ['gutter', 'roofing'], areas: ['Doral'], years: 12, founded: 2010, license: 'CCC1', hours: 'Mon to Fri', team: ['Al (Owner)'], hasForm: true };
  const m = mergeProfiles(a, b);
  assert.deepEqual(m.services, ['roofing', 'gutter']);
  assert.deepEqual(m.areas, ['Miami', 'Doral']);
  assert.equal(m.years, 12); assert.equal(m.license, 'CCC1'); assert.equal(m.hasForm, true);
  assert.equal(mergeProfiles(null, b), b);
});
