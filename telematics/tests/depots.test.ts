/**
 * Operations of a depot besides Budimír (phase 7c, ADR-065): the couriers of Žilina park and load
 * in the Žilina yard and drive their rounds from there, the Žilina gate sees the ZA truck and the
 * vans, and Budimír's gate stays as it was.
 */

import { describe, expect, it } from "vitest";
import type { CourierPlan } from "../src/simulator/couriers.js";
import { SimClock } from "../src/clock/clock.js";
import { addDays, MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { FakeApp, MemoryStore, silentLog } from "./fixtures.js";

const DAY = "2026-10-23";
const NEXT = addDays(DAY, 1);
const ZIL = { code: "ZIL", name: "Žilina", lat: 49.187248, lon: 18.84926 };
const PARKING: [number, number] = [49.18756, 18.84877];
const LOADING: [number, number] = [49.18709, 18.84869];
const CONFIG = { seed: 42, envSeed: 42, forceCascade: true, degradedDevice: null, degradationStartedAt: null, degradationHours: 6, externalDevices: [], degradedThreshold: 0.92 };

/** Budimír's two routes plus one round of Žilina; ZA ends in Žilina. */
class TwoDepotApp extends FakeApp {
  withZilina = true;
  override getPlan(day: string) {
    return super.getPlan(day).then((p) => ({ ...p, destinationDepots: this.withZilina ? { BA: "BAH", ZA: "ZIL" } : { BA: "BAH" } }));
  }
  override getCourierRoutes(day: string): Promise<CourierPlan> {
    return super.getCourierRoutes(day).then((plan) => {
      if (!this.withZilina || day !== DAY) return plan;
      const zil = {
        routeId: 900,
        date: NEXT,
        vehiclePlate: "ZA-301KR",
        courierUsername: "kurierza01",
        districtCode: "ZA-01",
        stagingBay: "ZI-SB01",
        depot: ZIL,
        parking: PARKING,
        loading: LOADING,
        stops: Array.from({ length: 6 }, (_, i) => ({ stopId: 9000 + i, sequence: i + 1, barcode: `DP-ZA-${String(i)}`, lat: 49.225 + i * 0.002, lon: 18.74 + i * 0.002 })),
      };
      return { ...plan, routes: [...plan.routes, zil] };
    });
  }
}

async function runMorning(app: TwoDepotApp): Promise<Engine> {
  const clock = new SimClock({ simTime: operatingDayStart(DAY), speed: 60, paused: true }, () => 0);
  const engine = new Engine({ clock, store: new MemoryStore(), app, hub: new Hub(), routes: loadRoutes(), log: silentLog, realNow: () => 0, config: CONFIG });
  await engine.init();
  for (let t = operatingDayStart(DAY) + MINUTE; t <= zonedToUtc(NEXT, "06:20"); t += MINUTE) {
    clock.set(t);
    await engine.step(t);
  }
  expect(engine.vehicleNow("ZA-301KR")).toMatchObject({ status: "parked", lat: PARKING[0], lon: PARKING[1], doorCode: "ZI-SB01" });
  for (let t = zonedToUtc(NEXT, "06:21"); t <= zonedToUtc(NEXT, "12:00"); t += MINUTE) {
    clock.set(t);
    await engine.step(t);
    if (t === zonedToUtc(NEXT, "06:50")) expect(engine.vehicleNow("ZA-301KR")).toMatchObject({ status: "loading", lat: LOADING[0], lon: LOADING[1] });
  }
  await engine.flushTrips();
  return engine;
}

describe("phase 7c: a second depot with its own couriers and gate", () => {
  it("Žilina vans park, load and leave from the Žilina yard; the gate of Žilina sees them and the ZA truck", async () => {
    const app = new TwoDepotApp();
    await runMorning(app);
    const zil = app.gate.filter((g) => g.depot === "ZIL");
    const bud = app.gate.filter((g) => g.depot === undefined);
    // the van left in the morning through the Žilina gate, not through Budimír's
    expect(zil.some((g) => g.plate === "ZA-301KR" && g.direction === "out")).toBe(true);
    expect(bud.some((g) => g.plate === "ZA-301KR")).toBe(false);
    // the evening ZA truck came in at Žilina
    expect(zil.some((g) => g.vehicleType === "truck" && g.direction === "in")).toBe(true);
    // the hub in Ivanka has its own gate too: the evening BA truck comes in there (ADR-066)
    const bah = app.gate.filter((g) => g.depot === "BAH");
    expect(bah.some((g) => g.vehicleType === "truck" && g.direction === "in")).toBe(true);
    expect(app.courierEvents.some((e) => e.routeId === 900 && e.kind === "departed")).toBe(true);
    expect(new Set(app.gate.map((g) => g.key)).size).toBe(app.gate.length);

    // Budimír's gate is the same with or without Žilina (its own random stream)
    const alone = new TwoDepotApp();
    alone.withZilina = false;
    await runMorning2(alone);
    const strip = (g: (typeof app.gate)[number]) => ({ ...g });
    expect(alone.gate.filter((g) => g.depot === undefined).map(strip)).toEqual(bud.map(strip));

    // routes of other depots take ids, so Budimír's routes get others on the next days: its van
    // passages are keyed by the district and do not change
    const shifted = new TwoDepotApp();
    shifted.withZilina = false;
    const plan = shifted.getCourierRoutes.bind(shifted);
    shifted.getCourierRoutes = (day: string) => plan(day).then((p) => ({ ...p, routes: p.routes.map((r) => ({ ...r, routeId: r.routeId + 1000 })) }));
    await runMorning2(shifted);
    expect(shifted.gate.filter((g) => g.depot === undefined).map(strip)).toEqual(bud.map(strip));
  }, 90_000);
});

/** The same morning without asserting Žilina's van (it does not exist there). */
async function runMorning2(app: TwoDepotApp): Promise<void> {
  const clock = new SimClock({ simTime: operatingDayStart(DAY), speed: 60, paused: true }, () => 0);
  const engine = new Engine({ clock, store: new MemoryStore(), app, hub: new Hub(), routes: loadRoutes(), log: silentLog, realNow: () => 0, config: CONFIG });
  await engine.init();
  for (let t = operatingDayStart(DAY) + MINUTE; t <= zonedToUtc(NEXT, "12:00"); t += MINUTE) {
    clock.set(t);
    await engine.step(t);
  }
  await engine.flushTrips();
}
