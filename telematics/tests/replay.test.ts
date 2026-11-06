import { describe, expect, it, vi } from "vitest";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { HOUR, MINUTE, operatingDayStart } from "../src/clock/time.js";
import type { ScanRow } from "../src/db/telemetry.js";
import { Engine, ReplayBusyError, type AdvanceResult } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, MemoryStore, SECRET, silentLog, ticket } from "./fixtures.js";

/** Phase 5d step 1 (ADR-053): replay, "+N min" step, clean reset, SIM_CONTROLS_ENABLED. */

const DAY = "2026-10-23";
const START = operatingDayStart(DAY);
const SERVICE = "svc";

async function makeEngine(opts: { controlsEnabled?: boolean } = {}) {
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
      controlsEnabled: opts.controlsEnabled ?? true,
    },
  });
  await engine.init();
  /** the live clock: one tick per simulated minute */
  const runUntil = async (until: number): Promise<void> => {
    for (let t = clock.now() + MINUTE; t <= until; t += MINUTE) {
      clock.set(t);
      await engine.step(t);
    }
  };
  await runUntil(START + MINUTE);
  return { engine, clock, store, app, hub, runUntil };
}

async function makeApi(opts: { controlsEnabled?: boolean } = {}) {
  const made = await makeEngine(opts);
  const server = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db: { ping: () => Promise.resolve(), close: () => Promise.resolve() } });
  await registerSimulation(server, {
    clock: made.clock,
    engine: made.engine,
    hub: made.hub,
    verifier: new TicketVerifier(SECRET),
    serviceToken: SERVICE,
    controlsEnabled: opts.controlsEnabled ?? true,
  });
  return { ...made, server, headers: { authorization: `Bearer ${await ticket("admin")}` } };
}

const scanKey = (s: ScanRow) => `${String(s.deviceId)}|${String(s.at)}|${s.barcode ?? "-"}|${String(s.readOk)}`;
const sortedScans = (rows: ScanRow[]) => rows.map(scanKey).sort();
/** the last state of every trip the app was told about */
const lastTrips = (app: FakeApp) => {
  const out = new Map<number, string>();
  for (const batch of app.tripEvents) for (const t of batch.trips) out.set(t.tripId, t.status);
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
};

describe("replay (advance)", () => {
  it("gives the same scans, app data and trip states as the live clock", async () => {
    const live = await makeEngine();
    await live.runUntil(START + 6 * HOUR);
    await live.engine.flushTrips();

    const fast = await makeEngine();
    const r = await fast.engine.advance(START + 6 * HOUR);

    expect(live.store.scans.length).toBeGreaterThan(500);
    expect(sortedScans(fast.store.scans)).toEqual(sortedScans(live.store.scans));
    expect(fast.app.scans).toEqual(live.app.scans);
    expect(lastTrips(fast.app)).toEqual(lastTrips(live.app));
    expect(fast.store.gate.length).toBe(live.store.gate.length);
    expect(r).toMatchObject({ minutes: 359, scans: fast.app.scans.length });
    expect(fast.clock.now()).toBe(START + 6 * HOUR);
    // trips and scans went to the app in several rounds during the replay, trips first
    expect(fast.app.calls.filter((c) => c === "scans").length).toBeGreaterThan(5);
    expect(fast.app.calls[0]).toBe("trips");
  });

  it("batches the telemetry writes (Azure latency, ADR-056): one write per sync, not per minute", async () => {
    const { engine, store } = await makeEngine();
    const scans = vi.spyOn(store, "insertScans");
    const metrics = vi.spyOn(store, "upsertMetrics");
    await engine.advance(START + 6 * HOUR);
    // 359 simulated minutes, a sync every 10 minutes plus the final flush
    expect(scans.mock.calls.length).toBeLessThanOrEqual(37);
    expect(store.scans.length).toBeGreaterThan(500);
    // the buffer merged the minute counters: no (device, minute) twice in one upsert
    for (const [rows] of metrics.mock.calls) {
      const keys = rows.map((r) => `${String(r.deviceId)}|${String(r.minute)}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("does not broadcast single scans, keeps the clock paused or running as before", async () => {
    const { engine, clock, hub } = await makeEngine();
    const publish = vi.spyOn(hub, "publish");
    await engine.advance(START + 2 * HOUR);
    expect(publish.mock.calls.filter((c) => c[1] === "scan").length).toBe(0);
    expect(publish.mock.calls.some((c) => c[0] === "clock")).toBe(true);
    expect(clock.state().paused).toBe(true);
    clock.resume();
    await engine.advance(clock.now() + 10 * MINUTE);
    expect(clock.state().paused).toBe(false);
  });

  it("refuses a second replay while one is running", async () => {
    const { engine } = await makeEngine();
    const first = engine.advance(START + 2 * HOUR);
    await expect(engine.advance(START + 3 * HOUR)).rejects.toBeInstanceOf(ReplayBusyError);
    await first;
  });
});

describe("clock control API", () => {
  it("step 60 and jump in replay mode 60 min ahead are the same code and give the same scans", async () => {
    const a = await makeApi();
    const b = await makeApi();
    // START is 15:00 local, the engines are at 15:01
    const step = await a.server.inject({ method: "POST", url: "/sim/clock/step", headers: a.headers, payload: { minutes: 60 } });
    const jump = await b.server.inject({ method: "POST", url: "/sim/clock/jump", headers: b.headers, payload: { to: "16:01", mode: "replay" } });
    expect(step.statusCode, step.body).toBe(200);
    expect(jump.statusCode, jump.body).toBe(200);
    const rs = step.json<{ localTime: string; replay: AdvanceResult }>();
    const rj = jump.json<{ localTime: string; replay: AdvanceResult }>();
    expect(rs.localTime).toBe("16:01");
    expect(rj.localTime).toBe("16:01");
    expect(rs.replay.minutes).toBe(60);
    expect(rj.replay).toEqual({ ...rs.replay, ms: rj.replay.ms, stepMs: rj.replay.stepMs, syncMs: rj.replay.syncMs });
    expect(sortedScans(b.store.scans)).toEqual(sortedScans(a.store.scans));
    expect(b.app.scans).toEqual(a.app.scans);
    await a.server.close();
    await b.server.close();
  });

  it("jump without a mode still skips the interval (no data, ADR-025)", async () => {
    const { server, headers, store } = await makeApi();
    const res = await server.inject({ method: "POST", url: "/sim/clock/jump", headers, payload: { to: "18:30" } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ localTime: string }>().localTime).toBe("18:30");
    expect(store.scans.length).toBe(0);
    const bad = await server.inject({ method: "POST", url: "/sim/clock/jump", headers, payload: { to: "18:30", mode: "rewind" } });
    expect(bad.statusCode).toBe(400);
    const tooLong = await server.inject({ method: "POST", url: "/sim/clock/step", headers, payload: { minutes: 24 * 60 + 1 } });
    expect(tooLong.statusCode).toBe(400);
    await server.close();
  });

  it("answers 409 to clock changes while a replay runs", async () => {
    const { server, headers, engine, app } = await makeApi();
    // hold the replay at its first sync to the app until the checks are done
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    const original = app.postTripEvents.bind(app);
    vi.spyOn(app, "postTripEvents").mockImplementation(async (simTime, trips) => {
      await held;
      return original(simTime, trips);
    });
    const running = engine.advance(START + 2 * HOUR);
    for (const [url, payload] of [
      ["/sim/clock/step", { minutes: 5 }],
      ["/sim/clock/jump", { to: "20:00" }],
      ["/sim/reset", undefined],
      ["/sim/restart-day", undefined],
    ] as const) {
      const res = await server.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) });
      expect(res.statusCode, url).toBe(409);
    }
    release();
    await running;
    await server.close();
  });

  it("SIM_CONTROLS_ENABLED=false: every control endpoint answers 403, the clock says so, what-if still works", async () => {
    const { server, headers } = await makeApi({ controlsEnabled: false });
    const calls: [string, string, object | undefined][] = [
      ["POST", "/sim/clock/pause", undefined],
      ["POST", "/sim/clock/resume", undefined],
      ["PUT", "/sim/clock/speed", { speed: 120 }],
      ["POST", "/sim/clock/jump", { to: "18:00" }],
      ["POST", "/sim/clock/step", { minutes: 5 }],
      ["PUT", "/sim/seed", { seed: 7 }],
      ["POST", "/sim/restart-day", undefined],
      ["POST", "/sim/reset", undefined],
      ["PUT", "/sim/devices/DOCK-SCN-01", { enabled: false }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await server.inject({ method: method as "POST" | "PUT", url, headers, ...(payload ? { payload } : {}) });
      expect(res.statusCode, url).toBe(403);
      // a service token does not get past the switch either
      const svc = await server.inject({ method: method as "POST" | "PUT", url, headers: { "x-service-token": SERVICE }, ...(payload ? { payload } : {}) });
      expect(svc.statusCode, url).toBe(403);
    }
    const clockInfo = await server.inject({ method: "GET", url: "/sim/clock" });
    expect(clockInfo.json<{ controlsEnabled: boolean }>().controlsEnabled).toBe(false);
    const whatIf = await server.inject({
      method: "POST",
      url: "/sim/what-if",
      headers: { authorization: `Bearer ${await ticket("dispatcher")}` },
      payload: { interventions: [{ kind: "device_outage", device: "DOCK-SCN-01" }] },
    });
    expect(whatIf.statusCode).toBe(200);
    await server.close();
  });
});

describe("clean reset", () => {
  it("undoes seed, switched-off devices and maintenance: the day replays like a clean engine", async () => {
    const used = await makeEngine();
    await used.engine.setSeed(7);
    await used.engine.advance(START + 90 * MINUTE);
    await used.engine.updateDevice("DOCK-SCN-03", { enabled: false });
    await used.engine.startMaintenance("DOCK-SCN-01", 120);
    await used.engine.cleanReset();
    expect(used.engine.seed).toBe(42);
    expect(used.app.cleanResets).toEqual([DAY]);
    expect(used.engine.deviceList().find((d) => d.code === "DOCK-SCN-03")?.enabled).toBe(true);
    expect(used.clock.now()).toBe(START);
    await used.engine.advance(START + 3 * HOUR);

    const clean = await makeEngine();
    await clean.engine.advance(START + 3 * HOUR);
    expect(sortedScans(used.store.scans)).toEqual(sortedScans(clean.store.scans));
  });

  it("is reachable over HTTP for the admin only", async () => {
    const { server, app } = await makeApi();
    const dispatcher = await server.inject({ method: "POST", url: "/sim/reset", headers: { authorization: `Bearer ${await ticket("dispatcher")}` } });
    expect(dispatcher.statusCode).toBe(403);
    const res = await server.inject({ method: "POST", url: "/sim/reset", headers: { authorization: `Bearer ${await ticket("admin")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ localTime: string; seed: number }>()).toMatchObject({ localTime: "15:00", seed: 42 });
    expect(app.cleanResets).toEqual([DAY]);
    await server.close();
  });
});
