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
  doorDrive: "electric" | "manual";
  dockEquipment: "dock_leveler" | "telescopic_conveyor" | "none";
}

/** State of a door from its contact sensor (ADR-050); undefined = no reading yet. */
export type DoorState = "open" | "closed" | "fault" | "unknown";

/** A parking or loading place in the yard; heading in degrees of the hall frame (0 = +x, 90 = +z). */
export interface YardSlot {
  code?: string;
  bay?: string;
  x: number;
  y: number;
  heading: number;
}

/** The depot's yard from OSM and the team's notes (phase 7c, ADR-064). */
export interface Yard {
  gate: [number, number];
  /** direction vehicles drive in through the gate (towards the hall) */
  gateHeading?: number;
  truckStands: YardSlot[];
  vanParking: YardSlot[];
  vanLoading: YardSlot[];
  carParking: YardSlot[];
  lanes: [number, number][][];
  gatehouse?: [number, number];
}

export interface DepotLayout {
  depot: { code: string; name: string; kind: "depot" | "hub"; lat: number; lon: number; label?: string | null };
  layout: {
    /** centre of the hall (map anchor); the depot's lat/lon is its routing point */
    origin?: [number, number];
    hall?: { width: number; depth: number; height: number; rotationDeg?: number };
    /** real outline of the hall from OSM, in the hall frame */
    footprint?: [number, number][];
    site?: [number, number][];
    belt?: [number, number][];
    lineScanner?: [number, number];
    yardGate?: [number, number];
    /** direction every wall door faces, degrees in the hall frame */
    doorFacing?: Record<string, number>;
    yard?: Yard;
  };
  doors: LayoutDoor[];
  /** vans of a depot without simulated operations, on their parking spot (ADR-066) */
  parked?: { plate: string; x: number; y: number; heading: number }[];
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

/** Direction a door faces (degrees, 0 = +x, 90 = +z); older layouts: docks on the north wall. */
export function facingOf(l: DepotLayout, door: LayoutDoor): number {
  return l.layout.doorFacing?.[door.code] ?? (door.kind === "loading_dock" ? 270 : 90);
}

/** Unit vector of a heading in the model plane (x, z). */
export function headingVec(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** rotation-y of a part modelled facing -z (north) so that it faces `deg`. */
export function facingRotation(deg: number): number {
  return ((270 - deg) * Math.PI) / 180;
}

/** A point `out` metres in front of a door (negative = inside the hall). */
export function inFront(l: DepotLayout, door: LayoutDoor, out: number): [number, number] {
  const [fx, fz] = headingVec(facingOf(l, door));
  return [door.x + fx * out, door.y + fz * out];
}

/** Where the IoT pin of a device stands (dock scanner at its door, line scanner, gate camera). */
export function devicePosition(
  l: DepotLayout,
  device: { kind: string; doorCode: string | null },
): [number, number] | null {
  if (device.kind === "dock_scanner" && device.doorCode) {
    const d = l.doors.find((x) => x.code === device.doorCode);
    return d ? inFront(l, d, -2.5) : null;
  }
  if (device.kind === "line_scanner" && l.layout.lineScanner) return l.layout.lineScanner;
  if (device.kind === "gate_camera" && l.layout.yardGate) return [l.layout.yardGate[0] + 2, l.layout.yardGate[1]];
  return null;
}
