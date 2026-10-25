import { describe, expect, it } from "vitest";
import { MINUTE, localHhmm, zonedToUtc } from "../src/clock/time.js";
import { rngFor } from "../src/simulator/rng.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { buildScenario, type DayScenario } from "../src/simulator/scenario.js";
import { executionAt, positionAt, predictedArrivalAt, statusAt } from "../src/simulator/trips.js";
import { makePlan } from "./fixtures.js";

const DAY = "2026-10-23";
const routes = loadRoutes();
const plan = makePlan(DAY);
const build = (seed: number, forceCascade = true): DayScenario =>
  buildScenario(plan, { seed, forceCascade, routes });

function summary(s: DayScenario): string {
  return JSON.stringify(
    [...s.schedules.values()].map((x) => [x.trip.id, x.delayMin, x.arriveDepot, x.departDepot, x.incident]),
  );
}

describe("deterministic random numbers", () => {
  it("same keys give the same stream, other keys another one", () => {
    const a = rngFor(42, "x");
    const b = rngFor(42, "x");
    const c = rngFor(43, "x");
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
    const r = rngFor(1, "range");
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe("day scenario", () => {
  it("is identical for the same seed and differs for another seed", () => {
    expect(summary(build(42))).toBe(summary(build(42)));
    expect(summary(build(42))).not.toBe(summary(build(7)));
  });

  it("the default seed contains a night-truck breakdown that endangers a transit departure", () => {
    const s = build(42);
    expect(s.incidentTripId).not.toBeNull();
    const victim = s.schedules.get(s.incidentTripId as number);
    expect(victim?.trip.directionType).toBe("linehaul");
    expect(victim?.trip.kind).toBe("inbound");
    const dependents = plan.trips.filter(
      (t) => t.kind === "outbound" && t.dependsOnLinehaul.includes(victim?.trip.directionCode ?? ""),
    );
    const earliest = Math.min(...dependents.map((t) => Date.parse(t.plannedDeparture ?? "")));
    expect((victim?.arriveDepot ?? 0) + 30 * MINUTE).toBeGreaterThan(earliest);
  });

  it("guarantees the cascade for any seed while SIM_FORCE_CASCADE is on", () => {
    for (let seed = 1; seed <= 40; seed++) expect(build(seed).incidentTripId).not.toBeNull();
    expect(build(42, false).incidentTripId).toBeNull();
  });

  it("a regional truck waits until its night feeders are unloaded and sorted", () => {
    const s = build(42);
    for (const sched of s.schedules.values()) {
      if (sched.trip.kind !== "outbound" || sched.trip.directionType !== "transit") continue;
      for (const code of sched.trip.dependsOnLinehaul) {
        const feeder = [...s.schedules.values()].find((x) => x.trip.directionCode === code && x.trip.kind === "inbound");
        expect(sched.departDepot ?? 0).toBeGreaterThanOrEqual((feeder?.arriveDepot ?? 0) + 30 * MINUTE);
      }
    }
  });

  it("delays stay plausible", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const sched of build(seed, false).schedules.values()) {
        expect(sched.delayMin).toBeGreaterThanOrEqual(-10);
        expect(sched.delayMin).toBeLessThan(300);
      }
    }
  });
});

describe("trip state over time", () => {
  const s = build(42);
  const victim = s.schedules.get(s.incidentTripId as number);
  if (!victim?.incident || victim.departOrigin === undefined || victim.arriveDepot === undefined) {
    throw new Error("fixture needs an incident");
  }
  const inc = victim.incident;

  it("inbound: planned -> en_route -> at_door -> completed", () => {
    expect(statusAt(victim, (victim.departOrigin ?? 0) - MINUTE)).toBe("planned");
    expect(statusAt(victim, (victim.departOrigin ?? 0) + MINUTE)).toBe("en_route");
    expect(statusAt(victim, (victim.arriveDepot ?? 0) + MINUTE)).toBe("at_door");
    expect(statusAt(victim, (victim.arriveDepot ?? 0) + 60 * MINUTE)).toBe("completed");
  });

  it("dispatch learns about the late arrival when the truck breaks down", () => {
    const before = predictedArrivalAt(victim, inc.startsAt - MINUTE);
    const after = predictedArrivalAt(victim, inc.startsAt + MINUTE);
    expect(after).toBe(victim.arriveDepot);
    expect((after ?? 0) - (before ?? 0)).toBe(inc.durationMin * MINUTE);
    expect(executionAt(victim, (victim.arriveDepot ?? 0) + MINUTE).actualArrival).toBe(
      new Date(victim.arriveDepot ?? 0).toISOString(),
    );
  });

  it("the broken-down truck stands still, then drives on to the depot", () => {
    const stopped = positionAt(victim, inc.startsAt + 10 * MINUTE, routes);
    expect(stopped.moving).toBe(false);
    expect(stopped.speedKmh).toBe(0);
    const later = positionAt(victim, inc.startsAt + (inc.durationMin + 10) * MINUTE, routes);
    expect(later.moving).toBe(true);
    const home = positionAt(victim, (victim.arriveDepot ?? 0) + MINUTE, routes);
    expect([home.lat, home.lon]).toEqual([...routes.depot]);
  });

  it("outbound linehaul loads in the evening and leaves around its planned departure", () => {
    const ba = [...s.schedules.values()].find((x) => x.trip.directionCode === "BA" && x.trip.kind === "outbound");
    if (!ba) throw new Error("BA outbound missing");
    expect(statusAt(ba, zonedToUtc(DAY, "16:00"))).toBe("planned");
    expect(statusAt(ba, zonedToUtc(DAY, "18:00"))).toBe("loading");
    expect(Math.abs((ba.departDepot ?? 0) - zonedToUtc(DAY, "21:30"))).toBeLessThan(40 * MINUTE);
    expect(localHhmm(ba.loadStart ?? 0) >= "16:50").toBe(true);
  });
});
