import { describe, expect, it } from "vitest";
import { SimClock } from "../src/clock/clock.js";
import { HOUR, MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { buildScenario } from "../src/simulator/scenario.js";
import { activeWindow } from "../src/simulator/trips.js";
import { addDays } from "../src/clock/time.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { FakeApp, MemoryStore, silentLog } from "./fixtures.js";

const DAY = "2026-10-23";
const START = operatingDayStart(DAY);

async function makeEngine(seed = 42) {
  let real = 0;
  const clock = new SimClock({ simTime: START, speed: 60, paused: true }, () => real);
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
    realNow: () => real,
    config: {
      seed,
      envSeed: seed,
      forceCascade: true,
      degradedDevice: "DOCK-SCN-02",
      degradationStartedAt: START + 30 * MINUTE,
      degradationHours: 6,
      externalDevices: [],
      degradedThreshold: 0.92,
    },
  });
  await engine.init();
  /** advance simulated time in 1-minute steps (like ticks), real time stays put */
  const runUntil = async (until: number, stepMs = MINUTE): Promise<void> => {
    for (let t = clock.now() + stepMs; t <= until; t += stepMs) {
      clock.set(t);
      await engine.step(t);
      await engine.flushTrips();
    }
  };
  return { engine, clock, store, app, hub, runUntil, advanceReal: (ms: number) => (real += ms) };
}

describe("simulation engine", () => {
  it("replays the evening wave: trips go to the app, scans go to db-telemetry", async () => {
    const { store, app, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "22:30"));

    const latest = app.latest();
    const statuses = [...latest.values()].map((t) => t.status);
    expect(statuses).toContain("departed"); // linehaul trucks left
    expect(statuses).toContain("completed"); // regional trucks unloaded
    expect(store.scans.length).toBeGreaterThan(400);
    expect(store.gate.some((g) => g.direction === "out" && g.vehicleType === "truck")).toBe(true);
    expect(store.gps.length).toBeGreaterThan(50);
    expect(store.sensors.length).toBeGreaterThan(100);
    expect(store.metrics.size).toBeGreaterThan(100);
  });

  it("the degraded scanner's read rate drops through the evening (ML input)", async () => {
    const { store, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "21:30"));
    const ba = [...store.metrics.values()].filter((m) => m.deviceId === 2);
    const rate = (from: string, to: string): number => {
      const rows = ba.filter((m) => m.minute >= zonedToUtc(DAY, from) && m.minute < zonedToUtc(DAY, to));
      return rows.reduce((s, m) => s + m.readsOk, 0) / rows.reduce((s, m) => s + m.items, 0);
    };
    expect(rate("17:00", "18:30")).toBeGreaterThan(rate("19:45", "21:15") + 0.03);
  });

  it("reports the late night truck's ETA as soon as it breaks down (cascade input for the app)", async () => {
    const { engine, app, runUntil } = await makeEngine();
    const summary = engine.scenarioSummary();
    await runUntil(zonedToUtc("2026-10-24", "03:00"), 5 * MINUTE);
    const [day] = engine.scenarioSummary() as { incident: { tripId: number; arrival: string } }[];
    expect(summary).toHaveLength(0); // nothing loaded before the first step
    const incident = day?.incident;
    expect(incident).toBeTruthy();
    const etas = app.tripEvents
      .flatMap((b) => b.trips)
      .filter((t) => t.tripId === incident?.tripId && t.predictedArrival !== null)
      .map((t) => t.predictedArrival);
    expect(etas.at(-1)).toBe(incident?.arrival);
    expect(new Set(etas).size).toBeGreaterThanOrEqual(2); // normal ETA, then the late one
  });

  it("is deterministic: the same seed produces the same telemetry", async () => {
    const a = await makeEngine(42);
    const b = await makeEngine(42);
    const c = await makeEngine(43);
    const until = zonedToUtc(DAY, "19:00");
    await a.runUntil(until);
    await b.runUntil(until, 3 * MINUTE); // different tick size, same result
    await c.runUntil(until);
    const key = (s: MemoryStore): string => JSON.stringify(s.scans.map((x) => [x.deviceId, x.at, x.barcode]));
    expect(key(a.store)).toBe(key(b.store));
    expect(key(a.store)).not.toBe(key(c.store));
  });

  it("jumping the clock fast-forwards states without generating the skipped scans", async () => {
    const { clock, engine, store, app } = await makeEngine();
    await engine.step(clock.now());
    const target = clock.jumpTo("01:00");
    await engine.step(target);
    await engine.flushTrips();
    expect(store.scans).toHaveLength(0);
    const departed = [...app.latest().values()].filter((t) => t.status === "departed" || t.status === "completed");
    expect(departed.length).toBeGreaterThanOrEqual(3);
  });

  it("a switched-off device goes offline after 30 s and raises an alert; back on resolves it", async () => {
    const { engine, app, advanceReal } = await makeEngine();
    await engine.updateDevice("DOCK-SCN-03", { enabled: false });
    advanceReal(31_000);
    await engine.heartbeats();
    await engine.monitorDevices();
    expect(engine.deviceList().find((d) => d.code === "DOCK-SCN-03")?.status).toBe("offline");
    expect(engine.deviceList().find((d) => d.code === "DOCK-SCN-04")?.status).toBe("online");
    expect(app.alerts.at(-1)).toMatchObject({ kind: "device_offline", refId: "DOCK-SCN-03", resolved: false });

    await engine.updateDevice("DOCK-SCN-03", { enabled: true });
    expect(app.alerts.at(-1)).toMatchObject({ refId: "DOCK-SCN-03", resolved: true });
  });

  it("a new seed restarts the operating day from 15:00 with a different scenario", async () => {
    const { engine, clock, store, app, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "18:00"));
    expect(store.scans.length).toBeGreaterThan(0);
    await engine.setSeed(7);
    expect(clock.now()).toBe(START);
    expect(store.scans).toHaveLength(0);
    expect(engine.clockInfo().seed).toBe(7);
    expect(app.resets).toEqual([DAY]); // the app undid the day as well
  });

  it("keeps retrying when the app is down and catches up afterwards", async () => {
    const { engine, clock, app, advanceReal } = await makeEngine();
    app.down = true;
    await engine.step(clock.now() + MINUTE);
    expect(engine.scenarioSummary()).toHaveLength(0);
    app.down = false;
    advanceReal(6000);
    await engine.step(clock.now() + 2 * MINUTE);
    await engine.flushTrips();
    expect(engine.scenarioSummary()).toHaveLength(1);
    expect(app.latest().size).toBe(16);
  });

  it("vehicles drive along their routes", async () => {
    const { engine, store, app, runUntil } = await makeEngine();
    await runUntil(START + 4 * HOUR);
    // the Senica truck returning in the afternoon (which of the two depends on the day)
    const plate = app.planFor(DAY).trips.find((t) => t.directionCode === "SE" && t.kind === "inbound")?.vehiclePlate;
    const positions = store.gps.filter((g) => g.plate === plate);
    expect(positions.length).toBeGreaterThan(5);
    expect(new Set(positions.map((p) => p.lon.toFixed(2))).size).toBeGreaterThan(3);
    expect(engine.deviceList()).toHaveLength(13);
  });

  it("forwards dock and line scans to the app, trips first", async () => {
    const { app, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "19:00"));
    const dock = app.scans.filter((s) => s.doorCode !== null);
    expect(dock.length).toBeGreaterThan(100);
    expect(dock.every((s) => s.doorCode?.startsWith("LD-"))).toBe(true);
    expect(dock.some((s) => s.barcode === null && !s.readOk)).toBe(true); // counted, unread
    expect(app.calls.indexOf("trips")).toBeLessThan(app.calls.indexOf("scans"));
  });

  it("keeps scans while the app is down and delivers them later", async () => {
    const { app, engine, runUntil } = await makeEngine();
    await runUntil(zonedToUtc(DAY, "17:30"));
    const before = app.scans.length;
    app.down = true;
    await runUntil(zonedToUtc(DAY, "18:00"));
    expect(app.scans.length).toBe(before);
    app.down = false;
    await engine.flushTrips();
    expect(app.scans.length).toBeGreaterThan(before);
  });

  it("parcels of a night truck reach the belt only after the truck arrived", async () => {
    const { engine, app, runUntil } = await makeEngine();
    await runUntil(zonedToUtc("2026-10-24", "07:00"), 5 * MINUTE);
    const [day] = engine.scenarioSummary() as { incident: { direction: string; arrival: string } }[];
    const arrival = Date.parse(day?.incident.arrival ?? "");
    const late = app.scans.filter((s) => s.doorCode === null && s.barcode?.includes(`-${day?.incident.direction ?? ""}-`));
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((s) => Date.parse(s.at) >= arrival + 10 * MINUTE)).toBe(true);
  });
});

describe("vehicle rotation", () => {
  it("no truck is on two trips at the same time across consecutive days (Senica rotation)", () => {
    const app = new FakeApp();
    const routes = loadRoutes();
    const windows = new Map<string, [number, number][]>();
    for (const day of [DAY, addDays(DAY, 1), addDays(DAY, 2)]) {
      const scenario = buildScenario(app.planFor(day), { seed: 42, forceCascade: true, routes });
      for (const s of scenario.schedules.values()) {
        const list = windows.get(s.trip.vehiclePlate) ?? [];
        list.push(activeWindow(s));
        windows.set(s.trip.vehiclePlate, list);
      }
    }
    expect(windows.has("KE-206TR")).toBe(true);
    for (const [plate, list] of windows) {
      list.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < list.length; i++) {
        expect((list[i] as [number, number])[0], plate).toBeGreaterThanOrEqual((list[i - 1] as [number, number])[1]);
      }
    }
  });
});
