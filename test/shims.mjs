// Local stand-ins for Cloudflare D1 (SQLite) and R2, so the Hub runs and tests in plain Node.
import { DatabaseSync } from 'node:sqlite';

const toSql = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(toSql)); }
  _s() { if (this.args.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${this.args.length}): SQLITE_ERROR`); return this.db.prepare(this.sql); }
  async first(col) {
    const row = this._s().get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] : plain;
  }
  async all() { return { results: this._s().all(...this.args).map((r) => ({ ...r })), success: true }; }
  async run() {
    // D1 allows 100 columns a table (https://developers.cloudflare.com/d1/platform/limits/). Plain SQLite allows 2000, so mirror D1 here.
    const alt = /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN/i.exec(this.sql);
    if (alt && this.db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${alt[1]}')`).get().n >= 100) throw new Error('D1_ERROR: too many columns on ' + alt[1] + ': SQLITE_ERROR');
    const r = this._s().run(...this.args); return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export function d1(path = ':memory:') {
  const db = new DatabaseSync(path);
  return {
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => {
      const out = [];
      db.exec('BEGIN');
      try {
        for (const s of stmts) out.push(/^\s*(select|with)/i.test(s.sql) ? await s.all() : await s.run());
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return out;
    },
    exec: async (sql) => { db.exec(sql); return { count: 1 }; },
  };
}

export function r2() {
  const store = new Map();
  return {
    async put(key, value, opts = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      store.set(key, { bytes, httpMetadata: opts.httpMetadata || {} });
    },
    async head(key) { const o = store.get(key); return o ? { size: o.bytes.length, httpMetadata: o.httpMetadata } : null; },
    async get(key, opts = {}) {
      const o = store.get(key);
      if (!o) return null;
      const r = opts.range;
      const bytes = r ? o.bytes.slice(r.offset, r.offset + r.length) : o.bytes;
      return { body: new Blob([bytes]).stream(), httpMetadata: o.httpMetadata, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}
