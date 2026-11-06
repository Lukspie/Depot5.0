/** Simulation control: clock (pause, speed, jump, replay, step), reset, random seed, devices, what-if. */

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { SimClock } from "../clock/clock.js";
import { MAX_SPEED, MIN_SPEED } from "../clock/clock.js";
import { ReplayBusyError, ReplayStoppedError, type Engine } from "../simulator/engine.js";
import { MINUTE } from "../clock/time.js";
import { loadSituations, type Situation } from "../simulator/situations.js";
import type { Intervention } from "../simulator/whatif.js";
import type { TicketVerifier } from "../ws/ticket.js";
import { roleGuard } from "./guards.js";

export interface SimRoutesDeps {
  clock: SimClock;
  engine: Engine;
  verifier: TicketVerifier;
  serviceToken: string;
  /** SIM_CONTROLS_ENABLED: false in production, every control endpoint answers 403 (ADR-053) */
  controlsEnabled?: boolean;
  /** named starting points (data/situations.json, ADR-054) */
  situations?: Situation[];
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
    controlsEnabled: { type: "boolean" },
    situation: { type: ["string", "null"] },
  },
} as const;

/** clock + what a replay did (jump in replay mode, step) */
const advanceSchema = {
  type: "object",
  properties: {
    ...clockSchema.properties,
    replay: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        minutes: { type: "integer" },
        scans: { type: "integer" },
        ms: { type: "number" },
        stepMs: { type: "number" },
        syncMs: { type: "number" },
      },
    },
  },
} as const;

/** longest replay in one request (a whole operating day) */
const MAX_REPLAY_MIN = 24 * 60;

export const simRoutes: FastifyPluginAsync<SimRoutesDeps> = async (app, { clock, engine, verifier, serviceToken, controlsEnabled = true, situations = loadSituations() }) => {
  // control endpoints: switched off as a whole in production, then admin only
  const controlsGate = async (_req: unknown, reply: FastifyReply): Promise<void> => {
    if (!controlsEnabled) await reply.code(403).send({ error: "simulation controls are disabled" });
  };
  const admin = [controlsGate, roleGuard(verifier, serviceToken, [])];
  const replayBusy = (reply: FastifyReply) => reply.code(409).send({ error: "the simulation is busy (replay or reset running)" });
  // one place for the engine's mutex and a stopped replay, for every route of this plugin
  app.setErrorHandler(async (err, _req, reply) => {
    if (err instanceof ReplayBusyError) return replayBusy(reply);
    if (err instanceof ReplayStoppedError) {
      return reply.code(503).send({ error: err.message, stoppedAt: new Date(err.stoppedAt).toISOString(), ...engine.clockInfo() });
    }
    throw err;
  });
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
    (_req, reply) => {
      if (engine.replaying) return replayBusy(reply);
      clock.pause();
      return engine.clockInfo();
    },
  );

  app.post(
    "/sim/clock/resume",
    { preHandler: admin, schema: { tags: ["simulation"], summary: "Spustiť hodiny (admin)", ...secured, response: { 200: clockSchema } } },
    (_req, reply) => {
      if (engine.replaying) return replayBusy(reply);
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
    (req, reply) => {
      if (engine.replaying) return replayBusy(reply);
      clock.setSpeed(req.body.speed);
      return engine.clockInfo();
    },
  );

  app.post<{ Body: { to: string; mode?: "skip" | "replay" } }>(
    "/sim/clock/jump",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary:
          "Skok vpred na najbližší čas HH:MM. mode=skip preskočí úsek bez dát (ADR-025), mode=replay ho rýchlo dosimuluje so skenmi, prejazdmi a alarmami (ADR-053, admin)",
        ...secured,
        body: {
          type: "object",
          required: ["to"],
          additionalProperties: false,
          properties: {
            to: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
            mode: { type: "string", enum: ["skip", "replay"], default: "skip" },
          },
        },
        response: { 200: advanceSchema },
      },
    },
    async (req, reply) => {
      if (req.body.mode !== "replay") {
        if (engine.replaying) return replayBusy(reply);
        clock.jumpTo(req.body.to);
        return engine.clockInfo();
      }
      try {
        const replay = await engine.advance(clock.targetOf(req.body.to));
        return { ...engine.clockInfo(), replay };
      } catch (err) {
        if (err instanceof ReplayBusyError) return replayBusy(reply);
        throw err;
      }
    },
  );

  app.post<{ Body: { minutes: number } }>(
    "/sim/clock/step",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Krok o N simulovaných minút s dátami, napr. +5 / +15 / +60 (rovnaký kód ako skok v režime replay, admin)",
        ...secured,
        body: {
          type: "object",
          required: ["minutes"],
          additionalProperties: false,
          properties: { minutes: { type: "integer", minimum: 1, maximum: MAX_REPLAY_MIN } },
        },
        response: { 200: advanceSchema },
      },
    },
    async (req, reply) => {
      try {
        const replay = await engine.advance(clock.now() + req.body.minutes * MINUTE);
        return { ...engine.clockInfo(), replay };
      } catch (err) {
        if (err instanceof ReplayBusyError) return replayBusy(reply);
        throw err;
      }
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
    async (_req, reply) => {
      if (engine.replaying) return replayBusy(reply);
      await engine.restartDay();
      return engine.clockInfo();
    },
  );

  app.get(
    "/sim/situations",
    {
      preHandler: staff,
      schema: {
        tags: ["simulation"],
        summary: "Pomenované situácie na demo a testy (seed, čas, prepínače scenára, ADR-054)",
        ...secured,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                time: { type: "string" },
                seed: { type: "integer" },
                forceCascade: { type: "boolean" },
                degradedDevice: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
    () => situations,
  );

  app.post<{ Params: { id: string } }>(
    "/sim/situations/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary: "Načítať situáciu: čistý reset s jej seedom a prepínačmi, potom pretočenie s dátami do jej času (admin)",
        ...secured,
        params: { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[a-z0-9-]{1,40}$" } } },
        response: { 200: advanceSchema },
      },
    },
    async (req, reply) => {
      const s = situations.find((x) => x.id === req.params.id);
      if (!s) return reply.code(404).send({ error: "unknown situation" });
      try {
        const replay = await engine.loadSituation(s);
        return { ...engine.clockInfo(), replay };
      } catch (err) {
        if (err instanceof ReplayBusyError) return replayBusy(reply);
        throw err;
      }
    },
  );

  app.post(
    "/sim/reset",
    {
      preHandler: admin,
      schema: {
        tags: ["simulation"],
        summary:
          "Čistý reset dňa: seed z .env, zapnuté zariadenia, bez údržby, presunov jázd a alarmov dňa, staršie alarmy uzavreté, deň od 15:00 (admin)",
        ...secured,
        response: { 200: clockSchema },
      },
    },
    async (_req, reply) => {
      if (engine.replaying) return replayBusy(reply);
      await engine.cleanReset();
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
