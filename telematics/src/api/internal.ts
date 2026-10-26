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
