/**
 * What-if scenarios of the digital shadow (ADR-047).
 *
 * A scenario does not run a second clock: the day is a pure function of (plan, seed, manifests,
 * read-rate model), so it is computed again with the interventions applied, from "now" to the end
 * of the operating day, and compared with the unchanged day ("plan"). Nothing is written to the
 * live state, the database or the app; the same input always gives the same result.
 */

import type { ManifestParcel, PlanWithLocal } from "../app-client.js";
import { addDays, MINUTE, operatingDayStart } from "../clock/time.js";
import { cascadeRisk } from "./cascade.js";
import { dayScans } from "./dayevents.js";
import type { RouteBook } from "./routes.js";
import { buildScenario, DOOR_DELAY_MIN, type DayScenario, type TripSchedule } from "./scenario.js";
import type { ReadRateModel, ScanEvent } from "./scanners.js";
import type { PlanTrip } from "./types.js";

export type Intervention =
  | { kind: "delay"; tripId: number; minutes: number }
  | { kind: "device_outage"; device: string }
  | { kind: "read_rate"; device: string; rate: number }
  | { kind: "extra_scanner"; doorCode: string }
  | { kind: "move_trip"; tripId: number; doorCode: string };

export interface WhatIfKpis {
  /** sum of departure delays of transit trucks (minutes, every delay > 0) */
  transitDelayMin: number;
  /** transit departures later than the threshold (default 15 min, WHATIF_LATE_THRESHOLD_MIN) */
  transitLate: number;
  /** (transit departure, night feeder) pairs at risk by the cascade rule */
  cascadeWarnings: number;
  /** items counted by a scanner whose label was not read */
  unidentified: number;
  /** parcels that physically ended up at a wrong door */
  wrongDirection: number;
  /** ... of which the scanner did not read the label, so no alarm */
  wrongUndetected: number;
}

export interface TripOutcome {
  tripId: number;
  kind: "inbound" | "outbound";
  directionCode: string;
  directionName: string;
  doorCode: string | null;
  /** arrival (inbound) or departure (outbound) */
  planned: string | null;
  base: string | null;
  scenario: string | null;
  deltaMin: number;
}

export interface WhatIfResult {
  from: string;
  to: string;
  /** a transit departure counts as late above this many minutes */
  lateThresholdMin: number;
  plan: WhatIfKpis;
  scenario: WhatIfKpis;
  /** trips whose time changed */
  trips: TripOutcome[];
  affected: { trips: number[]; doors: string[]; devices: string[] };
  notes: string[];
}

export interface WhatIfContext {
  plan: PlanWithLocal;
  manifests: ReadonlyMap<string, ManifestParcel[]>;
  seed: number;
  forceCascade: boolean;
  routes: RouteBook;
  model: ReadRateModel;
  devices: readonly { code: string; kind: string; doorCode: string | null }[];
  now: number;
  /** default 15: the random operating delay of a few minutes is not "late" (faza-5d-diagnoza) */
  lateThresholdMin?: number;
}

interface Day {
  plan: PlanWithLocal;
  scenario: DayScenario;
  scans: ScanEvent[];
}

const iso = (ms: number | undefined | null): string | null => (ms === undefined || ms === null ? null : new Date(ms).toISOString());
const ms = (s: string | null): number | null => (s === null ? null : Date.parse(s));

/** Unknown trips, doors or devices in the interventions (the API answers 400). */
export function validateInterventions(ctx: WhatIfContext, list: readonly Intervention[]): string[] {
  const trips = new Map(ctx.plan.trips.map((t) => [t.id, t]));
  const devices = new Set(ctx.devices.map((d) => d.code));
  const docks = new Set(ctx.devices.filter((d) => d.kind === "dock_scanner" && d.doorCode).map((d) => d.doorCode as string));
  const errors: string[] = [];
  for (const iv of list) {
    if ((iv.kind === "delay" || iv.kind === "move_trip") && !trips.has(iv.tripId)) errors.push(`unknown trip ${String(iv.tripId)}`);
    if (iv.kind === "move_trip" && trips.get(iv.tripId)?.kind !== "outbound") errors.push(`trip ${String(iv.tripId)} is not outbound`);
    if ((iv.kind === "device_outage" || iv.kind === "read_rate") && !devices.has(iv.device)) errors.push(`unknown device ${iv.device}`);
    if ((iv.kind === "extra_scanner" || iv.kind === "move_trip") && !docks.has(iv.doorCode)) errors.push(`unknown loading door ${iv.doorCode}`);
  }
  return errors;
}

function dockDeviceOf(ctx: WhatIfContext): (door: string | null) => string | null {
  const byDoor = new Map(ctx.devices.filter((d) => d.kind === "dock_scanner" && d.doorCode).map((d) => [d.doorCode as string, d.code]));
  return (door) => (door ? (byDoor.get(door) ?? null) : null);
}

/** A moved truck waits until the truck already at its new door has left. */
function resolveDoorConflicts(plan: PlanWithLocal, scenario: DayScenario, moved: ReadonlySet<number>): void {
  for (const id of moved) {
    const m = scenario.schedules.get(id);
    if (!m || m.atDoor === undefined || m.departDepot === undefined) continue;
    const others = plan.trips
      .filter((t) => t.kind === "outbound" && t.id !== id && t.doorCode === m.trip.doorCode)
      .map((t) => scenario.schedules.get(t.id))
      .filter((s): s is TripSchedule => s?.atDoor !== undefined && s.departDepot !== undefined)
      .sort((a, b) => (a.atDoor ?? 0) - (b.atDoor ?? 0));
    for (const o of others) {
      if ((m.atDoor ?? 0) < (o.departDepot ?? 0) && (o.atDoor ?? 0) < (m.departDepot ?? 0)) {
        const wait: number = (o.departDepot ?? 0) + DOOR_DELAY_MIN * MINUTE - (m.atDoor ?? 0);
        if (wait <= 0) continue;
        m.atDoor = (m.atDoor ?? 0) + wait;
        if (m.loadStart !== undefined) m.loadStart += wait;
        if (m.loadEnd !== undefined) m.loadEnd += wait;
        m.departDepot += wait;
        if (m.arriveDestination !== undefined) m.arriveDestination += wait;
        m.delayMin += Math.round(wait / MINUTE);
      }
    }
  }
}

function simulate(ctx: WhatIfContext, list: readonly Intervention[]): Day {
  const extraDelayMin = new Map<number, number>();
  const moves = new Map<number, string>();
  const overrides: Record<string, { rate?: number; extra?: boolean }> = { ...ctx.model.overrides };
  const dockDevice = dockDeviceOf(ctx);
  for (const iv of list) {
    if (iv.kind === "delay") extraDelayMin.set(iv.tripId, (extraDelayMin.get(iv.tripId) ?? 0) + iv.minutes);
    else if (iv.kind === "move_trip") moves.set(iv.tripId, iv.doorCode);
    else if (iv.kind === "device_outage") overrides[iv.device] = { ...overrides[iv.device], rate: 0 };
    else if (iv.kind === "read_rate") overrides[iv.device] = { ...overrides[iv.device], rate: iv.rate };
    else {
      const device = dockDevice(iv.doorCode);
      if (device) overrides[device] = { ...overrides[device], extra: true };
    }
  }
  // copies: the live plan is never touched
  const plan: PlanWithLocal = { ...ctx.plan, trips: ctx.plan.trips.map((t) => (moves.has(t.id) ? { ...t, doorCode: moves.get(t.id) ?? t.doorCode } : t)) };
  const scenario = buildScenario(plan, { seed: ctx.seed, forceCascade: ctx.forceCascade, routes: ctx.routes, extraDelayMin });
  resolveDoorConflicts(plan, scenario, new Set(moves.keys()));
  const scans = dayScans({
    plan,
    scenario,
    manifests: ctx.manifests,
    model: { ...ctx.model, overrides },
    seed: ctx.seed,
    dockDevice,
    lineDevice: ctx.devices.find((d) => d.kind === "line_scanner")?.code ?? null,
  });
  return { plan, scenario, scans };
}

const eventTime = (s: TripSchedule | undefined): number | undefined => (s?.trip.kind === "inbound" ? s.arriveDepot : s?.departDepot);

export const DEFAULT_LATE_THRESHOLD_MIN = 15;

function kpis(day: Day, from: number, to: number, stillOpen: ReadonlySet<number>, lateThresholdMin: number): WhatIfKpis {
  const out: WhatIfKpis = { transitDelayMin: 0, transitLate: 0, cascadeWarnings: 0, unidentified: 0, wrongDirection: 0, wrongUndetected: 0 };
  const inbound = (code: string): PlanTrip | undefined => day.plan.trips.find((t) => t.kind === "inbound" && t.directionCode === code);
  for (const t of day.plan.trips) {
    if (t.kind !== "outbound" || t.directionType !== "transit" || !stillOpen.has(t.id)) continue;
    const planned = ms(t.plannedDeparture);
    const dep = day.scenario.schedules.get(t.id)?.departDepot;
    if (planned === null || dep === undefined || planned >= to) continue;
    const late = Math.max(0, Math.round((dep - planned) / MINUTE));
    out.transitDelayMin += late;
    if (late > lateThresholdMin) out.transitLate++;
    for (const code of t.dependsOnLinehaul) {
      const feeder = inbound(code);
      const eta = feeder ? day.scenario.schedules.get(feeder.id)?.arriveDepot : undefined;
      if (eta !== undefined && cascadeRisk(eta, planned, day.plan.cascadeBufferMin)) out.cascadeWarnings++;
    }
  }
  for (const s of day.scans) {
    if (s.at < from || s.at >= to) continue;
    if (s.itemCounted && !s.readOk) out.unidentified++;
    if (s.truth === "wrong_direction") {
      out.wrongDirection++;
      if (!s.readOk) out.wrongUndetected++;
    }
  }
  return out;
}

export function runWhatIf(ctx: WhatIfContext, list: readonly Intervention[]): WhatIfResult {
  const from = ctx.now;
  const to = operatingDayStart(addDays(ctx.plan.day, 1));
  const threshold = ctx.lateThresholdMin ?? DEFAULT_LATE_THRESHOLD_MIN;
  const base = simulate(ctx, []);
  const scen = simulate(ctx, list);
  const notes: string[] = [];

  // trips that have not happened yet in reality (their event is still ahead in the unchanged day)
  const stillOpen = new Set<number>();
  for (const t of ctx.plan.trips) {
    const at = eventTime(base.scenario.schedules.get(t.id));
    if (at !== undefined && at >= from) stillOpen.add(t.id);
  }
  for (const iv of list) {
    if ((iv.kind === "delay" || iv.kind === "move_trip") && !stillOpen.has(iv.tripId)) notes.push(`trip ${String(iv.tripId)} already happened`);
  }

  const trips: TripOutcome[] = [];
  for (const t of scen.plan.trips) {
    if (!stillOpen.has(t.id)) continue;
    const b = eventTime(base.scenario.schedules.get(t.id));
    const s = eventTime(scen.scenario.schedules.get(t.id));
    if (b === undefined || s === undefined) continue;
    const deltaMin = Math.round((s - b) / MINUTE);
    const doorChanged = t.doorCode !== ctx.plan.trips.find((x) => x.id === t.id)?.doorCode;
    if (deltaMin === 0 && !doorChanged) continue;
    trips.push({
      tripId: t.id,
      kind: t.kind,
      directionCode: t.directionCode,
      directionName: t.directionName,
      doorCode: t.doorCode,
      planned: t.kind === "inbound" ? t.plannedArrival : t.plannedDeparture,
      base: iso(b),
      scenario: iso(s),
      deltaMin,
    });
  }
  trips.sort((a, b) => (a.scenario ?? "").localeCompare(b.scenario ?? ""));

  const dockDevice = dockDeviceOf(ctx);
  const doors = new Set<string>();
  const devices = new Set<string>();
  const affectedTrips = new Set<number>(trips.map((t) => t.tripId));
  for (const iv of list) {
    if (iv.kind === "delay") affectedTrips.add(iv.tripId);
    if (iv.kind === "move_trip") {
      affectedTrips.add(iv.tripId);
      doors.add(iv.doorCode);
      const old = ctx.plan.trips.find((t) => t.id === iv.tripId)?.doorCode;
      if (old) doors.add(old);
    }
    if (iv.kind === "extra_scanner") {
      doors.add(iv.doorCode);
      const d = dockDevice(iv.doorCode);
      if (d) devices.add(d);
    }
    if (iv.kind === "device_outage" || iv.kind === "read_rate") devices.add(iv.device);
  }
  for (const t of trips) if (t.kind === "outbound" && t.doorCode) doors.add(t.doorCode);

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    lateThresholdMin: threshold,
    plan: kpis(base, from, to, stillOpen, threshold),
    scenario: kpis(scen, from, to, stillOpen, threshold),
    trips,
    affected: { trips: [...affectedTrips].sort((a, b) => a - b), doors: [...doors].sort(), devices: [...devices].sort() },
    notes,
  };
}
