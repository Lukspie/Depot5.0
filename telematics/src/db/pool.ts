/** PostgreSQL connection pool for db-telemetry. */

import pg from "pg";
import type { DbConfig } from "../config.js";

export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface PgDatabase extends Database {
  pool: pg.Pool;
}

export function createDatabase(cfg: DbConfig): PgDatabase {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 10,
  });
  return {
    pool,
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
