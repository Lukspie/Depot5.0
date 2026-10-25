/**
 * Truck routes from the depot to each direction's destination and position interpolation.
 *
 * Normally the routes follow real roads (RoadRouter over the OSM road graph, ADR-038). Without the
 * road graph (unit tests) a simple polyline book from data/routes.json is used instead.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RoadRouter } from "./roads.js";

export type LatLon = readonly [number, number];

export interface Route {
  points: LatLon[];
  /** driving time at truck speeds */
  minutes: number;
}

export interface RouteBook {
  depot: LatLon;
  /** route from the depot to the destination of the direction (code) */
  routes: Record<string, Route>;
}

export const DEFAULT_ROUTES_FILE = fileURLToPath(new URL("../../data/routes.json", import.meta.url));
const FALLBACK_SPEED_KMH = 72;

const EARTH_KM = 6371;
const rad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export class Polyline {
  readonly lengthKm: number;
  private readonly cumulative: number[];

  constructor(readonly points: readonly LatLon[]) {
    if (points.length < 2) throw new RangeError("polyline needs at least two points");
    this.cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const prev = this.cumulative[i - 1] ?? 0;
      this.cumulative.push(prev + haversineKm(points[i - 1] as LatLon, points[i] as LatLon));
    }
    this.lengthKm = this.cumulative[this.cumulative.length - 1] ?? 0;
  }

  reversed(): Polyline {
    return new Polyline([...this.points].reverse());
  }

  /** Point and heading at `fraction` (0 = start, 1 = end) of the length (binary search). */
  at(fraction: number): { point: LatLon; heading: number } {
    const f = Math.min(Math.max(fraction, 0), 1);
    const target = f * this.lengthKm;
    let lo = 1;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.cumulative[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const a = this.points[i - 1] as LatLon;
    const b = this.points[i] as LatLon;
    const segStart = this.cumulative[i - 1] ?? 0;
    const segLen = (this.cumulative[i] ?? 0) - segStart;
    const t = segLen === 0 ? 0 : (target - segStart) / segLen;
    return {
      point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      heading: bearingDeg(a, b),
    };
  }
}

const polylines = new WeakMap<Route, { forward: Polyline; back: Polyline }>();

function cached(route: Route): { forward: Polyline; back: Polyline } {
  let p = polylines.get(route);
  if (!p) {
    const forward = new Polyline(route.points);
    p = { forward, back: forward.reversed() };
    polylines.set(route, p);
  }
  return p;
}

function routeOf(book: RouteBook, directionCode: string): Route {
  const r = book.routes[directionCode];
  if (!r) throw new RangeError(`no route for direction ${directionCode}`);
  return r;
}

/** Route from the depot to `directionCode` (outbound direction). */
export function routeFor(book: RouteBook, directionCode: string): Polyline {
  return cached(routeOf(book, directionCode)).forward;
}

/** Same route driven back to the depot. */
export function routeBack(book: RouteBook, directionCode: string): Polyline {
  return cached(routeOf(book, directionCode)).back;
}

export function travelMinutes(book: RouteBook, directionCode: string): number {
  return Math.round(routeOf(book, directionCode).minutes);
}

/** Average speed on the route (km/h), shown for moving vehicles. */
export function routeSpeedKmh(book: RouteBook, directionCode: string): number {
  const r = routeOf(book, directionCode);
  return Math.round(routeFor(book, directionCode).lengthKm / (r.minutes / 60));
}

/** Simple book with hand-made polylines (tests, or when the road graph is missing). */
export function loadRoutes(file: string = DEFAULT_ROUTES_FILE): RouteBook {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { depot: LatLon; routes: Record<string, LatLon[]> };
  const routes: Record<string, Route> = {};
  for (const [code, points] of Object.entries(raw.routes)) {
    routes[code] = { points, minutes: (new Polyline(points).lengthKm / FALLBACK_SPEED_KMH) * 60 };
  }
  return { depot: raw.depot, routes };
}

/** Real-road book for a depot and the destinations of its directions. */
export function buildRouteBook(
  router: RoadRouter | null,
  depot: LatLon,
  destinations: Record<string, LatLon>,
): RouteBook {
  const routes: Record<string, Route> = {};
  for (const [code, dest] of Object.entries(destinations)) {
    const road = router?.route(depot, dest);
    if (road && road.points.length >= 2) {
      routes[code] = { points: [depot, ...road.points, dest], minutes: road.minutes };
    } else {
      const points: LatLon[] = [depot, dest];
      routes[code] = { points, minutes: (new Polyline(points).lengthKm / FALLBACK_SPEED_KMH) * 60 };
    }
  }
  return { depot, routes };
}
