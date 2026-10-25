/** State of a scheduled trip at a given simulated time: status, position, ETA, gate events. */

import { MINUTE } from "../clock/time.js";
import { routeBack, routeFor, routeSpeedKmh, type LatLon, type RouteBook } from "./routes.js";
import type { TripSchedule } from "./scenario.js";
import type { Position, TripExecution, TripStatus } from "./types.js";

export function statusAt(s: TripSchedule, t: number): TripStatus {
  if (s.trip.kind === "inbound") {
    if (s.departOrigin === undefined || t < s.departOrigin) return "planned";
    if (t < (s.arriveDepot ?? Infinity)) return "en_route";
    if (t < (s.unloadedAt ?? Infinity)) return "at_door";
    return "completed";
  }
  if (s.atDoor === undefined || t < s.atDoor) return "planned";
  if (t < (s.loadStart ?? Infinity)) return "at_door";
  if (t < (s.departDepot ?? Infinity)) return "loading";
  if (t < (s.arriveDestination ?? Infinity)) return "departed";
  return "completed";
}

/**
 * ETA of an inbound truck as dispatch knows it: from departure on, the normal arrival; once a
 * breakdown happens, the real (late) arrival. Before departure there is no estimate (ML, Phase 6).
 */
export function predictedArrivalAt(s: TripSchedule, t: number): number | null {
  if (s.trip.kind !== "inbound" || s.departOrigin === undefined || s.arriveDepot === undefined) {
    return null;
  }
  if (t < s.departOrigin) return null;
  if (s.incident && t < s.incident.startsAt) {
    return s.arriveDepot - s.incident.durationMin * MINUTE;
  }
  return s.arriveDepot;
}

const iso = (v: number | undefined | null): string | null =>
  v === undefined || v === null ? null : new Date(v).toISOString();

export function executionAt(s: TripSchedule, t: number): TripExecution {
  const status = statusAt(s, t);
  if (s.trip.kind === "inbound") {
    const arrived = s.arriveDepot !== undefined && t >= s.arriveDepot;
    return {
      tripId: s.trip.id,
      status,
      actualArrival: arrived ? iso(s.arriveDepot) : null,
      actualDeparture: null,
      predictedArrival: arrived ? iso(s.arriveDepot) : iso(predictedArrivalAt(s, t)),
    };
  }
  return {
    tripId: s.trip.id,
    status,
    actualArrival: s.atDoor !== undefined && t >= s.atDoor ? iso(s.atDoor) : null,
    actualDeparture: s.departDepot !== undefined && t >= s.departDepot ? iso(s.departDepot) : null,
    predictedArrival: null,
  };
}

/** [start, end) during which the trip "owns" its vehicle. */
export function activeWindow(s: TripSchedule): [number, number] {
  if (s.trip.kind === "inbound") return [s.departOrigin ?? 0, s.unloadedAt ?? 0];
  return [s.atDoor ?? 0, s.arriveDestination ?? 0];
}

function parked(at: LatLon): Position {
  return { lat: at[0], lon: at[1], speedKmh: 0, heading: 0, moving: false };
}

/** Where the trip's vehicle is at `t` (assumes t inside or at the edges of the active window). */
export function positionAt(s: TripSchedule, t: number, book: RouteBook): Position {
  const route = routeFor(book, s.trip.directionCode);
  const destination = route.points[route.points.length - 1] as LatLon;
  const travelMs = s.travelMin * MINUTE;

  if (s.trip.kind === "inbound") {
    const depart = s.departOrigin ?? 0;
    const arrive = s.arriveDepot ?? 0;
    if (t <= depart) return parked(destination);
    if (t >= arrive) return parked(book.depot);
    const back = routeBack(book, s.trip.directionCode);
    let movingElapsed = t - depart;
    const inc = s.incident;
    if (inc) {
      const stopStart = inc.startsAt;
      const stopEnd = stopStart + inc.durationMin * MINUTE;
      if (t >= stopStart && t < stopEnd) {
        const { point, heading } = back.at(inc.fraction);
        return { lat: point[0], lon: point[1], speedKmh: 0, heading, moving: false };
      }
      if (t >= stopEnd) movingElapsed -= inc.durationMin * MINUTE;
    }
    const { point, heading } = back.at(movingElapsed / travelMs);
    return { lat: point[0], lon: point[1], speedKmh: routeSpeedKmh(book, s.trip.directionCode), heading, moving: true };
  }

  const depart = s.departDepot ?? 0;
  const arrive = s.arriveDestination ?? 0;
  if (t <= depart) return parked(book.depot);
  if (t >= arrive) return parked(destination);
  const { point, heading } = route.at((t - depart) / travelMs);
  return { lat: point[0], lon: point[1], speedKmh: routeSpeedKmh(book, s.trip.directionCode), heading, moving: true };
}

/** Where the vehicle is before / after the trip. */
export function startLocation(s: TripSchedule, book: RouteBook): LatLon {
  if (s.trip.kind === "outbound") return book.depot;
  const pts = routeFor(book, s.trip.directionCode).points;
  return pts[pts.length - 1] as LatLon;
}

export function endLocation(s: TripSchedule, book: RouteBook): LatLon {
  if (s.trip.kind === "inbound") return book.depot;
  const pts = routeFor(book, s.trip.directionCode).points;
  return pts[pts.length - 1] as LatLon;
}

export interface GateEvent {
  at: number;
  direction: "in" | "out";
  tripId: number;
  plate: string;
}

/** Trucks pass the yard gate when they arrive (inbound) and when they leave (outbound). */
export function gateEvents(s: TripSchedule): GateEvent[] {
  if (s.trip.kind === "inbound" && s.arriveDepot !== undefined) {
    return [{ at: s.arriveDepot, direction: "in", tripId: s.trip.id, plate: s.trip.vehiclePlate }];
  }
  if (s.trip.kind === "outbound" && s.departDepot !== undefined) {
    return [{ at: s.departDepot, direction: "out", tripId: s.trip.id, plate: s.trip.vehiclePlate }];
  }
  return [];
}
