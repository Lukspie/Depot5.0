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
  app.post<{ Body: { channel: Channel; type?: string; event: unknown } }>(
    "/internal/broadcast",
    {
      preHandler: serviceTokenGuard(serviceToken),
      schema: {
        tags: ["internal"],
        summary: "Rozoslať udalosť klientom WebSocketu (volá app)",
        body: {
          type: "object",
          required: ["channel", "event"],
          properties: {
            channel: { type: "string", enum: [...CHANNELS] },
            type: { type: "string", maxLength: 32 },
            event: { type: "object" },
          },
        },
      },
    },
    (req) => {
      hub.publish(req.body.channel, req.body.type ?? "event", req.body.event);
      return { delivered: hub.size };
    },
  );

  await Promise.resolve();
};
