/** Simulation control: clock (pause, speed, jump), random seed, devices, scenario summary. */

import type { FastifyPluginAsync } from "fastify";
import type { SimClock } from "../clock/clock.js";
import { MAX_SPEED, MIN_SPEED } from "../clock/clock.js";
import type { Engine } from "../simulator/engine.js";
import type { Intervention } from "../simulator/whatif.js";
import type { TicketVerifier } from "../ws/ticket.js";
import { roleGuard } from "./guards.js";

export interface SimRoutesDeps {
  clock: SimClock;
  engine: Engine;
  verifier: TicketVerifier;
  serviceToken: string;
}

const clockSchema = {
  type: "object",
  properties: {
    simTime: { type: "string", format: "date-time" },
    localTime: { type: "string" },
    timeZone: { type: "string" },
    operatingDay: { type: "string" },
    speed: { type: "number" },
    paused: { type: "boolean" },
    seed: { type: "integer" },
  },
} as const;

export const simRoutes: FastifyPluginAsync<SimRoutesDeps> = async (app, { clock, engine, verifier, serviceToken }) => {
  const admin = roleGuard(verifier, serviceToken, []);
  const staff = roleGuard(verifier, serviceToken, ["dispatcher", "security", "operator"]);
  const dispatcher = roleGuard(verifier, serviceToken, ["dispatcher"]);
  const secured = { security: [{ bearerAuth: [] }] };

  app.get(
    "/sim/clock",
    { schema: { tags: ["simulation"], summary: "Simulovaný čas (verejné)", response: { 200: clockSchema } } },
    () => engine.clockInfo(),
  );

  app.post(
    "/sim/clock/pause",
    { preHandler: admin, schema: { tags: ["simulation"], summary: "Pozastaviť hodiny (admin)", ...secured, response: { 200: clockSchema } } },
    () => {
      clock.pause();
      return engine.clockInfo();
    },
  );

  app.post(
    "/sim/clock/resume",
    { preHandler: admin, schema: { tags: ["simulation"], summary: "Spustiť hodiny (admin)", ...secured, response: { 200: clockSchema } } },
    () => {
      clock.resume();
      return engine.clockInfo();
    },
  );

  app.put<{ Body: { speed: number } }>(
    "/sim/clock/speed",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Rýchlosť simulácie, násobok reálneho času (admin)",
        ...secured,
        body: {
          type: "object",
          required: ["speed"],
          properties: { speed: { type: "number", minimum: MIN_SPEED, maximum: MAX_SPEED } },
        },
        response: { 200: clockSchema },
      },
    },
    (req) => {
      clock.setSpeed(req.body.speed);
      return engine.clockInfo();
    },
  );

  app.post<{ Body: { to: string } }>(
    "/sim/clock/jump",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Skok vpred na najbližší čas HH:MM, napr. 15:30 večerná vlna, 01:00 nočné kamióny, 06:00 ranné odchody (admin)",
        ...secured,
        body: {
          type: "object",
          required: ["to"],
          properties: { to: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" } },
        },
        response: { 200: clockSchema },
      },
    },
    (req) => {
      clock.jumpTo(req.body.to);
      return engine.clockInfo();
    },
  );

  app.get(
    "/sim/seed",
    { preHandler: staff, schema: { tags: ["simulation"], summary: "Aktuálny seed", ...secured } },
    () => ({ seed: engine.seed }),
  );

  app.put<{ Body: { seed: number } }>(
    "/sim/seed",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Zmena seedu – aktuálny prevádzkový deň začne znova od 15:00 (admin)",
        ...secured,
        body: {
          type: "object",
          required: ["seed"],
          properties: { seed: { type: "integer", minimum: 0, maximum: 2147483647 } },
        },
        response: { 200: clockSchema },
      },
    },
    async (req) => {
      await engine.setSeed(req.body.seed);
      return engine.clockInfo();
    },
  );

  app.post(
    "/sim/restart-day",
    { preHandler: admin, schema: { tags: ["simulation"], summary: "Prehrať aktuálny prevádzkový deň znova od 15:00 (admin)", ...secured } },
    async () => {
      await engine.restartDay();
      return engine.clockInfo();
    },
  );

  app.get(
    "/routes",
    {
      preHandler: roleGuard(verifier, serviceToken, "any"),
      schema: { tags: ["simulation"], summary: "Trasy kamiónov po reálnych cestách (pre mapu)", ...secured },
    },
    (_req, reply) => engine.routesSummary() ?? reply.code(503).send({ error: "routes not loaded yet" }),
  );

  app.get<{ Params: { plate: string } }>(
    "/routes/vehicle/:plate",
    {
      // the remaining stops of a courier are internal data: staff only, never the customer
      preHandler: roleGuard(verifier, serviceToken, ["dispatcher", "courier"]),
      schema: {
        tags: ["simulation"],
        summary: "Zvyšná trasa dodávky kuriéra po uliciach (pre mapu)",
        params: { type: "object", properties: { plate: { type: "string", maxLength: 16 } } },
        ...secured,
      },
    },
    (req, reply) => {
      const points = engine.vehiclePath(req.params.plate);
      return points === null ? reply.code(404).send({ error: "no courier route for this vehicle" }) : { points };
    },
  );

  app.get(
    "/sim/scenario",
    { preHandler: staff, schema: { tags: ["simulation"], summary: "Prehľad scenára načítaných dní", ...secured } },
    () => ({ days: engine.scenarioSummary() }),
  );

  // what-if scenario of the digital shadow (ADR-047): a computation on copies, no live data changes
  const tripId = { type: "integer", minimum: 1 } as const;
  const device = { type: "string", minLength: 1, maxLength: 32 } as const;
  const door = { type: "string", minLength: 1, maxLength: 16 } as const;
  // Branches are picked by `kind` (if/then), not by `oneOf`: Fastify's AJV runs with removeAdditional,
  // so in a oneOf the `additionalProperties: false` of a non-matching branch strips fields (`rate`,
  // `tripId`, `doorCode`) before the right branch is tried, and read_rate / move_trip never validated.
  const intervention = (kind: string, props: Record<string, object>) =>
    ({
      if: { properties: { kind: { const: kind } } },
      then: { required: Object.keys(props), additionalProperties: false, properties: { kind: { const: kind }, ...props } },
    }) as const;
  const KINDS = ["delay", "device_outage", "read_rate", "extra_scanner", "move_trip"] as const;
  app.post<{ Body: { interventions: Intervention[] } }>(
    "/sim/what-if",
    {
      preHandler: dispatcher,
      schema: {
        tags: ["simulation"],
        summary: "Scenár čo ak: KPI plán vs. scenár do konca prevádzkového dňa (dispečer)",
        ...secured,
        body: {
          type: "object",
          required: ["interventions"],
          additionalProperties: false,
          properties: {
            interventions: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                required: ["kind"],
                properties: { kind: { type: "string", enum: KINDS } },
                allOf: [
                  intervention("delay", { tripId, minutes: { type: "integer", minimum: -120, maximum: 600 } }),
                  intervention("device_outage", { device }),
                  intervention("read_rate", { device, rate: { type: "number", minimum: 0, maximum: 1 } }),
                  intervention("extra_scanner", { doorCode: door }),
                  intervention("move_trip", { tripId, doorCode: door }),
                ],
              },
            },
          },
        },
      },
    },
    (req, reply) => {
      const out = engine.whatIf(req.body.interventions);
      if (out === null) return reply.code(503).send({ error: "operating day not loaded yet" });
      if ("errors" in out) return reply.code(400).send({ error: out.errors.join("; ") });
      return out.result;
    },
  );

  app.put<{ Params: { code: string }; Body: { enabled?: boolean; repair?: boolean } }>(
    "/sim/devices/:code",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Vypnúť/zapnúť zariadenie, opraviť degradovaný skener (admin)",
        ...secured,
        body: {
          type: "object",
          properties: { enabled: { type: "boolean" }, repair: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const result = await engine.updateDevice(req.params.code, req.body);
      if (!result) return reply.code(404).send({ error: "unknown device" });
      return result;
    },
  );

  await Promise.resolve();
};
