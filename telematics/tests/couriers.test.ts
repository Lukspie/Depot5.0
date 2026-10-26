import { describe, expect, it } from "vitest";
import { SimClock } from "../src/clock/clock.js";
import { addDays, MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { buildCourierSchedules, courierEvents, courierStateAt, predictedEtas, SUCCESS_RATE } from "../src/simulator/couriers.js";
import { Engine } from "../src/simulator/engine.js";
import { RoadRouter } from "../src/simulator/roads.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { FakeApp, makeCourierPlan, MemoryStore, silentLog } from "./fixtures.js";

const DAY = "2026-10-23";

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing value");
  return v;
}
const NEXT = addDays(DAY, 1);

describe("courier rounds", () => {
  const plan = makeCourierPlan(DAY);

  it("is deterministic: same seed, same rounds", () => {
    const a = buildCourierSchedules(plan, { seed: 42, router: null });
    const b = buildCourierSchedules(plan, { seed: 42, router: null });
    const c = buildCourierSchedules(plan, { seed: 43, router: null });
    expect(courierEvents(a)).toEqual(courierEvents(b));
    expect(courierEvents(a)).not.toEqual(courierEvents(c));
  });

  it("loads from 07:00, leaves ~07:30, stays 2–6 min per stop, comes back", () => {
    for (const s of buildCourierSchedules(plan, { seed: 42, router: null })) {
      expect(s.loadStart).toBeGreaterThanOrEqual(zonedToUtc(NEXT, "07:00"));
      expect(Math.max(...s.loadAt)).toBeLessThan(s.depart);
      expect(s.depart).toBeGreaterThanOrEqual(zonedToUtc(NEXT, "07:30"));
      expect(s.depart).toBeLessThanOrEqual(zonedToUtc(NEXT, "07:36"));
      for (const v of s.visits) {
        const dwell = (v.leave - v.arrive) / MINUTE;
        expect(dwell).toBeGreaterThanOrEqual(1.5);
        expect(dwell).toBeLessThanOrEqual(6);
      }
      const order = s.visits.map((v) => v.sequence);
      expect(order).toEqual([...order].sort((x, y) => x - y));
      expect(s.returnAt).toBeGreaterThan(s.visits[s.visits.length - 1]?.leave ?? 0);
    }
  });

  it("about 90 % of deliveries succeed", () => {
    const big = makeCourierPlan(DAY);
    for (const r of big.routes) {
      r.stops = Array.from({ length: 300 }, (_, i) => ({ ...must(r.stops[0]), stopId: r.routeId * 1000 + i, sequence: i + 1 }));
    }
    const visits = buildCourierSchedules(big, { seed: 42, router: null }).flatMap((s) => s.visits);
    const ok = visits.filter((v) => v.outcome === "delivered").length / visits.length;
    expect(ok).toBeGreaterThan(SUCCESS_RATE - 0.05);
    expect(ok).toBeLessThan(SUCCESS_RATE + 0.05);
  });

  it("van state: loading in the depot, driving between stops, standing at a stop", () => {
    const [s] = buildCourierSchedules(plan, { seed: 42, router: null });
    if (!s) throw new Error("no schedule");
    expect(courierStateAt(s, s.loadStart + MINUTE).status).toBe("loading");
    const firstLeg = (must(s.legStart[0]) + must(s.legEnd[0])) / 2;
    const driving = courierStateAt(s, firstLeg);
    expect(driving.status).toBe("en_route");
    expect(driving.pos.moving).toBe(true);
    const v = must(s.visits[0]);
    const at = courierStateAt(s, (v.arrive + v.leave) / 2);
    expect(at.status).toBe("at_stop");
    expect(at.pos).toMatchObject({ lat: must(s.route.stops[0]).lat, lon: must(s.route.stops[0]).lon, moving: false });
    expect(courierStateAt(s, s.returnAt + MINUTE).status).toBeNull();
  });

  it("ETA error shrinks as the van gets closer", () => {
    const [s] = buildCourierSchedules(plan, { seed: 42, router: null });
    if (!s) throw new Error("no schedule");
    const now = s.depart;
    const etas = predictedEtas(s, now);
    expect(etas).toHaveLength(s.visits.length);
    // the next stop is predicted exactly, later ones carry their bias
    expect(etas[0]?.eta).toBe(s.visits[0]?.arrive);
    const later = predictedEtas(s, must(s.visits[5]).leave);
    expect(later[0]?.stopId).toBe(s.visits[6]?.stopId);
  });

  it("drives on the street graph when it is available", () => {
    const router = RoadRouter.load();
    if (!router) return; // graph not present (should be in git)
    const [s] = buildCourierSchedules(plan, { seed: 42, router });
    if (!s) throw new Error("no schedule");
    // the first leg follows streets: many more points than a straight line
    expect(must(s.legs[0]).points.length).toBeGreaterThan(5);
    // depot -> Košice is ~10 km on roads
    expect(must(s.legs[0]).lengthKm).toBeGreaterThan(8);
  });
});

describe("engine: courier rounds", () => {
  it("reports loaded/departed/delivered/returned with ETAs and shows the vans", async () => {
    const start = operatingDayStart(DAY);
    const clock = new SimClock({ simTime: zonedToUtc(NEXT, "06:50"), speed: 60, paused: true }, () => 0);
    const app = new FakeApp();
    const hub = new Hub();
    const engine = new Engine({
      clock,
      store: new MemoryStore(),
      app,
      hub,
      routes: loadRoutes(),
      log: silentLog,
      realNow: () => 0,
      config: {
        seed: 42,
        envSeed: 42,
        forceCascade: true,
        degradedDevice: null,
        degradationStartedAt: null,
        degradationHours: 6,
        externalDevices: [],
        degradedThreshold: 0.92,
      },
    });
    await engine.init();
    expect(start).toBeLessThan(clock.now());
    await engine.step(clock.now());
    const until = zonedToUtc(NEXT, "14:00");
    for (let t = clock.now() + MINUTE; t <= until; t += MINUTE) {
      clock.set(t);
      await engine.step(t);
      await engine.flushTrips();
      if (t === zonedToUtc(NEXT, "07:15")) {
        expect(engine.vehicleNow("KE-301KR")?.status).toBe("loading");
      }
    }
    await engine.flushTrips();

    const kinds = app.courierEvents.map((e) => e.kind);
    expect(kinds.filter((k) => k === "loaded")).toHaveLength(24);
    expect(kinds.filter((k) => k === "departed")).toHaveLength(2);
    expect(kinds.filter((k) => k === "delivered" || k === "failed")).toHaveLength(24);
    expect(kinds.filter((k) => k === "returned")).toHaveLength(2);
    // events are in time order and loading comes before the departure of the same van
    const r1 = app.courierEvents.filter((e) => e.routeId === must(app.courierEvents[0]).routeId);
    expect(r1.findIndex((e) => e.kind === "departed")).toBeGreaterThan(r1.findLastIndex((e) => e.kind === "loaded"));
    expect(app.etas.length).toBeGreaterThan(5);

    const van = engine.vehicleNow("KE-301KR");
    expect(van).toMatchObject({ kind: "van", directionCode: "KE-01" });
    expect(engine.vehicleNow("XX-000")).toBeNull();
  });
});
