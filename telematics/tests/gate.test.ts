import { describe, expect, it, vi } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { MINUTE, operatingDayStart } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
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
