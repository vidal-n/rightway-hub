import test from 'node:test';
import assert from 'node:assert/strict';
import { isMapsScrape, mapsScrapeRows } from '../public/js/mapsimport.js';

const head = ['hfpxzc href', 'xxVWCe', 'MW4etd', 'UY7F9', 'W4Efsd', 'W4Efsd 2', 'W4Efsd 3', 'W4Efsd 4', 'W4Efsd 5', 'UsdlK', 'lcr4fd href', 'Cw1rxd', 'R8c4Qb', 'Cw1rxd 2', 'R8c4Qb 2', 'Jn12ke src'];
const row = ['https://www.google.com/maps/place/Americas+Plumbers/data=!4m7', 'Americas Plumbers', '5.0', '(164)', 'Plumber', '·', '2517 Park Ln', 'Open 24 hours', '·', '(954) 737-3680', 'https://americasplumbers.com/?utm_campaign=gmb', 'Website', '', 'Directions', 'https://www.google.com/maps/dir/x', ''];
const noPhone = ['https://www.google.com/maps/place/Roto-Rooter/data=!4m7', 'Roto-Rooter Plumbing & Water Cleanup', '4.8', '(2,310)', 'Plumber', '·', '', 'Closed', '', '', '', '', '', '', '', ''];

test('detects the Instant Data Scraper Maps format', () => {
  assert.equal(isMapsScrape(head, [row]), true);
  assert.equal(isMapsScrape(['business', 'phone'], [['A', '1']]), false);
  assert.equal(isMapsScrape(['x', 'y'], [[row[0], 'Name']]), true);
});

test('reads name, rating, reviews, phone, website, category and address by content', () => {
  const [a, b] = mapsScrapeRows(head, [row, noPhone], { state: 'fl' });
  assert.deepEqual(a, { business: 'Americas Plumbers', rating: '5.0', reviews: '164', phone: '(954) 737-3680', website: 'https://americasplumbers.com', category: 'Plumber', address: '2517 Park Ln', state: 'FL' });
  assert.equal(b.business, 'Roto-Rooter Plumbing & Water Cleanup');
  assert.equal(b.reviews, '2310');
  assert.equal(b.phone, undefined);
  assert.equal(b.website, undefined);
});

test('skips rows with no name', () => {
  assert.equal(mapsScrapeRows(head, [['https://www.google.com/maps/place/x', '', '4.0']]).length, 0);
});
