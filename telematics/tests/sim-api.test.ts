import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { localHhmm, operatingDayStart } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, MemoryStore, SECRET, silentLog, ticket } from "./fixtures.js";

const SERVICE = "svc-token";

describe("simulation control API", () => {
  let app: FastifyInstance;
  let clock: SimClock;
  const hub = new Hub();

  beforeAll(async () => {
    clock = new SimClock({ simTime: operatingDayStart("2026-10-23"), speed: 60, paused: false });
    const engine = new Engine({
      clock,
      store: new MemoryStore(),
      app: new FakeApp(),
      hub,
      routes: loadRoutes(),
      log: silentLog,
      config: {
        seed: 42,
        envSeed: 42,
        forceCascade: true,
        degradedDevice: "DOCK-SCN-02",
        degradationStartedAt: null,
        degradationHours: 6,
        externalDevices: [],
        degradedThreshold: 0.92,
      },
    });
    await engine.init();
    app = await buildApp({
      logLevel: "silent",
      allowedOrigins: ["http://localhost:8000"],
      db: { ping: () => Promise.resolve(), close: () => Promise.resolve() },
    });
    await registerSimulation(app, { clock, engine, hub, verifier: new TicketVerifier(SECRET), serviceToken: SERVICE });
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = async (role: string) => ({ authorization: `Bearer ${await ticket(role)}` });

  it("the clock is public", async () => {
    const res = await app.inject({ method: "GET", url: "/sim/clock" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ operatingDay: "2026-10-23", speed: 60, seed: 42, timeZone: "Europe/Bratislava" });
  });

  it("controls require an admin ticket (or the service token)", async () => {
    expect((await app.inject({ method: "POST", url: "/sim/clock/pause" })).statusCode).toBe(401);
    const operator = await app.inject({ method: "POST", url: "/sim/clock/pause", headers: await bearer("dispatcher") });
    expect(operator.statusCode).toBe(403);
    const admin = await app.inject({ method: "POST", url: "/sim/clock/pause", headers: await bearer("admin") });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toMatchObject({ paused: true });
    const svc = await app.inject({ method: "POST", url: "/sim/clock/resume", headers: { "x-service-token": SERVICE } });
    expect(svc.json()).toMatchObject({ paused: false });
  });

  it("speed and jump are validated", async () => {
    const headers = await bearer("admin");
    expect((await app.inject({ method: "PUT", url: "/sim/clock/speed", headers, payload: { speed: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/sim/clock/speed", headers, payload: { speed: 300 } })).json()).toMatchObject({ speed: 300 });
    expect((await app.inject({ method: "POST", url: "/sim/clock/jump", headers, payload: { to: "25:00" } })).statusCode).toBe(400);
    const jump = await app.inject({ method: "POST", url: "/sim/clock/jump", headers, payload: { to: "01:00" } });
    expect(jump.statusCode).toBe(200);
    expect(localHhmm(clock.now())).toBe("01:00");
  });

  it("seed can be changed by admin and read by staff", async () => {
    const put = await app.inject({ method: "PUT", url: "/sim/seed", headers: await bearer("admin"), payload: { seed: 7 } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ seed: 7, localTime: "15:00" });
    const get = await app.inject({ method: "GET", url: "/sim/seed", headers: await bearer("dispatcher") });
    expect(get.json()).toEqual({ seed: 7 });
    expect((await app.inject({ method: "GET", url: "/sim/seed", headers: await bearer("courier") })).statusCode).toBe(403);
  });

  it("devices: list for any role, switching off for admin, ingestion with service token", async () => {
    const list = await app.inject({ method: "GET", url: "/devices", headers: await bearer("courier") });
    expect(list.json<{ devices: unknown[] }>().devices).toHaveLength(13);
    const off = await app.inject({
      method: "PUT",
      url: "/sim/devices/DOCK-SCN-05",
      headers: await bearer("admin"),
      payload: { enabled: false },
    });
    expect(off.json()).toMatchObject({ code: "DOCK-SCN-05", enabled: false });
    expect((await app.inject({ method: "PUT", url: "/sim/devices/NOPE", headers: await bearer("admin"), payload: {} })).statusCode).toBe(404);

    const scans = { events: [{ barcode: "SPS1", readOk: true }, { barcode: null, readOk: false }] };
    expect((await app.inject({ method: "POST", url: "/devices/DOCK-SCN-01/scans", payload: scans })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/devices/DOCK-SCN-01/scans", headers: { "x-service-token": SERVICE }, payload: scans });
    expect(ok.json()).toEqual({ accepted: 2 });

    // the two ingested scans show up in the read-rate sparkline (1 of 2 read)
    const metrics = await app.inject({ method: "GET", url: "/devices/DOCK-SCN-01/metrics?hours=2", headers: await bearer("security") });
    expect(metrics.statusCode).toBe(200);
    const buckets = metrics.json<{ buckets: { items: number; readRate: number | null }[] }>().buckets;
    expect(buckets.reduce((n, b) => n + b.items, 0)).toBe(2);
    expect(buckets.at(-1)?.readRate).toBe(0.5);
    expect((await app.inject({ method: "GET", url: "/devices/DOCK-SCN-01/metrics" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/devices/NOPE/metrics", headers: await bearer("admin") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/devices/DOCK-SCN-01/metrics?hours=99", headers: await bearer("admin") })).statusCode).toBe(400);
  });

  it("internal broadcast requires the service token", async () => {
    const body = { channel: "alerts", event: { message: "test" } };
    expect((await app.inject({ method: "POST", url: "/internal/broadcast", payload: body })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/internal/broadcast", headers: { "x-service-token": SERVICE }, payload: body });
    expect(ok.statusCode).toBe(200);
  });
});
