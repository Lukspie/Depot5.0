/** Internal API for the app (X-Service-Token): push events to WebSocket clients (e.g. alerts). */

import type { FastifyPluginAsync } from "fastify";
import type { Hub } from "../ws/hub.js";
import { CHANNELS, type Channel } from "../ws/hub.js";
import { serviceTokenGuard } from "./guards.js";

export interface InternalRoutesDeps {
  hub: Hub;
  serviceToken: string;
}

export const internalRoutes: FastifyPluginAsync<InternalRoutesDeps> = async (app, { hub, serviceToken }) => {
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

  await Promise.resolve();
};
