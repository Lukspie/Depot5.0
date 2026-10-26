/**
 * Devices: list with live status, and the ingestion API used by real devices
 * (the IoT scanner prototype ml/dock_scanner.py in Phase 6) — the same path simulated scans take.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Engine } from "../simulator/engine.js";
import type { TicketVerifier } from "../ws/ticket.js";
import { roleGuard, serviceTokenGuard } from "./guards.js";

export interface DeviceRoutesDeps {
  engine: Engine;
  verifier: TicketVerifier;
  serviceToken: string;
}

interface ScanBody {
  events: { at?: string; barcode: string | null; readOk: boolean; facesRead?: number; itemCounted?: boolean }[];
}

export const deviceRoutes: FastifyPluginAsync<DeviceRoutesDeps> = async (app, { engine, verifier, serviceToken }) => {
  const anyRole = roleGuard(verifier, serviceToken, "any");
  const service = serviceTokenGuard(serviceToken);

  app.get(
    "/devices",
    {
      preHandler: anyRole,
      schema: { tags: ["devices"], summary: "Zariadenia so stavom a čítanosťou", security: [{ bearerAuth: [] }] },
    },
    () => ({ devices: engine.deviceList() }),
  );

  app.get<{ Params: { code: string }; Querystring: { hours?: number } }>(
    "/devices/:code/metrics",
    {
      preHandler: anyRole,
      schema: {
        tags: ["devices"],
        summary: "Čítanosť zariadenia po 10 minútach (sparkline)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { hours: { type: "integer", minimum: 1, maximum: 24, default: 6 } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const buckets = await engine.deviceMetrics(req.params.code, req.query.hours ?? 6);
      return buckets ? { code: req.params.code, buckets } : reply.code(404).send({ error: "unknown device" });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/devices/:code/heartbeat",
    { preHandler: service, schema: { tags: ["devices"], summary: "Heartbeat reálneho zariadenia" } },
    (req, reply) => (engine.heartbeat(req.params.code) ? { ok: true } : reply.code(404).send({ error: "unknown device" })),
  );

  app.post<{ Params: { code: string }; Body: ScanBody }>(
    "/devices/:code/scans",
    {
      preHandler: service,
      schema: {
        tags: ["devices"],
        summary: "Skeny z reálneho zariadenia (rovnaké spracovanie ako simulované)",
        body: {
          type: "object",
          required: ["events"],
          properties: {
            events: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                required: ["barcode", "readOk"],
                properties: {
                  at: { type: "string", format: "date-time" },
                  barcode: { type: ["string", "null"], maxLength: 64 },
                  readOk: { type: "boolean" },
                  facesRead: { type: "integer", minimum: 0, maximum: 6 },
                  itemCounted: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const n = await engine.ingestScans(req.params.code, req.body.events);
      if (n === null) return reply.code(404).send({ error: "unknown device" });
      return { accepted: n };
    },
  );

  await Promise.resolve();
};
