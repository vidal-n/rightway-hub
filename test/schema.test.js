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

test('schema: every table stays under D1\'s 100 column limit, with room to grow on leads', async () => {
  const db = d1();
  resetSchemaCache();
  await ensureSchema({ DB: db });
  const tables = await all({ DB: db }, "SELECT name FROM sqlite_master WHERE type = 'table'");
  for (const t of tables) {
    const n = (await all({ DB: db }, `SELECT name FROM pragma_table_info('${t.name}')`)).length;
    assert.ok(n <= 100, `${t.name} has ${n} columns`);
    if (t.name === 'leads') assert.ok(n <= 90, `leads has ${n} columns: put new lead data in its own table (D1 stops at 100)`);
  }
});

test('schema: the database the Lead database deploy left at 100 columns migrates and opens', async () => {
  const db = d1();
  resetSchemaCache();
  await ensureSchema({ DB: db });
  // What production looked like: the first 16 roll up columns added on leads, then filler up to 100, and an old stamp.
  const roll = ['r_dials', 'r_connects', 'r_owner', 'r_staff', 'r_menu', 'r_vm', 'r_noans', 'r_dead', 'r_wrong', 'r_talk', 'r_longest', 'r_fast_hangs', 'r_shortest', 'r_last_by', 'r_last_dispo', 'r_last_secs'];
  for (const c of roll) await db.prepare(`ALTER TABLE leads ADD COLUMN ${c} INTEGER`).run();
  await db.prepare('ALTER TABLE leads DROP COLUMN menu_path').run();
  let n = (await all({ DB: db }, "SELECT name FROM pragma_table_info('leads')")).length, i = 0;
  while (n < 100) { await db.prepare(`ALTER TABLE leads ADD COLUMN zz_${i++} TEXT`).run(); n++; }
  await db.prepare("UPDATE settings SET v = 'old' WHERE k = 'schema_v'").run();
  resetSchemaCache();
  await ensureSchema({ DB: db }); // must not throw
  const cols = new Set((await all({ DB: db }, "SELECT name FROM pragma_table_info('leads')")).map((c) => c.name));
  assert.ok(!cols.has('r_dials') && cols.has('menu_path'), 'roll up columns dropped, missing column added');
  assert.ok((await all({ DB: db }, "SELECT name FROM pragma_table_info('lead_roll')")).some((c) => c.name === 'r_service'));
});

test('schema: a step that cannot run is recorded, and the Hub still opens', async () => {
  const db = d1();
  resetSchemaCache();
  await ensureSchema({ DB: db });
  let n = (await all({ DB: db }, "SELECT name FROM pragma_table_info('leads')")).length, i = 0;
  await db.prepare('ALTER TABLE leads DROP COLUMN roll_at').run(); n--;
  while (n < 100) { await db.prepare(`ALTER TABLE leads ADD COLUMN zz_${i++} TEXT`).run(); n++; }
  await db.prepare("UPDATE settings SET v = 'old' WHERE k = 'schema_v'").run();
  resetSchemaCache();
  await ensureSchema({ DB: db });
  const s = Object.fromEntries((await all({ DB: db }, "SELECT k, v FROM settings WHERE k IN ('schema_v','schema_err')")).map((r) => [r.k, r.v]));
  assert.equal(s.schema_v, 'old', 'not stamped, so the next Worker tries again');
  assert.match(s.schema_err, /roll_at/);
});
