/**
 * The mix of vehicles at the gate in one operating day (ADR-061): fleet trucks and unexpected cars (`base`),
 * courier vans leaving in the morning and coming back, an allowed external vehicle, sometimes an
 * unknown lorry and a plate read with low confidence. The app decides each passage by its rules.
 *
 * Own random stream ("gate-mix"), so the older gate stream (truck misreads, unexpected cars) and
 * every other stream keep their numbers. Every passage draws the same count of numbers.
 */

import { addDays, zonedToUtc } from "../clock/time.js";
import type { GateRow } from "../db/telemetry.js";
import type { CourierSchedule } from "./couriers.js";
import { rngFor } from "./rng.js";
import type { TripSchedule } from "./scenario.js";

/** The same plates as ALLOWED_PLATES in the app seed (app/src/depotrack/seed/reference.py). */
export const ALLOWED_EXTERNAL: readonly { plate: string; type: "truck" | "van" | "car" }[] = [
  { plate: "BA-512ZT", type: "truck" },
  { plate: "KE-640SV", type: "van" },
  { plate: "PO-215CL", type: "car" },
];

const MINUTE = 60_000;
const conf = (v: number): number => Number(v.toFixed(2));

export function gateMix(base: GateRow[], couriers: CourierSchedule[], day: string, seed: number): GateRow[] {
  const rng = rngFor(seed, day, "gate-mix");
  // fixed draws first: the external vehicle and the lorry do not move when the plan changes
  const next = addDays(day, 1);
  const ext = rng.pick(ALLOWED_EXTERNAL);
  const extIn = Math.round(rng.float(zonedToUtc(next, "07:45"), zonedToUtc(next, "12:30")));
  const extStay = rng.int(40, 90) * MINUTE;
  const extConf = [conf(rng.float(0.7, 0.95)), conf(rng.float(0.86, 0.98)), conf(rng.float(0.7, 0.95)), conf(rng.float(0.86, 0.98))];
  const unknownLorry = rng.chance(0.5);
  const lorryAt = Math.round(rng.float(zonedToUtc(day, "16:30"), zonedToUtc(day, "22:00")));
  const lorryPlate = `${rng.pick(["TT", "NR", "ZA", "BB"])}-${String(rng.int(100, 999))}${rng.pick(["XA", "KD", "MR", "PL"])}`;
  const lorryConf = conf(rng.float(0.75, 0.95));
  const lorryPlateConf = conf(rng.float(0.86, 0.97));

  const out: GateRow[] = [];
  // one allowed external vehicle in the morning, for 40–90 min
  for (const [i, [at, direction]] of ([
    [extIn, "in"],
    [extIn + extStay, "out"],
  ] as const).entries()) {
    out.push({
      at,
      direction,
      vehicleType: ext.type,
      vehicleConfidence: extConf[2 * i] ?? null,
      plate: ext.plate,
      plateConfidence: extConf[2 * i + 1] ?? null,
      snapshotPath: null,
      expected: true,
    });
  }
  // every other evening an unknown lorry (a carrier not on the list): passes, security verifies
  if (unknownLorry) {
    out.push({
      at: lorryAt,
      direction: "in",
      vehicleType: "truck",
      vehicleConfidence: lorryConf,
      plate: lorryPlate,
      plateConfidence: lorryPlateConf,
      snapshotPath: null,
      expected: false,
    });
  }
  for (const g of base) {
    const vehicleConfidence = conf(rng.float(0.72, 0.97));
    const lowPlate = rng.chance(0.03);
    const low = conf(rng.float(0.5, 0.75));
    out.push({ ...g, vehicleConfidence, plateConfidence: lowPlate && g.plate !== null ? low : g.plateConfidence });
  }
  for (const c of [...couriers].sort((a, b) => a.route.routeId - b.route.routeId)) {
    // keyed by the district, not the route id: routes of other depots (phase 7c) shift the ids
    const r = rngFor(seed, day, "gate-mix", "van", c.route.districtCode);
    for (const [at, direction] of [
      [c.depart, "out"],
      [c.returnAt, "in"],
    ] as const) {
      out.push({
        at,
        direction,
        vehicleType: "van",
        vehicleConfidence: conf(r.float(0.7, 0.97)),
        plate: c.route.vehiclePlate,
        plateConfidence: conf(r.float(0.86, 0.99)),
        snapshotPath: null,
        expected: true,
      });
    }
  }
  return out;
}

/** district prefixes of the plates of unknown cars around a depot */
const REGION_PLATES: Record<string, string[]> = {
  ZIL: ["ZA", "MT", "PB", "CA"],
  BAH: ["BA", "BL", "SC", "PK"],
  DS: ["DS", "GA", "KN", "SC"],
  TN: ["TN", "IL", "NM", "PB"],
};

/**
 * The gate of another depot (phase 7c, ADR-065), e.g. Žilina: the linehaul trucks that end there
 * come in when they arrive and leave with the night trip, the depot's courier vans leave in the
 * morning and come back, now and then an unknown car. Its own random stream per depot, so
 * Budimír's gate keeps its numbers.
 */
export function depotGateMix(depot: string, trucks: TripSchedule[], couriers: CourierSchedule[], day: string, seed: number): GateRow[] {
  const rng = rngFor(seed, day, "gate-mix", depot);
  const out: GateRow[] = [];
  // an unknown car on two days of three, drawn first so it does not depend on the trips
  const car = rng.chance(0.66);
  const carAt = Math.round(rng.float(zonedToUtc(addDays(day, 1), "09:00"), zonedToUtc(addDays(day, 1), "14:00")));
  const carStay = rng.int(20, 90) * 60_000;
  const carPlate = `${rng.pick(REGION_PLATES[depot] ?? ["ZA", "MT", "PB", "CA"])}-${String(rng.int(100, 999))}${rng.pick(["AB", "EF", "KL", "XY"])}`;
  const row = (at: number, direction: "in" | "out", vehicleType: string, plate: string | null, expected: boolean): GateRow => ({
    at,
    direction,
    vehicleType,
    vehicleConfidence: conf(rng.float(0.72, 0.97)),
    plate,
    plateConfidence: plate === null ? null : conf(rng.float(0.86, 0.99)),
    snapshotPath: null,
    expected,
    depot,
  });
  for (const s of [...trucks].sort((a, b) => a.trip.id - b.trip.id)) {
    // outbound from Budimír arrives here, inbound to Budimír leaves from here
    if (s.trip.kind === "outbound" && s.arriveDestination !== undefined) out.push(row(s.arriveDestination, "in", "truck", s.trip.vehiclePlate, true));
    if (s.trip.kind === "inbound" && s.departOrigin !== undefined) out.push(row(s.departOrigin, "out", "truck", s.trip.vehiclePlate, true));
  }
  for (const c of [...couriers].sort((a, b) => a.route.routeId - b.route.routeId)) {
    out.push(row(c.depart, "out", "van", c.route.vehiclePlate, true), row(c.returnAt, "in", "van", c.route.vehiclePlate, true));
  }
  if (car) out.push(row(carAt, "in", "car", carPlate, false), row(carAt + carStay, "out", "car", carPlate, false));
  return out;
}
