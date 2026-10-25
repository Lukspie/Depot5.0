/**
 * Minimal SQL migration runner for db-telemetry (ADR-012).
 *
 * Applies `sql/NNN_name.sql` files in order. Each file runs in its own transaction together with
 * its row in `schema_migrations`, so a failing file leaves no partial state. An advisory lock
 * makes concurrent starts safe.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface Migration {
  version: string;
  sql: string;
}

const FILE_PATTERN = /^(\d{3,})_[\w-]+\.sql$/;
// arbitrary constant identifying the migration lock
const LOCK_ID = 73_012_026;

/** `sql/` next to `src/` (or `dist/` in the container). */
export const DEFAULT_SQL_DIR = fileURLToPath(new URL("../../sql", import.meta.url));

export async function loadMigrations(dir: string = DEFAULT_SQL_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
  return Promise.all(
    files.map(async (file) => ({
      version: file.replace(/\.sql$/, ""),
      sql: await readFile(join(dir, file), "utf8"),
    })),
  );
}

/** Applies pending migrations; returns the versions applied in this run. */
export async function migrate(pool: MigrationPool, migrations: Migration[]): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const done = new Set(rows.map((r) => String(r.version)));

    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m.version} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(m.version);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
