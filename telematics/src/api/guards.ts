/**
 * Request guards (Fastify preHandlers).
 * - serviceToken: app -> telematics and device scripts (header X-Service-Token)
 * - role: browser calls with a ticket from the app (Authorization: Bearer <ticket>);
 *   admin always passes (ADR-017); the service token is accepted too.
 */

import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { TicketError, type Role, type TicketVerifier } from "../ws/ticket.js";

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function hasServiceToken(req: FastifyRequest, token: string): boolean {
  const header = req.headers["x-service-token"];
  return typeof header === "string" && sameSecret(header, token);
}

/**
 * Role and depot: data of one depot (sorting line, ADR-071) only for the given roles and, for a
 * user bound to a depot, only that depot (ADR-068). The depot comes from the route.
 */
export function depotGuard(verifier: TicketVerifier, serviceToken: string, roles: Role[], depotOf: (req: FastifyRequest) => string): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (hasServiceToken(req, serviceToken)) return;
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "missing ticket" });
      return;
    }
    try {
      const claims = await verifier.verify(auth.slice("Bearer ".length), { consume: false });
      if (claims.role !== "admin" && !roles.includes(claims.role)) {
        await reply.code(403).send({ error: "insufficient role" });
      } else if (claims.depot !== null && claims.depot !== depotOf(req)) {
        await reply.code(403).send({ error: "not your depot" });
      }
    } catch (err) {
      await reply.code(401).send({ error: err instanceof TicketError ? err.message : "invalid ticket" });
    }
  };
}

export function serviceTokenGuard(token: string): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!hasServiceToken(req, token)) {
      await reply.code(401).send({ error: "invalid service token" });
    }
  };
}

export function roleGuard(
  verifier: TicketVerifier,
  serviceToken: string,
  roles: Role[] | "any",
): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (hasServiceToken(req, serviceToken)) return;
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "missing ticket" });
      return;
    }
    try {
      const claims = await verifier.verify(auth.slice("Bearer ".length), { consume: false });
      if (roles !== "any" && claims.role !== "admin" && !roles.includes(claims.role)) {
        await reply.code(403).send({ error: "insufficient role" });
      }
    } catch (err) {
      await reply.code(401).send({ error: err instanceof TicketError ? err.message : "invalid ticket" });
    }
  };
}
