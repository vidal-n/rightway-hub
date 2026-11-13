// Contrast guard (Nov 2026, V: pale boxes with pale text in dark mode). --ink is a text colour that turns light in dark mode, so it must never
// be used as a background. Use --fill (dark panel) or --sel (selected control) with --on-fill / --on-sel for the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILES = ['public/hub.css', 'public/hub5.css'];
// Allowed on purpose: small inverted bits whose text token flips with it (tooltip, progress fills).
const ALLOW = [/\.pc-tip\b/, /\.hbar \.fill/, /\.pin\b/];

test('no background uses var(--ink)', () => {
  const bad = [];
  for (const f of FILES) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/background(-color)?:\s*var\(--ink\)/.test(line) && !ALLOW.some(a => a.test(line))) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [], 'use var(--fill) or var(--sel) instead of var(--ink) for backgrounds');
});

test('tokens exist for light and dark', () => {
  const css = fs.readFileSync('public/hub.css', 'utf8');
  for (const t of ['--fill', '--on-fill', '--sel', '--on-sel']) assert.ok((css.match(new RegExp(t + ':', 'g')) || []).length >= 2, t);
});
