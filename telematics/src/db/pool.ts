/** PostgreSQL connection pool for db-telemetry. */

import pg from "pg";
import type { DbConfig } from "../config.js";

export interface DbLocation {
  /** azure = Azure Database for PostgreSQL, local = the db-telemetry container */
  kind: "azure" | "local" | "external";
  host: string;
  ssl: boolean;
}

export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
  location?: DbLocation;
}

const AZURE_SUFFIX = ".postgres.database.azure.com";

/**
 * Pool settings: a TELEMETRY_DATABASE_URL gets TLS from its `sslmode` (Azure defaults to require).
 * `sslmode` is taken out of the URL and turned into the `ssl` option, so node-postgres does not
 * reinterpret it; require and verify-* check the server certificate against the system CAs (Azure
 * uses public CAs), `no-verify` encrypts without the check (only if a CA is missing).
 */
export function poolConfig(cfg: DbConfig): pg.PoolConfig {
  if (!cfg.url) return { host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password, max: 10 };
  const url = new URL(cfg.url);
  const mode = url.searchParams.get("sslmode") ?? (url.hostname.endsWith(AZURE_SUFFIX) ? "require" : "disable");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: mode === "disable" ? false : { rejectUnauthorized: mode !== "no-verify" },
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 60_000,
  };
}

export function dbLocation(cfg: DbConfig): DbLocation {
  const ssl = poolConfig(cfg).ssl;
  if (!cfg.url) return { kind: "local", host: cfg.host, ssl: false };
  return { kind: cfg.host.endsWith(AZURE_SUFFIX) ? "azure" : "external", host: cfg.host, ssl: ssl !== false && ssl !== undefined };
}

export interface PgDatabase extends Database {
  pool: pg.Pool;
}

export function createDatabase(cfg: DbConfig): PgDatabase {
  const pool = new pg.Pool(poolConfig(cfg));
  return {
    pool,
    location: dbLocation(cfg),
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
