/**
 * Scenario of one operating day: when every planned trip really departs, arrives and loads.
 *
 * buildScenario() is a pure function of (plan, seed, options). The live engine only replays the
 * scenario against the simulated clock, so the same seed always produces the same day: the same
 * delays, the same incident, the same unexpected cars at the gate.
 *
 * Guaranteed by default (SIM_FORCE_CASCADE=true): one night linehaul truck breaks down on the way
 * and arrives so late that a regional (transit) departure it feeds is at risk -> cascade warning.
 */

import { localParts, MINUTE, operatingDayStart, zonedToUtc, addDays, HOUR } from "../clock/time.js";
import { arrivalDelay, departureDelay, weatherFor, type DelayContext, type Weather } from "./delays.js";
import { rngFor } from "./rng.js";
import { routeFor, type RouteBook } from "./routes.js";
import type { Plan, PlanTrip } from "./types.js";

export const UNLOAD_MIN = 40;
export const DOOR_DELAY_MIN = 5;

export interface Incident {
  kind: "breakdown";
  /** when the truck stops on the road, epoch ms */
  startsAt: number;
  durationMin: number;
  /** fraction of the route where it stops */
  fraction: number;
}

export interface TripSchedule {
  trip: PlanTrip;
  /** minutes vs. plan: arrival delay (inbound) or departure delay (outbound) */
  delayMin: number;
  weather: Weather;
  prevDelayMin: number;
  travelMin: number;
  // inbound
  departOrigin?: number;
  arriveDepot?: number;
  unloadedAt?: number;
  incident?: Incident;
  // outbound
  atDoor?: number;
  loadStart?: number;
  loadEnd?: number;
  departDepot?: number;
  arriveDestination?: number;
}

export interface ScenarioOptions {
  seed: number;
  forceCascade: boolean;
  routes: RouteBook;
}

export interface DayScenario {
  day: string;
  seed: number;
  weather: Weather;
  schedules: Map<number, TripSchedule>;
  /** trip id of the night truck with the forced breakdown, if any */
  incidentTripId: number | null;
  /** times of unexpected passenger cars at the gate */
  unexpectedCars: number[];
}

const ms = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

function context(t: PlanTrip, at: number, weather: Weather, prevDelayMin: number, km: number): DelayContext {
  const p = localParts(at);
  return { weekday: p.weekday, month: p.month, hour: p.hour, weather, prevDelayMin, distanceKm: km };
}

export function buildScenario(plan: Plan, opts: ScenarioOptions): DayScenario {
  const { seed, routes } = opts;
  const weather = weatherFor(seed, plan.day);
  const schedules = new Map<number, TripSchedule>();
  const buffer = plan.cascadeBufferMin * MINUTE;
  const byKey = (code: string, kind: string): PlanTrip | undefined =>
    plan.trips.find((t) => t.directionCode === code && t.kind === kind);

  // 1) inbound trips (they feed the outbound ones)
  for (const trip of plan.trips.filter((t) => t.kind === "inbound")) {
    const planned = ms(trip.plannedArrival);
    if (planned === null) continue;
    const route = routeFor(routes, trip.directionCode);
    const travelMin = Math.round((route.lengthKm / routes.averageSpeedKmh) * 60);
    const rng = rngFor(seed, plan.day, "trip", trip.directionCode, trip.kind);
    const delayMin = arrivalDelay(context(trip, planned, weather, 0, route.lengthKm), rng);
    const arrive = planned + delayMin * MINUTE;
    schedules.set(trip.id, {
      trip,
      delayMin,
      weather,
      prevDelayMin: 0,
      travelMin,
      departOrigin: arrive - travelMin * MINUTE,
      arriveDepot: arrive,
      unloadedAt: arrive + UNLOAD_MIN * MINUTE,
    });
  }

  // 2) guaranteed cascade: one night linehaul truck breaks down
  let incidentTripId: number | null = null;
  if (opts.forceCascade) {
    const night = plan.trips
      .filter((t) => t.kind === "inbound" && t.directionType === "linehaul" && schedules.has(t.id))
      .sort((a, b) => a.id - b.id);
    if (night.length > 0) {
      const rng = rngFor(seed, plan.day, "incident");
      const victim = rng.pick(night);
      const dependents = plan.trips
        .filter(
          (t) =>
            t.kind === "outbound" &&
            t.directionType === "transit" &&
            t.dependsOnLinehaul.includes(victim.directionCode),
        )
        .map((t) => ms(t.plannedDeparture))
        .filter((v): v is number => v !== null);
      const sched = schedules.get(victim.id);
      const planned = ms(victim.plannedArrival);
      if (sched && planned !== null && dependents.length > 0 && sched.departOrigin !== undefined) {
        const earliest = Math.min(...dependents);
        const neededArrival = earliest - buffer + rng.int(5, 35) * MINUTE;
        const naturalArrival = sched.arriveDepot ?? planned;
        if (neededArrival > naturalArrival) {
          const stopMin = Math.round((neededArrival - naturalArrival) / MINUTE);
          const fraction = rng.float(0.35, 0.7);
          sched.incident = {
            kind: "breakdown",
            startsAt: sched.departOrigin + fraction * sched.travelMin * MINUTE,
            durationMin: stopMin,
            fraction,
          };
          sched.delayMin += stopMin;
          sched.arriveDepot = naturalArrival + stopMin * MINUTE;
          sched.unloadedAt = sched.arriveDepot + UNLOAD_MIN * MINUTE;
          incidentTripId = victim.id;
        }
      }
    }
  }

  // 3) outbound trips
  for (const trip of plan.trips.filter((t) => t.kind === "outbound")) {
    const plannedDep = ms(trip.plannedDeparture);
    const plannedAtDoor = ms(trip.plannedArrival) ?? (plannedDep ?? 0) - 4 * HOUR;
    if (plannedDep === null) continue;
    const route = routeFor(routes, trip.directionCode);
    const travelMin = Math.round((route.lengthKm / routes.averageSpeedKmh) * 60);
    const rng = rngFor(seed, plan.day, "trip", trip.directionCode, trip.kind);
    const prev = byKey(trip.directionCode, "inbound");
    const prevDelayMin = prev ? (schedules.get(prev.id)?.delayMin ?? 0) : 0;
    let departure =
      plannedDep +
      departureDelay(context(trip, plannedDep, weather, prevDelayMin, route.lengthKm), rng) * MINUTE;

    // a regional truck waits until its night feeders are unloaded and sorted
    if (trip.directionType === "transit") {
      for (const code of trip.dependsOnLinehaul) {
        const feeder = byKey(code, "inbound");
        const arrive = feeder ? schedules.get(feeder.id)?.arriveDepot : undefined;
        if (arrive !== undefined) departure = Math.max(departure, arrive + buffer);
      }
    }
    const atDoor = plannedAtDoor + rng.int(-10, 10) * MINUTE;
    schedules.set(trip.id, {
      trip,
      delayMin: Math.round((departure - plannedDep) / MINUTE),
      weather,
      prevDelayMin,
      travelMin,
      atDoor,
      loadStart: atDoor + DOOR_DELAY_MIN * MINUTE,
      loadEnd: Math.max(atDoor + 30 * MINUTE, plannedDep - 10 * MINUTE),
      departDepot: departure,
      arriveDestination: departure + travelMin * MINUTE,
    });
  }

  // 4) unexpected passenger cars at the gate (daytime only)
  const carRng = rngFor(seed, plan.day, "gate-cars");
  const start = operatingDayStart(plan.day);
  const windows: [number, number][] = [
    [start, start + 3 * HOUR], // 15:00-18:00
    [zonedToUtc(addDays(plan.day, 1), "07:00"), zonedToUtc(addDays(plan.day, 1), "15:00")],
  ];
  const unexpectedCars: number[] = [];
  const count = carRng.int(2, 4);
  for (let i = 0; i < count; i++) {
    const [a, b] = carRng.pick(windows);
    unexpectedCars.push(Math.round(carRng.float(a, b)));
  }
  unexpectedCars.sort((x, y) => x - y);

  return { day: plan.day, seed, weather, schedules, incidentTripId, unexpectedCars };
}
