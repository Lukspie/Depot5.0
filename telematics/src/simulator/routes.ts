/** Truck routes as simplified polylines (data/routes.json) and position interpolation. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type LatLon = readonly [number, number];

export interface RouteBook {
  depot: LatLon;
  averageSpeedKmh: number;
  routes: Record<string, LatLon[]>;
}

export const DEFAULT_ROUTES_FILE = fileURLToPath(new URL("../../data/routes.json", import.meta.url));

export function loadRoutes(file: string = DEFAULT_ROUTES_FILE): RouteBook {
  const raw = JSON.parse(readFileSync(file, "utf8")) as RouteBook;
  return { depot: raw.depot, averageSpeedKmh: raw.averageSpeedKmh, routes: raw.routes };
}

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

  /** Point and heading at `fraction` (0 = start, 1 = end) of the length. */
  at(fraction: number): { point: LatLon; heading: number } {
    const f = Math.min(Math.max(fraction, 0), 1);
    const target = f * this.lengthKm;
    let i = 1;
    while (i < this.points.length - 1 && (this.cumulative[i] ?? 0) < target) i++;
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

/** Route from the depot to `directionCode` (outbound direction). */
export function routeFor(book: RouteBook, directionCode: string): Polyline {
  const pts = book.routes[directionCode];
  if (!pts) throw new RangeError(`no route for direction ${directionCode}`);
  return new Polyline(pts);
}

export function travelMinutes(book: RouteBook, directionCode: string): number {
  return Math.round((routeFor(book, directionCode).lengthKm / book.averageSpeedKmh) * 60);
}
