/** Telematics service entry point. */

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadMigrations, migrate } from "./db/migrate.js";
import { createDatabase } from "./db/pool.js";

const config = loadConfig();
const db = createDatabase(config.db);
const app = await buildApp({ logLevel: config.logLevel, allowedOrigins: config.allowedOrigins, db });

const applied = await migrate(db.pool, await loadMigrations());
app.log.info({ applied }, applied.length ? "db-telemetry migrated" : "db-telemetry schema up to date");

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: config.port });
