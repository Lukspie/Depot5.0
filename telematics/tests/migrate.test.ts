import { describe, expect, it } from "vitest";
import {
  loadMigrations,
  migrate,
  type Migration,
  type MigrationClient,
  type MigrationPool,
} from "../src/db/migrate.js";

/** In-memory stand-in for pg: records statements and remembers applied versions. */
function fakePool(alreadyApplied: string[] = [], failOn?: string) {
  const versions = new Set(alreadyApplied);
  const log: string[] = [];
  let released = 0;
  const client: MigrationClient = {
    query(sql, params) {
      const s = sql.trim();
      log.push(s.split(/\s+/).slice(0, 3).join(" "));
      if (failOn !== undefined && s === failOn) return Promise.reject(new Error("syntax error"));
      if (s.startsWith("SELECT version")) {
        return Promise.resolve({ rows: [...versions].map((version) => ({ version })) });
      }
      if (s.startsWith("INSERT INTO schema_migrations")) versions.add(String(params?.[0]));
      return Promise.resolve({ rows: [] });
    },
    release() {
      released += 1;
    },
  };
  const pool: MigrationPool = { connect: () => Promise.resolve(client) };
  return { pool, log, versions, released: () => released };
}

const migrations: Migration[] = [
  { version: "001_init", sql: "CREATE TABLE a (id int)" },
  { version: "002_more", sql: "CREATE TABLE b (id int)" },
];

describe("migration runner", () => {
  it("applies all pending migrations in order", async () => {
    const f = fakePool();
    expect(await migrate(f.pool, migrations)).toEqual(["001_init", "002_more"]);
    expect([...f.versions]).toEqual(["001_init", "002_more"]);
    expect(f.log.filter((l) => l.startsWith("CREATE TABLE a") || l.startsWith("CREATE TABLE b")))
      .toEqual(["CREATE TABLE a", "CREATE TABLE b"]);
    expect(f.released()).toBe(1);
  });

  it("skips migrations that were already applied", async () => {
    const f = fakePool(["001_init"]);
    expect(await migrate(f.pool, migrations)).toEqual(["002_more"]);
    expect(f.log).not.toContain("CREATE TABLE a");
  });

  it("rolls back and stops on a failing migration", async () => {
    const f = fakePool([], "CREATE TABLE b (id int)");
    await expect(migrate(f.pool, migrations)).rejects.toThrow(/002_more failed/);
    expect([...f.versions]).toEqual(["001_init"]);
    expect(f.log).toContain("ROLLBACK");
    expect(f.released()).toBe(1);
  });

  it("loads the real sql/ directory in order", async () => {
    const loaded = await loadMigrations();
    const versions = loaded.map((m) => m.version);
    expect(versions[0]).toBe("001_init");
    expect(versions).toEqual([...versions].sort());
    expect(loaded.every((m) => m.sql.length > 0)).toBe(true);
  });
});
