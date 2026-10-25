/** Fastify application factory (separate from index.ts so tests can build it without a real DB). */

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { deviceRoutes } from "./api/devices.js";
import { healthRoutes } from "./api/health.js";
import { internalRoutes } from "./api/internal.js";
import { simRoutes } from "./api/sim.js";
import type { SimClock } from "./clock/clock.js";
import type { Database } from "./db/pool.js";
import type { Engine } from "./simulator/engine.js";
import type { Hub } from "./ws/hub.js";
import type { TicketVerifier } from "./ws/ticket.js";

export interface AppDeps {
  logLevel: string;
  allowedOrigins: string[];
  db: Database;
}

export async function buildApp({ logLevel, allowedOrigins, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logLevel === "silent" ? false : { level: logLevel },
    // healthchecks every 10 s would flood the log
    disableRequestLogging: true,
  });

  await app.register(cors, {
    origin: allowedOrigins,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT"],
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "DepoTrack Telematics API",
        description:
          "Simulátor, simulované hodiny, telemetria a WebSocket stream udalostí (ws://…/ws?ticket=…). " +
          "Ovládanie simulácie vyžaduje ticket roly admin z app (`Authorization: Bearer <ticket>`).",
        version: "0.2.0",
      },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT ticket" } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(healthRoutes, { db });

  return app;
}

export interface SimulationDeps {
  clock: SimClock;
  engine: Engine;
  hub: Hub;
  verifier: TicketVerifier;
  serviceToken: string;
}

/** Simulation, device and internal routes (need the running engine). */
export async function registerSimulation(app: FastifyInstance, deps: SimulationDeps): Promise<void> {
  await app.register(simRoutes, deps);
  await app.register(deviceRoutes, deps);
  await app.register(internalRoutes, deps);
}
