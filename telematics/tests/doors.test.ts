import { describe, expect, it } from "vitest";
import { SimClock } from "../src/clock/clock.js";
import { MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { DEVICES, FakeApp, MemoryStore, silentLog } from "./fixtures.js";
import type { DeviceRow } from "../src/db/telemetry.js";

const DAY = "2026-10-23";
const START = operatingDayStart(DAY);
const DOOR_IDS = new Set(DEVICES.filter((d) => d.kind === "door_sensor").map((d) => d.id));

async function run(until: string, withoutSensors = false) {
  const clock = new SimClock({ simTime: START, speed: 60, paused: true }, () => 0);
  const store = new MemoryStore();
  if (withoutSensors) {
    const all = await store.devices();
    store.devices = (): Promise<DeviceRow[]> => Promise.resolve(all.filter((d) => d.kind !== "door_sensor"));
  }
  const hub = new Hub();
  const events: { type: string; data: unknown }[] = [];
  const publish = hub.publish.bind(hub);
  hub.publish = (channel, type, data, key) => {
    if (channel === "devices" && type === "door") events.push({ type, data });
    publish(channel, type, data, key);
  };
  const engine = new Engine({
    clock,
    store,
    app: new FakeApp(),
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
  for (let t = START + MINUTE; t <= zonedToUtc(DAY, until); t += MINUTE) {
    clock.set(t);
    await engine.step(t);
  }
  await engine.flushTrips();
  return { engine, store, events };
}

describe("door sensors (ADR-050)", () => {
  it("report open while a truck is at the door, closed otherwise, and one fault a day", async () => {
    const { engine, events } = await run("22:30");
    const ld2 = events.filter((e) => (e.data as { doorCode: string }).doorCode === "LD-02").map((e) => (e.data as { state: string }).state);
    expect(ld2).toContain("open");
    expect(ld2).toContain("closed");
    expect(engine.doorState("LD-02", zonedToUtc(DAY, "15:10"))).toBe("closed");
    const faults = events.filter((e) => (e.data as { state: string }).state === "fault");
    expect(new Set(faults.map((e) => (e.data as { doorCode: string }).doorCode)).size).toBe(1);
  });

  it("are deterministic", async () => {
    const a = await run("21:00");
    const b = await run("21:00");
    expect(a.events).toEqual(b.events);
  });

  it("never enter scans, device metrics or read rates (KPI, ML data)", async () => {
    const { engine, store } = await run("22:30");
    expect(store.scans.some((s) => DOOR_IDS.has(s.deviceId))).toBe(false);
    expect([...store.metrics.values()].some((m) => DOOR_IDS.has(m.deviceId))).toBe(false);
    const sensors = engine.deviceList().filter((d) => d.kind === "door_sensor");
    expect(sensors).toHaveLength(8);
    expect(sensors.every((d) => d.readRate === null && d.items30m === 0)).toBe(true);
  });

  it("do not change scans or trips: their random stream is their own", async () => {
    const a = await run("21:00");
    const b = await run("21:00", true);
    expect(b.events).toEqual([]);
    expect(a.store.scans).toEqual(b.store.scans);
  });

  it("a switched-off sensor reports unknown, not its last state", async () => {
    const { engine, events } = await run("18:00");
    await engine.updateDevice("DOOR-SNS-02", { enabled: false });
    await engine.step(zonedToUtc(DAY, "18:01"));
    const last = events.filter((e) => (e.data as { device: string }).device === "DOOR-SNS-02").at(-1);
    expect((last?.data as { state: string }).state).toBe("unknown");
  });

  it("door and status events of one sensor both survive a WebSocket batch", () => {
    const hub = new Hub({ flushMs: 1_000_000 });
    const sent: string[] = [];
    hub.subscribe(hub.addClient((msg) => sent.push(msg)), ["devices"]);
    hub.publish("devices", "status", { code: "DOOR-SNS-01" }, "DOOR-SNS-01");
    hub.publish("devices", "door", { device: "DOOR-SNS-01", state: "open" }, "door:DOOR-SNS-01");
    hub.flush();
    const types = sent.flatMap((m) => (JSON.parse(m) as { events?: { type: string }[] }).events ?? []).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["status", "door"]));
  });
});
