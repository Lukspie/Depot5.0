/**
 * Courier rounds (Phase 4, ADR-041): the deterministic schedule of every courier van of a day.
 *
 * buildCourierSchedules() is a pure function of (courier plan, seed, road graph), like the trip
 * scenario: from ~06:30 the courier scans the parcels into the van at its place in the yard
 * (phase 7b, ADR-063), leaves Budimír ~07:30, drives
 * the stops in the app's order on the street graph (offline A*, ADR-038), stays 2–6 min at each
 * stop, ~90 % of deliveries succeed, then drives back to its place in the yard.
 */

import { MINUTE, zonedToUtc } from "../clock/time.js";
import { rngFor } from "./rng.js";
import type { RoadRouter } from "./roads.js";
import { Polyline, type LatLon } from "./routes.js";
import type { Position } from "./types.js";

export interface CourierPlanStop {
  stopId: number;
  sequence: number;
  barcode: string;
  lat: number;
  lon: number;
  /** ADR-062: handover (customer at home, the courier waits for the window) | mailbox | locker */
  deliveryType?: string;
  windowFrom?: string | null;
}

export interface CourierPlanRoute {
  routeId: number;
  /** delivery date (YYYY-MM-DD) */
  date: string;
  vehiclePlate: string;
  courierUsername: string;
  districtCode: string;
  stagingBay: string | null;
  stops: CourierPlanStop[];
}

export interface CourierPlan {
  day: string;
  depot: { code: string; name: string; lat: number; lon: number };
  routes: CourierPlanRoute[];
}

export type CourierEventKind = "loaded" | "departed" | "delivered" | "failed" | "returned";

export interface CourierEvent {
  routeId: number;
  kind: CourierEventKind;
  stopId: number | null;
  at: number;
}

export interface StopVisit {
  stopId: number;
  sequence: number;
  arrive: number;
  leave: number;
  outcome: "delivered" | "failed";
  /** systematic error of the dispatch ETA for this stop (ms), shrinks as the van gets closer */
  etaBias: number;
}

export interface CourierSchedule {
  route: CourierPlanRoute;
  loadStart: number;
  loadAt: number[];
  depart: number;
  visits: StopVisit[];
  returnAt: number;
  /** legs[i] leads to stop i; the last leg leads back to the depot */
  legs: Polyline[];
  legStart: number[];
  legEnd: number[];
  /** where the van stands in the depot yard overnight and while it is loaded (phase 7b) */
  parking: LatLon;
  depot: LatLon;
}

export const SUCCESS_RATE = 0.9;
/** van in city traffic vs. the free-flow time of the graph (parking, crossings) */
const CITY_FACTOR = [1.0, 1.1] as const;
const PARKING_MIN = 0.5;
const FALLBACK_KMH = 25;
const ROAD_FACTOR = 1.35;

function leg(router: RoadRouter | null, a: LatLon, b: LatLon, traffic: number): { line: Polyline; minutes: number } {
  const road = router?.route(a, b);
  if (road && road.points.length >= 1) {
    return { line: new Polyline([a, ...road.points, b]), minutes: road.minutes * traffic + PARKING_MIN };
  }
  const line = new Polyline([a, b]);
  return { line, minutes: ((line.lengthKm * ROAD_FACTOR) / FALLBACK_KMH) * 60 + PARKING_MIN };
}

/** 2–6 minutes, most stops short (a parcel handed over at the door), mean ~2.7 min. */
function dwellMinutes(u: number): number {
  return 2 + 4 * u ** 5;
}

export function buildCourierSchedules(plan: CourierPlan, opts: { seed: number; router: RoadRouter | null }): CourierSchedule[] {
  const depot: LatLon = [plan.depot.lat, plan.depot.lon];
  return plan.routes
    .filter((r) => r.stops.length > 0)
    .map((route) => {
      const rng = rngFor(opts.seed, plan.day, "courier", route.districtCode);
      const traffic = rng.float(CITY_FACTOR[0], CITY_FACTOR[1]);
      // phase 7b: loading at the staging bay from 06:30, the departure stays at ~07:30
      const loadStart = zonedToUtc(route.date, "06:30") + rng.int(0, 5) * MINUTE;
      const spacing = (50 * MINUTE) / route.stops.length;
      const loadAt = route.stops.map((_, i) => Math.round(loadStart + i * spacing));
      const depart = zonedToUtc(route.date, "07:30") + rng.int(0, 6) * MINUTE;

      const legs: Polyline[] = [];
      const legStart: number[] = [];
      const legEnd: number[] = [];
      const visits: StopVisit[] = [];
      // the round starts and ends at the van's own place in the yard, not on the depot point
      const parking = parkingSpot(depot, route);
      let here = parking;
      let t = depart;
      for (const stop of route.stops) {
        const to: LatLon = [stop.lat, stop.lon];
        const { line, minutes } = leg(opts.router, here, to, traffic);
        legs.push(line);
        legStart.push(t);
        t = Math.round(t + minutes * MINUTE);
        legEnd.push(t);
        // a personal handover is not before its window: the van waits at the address
        const windowFrom = stop.windowFrom ? Date.parse(stop.windowFrom) : null;
        if (windowFrom !== null && t < windowFrom) t = windowFrom;
        const arrive = t;
        // mailbox and locker need nobody at home; the number is drawn anyway (same RNG sequence)
        const reached = rng.chance(SUCCESS_RATE);
        const ok = stop.deliveryType === "mailbox" || stop.deliveryType === "locker" ? true : reached;
        // a failed attempt (nobody home) is quicker
        const dwell = ok ? dwellMinutes(rng.next()) : 1.5 + rng.next();
        t = Math.round(t + dwell * MINUTE);
        visits.push({
          stopId: stop.stopId,
          sequence: stop.sequence,
          arrive,
          leave: t,
          outcome: ok ? "delivered" : "failed",
          etaBias: Math.max(-20, Math.min(20, rng.normal(0, 8))) * MINUTE,
        });
        here = to;
      }
      const back = leg(opts.router, here, parking, traffic);
      legs.push(back.line);
      legStart.push(t);
      t = Math.round(t + back.minutes * MINUTE);
      legEnd.push(t);
      return { route, loadStart, loadAt, depart, visits, returnAt: t, legs, legStart, legEnd, depot, parking };
    });
}

/** All events of the rounds, sorted by time. */
export function courierEvents(schedules: CourierSchedule[]): CourierEvent[] {
  const out: CourierEvent[] = [];
  for (const s of schedules) {
    const routeId = s.route.routeId;
    s.route.stops.forEach((stop, i) => {
      out.push({ routeId, kind: "loaded", stopId: stop.stopId, at: s.loadAt[i] ?? s.loadStart });
    });
    out.push({ routeId, kind: "departed", stopId: null, at: s.depart });
    for (const v of s.visits) out.push({ routeId, kind: v.outcome, stopId: v.stopId, at: v.leave });
    out.push({ routeId, kind: "returned", stopId: null, at: s.returnAt });
  }
  return out.sort((a, b) => a.at - b.at || a.routeId - b.routeId);
}

export type CourierStatus = "parked" | "loading" | "en_route" | "at_stop" | "returning" | null;

/**
 * The van's own place in the depot yard, in a row south of the depot point, ~9 m apart by its
 * district number (KE-03 -> 3rd place). Not surveyed geometry: the map and the shadow only need
 * the vans next to each other instead of on one point.
 */
export function parkingSpot(depot: LatLon, route: Pick<CourierPlanRoute, "districtCode" | "routeId">): LatLon {
  const n = Number.parseInt(route.districtCode.slice(-2), 10);
  const place = Number.isFinite(n) ? n : (route.routeId % 8) + 1;
  return [depot[0] - 0.0004, depot[1] + 0.0004 + (place - 4.5) * 0.00012];
}

export interface CourierState {
  pos: Position;
  status: CourierStatus;
  /** stops finished so far */
  done: number;
}

function parked(at: LatLon): Position {
  return { lat: at[0], lon: at[1], speedKmh: 0, heading: 0, moving: false };
}

/** Where the van is at `t` and what it does. */
export function courierStateAt(s: CourierSchedule, t: number): CourierState {
  const done = s.visits.filter((v) => v.leave <= t).length;
  if (t < s.loadStart || t >= s.returnAt) return { pos: parked(s.parking), status: "parked", done };
  if (t < s.depart) return { pos: parked(s.parking), status: "loading", done };
  for (let i = 0; i < s.legs.length; i++) {
    const start = s.legStart[i] ?? 0;
    const end = s.legEnd[i] ?? 0;
    if (t < start) {
      // dwelling at the previous stop
      const v = s.visits[i - 1];
      const stop = s.route.stops[i - 1];
      return { pos: stop ? parked([stop.lat, stop.lon]) : parked(s.depot), status: v ? "at_stop" : null, done };
    }
    if (t < end) {
      const line = s.legs[i] as Polyline;
      const f = end > start ? (t - start) / (end - start) : 1;
      const { point, heading } = line.at(f);
      const hours = (end - start) / (60 * MINUTE);
      const speed = hours > 0 ? Math.round(line.lengthKm / hours) : 0;
      return {
        pos: { lat: point[0], lon: point[1], speedKmh: speed, heading, moving: true },
        status: i === s.legs.length - 1 ? "returning" : "en_route",
        done,
      };
    }
  }
  return { pos: parked(s.depot), status: null, done };
}

/**
 * Dispatch ETA of the open stops at `t`: the real arrival plus an error that disappears as the
 * van gets closer (8 stops ahead = full error). Stops already finished get no prediction.
 */
export function predictedEtas(s: CourierSchedule, t: number): { stopId: number; eta: number }[] {
  const next = s.visits.findIndex((v) => v.leave > t);
  if (next < 0) return [];
  return s.visits.slice(next).map((v, k) => ({
    stopId: v.stopId,
    eta: Math.round(v.arrive + v.etaBias * Math.min(1, k / 8)),
  }));
}

/** Remaining road geometry of the van (for the dispatcher's map). */
export function remainingPath(s: CourierSchedule, t: number): LatLon[] {
  const first = s.legEnd.findIndex((end) => end > t);
  if (first < 0) return [];
  const pts: LatLon[] = [];
  for (let i = first; i < s.legs.length; i++) pts.push(...(s.legs[i] as Polyline).points);
  return pts;
}
