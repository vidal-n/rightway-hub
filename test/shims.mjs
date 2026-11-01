// Local stand-ins for Cloudflare D1 (SQLite) and R2, so the Hub runs and tests in plain Node.
import { DatabaseSync } from 'node:sqlite';

const toSql = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(toSql)); }
  _s() { return this.db.prepare(this.sql); }
  async first(col) {
    const row = this._s().get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] : plain;
  }
  async all() { return { results: this._s().all(...this.args).map((r) => ({ ...r })), success: true }; }
  async run() { const r = this._s().run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
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
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return { body: new Blob([o.bytes]).stream(), httpMetadata: o.httpMetadata, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) };
    },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}
