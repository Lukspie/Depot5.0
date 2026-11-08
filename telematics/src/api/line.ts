/**
 * Sorting lines (phase 7d step 5d, ADR-071): checkpoints, parcels on the line and the comparison
 * of the current state with the Depot 5.0 proposal, for the digital shadow. No personal data:
 * barcodes and counts only.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Engine } from "../simulator/engine.js";
import type { Variant } from "../simulator/line.js";
import type { TicketVerifier } from "../ws/ticket.js";
import { roleGuard } from "./guards.js";

export interface LineRoutesDeps {
  engine: Engine;
  verifier: TicketVerifier;
  serviceToken: string;
}

const params = {
  type: "object",
  required: ["depot"],
  properties: { depot: { type: "string", pattern: "^[A-Z]{2,4}$" }, barcode: { type: "string", pattern: "^[A-Z0-9-]{1,32}$" } },
} as const;
const query = {
  type: "object",
  properties: { variant: { type: "string", enum: ["current", "proposal"], default: "current" } },
  additionalProperties: false,
} as const;

export const lineRoutes: FastifyPluginAsync<LineRoutesDeps> = async (app, { engine, verifier, serviceToken }) => {
  const anyRole = roleGuard(verifier, serviceToken, "any");

  app.get<{ Params: { depot: string }; Querystring: { variant?: Variant } }>(
    "/line/:depot",
    {
      preHandler: anyRole,
      schema: {
        tags: ["line"],
        summary: "Triediaca linka skladu: kontrolné body, balíky na linke, porovnanie variantov",
        security: [{ bearerAuth: [] }],
        params,
        querystring: query,
      },
    },
    (req, reply) => engine.lineView(req.params.depot, req.query.variant ?? "current") ?? reply.code(404).send({ error: "no line for this depot" }),
  );

  app.get<{ Params: { depot: string; barcode: string }; Querystring: { variant?: Variant } }>(
    "/line/:depot/parcels/:barcode",
    {
      preHandler: anyRole,
      schema: {
        tags: ["line"],
        summary: "Trasa balíka po linke a posledný kontrolný bod",
        security: [{ bearerAuth: [] }],
        params,
        querystring: query,
      },
    },
    (req, reply) =>
      engine.lineParcel(req.params.depot, req.params.barcode, req.query.variant ?? "current") ?? reply.code(404).send({ error: "parcel not on the line today" }),
  );

  await Promise.resolve();
};
