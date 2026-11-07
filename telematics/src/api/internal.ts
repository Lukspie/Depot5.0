/** Internal API for the app (X-Service-Token): push events to WebSocket clients (e.g. alerts),
 * current position of a vehicle (customer tracking, courier screen). */

import type { FastifyPluginAsync } from "fastify";
import type { Engine } from "../simulator/engine.js";
import type { Hub } from "../ws/hub.js";
import { CHANNELS, type Channel } from "../ws/hub.js";
import { serviceTokenGuard } from "./guards.js";

export interface InternalRoutesDeps {
  hub: Hub;
  engine: Engine;
  serviceToken: string;
}

export const internalRoutes: FastifyPluginAsync<InternalRoutesDeps> = async (app, { hub, engine, serviceToken }) => {
  app.post<{ Body: { channel: Channel; type?: string; event?: unknown; events?: unknown[] } }>(
    "/internal/broadcast",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: {
        tags: ["internal"],
        summary: "Rozoslať udalosť klientom WebSocketu (volá app)",
        body: {
          type: "object",
          required: ["channel"],
          properties: {
            channel: { type: "string", enum: [...CHANNELS] },
            type: { type: "string", maxLength: 32 },
            event: { type: "object" },
            events: { type: "array", maxItems: 2000, items: { type: "object" } },
          },
        },
      },
    },
    (req) => {
      const type = req.body.type ?? "event";
      const events = req.body.events ?? (req.body.event === undefined ? [] : [req.body.event]);
      for (const ev of events) hub.publish(req.body.channel, type, ev);
      return { events: events.length, clients: hub.size };
    },
  );

  app.post(
    "/internal/plan/reload",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: { tags: ["internal"], summary: "Plán sa zmenil (jazda na inú bránu): načítať ho znova (volá app)" },
    },
    async () => ({ days: await engine.refreshPlan() }),
  );

  app.post<{ Params: { code: string }; Body: { minutes: number } }>(
    "/internal/devices/:code/maintenance",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: {
        tags: ["internal"],
        summary: "Zariadenie označené na údržbu vo WMS (volá app)",
        params: { type: "object", properties: { code: { type: "string", maxLength: 32 } } },
        body: {
          type: "object",
          required: ["minutes"],
          additionalProperties: false,
          properties: { minutes: { type: "integer", minimum: 5, maximum: 240 } },
        },
      },
    },
    async (req, reply) => (await engine.startMaintenance(req.params.code, req.body.minutes)) ?? reply.code(404).send({ error: "unknown device" }),
  );

  app.post<{ Body: { direction: "in" | "out"; vehicleType: string; plate: string | null; plateConfidence: number | null; expected: boolean } }>(
    "/internal/gate/passages",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: {
        tags: ["internal"],
        summary: "Prejazd z reálnej kamery brány (CV v app, ADR-059)",
        body: {
          type: "object",
          required: ["direction", "vehicleType", "plate", "plateConfidence", "expected"],
          additionalProperties: false,
          properties: {
            direction: { type: "string", enum: ["in", "out"] },
            vehicleType: { type: "string", enum: ["car", "truck", "bus", "van"] },
            plate: { type: ["string", "null"], maxLength: 16 },
            plateConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
            expected: { type: "boolean" },
          },
        },
      },
    },
    async (req) => {
      const row = await engine.recordGatePassage(req.body);
      return { ...row, at: new Date(row.at).toISOString() };
    },
  );

  app.get<{ Params: { plate: string } }>(
    "/internal/vehicles/:plate",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: {
        tags: ["internal"],
        summary: "Aktuálna poloha vozidla (volá app)",
        params: { type: "object", properties: { plate: { type: "string", maxLength: 16 } } },
      },
    },
    (req, reply) => engine.vehicleNow(req.params.plate) ?? reply.code(404).send({ error: "unknown vehicle" }),
  );

  await Promise.resolve();
};
