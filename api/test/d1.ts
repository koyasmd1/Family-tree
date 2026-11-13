// A small stand-in for Cloudflare D1 built on Node's built-in SQLite, so the
// rules can be tested without a Cloudflare account. D1 is SQLite too.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

class Stmt {
  private args: unknown[] = [];
  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}
  bind(...args: unknown[]) {
    this.args = args.map((a) => (a === undefined ? null : a));
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.args as any[])) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.args as any[])) as T[], success: true };
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.args as any[]));
    return { success: true };
  }
}

export function testDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, file), "utf8"));
  return { prepare: (sql: string) => new Stmt(db, sql) } as unknown as D1Database;
}
