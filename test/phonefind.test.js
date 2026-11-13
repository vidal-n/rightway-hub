import test from 'node:test';
import assert from 'node:assert/strict';
import { nameMatches, findPhones, nameTokens } from '../public/js/phonefind.js';

test('name tokens drop legal words', () => assert.deepEqual(nameTokens('Sparkle Plumbing LLC'), ['sparkle', 'plumbing']));

test('a site for the business matches, a different business or parked page does not', () => {
  assert.equal(nameMatches('Americas Plumbers', '<title>Americas Plumbers | Hollywood FL</title> call us'.replace(/<[^>]+>/g, ' ')), true);
  assert.equal(nameMatches('Sparkle Plumbing LLC', 'Welcome to Bob Smith Plumbing, the best plumbing in Miami'), false);
  assert.equal(nameMatches('Sparkle Plumbing LLC', 'This domain is for sale'), false);
  assert.equal(nameMatches('Roto-Rooter Plumbing & Water Cleanup', 'Roto Rooter plumbing and water cleanup in Broward'), true);
});

test('trade words alone are not enough', () => {
  assert.equal(nameMatches('Plumbing Pros', 'Our plumbing team'), false);
  assert.equal(nameMatches('Plumbing Pros', 'Plumbing Pros of South Florida'), true);
});

test('finds phones: tel link first, then schema, then text; skips toll free', () => {
  const html = '<a href="tel:+19547373680">Call</a><script type="application/ld+json">{"telephone":"305-555-0188"}</script><p>Toll free 800-555-0100 or (786) 555-0144</p>';
  assert.deepEqual(findPhones(html).map((p) => p.digits), ['9547373680', '3055550188', '7865550144']);
});
