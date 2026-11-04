import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCache, all } from '../src/db.js';
import { d1 } from './shims.mjs';
import { readFileSync, existsSync } from 'node:fs';

const counting = (db) => { const c = { n: 0 }; return { c, DB: { prepare(sql) { c.n++; return db.prepare(sql); }, batch(x) { c.n += x.length; return db.batch(x); } } }; };

test('schema: a new Worker on a current database runs one read, not hundreds of statements', async () => {
  const db = d1();
  resetSchemaCache();
  const first = counting(db);
  await ensureSchema(first);
  assert.ok(first.c.n > 100, 'a fresh database is built once');
  const cols = await all({ DB: db }, "SELECT name FROM pragma_table_info('users')");
  assert.ok(cols.some((c) => c.name === 'avatar_at'), 'added columns exist');
  resetSchemaCache(); // a different isolate starting cold
  const second = counting(db);
  await ensureSchema(second);
  assert.equal(second.c.n, 1);
  // A database stamped by an older deploy migrates again and only adds what is missing.
  await db.prepare("UPDATE settings SET v = 'old' WHERE k = 'schema_v'").run();
  resetSchemaCache();
  const third = counting(db);
  await ensureSchema(third);
  assert.ok(third.c.n > 1 && third.c.n < 400, `third=${third.c.n}`);
  const fourth = counting(db); resetSchemaCache(); await ensureSchema(fourth);
  assert.equal(fourth.c.n, 1);
});

test('index.html preloads real modules so the app does not load in a long chain', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const hrefs = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 25);
  for (const h of hrefs) assert.ok(existsSync(`public${h}`), `${h} exists`);
  assert.ok(hrefs.includes('/hub/home.js') && hrefs.includes('/hub/shell.js') && hrefs.includes('/js/charts.js'));
});
