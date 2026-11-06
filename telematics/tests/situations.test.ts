import { describe, expect, it } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { localHhmm, MINUTE, operatingDayStart } from "../src/clock/time.js";
import type { ScanRow } from "../src/db/telemetry.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { loadSituations, type Situation } from "../src/simulator/situations.js";
import type { WhatIfResult } from "../src/simulator/whatif.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, MemoryStore, SECRET, silentLog, ticket } from "./fixtures.js";

/** Phase 5d step 2 (ADR-054): named deterministic situations. */

const DAY = "2026-10-23";
const START = operatingDayStart(DAY);
const SITUATIONS = loadSituations();
const byId = (id: string): Situation => {
  const s = SITUATIONS.find((x) => x.id === id);
  if (!s) throw new Error(`no situation ${id}`);
  return s;
};

async function makeEngine(startAt = START + MINUTE) {
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
  for (let t = START + MINUTE; t <= startAt; t += MINUTE) {
    clock.set(t);
    await engine.step(t);
  }
  return { engine, clock, store, app, hub };
}

const sortedScans = (rows: ScanRow[]) => rows.map((s) => `${String(s.deviceId)}|${String(s.at)}|${s.barcode ?? "-"}|${String(s.readOk)}`).sort();
const planKpis = (engine: Engine): WhatIfResult["plan"] => {
  const out = engine.whatIf([{ kind: "device_outage", device: "DOCK-SCN-01" }]);
  if (out === null || "errors" in out) throw new Error(JSON.stringify(out));
  return out.result.plan;
};

describe("situations", () => {
  it("are defined with unique ids, valid times, and include the agreed set", () => {
    expect(SITUATIONS.map((s) => s.id)).toEqual(
      expect.arrayContaining(["evening-peak", "night-cascade", "calm-night", "morning-departures", "couriers-morning", "scanner-ld05", "off-wave"]),
    );
    for (const s of SITUATIONS) expect(s.name.length).toBeGreaterThan(3);
  });

  it("the same situation always gives the same numbers (fresh engines and a reused one)", async () => {
    const a = await makeEngine();
    const ra = await a.engine.loadSituation(byId("evening-peak"));
    const b = await makeEngine(START + 4 * 60 * MINUTE); // another engine that already ran 4 h
    await b.engine.setSeed(7);
    const rb = await b.engine.loadSituation(byId("evening-peak"));
    expect(localHhmm(a.clock.now())).toBe("18:30");
    expect(b.clock.now()).toBe(a.clock.now());
    expect(rb.scans).toBe(ra.scans);
    expect(sortedScans(b.store.scans)).toEqual(sortedScans(a.store.scans));
    expect(b.app.scans).toEqual(a.app.scans);
    expect(planKpis(b.engine)).toEqual(planKpis(a.engine));
    // loading it again on the same engine: still the same
    await a.engine.loadSituation(byId("evening-peak"));
    expect(sortedScans(a.store.scans)).toEqual(sortedScans(b.store.scans));
  });

  it("calm-night has no cascade in the plan, night-cascade has one", async () => {
    const calm = await makeEngine();
    await calm.engine.loadSituation(byId("calm-night"));
    expect(localHhmm(calm.clock.now())).toBe("23:30");
    expect(planKpis(calm.engine).cascadeWarnings).toBe(0);
    const night = await makeEngine();
    await night.engine.loadSituation(byId("night-cascade"));
    expect(localHhmm(night.clock.now())).toBe("02:10");
    expect(planKpis(night.engine).cascadeWarnings).toBeGreaterThan(0);
  });

  it("keeps its switches in sim_state until a clean reset", async () => {
    const { engine, store } = await makeEngine();
    await engine.loadSituation(byId("scanner-ld05"));
    expect(engine.clockInfo().situation).toBe("scanner-ld05");
    const saved = await store.loadSimState();
    expect(saved).toMatchObject({ situation: "scanner-ld05", degradedDevice: "DOCK-SCN-05", forceCascade: true });
    await engine.cleanReset();
    expect(engine.clockInfo().situation).toBeNull();
    expect(await store.loadSimState()).toMatchObject({ situation: null, degradedDevice: "DOCK-SCN-02", forceCascade: null });
  });

  it("over HTTP: staff lists them, the admin loads one, unknown id 404", async () => {
    const made = await makeEngine();
    const server = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db: { ping: () => Promise.resolve(), close: () => Promise.resolve() } });
    await registerSimulation(server, { clock: made.clock, engine: made.engine, hub: made.hub, verifier: new TicketVerifier(SECRET), serviceToken: "svc" });
    const as = async (role: string) => ({ authorization: `Bearer ${await ticket(role)}` });
    const list = await server.inject({ method: "GET", url: "/sim/situations", headers: await as("dispatcher") });
    expect(list.statusCode).toBe(200);
    expect(list.json<Situation[]>().find((s) => s.id === "calm-night")?.forceCascade).toBe(false);
    expect((await server.inject({ method: "POST", url: "/sim/situations/evening-peak", headers: await as("dispatcher") })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: "/sim/situations/nope", headers: await as("admin") })).statusCode).toBe(404);
    const res = await server.inject({ method: "POST", url: "/sim/situations/off-wave", headers: await as("admin") });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ localTime: string; situation: string; replay: { minutes: number } }>()).toMatchObject({ localTime: "10:00", situation: "off-wave", replay: { minutes: 19 * 60 } });
    await server.close();
  });
});
