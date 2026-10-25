/** System endpoints: health (incl. DB ping) and hello. */

import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db/pool.js";

const VERSION = "0.1.0";

const healthSchema = {
  type: "object",
  required: ["status", "db"],
  properties: {
    status: { type: "string", enum: ["ok", "error"] },
    db: { type: "string", enum: ["ok", "unreachable"] },
  },
} as const;

const helloSchema = {
  type: "object",
  required: ["service", "language", "version", "time"],
  properties: {
    service: { type: "string" },
    language: { type: "string" },
    version: { type: "string" },
    time: { type: "string", format: "date-time" },
  },
} as const;

export const healthRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness + db-telemetry ping",
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_req, reply) => {
      try {
        await db.ping();
        return { status: "ok", db: "ok" };
      } catch (err) {
        app.log.error({ err }, "db-telemetry health check failed");
        return reply.code(503).send({ status: "error", db: "unreachable" });
      }
    },
  );

  app.get(
    "/hello",
    { schema: { tags: ["system"], summary: "Hello", response: { 200: helloSchema } } },
    () => ({
      service: "telematics",
      language: "Node.js (TypeScript, Fastify)",
      version: VERSION,
      time: new Date().toISOString(),
    }),
  );

  await Promise.resolve();
};
