/** Fastify application factory (separate from index.ts so tests can build it without a real DB). */

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./api/health.js";
import type { Database } from "./db/pool.js";

export interface AppDeps {
  logLevel: string;
  allowedOrigins: string[];
  db: Database;
}

export async function buildApp({ logLevel, allowedOrigins, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logLevel === "silent" ? false : { level: logLevel } });

  await app.register(cors, { origin: allowedOrigins });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "DepoTrack Telematics API",
        description: "Simulátor, simulované hodiny, telemetria a WebSocket stream udalostí.",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(healthRoutes, { db });

  return app;
}
