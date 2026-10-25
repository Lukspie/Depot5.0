/** Test doubles: a plan like the app creates it, an in-memory telemetry store and app API. */

import { SignJWT } from "jose";
import type { AlertPayload, AppApi, ManifestParcel, PlanWithLocal, ScanForward } from "../src/app-client.js";
import { addDays, zonedToUtc } from "../src/clock/time.js";
import type {
  DeviceRow,
  GateRow,
  GpsRow,
  HeartbeatRow,
  MetricRow,
  ScanRow,
  SensorRow,
  SimStateRow,
  TelemetrySink,
} from "../src/db/telemetry.js";
import type { PlanTrip, TripExecution } from "../src/simulator/types.js";

const LINEHAUL = [
  { code: "BB", name: "Banská Bystrica", dep: "20:30", door: "LD-01" },
  { code: "BA", name: "Bratislava", dep: "21:30", door: "LD-02" },
  { code: "ZA", name: "Žilina", dep: "21:00", door: "LD-03" },
];
const TRANSIT = [
  { code: "MI", name: "Michalovce", dep: "06:00", door: "LD-04", deps: ["BA", "ZA", "BB"] },
  { code: "TV", name: "Trebišov", dep: "06:15", door: "LD-05", deps: ["BA", "BB"] },
  { code: "HE", name: "Humenné", dep: "06:00", door: "LD-06", deps: ["BA", "ZA"] },
  { code: "SL", name: "Stará Ľubovňa", dep: "05:45", door: "LD-07", deps: ["ZA", "BB"] },
  { code: "SE", name: "Senica", dep: "06:30", door: "LD-08", deps: ["BA"] },
];
export const LOCAL = ["KE-01", "KE-02", "KE-03", "KE-04", "KE-05", "KE-06", "KE-07", "KE-08"];

const at = (day: string, hhmm: string, plusMin = 0): string =>
  new Date(zonedToUtc(day, hhmm) + plusMin * 60_000).toISOString();

/** Same structure as app/src/depotrack/services/trip_plan.py (incl. the Senica rotation). */
export function makePlan(day: string, idBase = 1): PlanWithLocal {
  const next = addDays(day, 1);
  const parity = Math.round(Date.parse(day) / 86_400_000) % 2;
  const transitPlate = (i: number): string => (i === 4 && parity === 1 ? "KE-206TR" : `KE-20${String(i + 1)}TR`);
  const trips: PlanTrip[] = [];
  let id = idBase;
  const base = {
    status: "planned" as const,
    vehicleKind: "truck" as const,
    operatingDay: day,
  };
  TRANSIT.forEach((t, i) => {
    trips.push({
      ...base, id: id++, kind: "inbound", vehiclePlate: transitPlate(i), directionCode: t.code,
      directionName: t.name, directionType: "transit", dependsOnLinehaul: t.deps, doorCode: t.door,
      plannedArrival: at(day, "15:45", 15 * i), plannedDeparture: null,
    });
  });
  LINEHAUL.forEach((l, i) => {
    trips.push({
      ...base, id: id++, kind: "outbound", vehiclePlate: `KE-10${String(i + 1)}LH`, directionCode: l.code,
      directionName: l.name, directionType: "linehaul", dependsOnLinehaul: [], doorCode: l.door,
      plannedArrival: at(day, "17:00"), plannedDeparture: at(day, l.dep),
    });
    trips.push({
      ...base, id: id++, kind: "inbound", vehiclePlate: `KE-10${String(i + 4)}LH`, directionCode: l.code,
      directionName: l.name, directionType: "linehaul", dependsOnLinehaul: [], doorCode: l.door,
      plannedArrival: at(next, "01:00", 30 * i), plannedDeparture: null,
    });
  });
  TRANSIT.forEach((t, i) => {
    trips.push({
      ...base, id: id++, kind: "outbound", vehiclePlate: transitPlate(i), directionCode: t.code,
      directionName: t.name, directionType: "transit", dependsOnLinehaul: t.deps, doorCode: t.door,
      plannedArrival: at(next, "03:00"), plannedDeparture: at(next, t.dep),
    });
  });
  return { day, cascadeBufferMin: 30, trips, localDirections: LOCAL };
}

export const DEVICES: DeviceRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    code: `DOCK-SCN-0${String(i + 1)}`,
    kind: "dock_scanner" as const,
    doorCode: `LD-0${String(i + 1)}`,
    enabled: true,
  })),
  { id: 9, code: "LINE-SCN-01", kind: "line_scanner", doorCode: null, enabled: true },
  { id: 10, code: "GATE-CAM-01", kind: "gate_camera", doorCode: "GATE-01", enabled: true },
  { id: 11, code: "LINE-SNS-01", kind: "line_sensor", doorCode: null, enabled: true },
  { id: 12, code: "LINE-SNS-02", kind: "line_sensor", doorCode: null, enabled: true },
  { id: 13, code: "LINE-SNS-03", kind: "line_sensor", doorCode: null, enabled: true },
];

export class MemoryStore implements TelemetrySink {
  scans: ScanRow[] = [];
  metrics = new Map<string, MetricRow>();
  heartbeats: HeartbeatRow[] = [];
  gps: GpsRow[] = [];
  gate: GateRow[] = [];
  sensors: SensorRow[] = [];
  state: SimStateRow | null = null;
  private readonly deviceRows = DEVICES.map((d) => ({ ...d }));

  devices(): Promise<DeviceRow[]> {
    return Promise.resolve(this.deviceRows.map((d) => ({ ...d })));
  }
  setDeviceEnabled(code: string, enabled: boolean): Promise<void> {
    const d = this.deviceRows.find((x) => x.code === code);
    if (d) d.enabled = enabled;
    return Promise.resolve();
  }
  insertScans(rows: ScanRow[]): Promise<void> {
    this.scans.push(...rows);
    return Promise.resolve();
  }
  upsertMetrics(rows: MetricRow[]): Promise<void> {
    for (const r of rows) {
      const key = `${String(r.deviceId)}|${String(r.minute)}`;
      const m = this.metrics.get(key) ?? { ...r, items: 0, readsOk: 0 };
      m.items += r.items;
      m.readsOk += r.readsOk;
      this.metrics.set(key, m);
    }
    return Promise.resolve();
  }
  insertHeartbeats(rows: HeartbeatRow[]): Promise<void> {
    this.heartbeats.push(...rows);
    return Promise.resolve();
  }
  insertGps(rows: GpsRow[]): Promise<void> {
    this.gps.push(...rows);
    return Promise.resolve();
  }
  insertGatePassages(rows: GateRow[]): Promise<void> {
    this.gate.push(...rows);
    return Promise.resolve();
  }
  insertSensorReadings(rows: SensorRow[]): Promise<void> {
    this.sensors.push(...rows);
    return Promise.resolve();
  }
  deleteSince(at: number): Promise<void> {
    this.scans = this.scans.filter((r) => r.at < at);
    this.gps = this.gps.filter((r) => r.at < at);
    this.gate = this.gate.filter((r) => r.at < at);
    this.sensors = this.sensors.filter((r) => r.at < at);
    for (const [k, m] of this.metrics) if (m.minute >= at) this.metrics.delete(k);
    return Promise.resolve();
  }
  purgeGatePassages(before: number): Promise<string[]> {
    const old = this.gate.filter((g) => g.at < before);
    this.gate = this.gate.filter((g) => g.at >= before);
    return Promise.resolve(old.map((g) => g.snapshotPath).filter((p): p is string => p !== null));
  }
  loadSimState(): Promise<SimStateRow | null> {
    return Promise.resolve(this.state);
  }
  saveSimState(state: SimStateRow): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }
}

/** Parcels per direction: deterministic barcodes, sizes similar to the real seed. */
export function manifestFor(direction: string, day: string): string[] {
  const sizes: Record<string, number> = { BA: 230, BB: 140, ZA: 160, MI: 165, TV: 90, HE: 115, SL: 80, SE: 60 };
  const n = sizes[direction] ?? 55;
  return Array.from({ length: n }, (_, i) => `SPS${day.replaceAll("-", "").slice(2)}${direction}${String(i).padStart(4, "0")}`);
}

const DEPENDS: Record<string, string[]> = Object.fromEntries(TRANSIT.map((t) => [t.code, t.deps]));

export class FakeApp implements AppApi {
  readonly tripEvents: { simTime: string; trips: TripExecution[] }[] = [];
  readonly scans: ScanForward[] = [];
  readonly alerts: AlertPayload[] = [];
  /** order of calls, to check that trips are sent before scans */
  readonly calls: string[] = [];
  down = false;

  planFor(day: string): PlanWithLocal {
    const offset = (Date.parse(day) / 86_400_000) % 1000;
    return makePlan(day, offset * 100);
  }

  getPlan(day: string): Promise<PlanWithLocal> {
    if (this.down) return Promise.reject(new Error("app down"));
    return Promise.resolve(this.planFor(day));
  }

  /** evening parcels + parcels arriving on the night trucks that feed the direction */
  getManifest(direction: string, day: string): Promise<ManifestParcel[]> {
    const parcels: ManifestParcel[] = manifestFor(direction, day).map((barcode) => ({ barcode, arrivesWithTripId: null }));
    const feeders = direction.startsWith("KE-") ? ["BA"] : (DEPENDS[direction] ?? []);
    for (const code of feeders) {
      const night = this.planFor(day).trips.find((t) => t.directionCode === code && t.kind === "inbound");
      if (!night) continue;
      for (let i = 0; i < 20; i++) parcels.push({ barcode: `N-${direction}-${code}-${String(i)}`, arrivesWithTripId: night.id });
    }
    return Promise.resolve(parcels);
  }

  readonly resets: string[] = [];

  resetDay(day: string): Promise<void> {
    if (this.down) return Promise.reject(new Error("app down"));
    this.resets.push(day);
    return Promise.resolve();
  }

  postScans(scans: ScanForward[]): Promise<void> {
    if (this.down) return Promise.reject(new Error("app down"));
    this.calls.push("scans");
    this.scans.push(...scans);
    return Promise.resolve();
  }
  postTripEvents(simTime: string, trips: TripExecution[]): Promise<void> {
    if (this.down) return Promise.reject(new Error("app down"));
    this.calls.push("trips");
    this.tripEvents.push({ simTime, trips });
    return Promise.resolve();
  }
  postAlert(alert: AlertPayload): Promise<void> {
    this.alerts.push(alert);
    return Promise.resolve();
  }
  /** latest reported state per trip */
  latest(): Map<number, TripExecution> {
    const m = new Map<number, TripExecution>();
    for (const batch of this.tripEvents) for (const t of batch.trips) m.set(t.tripId, t);
    return m;
  }
}

export const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

export const SECRET = "test-ws-secret-0123456789abcdef0123456789";
const key = new TextEncoder().encode(SECRET);

export async function ticket(
  role = "dispatcher",
  opts: { secret?: Uint8Array; audience?: string; expSeconds?: number; jti?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role, name: "tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("depotrack-app")
    .setAudience(opts.audience ?? "telematics")
    .setSubject("7")
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSeconds ?? 60))
    .setJti(opts.jti ?? crypto.randomUUID())
    .sign(opts.secret ?? key);
}

