/** Telematics service entry point. */

import { HttpAppApi, type PlanWithLocal } from "./app-client.js";
import { buildApp, registerSimulation } from "./app.js";
import { SimClock } from "./clock/clock.js";
import { MINUTE, operatingDay, operatingDayStart } from "./clock/time.js";
import { loadConfig } from "./config.js";
import { loadMigrations, migrate } from "./db/migrate.js";
import { createDatabase } from "./db/pool.js";
import { PgTelemetry } from "./db/telemetry.js";
import { purgeGate } from "./jobs/retention.js";
import { Engine, initialSimTime } from "./simulator/engine.js";
import { RoadRouter } from "./simulator/roads.js";
import { buildRouteBook, loadRoutes, type RouteBook } from "./simulator/routes.js";
import { Hub } from "./ws/hub.js";
import { attachWebSocket } from "./ws/server.js";
import { TicketVerifier } from "./ws/ticket.js";

const config = loadConfig();
const db = createDatabase(config.db);
const app = await buildApp({ logLevel: config.logLevel, allowedOrigins: config.allowedOrigins, db });

const applied = await migrate(db.pool, await loadMigrations());
app.log.info({ applied }, applied.length ? "db-telemetry migrated" : "db-telemetry schema up to date");

// --- simulator state: resume where it stopped, or start fresh
const store = new PgTelemetry(db.pool);
const saved = await store.loadSimState();
const sim = config.sim;
let restartForNewEnvSeed = false;
let clockState;
let seed: number;
let degradationStartedAt: number | null;
if (saved) {
  clockState = { simTime: saved.simTime, speed: saved.speed, paused: saved.paused };
  seed = saved.seed;
  degradationStartedAt = saved.degradationStartedAt;
  if (saved.envSeed !== sim.seed) {
    // SIM_RANDOM_SEED in .env changed since the last start: apply it
    seed = sim.seed;
    restartForNewEnvSeed = true;
  }
} else {
  const simTime = initialSimTime(sim.startDate, sim.startTime, Date.now());
  clockState = { simTime, speed: sim.speed, paused: false };
  seed = sim.seed;
  degradationStartedAt = sim.degradedDevice ? operatingDayStart(operatingDay(simTime)) + 30 * MINUTE : null;
}

// real roads from the offline OSM graph (ADR-038); fallback polylines if the file is missing
const router = RoadRouter.load();
app.log.info({ roadNodes: router?.nodeCount ?? 0 }, router ? "road graph loaded" : "no road graph, using fallback routes");
const fallbackRoutes = loadRoutes();
const routesFor = (plan: PlanWithLocal): RouteBook =>
  plan.depot && plan.destinations
    ? buildRouteBook(router, [plan.depot.lat, plan.depot.lon], plan.destinations)
    : fallbackRoutes;

const clock = new SimClock(clockState);
const hub = new Hub();
const verifier = new TicketVerifier(config.wsTicketSecret);
const engine = new Engine({
  clock,
  store,
  app: new HttpAppApi(config.appInternalUrl, config.serviceToken),
  hub,
  routes: routesFor,
  router,
  log: app.log,
  config: {
    seed,
    envSeed: sim.seed,
    forceCascade: sim.forceCascade,
    degradedDevice: sim.degradedDevice,
    degradationStartedAt,
    degradationHours: sim.degradationHours,
    externalDevices: sim.externalDevices,
    degradedThreshold: sim.degradedThreshold,
  },
});
await engine.init();
await registerSimulation(app, { clock, engine, hub, verifier, serviceToken: config.serviceToken });

await app.listen({ host: "0.0.0.0", port: config.port });
const wss = attachWebSocket(app.server, { hub, verifier, allowedOrigins: config.allowedOrigins, log: app.log });
hub.start();
if (restartForNewEnvSeed) await engine.restartDay();
await engine.persist();
engine.start();
app.log.info(engine.clockInfo(), "simulation running");

// GDPR retention of gate passages: at start and every hour
const retention = async (): Promise<void> => {
  const result = await purgeGate(store, clock.now(), config.gateRetentionDays, config.snapshotDir);
  if (result.rows > 0) app.log.info(result, "gate passages purged (GDPR retention)");
};
await retention().catch((err: unknown) => {
  app.log.error({ err }, "retention failed");
});
const retentionTimer = setInterval(() => {
  retention().catch((err: unknown) => {
    app.log.error({ err }, "retention failed");
  });
}, 60 * 60 * 1000);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  clearInterval(retentionTimer);
  hub.stop();
  wss.close();
  await engine.stop();
  await app.close();
  await db.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
