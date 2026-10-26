/** Simulation control: clock (pause, speed, jump), random seed, devices, scenario summary. */

import type { FastifyPluginAsync } from "fastify";
import type { SimClock } from "../clock/clock.js";
import { MAX_SPEED, MIN_SPEED } from "../clock/clock.js";
import type { Engine } from "../simulator/engine.js";
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
