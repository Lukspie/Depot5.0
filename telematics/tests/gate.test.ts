import { describe, expect, it, vi } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { addDays, MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { ALLOWED_EXTERNAL } from "../src/simulator/gatemix.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, MemoryStore, SECRET, silentLog } from "./fixtures.js";

/** A real gate camera passage from the app (phase 6, ADR-059). */

const START = operatingDayStart("2026-10-23");

describe("POST /internal/gate/passages", () => {
  it("stores and broadcasts a camera passage at the simulated time, service token only", async () => {
    const clock = new SimClock({ simTime: START + 90 * MINUTE, speed: 60, paused: true }, () => 0);
    const store = new MemoryStore();
    const hub = new Hub();
    const engine = new Engine({
      clock,
      store,
      app: new FakeApp(),
      hub,
      routes: loadRoutes(),
      log: silentLog,
      realNow: () => 0,
      config: { seed: 42, envSeed: 42, forceCascade: true, degradedDevice: null, degradationStartedAt: null, degradationHours: 6, externalDevices: [], degradedThreshold: 0.92 },
    });
    await engine.init();
    const server = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db: { ping: () => Promise.resolve(), close: () => Promise.resolve() } });
    await registerSimulation(server, { clock, engine, hub, verifier: new TicketVerifier(SECRET), serviceToken: "svc" });
    const publish = vi.spyOn(hub, "publish");
    const body = { direction: "in", vehicleType: "truck", plate: "KE-102LH", plateConfidence: 0.95, expected: true };

    expect((await server.inject({ method: "POST", url: "/internal/gate/passages", payload: body })).statusCode).toBe(401);
    const bad = await server.inject({ method: "POST", url: "/internal/gate/passages", headers: { "x-service-token": "svc" }, payload: { ...body, vehicleType: "ufo" } });
    expect(bad.statusCode).toBe(400);
    const res = await server.inject({ method: "POST", url: "/internal/gate/passages", headers: { "x-service-token": "svc" }, payload: body });
    expect(res.statusCode, res.body).toBe(200);
    expect(store.gate).toEqual([expect.objectContaining({ at: START + 90 * MINUTE, plate: "KE-102LH", vehicleType: "truck", expected: true })]);
    expect(publish).toHaveBeenCalledWith("devices", "gate_passage", expect.objectContaining({ plate: "KE-102LH", device: "GATE-CAM-01" }));
    await server.close();
  });
});

const CONFIG = { seed: 42, envSeed: 42, forceCascade: true, degradedDevice: null, degradationStartedAt: null, degradationHours: 6, externalDevices: [], degradedThreshold: 0.92 };

/** Run one operating day minute by minute and return what went to the app. */
async function runDay(): Promise<{ app: FakeApp; engine: Engine; clock: SimClock }> {
  const clock = new SimClock({ simTime: START, speed: 60, paused: true }, () => 0);
  const app = new FakeApp();
  const engine = new Engine({ clock, store: new MemoryStore(), app, hub: new Hub(), routes: loadRoutes(), log: silentLog, realNow: () => 0, config: CONFIG });
  await engine.init();
  const until = zonedToUtc(addDays("2026-10-23", 1), "14:30");
  for (let t = START + MINUTE; t <= until; t += MINUTE) {
    clock.set(t);
    await engine.step(t);
  }
  await engine.flushTrips();
  return { app, engine, clock };
}

describe("gate mix -> app decisions (ADR-061)", () => {
  it("sends trucks, courier vans out and back and an allowed external vehicle, deterministically", async () => {
    const { app, engine } = await runDay();
    const vans = app.gate.filter((g) => g.vehicleType === "van" && /^KE-3\d\dKR$/.test(g.plate ?? ""));
    // makeCourierPlan has 2 routes: each van leaves in the morning and comes back
    expect(vans.map((g) => g.direction).sort()).toEqual(["in", "in", "out", "out"]);
    expect(app.gate.filter((g) => g.vehicleType === "truck").length).toBeGreaterThan(10);
    const ext = app.gate.filter((g) => ALLOWED_EXTERNAL.some((a) => a.plate === g.plate));
    expect(ext.map((g) => g.direction)).toEqual(["in", "out"]);
    expect(app.gate.every((g) => g.vehicleConfidence !== null && g.vehicleConfidence >= 0 && g.vehicleConfidence <= 1)).toBe(true);
    expect(new Set(app.gate.map((g) => g.key)).size).toBe(app.gate.length);

    // a camera passage is decided by the app already: not sent back
    const before = app.gate.length;
    await engine.recordGatePassage({ direction: "in", vehicleType: "car", plate: "ZA-999XY", plateConfidence: 0.9, expected: false });
    await engine.flushTrips();
    expect(app.gate).toHaveLength(before);

    const again = await runDay();
    expect(again.app.gate.slice(0, before)).toEqual(app.gate);
  });

  it("after a restart sends the passages of the day again (the app skips duplicates by key)", async () => {
    const now = START + 8 * 60 * MINUTE;
    const clock = new SimClock({ simTime: now, speed: 60, paused: true }, () => 0);
    const app = new FakeApp();
    const engine = new Engine({ clock, store: new MemoryStore(), app, hub: new Hub(), routes: loadRoutes(), log: silentLog, realNow: () => 0, config: CONFIG });
    await engine.init();
    await engine.step(now);
    await engine.flushTrips();
    expect(app.gate.length).toBeGreaterThan(5);
    expect(app.gate.every((g) => Date.parse(g.at) <= now)).toBe(true);
  });
});
