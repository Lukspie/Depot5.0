import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { addDays, MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import type { WhatIfResult } from "../src/simulator/whatif.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, MemoryStore, SECRET, silentLog, ticket } from "./fixtures.js";

const DAY = "2026-10-23";
const START = operatingDayStart(DAY);
const SERVICE = "svc";

async function makeEngine() {
  const clock = new SimClock({ simTime: START, speed: 60, paused: true }, () => 0);
  const store = new MemoryStore();
  const app = new FakeApp();
  const hub = new Hub();
  const engine = new Engine({
    clock,
    store,
    app,
    hub,
    routes: loadRoutes(),
    log: silentLog,
    realNow: () => 0,
    config: {
      seed: 42,
      envSeed: 42,
      forceCascade: true,
      degradedDevice: "DOCK-SCN-02",
      degradationStartedAt: START + 30 * MINUTE,
      degradationHours: 6,
      externalDevices: [],
      degradedThreshold: 0.92,
    },
  });
  await engine.init();
  const runUntil = async (until: number): Promise<void> => {
    for (let t = clock.now() + MINUTE; t <= until; t += MINUTE) {
      clock.set(t);
      await engine.step(t);
    }
  };
  await runUntil(START + MINUTE);
  const trip = (code: string, kind: "inbound" | "outbound") => {
    const t = app.planFor(DAY).trips.find((x) => x.directionCode === code && x.kind === kind);
    if (!t) throw new Error(`no ${code} ${kind}`);
    return t;
  };
  return { engine, clock, store, app, runUntil, trip };
}

function result(out: ReturnType<Engine["whatIf"]>): WhatIfResult {
  if (out === null || "errors" in out) throw new Error(JSON.stringify(out));
  return out.result;
}

describe("what-if scenarios (ADR-047)", () => {
  it("without interventions the scenario equals the plan, until the end of the operating day", async () => {
    const { engine } = await makeEngine();
    const r = result(engine.whatIf([]));
    expect(r.scenario).toEqual(r.plan);
    expect(r.trips).toEqual([]);
    expect(r.to).toBe(new Date(operatingDayStart(addDays(DAY, 1))).toISOString());
    expect(r.plan.cascadeWarnings).toBeGreaterThan(0); // the guaranteed cascade of the default seed
  });

  it("is deterministic and does not touch the live day", async () => {
    const a = await makeEngine();
    const b = await makeEngine();
    const iv = [{ kind: "delay" as const, tripId: a.trip("BA", "inbound").id, minutes: 90 }];
    const before = JSON.stringify(a.engine.scenarioSummary());
    expect(result(a.engine.whatIf(iv))).toEqual(result(a.engine.whatIf(iv)));
    expect(JSON.stringify(a.engine.scenarioSummary())).toBe(before);
    // the engine that ran a scenario replays the evening exactly like one that did not
    await a.runUntil(zonedToUtc(DAY, "19:00"));
    await b.runUntil(zonedToUtc(DAY, "19:00"));
    expect(a.store.scans.length).toBeGreaterThan(100);
    expect(a.store.scans).toEqual(b.store.scans);
  });

  it("a late night truck delays the regional departures and raises cascade warnings", async () => {
    const { engine, trip } = await makeEngine();
    const r = result(engine.whatIf([{ kind: "delay", tripId: trip("BA", "inbound").id, minutes: 120 }]));
    expect(r.scenario.cascadeWarnings).toBeGreaterThan(r.plan.cascadeWarnings);
    expect(r.scenario.transitDelayMin).toBeGreaterThan(r.plan.transitDelayMin);
    const changed = r.trips.map((t) => t.directionCode);
    expect(changed).toContain("BA");
    expect(changed).toEqual(expect.arrayContaining(["MI", "SE"])); // both wait for Bratislava
    // the delay moves when parcels are scanned, not which ones go to a wrong door
    expect(r.scenario.wrongDirection).toBe(r.plan.wrongDirection);
    expect(r.affected.doors).toContain("LD-08");
  });

  it("scanner interventions change the unidentified parcels", async () => {
    const { engine } = await makeEngine();
    const outage = result(engine.whatIf([{ kind: "device_outage", device: "DOCK-SCN-01" }]));
    expect(outage.scenario.unidentified).toBeGreaterThan(outage.plan.unidentified + 50);
    expect(outage.scenario.wrongUndetected).toBeGreaterThanOrEqual(outage.plan.wrongUndetected);
    expect(outage.affected.devices).toEqual(["DOCK-SCN-01"]);

    const worse = result(engine.whatIf([{ kind: "read_rate", device: "DOCK-SCN-03", rate: 0.6 }]));
    expect(worse.scenario.unidentified).toBeGreaterThan(worse.plan.unidentified);

    // a second camera at the door of the degrading scanner
    const extra = result(engine.whatIf([{ kind: "extra_scanner", doorCode: "LD-02" }]));
    expect(extra.scenario.unidentified).toBeLessThan(extra.plan.unidentified);
    expect(extra.affected).toMatchObject({ doors: ["LD-02"], devices: ["DOCK-SCN-02"] });
    expect(extra.scenario.wrongDirection).toBe(extra.plan.wrongDirection); // same parcels, same mistakes
  });

  it("moving a truck to an occupied door makes it wait", async () => {
    const { engine, trip } = await makeEngine();
    const ba = trip("BA", "outbound");
    const r = result(engine.whatIf([{ kind: "move_trip", tripId: ba.id, doorCode: "LD-01" }]));
    const moved = r.trips.find((t) => t.tripId === ba.id);
    expect(moved?.doorCode).toBe("LD-01");
    expect(moved?.deltaMin).toBeGreaterThan(60); // waits for Banská Bystrica (20:30)
    expect(r.affected.doors).toEqual(expect.arrayContaining(["LD-01", "LD-02"]));
  });

  it("rejects unknown trips, devices and doors", async () => {
    const { engine } = await makeEngine();
    expect(engine.whatIf([{ kind: "delay", tripId: 999_999, minutes: 10 }])).toEqual({ errors: ["unknown trip 999999"] });
    expect(engine.whatIf([{ kind: "device_outage", device: "NOPE" }])).toEqual({ errors: ["unknown device NOPE"] });
    expect(engine.whatIf([{ kind: "extra_scanner", doorCode: "SB-01" }])).toEqual({ errors: ["unknown loading door SB-01"] });
  });
});

describe("maintenance and plan reload (ADR-048)", () => {
  it("a scanner under maintenance sends no scans, then it is repaired", async () => {
    const { engine, store, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "19:00"));
    const info = await engine.startMaintenance("DOCK-SCN-02", 30);
    expect(info?.status).toBe("maintenance");
    const from = zonedToUtc(DAY, "19:00");
    await runUntil(zonedToUtc(DAY, "19:40"));
    const ld2 = store.scans.filter((s) => s.deviceId === 2 && s.at > from);
    expect(ld2.filter((s) => s.at < from + 30 * MINUTE)).toEqual([]);
    expect(ld2.length).toBeGreaterThan(0); // scanning again after the window
    expect(engine.deviceList().find((d) => d.code === "DOCK-SCN-02")?.status).not.toBe("maintenance");
    expect(await engine.startMaintenance("NOPE", 30)).toBeNull();
  });

  it("restarting the day ends maintenance: the replay equals a clean engine", async () => {
    const a = await makeEngine();
    const b = await makeEngine();
    await a.runUntil(zonedToUtc(DAY, "19:00"));
    await a.engine.startMaintenance("DOCK-SCN-01", 240);
    await a.engine.restartDay();
    a.store.scans.length = 0;
    await a.runUntil(zonedToUtc(DAY, "19:00"));
    await b.runUntil(zonedToUtc(DAY, "19:00"));
    expect(a.engine.deviceList().find((d) => d.code === "DOCK-SCN-01")?.status).not.toBe("maintenance");
    const ld1 = (s: typeof a.store) => s.scans.filter((x) => x.deviceId === 1).map((x) => [x.at, x.barcode]);
    expect(ld1(a.store).length).toBeGreaterThan(20);
    expect(ld1(a.store)).toEqual(ld1(b.store));
  });

  it("repair keeps the guaranteed degradation: dirty again from the next day, and after a restart", async () => {
    const { engine, store, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "18:00"));
    await engine.updateDevice("DOCK-SCN-02", { repair: true });
    expect(store.state?.degradationStartedAt).toBe(operatingDayStart(addDays(DAY, 1)) + 30 * MINUTE);
    await engine.restartDay();
    await engine.persist();
    expect(store.state?.degradationStartedAt).toBe(START + 30 * MINUTE);
  });

  it("after the app moves a trip to another door, its scans come from that door's scanner", async () => {
    const { engine, app, store, runUntil, trip } = await makeEngine();
    const ba = trip("BA", "outbound");
    app.doorOverrides.set(ba.id, "LD-08"); // LD-08 is free in the evening (Senica leaves in the morning)
    expect(await engine.refreshPlan()).toContain(DAY);
    await runUntil(zonedToUtc(DAY, "21:00"));
    const byDevice = (id: number) => store.scans.filter((s) => s.deviceId === id).length;
    expect(byDevice(8)).toBeGreaterThan(50);
    expect(byDevice(2)).toBe(0);
  });
});

describe("POST /sim/what-if", () => {
  async function api(): Promise<FastifyInstance> {
    return (await apiWithEngine()).server;
  }
  async function apiWithEngine(): Promise<Awaited<ReturnType<typeof makeEngine>> & { server: FastifyInstance }> {
    const made = await makeEngine();
    const server = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db: { ping: () => Promise.resolve(), close: () => Promise.resolve() } });
    await registerSimulation(server, { clock: made.clock, engine: made.engine, hub: new Hub(), verifier: new TicketVerifier(SECRET), serviceToken: SERVICE });
    return { ...made, server };
  }

  // every variant of the body schema goes through HTTP at least once (the validation broke
  // read_rate and move_trip while the engine tests passed, faza-5d-diagnoza.md)
  it("accepts every intervention kind over HTTP, alone and together", async () => {
    const { server: app, trip } = await apiWithEngine();
    const headers = { authorization: `Bearer ${await ticket("dispatcher")}` };
    const ba = trip("BA", "outbound");
    const ivs = {
      delay: { kind: "delay", tripId: trip("BA", "inbound").id, minutes: 240 },
      device_outage: { kind: "device_outage", device: "DOCK-SCN-02" },
      read_rate: { kind: "read_rate", device: "DOCK-SCN-02", rate: 0.3 },
      extra_scanner: { kind: "extra_scanner", doorCode: "LD-02" },
      move_trip: { kind: "move_trip", tripId: ba.id, doorCode: "LD-01" },
    };
    const run = (list: object[]) => app.inject({ method: "POST", url: "/sim/what-if", headers, payload: { interventions: list } });
    for (const [kind, iv] of Object.entries(ivs)) {
      const res = await run([iv]);
      expect(res.statusCode, `${kind}: ${res.body}`).toBe(200);
      const r = res.json<WhatIfResult>();
      if (kind === "delay") expect(r.affected.trips).toContain(ivs.delay.tripId);
      if (kind === "device_outage" || kind === "read_rate") {
        expect(r.affected.devices).toContain("DOCK-SCN-02");
        expect(r.scenario.unidentified).toBeGreaterThan(r.plan.unidentified);
      }
      if (kind === "extra_scanner") expect(r.affected.doors).toContain("LD-02");
      if (kind === "move_trip") expect(r.affected.doors).toEqual(expect.arrayContaining(["LD-01", ba.doorCode ?? ""]));
    }
    expect((await run(Object.values(ivs))).statusCode).toBe(200);
    // a missing required field of each kind is still rejected
    for (const payload of [
      { kind: "delay", tripId: 1 },
      { kind: "device_outage" },
      { kind: "read_rate", device: "DOCK-SCN-02" },
      { kind: "extra_scanner" },
      { kind: "move_trip", tripId: ba.id },
    ]) {
      expect((await run([payload])).statusCode, JSON.stringify(payload)).toBe(400);
    }
    await app.close();
  });

  it("dispatcher runs a scenario, security cannot, the body is validated", async () => {
    const app = await api();
    const auth = async (role: string) => ({ authorization: `Bearer ${await ticket(role)}` });
    const body = { interventions: [{ kind: "device_outage", device: "DOCK-SCN-01" }] };
    const ok = await app.inject({ method: "POST", url: "/sim/what-if", headers: await auth("dispatcher"), payload: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<WhatIfResult>().scenario.unidentified).toBeGreaterThan(0);
    expect((await app.inject({ method: "POST", url: "/sim/what-if", headers: await auth("security"), payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/sim/what-if", payload: body })).statusCode).toBe(401);
    const bad = [
      { interventions: [] },
      { interventions: [{ kind: "explode", device: "X" }] },
      { interventions: [{ kind: "read_rate", device: "DOCK-SCN-01", rate: 2 }] },
      { interventions: [{ kind: "delay", tripId: 1 }] },
    ];
    for (const payload of bad) {
      expect((await app.inject({ method: "POST", url: "/sim/what-if", headers: await auth("dispatcher"), payload })).statusCode).toBe(400);
    }
    const unknown = await app.inject({ method: "POST", url: "/sim/what-if", headers: await auth("admin"), payload: { interventions: [{ kind: "device_outage", device: "NOPE" }] } });
    expect(unknown.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/internal/plan/reload" })).statusCode).toBe(401);
    const svc = { "x-service-token": SERVICE };
    expect((await app.inject({ method: "POST", url: "/internal/plan/reload", headers: svc })).statusCode).toBe(200);
    const m = await app.inject({ method: "POST", url: "/internal/devices/DOCK-SCN-03/maintenance", headers: svc, payload: { minutes: 20 } });
    expect(m.json<{ status: string }>().status).toBe("maintenance");
    expect((await app.inject({ method: "POST", url: "/internal/devices/DOCK-SCN-03/maintenance", headers: svc, payload: { minutes: 1 } })).statusCode).toBe(400);
    await app.close();
  });
});
