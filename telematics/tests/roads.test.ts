import { describe, expect, it } from "vitest";
import { RoadRouter } from "../src/simulator/roads.js";
import { buildRouteBook, haversineKm, routeFor, travelMinutes, type LatLon } from "../src/simulator/routes.js";

const router = RoadRouter.load();
const BUDIMIR: LatLon = [48.79256, 21.3071];
const BA_HUB: LatLon = [48.19404, 17.22834]; // hub in Ivanka pri Dunaji (ADR-051)
const KOSICE: LatLon = [48.7164, 21.2611];

describe.skipIf(router === null)("offline road routing (OSM graph)", () => {
  it("finds the motorway route Budimír -> Bratislava hub", () => {
    const r = router?.route(BUDIMIR, BA_HUB);
    expect(r).toBeTruthy();
    expect(r?.lengthKm).toBeGreaterThan(380); // straight line is ~310 km
    expect(r?.lengthKm).toBeLessThan(470);
    expect((r?.minutes ?? 0) / 60).toBeGreaterThan(4);
    expect((r?.minutes ?? 0) / 60).toBeLessThan(6.5);
  });

  it("the geometry is continuous (no jumps between consecutive points)", () => {
    const pts = router?.route(BUDIMIR, KOSICE)?.points ?? [];
    expect(pts.length).toBeGreaterThan(20);
    for (let i = 1; i < pts.length; i++) {
      expect(haversineKm(pts[i - 1] as LatLon, pts[i] as LatLon)).toBeLessThan(3);
    }
  });

  it("is deterministic and snaps endpoints to the network", () => {
    const a = router?.route(BUDIMIR, [48.7543, 21.9195]);
    expect(router?.route(BUDIMIR, [48.7543, 21.9195])).toBe(a); // cached, identical
    const first = a?.points[0] as LatLon;
    expect(haversineKm(first, BUDIMIR)).toBeLessThan(1);
  });

  it("builds a route book with real roads for every direction", () => {
    const book = buildRouteBook(router, BUDIMIR, { BA: BA_HUB, MI: [48.7543, 21.9195] });
    expect(routeFor(book, "BA").points.length).toBeGreaterThan(100);
    expect(travelMinutes(book, "MI")).toBeGreaterThan(30);
    expect(travelMinutes(book, "MI")).toBeLessThan(90);
  });
});
