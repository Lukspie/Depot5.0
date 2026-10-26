/**
 * Hall layout of a depot/hub from GET /api/layout (ADR-039). The only source of positions for the
 * digital shadow and the 3D hall on the map: nothing is hardcoded in the components.
 *
 * Model space: metres, x = east, y = up, z = south (layout y).
 */

export interface LayoutDoor {
  code: string;
  kind: "loading_dock" | "staging_bay" | "yard_gate";
  x: number;
  y: number;
  directionCode: string | null;
  directionName: string | null;
}

export interface DepotLayout {
  depot: { code: string; name: string; kind: "depot" | "hub"; lat: number; lon: number };
  layout: {
    hall?: { width: number; depth: number; height: number; rotationDeg?: number };
    belt?: [number, number][];
    lineScanner?: [number, number];
    yardGate?: [number, number];
  };
  doors: LayoutDoor[];
}

export type DeviceStatus = "online" | "degraded" | "offline" | "maintenance";

export const DEFAULT_HALL = { width: 60, depth: 30, height: 9 };

export function hallOf(l: DepotLayout): { width: number; depth: number; height: number } {
  return l.layout.hall ?? DEFAULT_HALL;
}

/** z of the main belt (doors branch off it). */
export function beltZ(l: DepotLayout): number {
  return l.layout.belt?.[0]?.[1] ?? 0;
}

/** Where the IoT pin of a device stands (dock scanner at its door, line scanner, gate camera). */
export function devicePosition(
  l: DepotLayout,
  device: { kind: string; doorCode: string | null },
): [number, number] | null {
  if (device.kind === "dock_scanner" && device.doorCode) {
    const d = l.doors.find((x) => x.code === device.doorCode);
    return d ? [d.x, d.y + 2.5] : null;
  }
  if (device.kind === "line_scanner" && l.layout.lineScanner) return l.layout.lineScanner;
  if (device.kind === "gate_camera" && l.layout.yardGate) return [l.layout.yardGate[0] + 2, l.layout.yardGate[1]];
  return null;
}
