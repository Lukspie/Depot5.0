/**
 * Simulation engine: replays the deterministic day scenario against the simulated clock.
 *
 * Every tick (250 ms real time) it processes the simulated interval (last tick, now]:
 *   - trip status / ETA changes      -> app   (POST /internal/events/trips, batched every 1 s)
 *   - scans at loading doors / line  -> db-telemetry + WebSocket "devices"
 *   - gate passages, line sensors    -> db-telemetry (+ WebSocket)
 *   - vehicle positions              -> db-telemetry (1×/sim-minute) + WebSocket "vehicles"
 * A jump of the clock (> 15 sim-minutes in one tick) fast-forwards: states are updated, but the
 * skipped scans/passages are not generated.
 *
 * Device heartbeats run in REAL time (every 10 s); a device without a heartbeat for 30 s is offline.
 */

import { addDays, HOUR, localDate, localHhmm, localParts, MINUTE, operatingDay, operatingDayStart, TIME_ZONE, zonedToUtc } from "../clock/time.js";
import type { SimClock } from "../clock/clock.js";
import type { AppApi, PlanWithLocal } from "../app-client.js";
import type { DeviceRow, GateRow, GpsRow, HeartbeatRow, MetricRow, ScanRow, SensorRow, TelemetrySink } from "../db/telemetry.js";
import type { Hub, WsEvent } from "../ws/hub.js";
import { rngFor } from "./rng.js";
import type { RouteBook } from "./routes.js";
import { buildScenario, type DayScenario, type TripSchedule } from "./scenario.js";
import { DEFAULT_READ_RATE, lineScans, loadingScans, type ReadRateModel, type ScanEvent } from "./scanners.js";
import { activeWindow, endLocation, executionAt, gateEvents, positionAt, startLocation, statusAt } from "./trips.js";
import type { Position, TripExecution } from "./types.js";

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface EngineConfig {
  seed: number;
  envSeed: number;
  forceCascade: boolean;
  degradedDevice: string | null;
  degradationStartedAt: number | null;
  degradationHours: number;
  externalDevices: string[];
  degradedThreshold: number;
}

export interface EngineDeps {
  clock: SimClock;
  store: TelemetrySink;
  app: AppApi;
  hub: Hub;
  routes: RouteBook;
  log: Logger;
  config: EngineConfig;
  realNow?: () => number;
}

export type DeviceStatus = "online" | "degraded" | "offline";

export interface DeviceInfo {
  code: string;
  kind: DeviceRow["kind"];
  doorCode: string | null;
  enabled: boolean;
  external: boolean;
  status: DeviceStatus;
  /** read rate of the last 30 simulated minutes (null = too few items) */
  readRate: number | null;
  items30m: number;
  lastScanAt: string | null;
  lastHeartbeatAgoS: number | null;
}

export interface ClockInfo {
  simTime: string;
  localTime: string;
  timeZone: string;
  operatingDay: string;
  speed: number;
  paused: boolean;
  seed: number;
}

interface DayState {
  plan: PlanWithLocal;
  scenario: DayScenario;
  manifests: Map<string, string[]>;
  scans: ScanEvent[];
  scanIdx: number;
  gate: GateRow[];
  gateIdx: number;
}

interface DeviceRuntime {
  row: DeviceRow;
  external: boolean;
  lastHeartbeat: number;
  status: DeviceStatus;
  recent: { at: number; ok: boolean }[];
  lastScanAt: number | null;
}

interface VehicleState {
  lastKey: string;
  lastStatus: string | null;
  lastGpsMinute: number;
}

export interface VehicleEventData {
  plate: string;
  kind: string;
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
  moving: boolean;
  tripId: number | null;
  tripKind: string | null;
  status: string | null;
  directionCode: string | null;
  doorCode: string | null;
}

const TICK_MS = 250;
const FAST_FORWARD_MS = 15 * MINUTE;
const HEARTBEAT_MS = 10_000;
const OFFLINE_AFTER_MS = 30_000;
const ROLLING_MS = 30 * MINUTE;
const MIN_ITEMS_FOR_RATE = 30;
const SENSORS = ["LINE-SNS-01", "LINE-SNS-02", "LINE-SNS-03"] as const;

const iso = (ms: number): string => new Date(ms).toISOString();

export class Engine {
  private readonly days = new Map<string, DayState>();
  private readonly loadingDays = new Set<string>();
  /** real time before which a failed day load is not retried */
  private readonly dayRetryAt = new Map<string, number>();
  private readonly reported = new Map<number, string>();
  private readonly pendingTrips = new Map<number, TripExecution>();
  private readonly devices = new Map<string, DeviceRuntime>();
  private readonly vehicles = new Map<string, VehicleState>();
  private readonly metrics = new Map<string, MetricRow>();
  private lastT: number;
  private ticking = false;
  private flushing = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly realNow: () => number;
  private seedValue: number;
  private degradationStartedAt: number | null;

  constructor(private readonly deps: EngineDeps) {
    this.realNow = deps.realNow ?? Date.now;
    this.lastT = deps.clock.now();
    this.seedValue = deps.config.seed;
    this.degradationStartedAt = deps.config.degradationStartedAt;
    deps.hub.setSnapshot("clock", () => [this.clockEvent()]);
    deps.hub.setSnapshot("vehicles", () => this.vehicleSnapshot());
    deps.hub.setSnapshot("devices", () => this.devices.size ? this.deviceList().map((d) => this.deviceEvent(d)) : []);
    deps.clock.onChange(() => {
      deps.hub.publish("clock", "tick", this.clockInfo(), "clock");
    });
  }

  // ------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    const rows = await this.deps.store.devices();
    const now = this.realNow();
    for (const row of rows) {
      this.devices.set(row.code, {
        row,
        external: this.deps.config.externalDevices.includes(row.code),
        lastHeartbeat: now,
        status: "online",
        recent: [],
        lastScanAt: null,
      });
    }
  }

  start(): void {
    const every = (ms: number, fn: () => Promise<void> | void): void => {
      this.timers.push(
        setInterval(() => {
          Promise.resolve(fn()).catch((err: unknown) => {
            this.deps.log.error({ err }, "engine task failed");
          });
        }, ms),
      );
    };
    every(TICK_MS, () => this.tick());
    every(1000, () => this.flushTrips());
    every(1000, () => {
      this.deps.hub.publish("clock", "tick", this.clockInfo(), "clock");
    });
    every(HEARTBEAT_MS, () => this.heartbeats());
    every(5000, () => this.monitorDevices());
    every(10_000, () => this.persist());
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.persist();
  }

  // ------------------------------------------------------------------ public control

  get seed(): number {
    return this.seedValue;
  }

  clockInfo(): ClockInfo {
    const { simTime, speed, paused } = this.deps.clock.state();
    return {
      simTime: iso(simTime),
      localTime: localHhmm(simTime),
      timeZone: TIME_ZONE,
      operatingDay: operatingDay(simTime),
      speed,
      paused,
      seed: this.seedValue,
    };
  }

  /** New seed = the current operating day starts again from 15:00 with the new scenario. */
  async setSeed(seed: number): Promise<void> {
    this.seedValue = seed;
    await this.restartDay();
  }

  async restartDay(): Promise<void> {
    const day = operatingDay(this.deps.clock.now());
    const start = operatingDayStart(day);
    await this.deps.store.deleteSince(start);
    this.days.clear();
    this.metrics.clear();
    for (const d of this.devices.values()) {
      d.recent = [];
      d.lastScanAt = null;
    }
    if (this.deps.config.degradedDevice) this.degradationStartedAt = start + 30 * MINUTE;
    this.deps.clock.set(start);
    this.lastT = start;
    await this.ensureDay(day);
    await this.persist();
  }

  deviceList(): DeviceInfo[] {
    const now = this.deps.clock.now();
    const real = this.realNow();
    return [...this.devices.values()].map((d) => {
      const recent = d.recent.filter((r) => r.at > now - ROLLING_MS);
      return {
        code: d.row.code,
        kind: d.row.kind,
        doorCode: d.row.doorCode,
        enabled: d.row.enabled,
        external: d.external,
        status: d.status,
        readRate: recent.length >= MIN_ITEMS_FOR_RATE ? recent.filter((r) => r.ok).length / recent.length : null,
        items30m: recent.length,
        lastScanAt: d.lastScanAt === null ? null : iso(d.lastScanAt),
        lastHeartbeatAgoS: Math.round((real - d.lastHeartbeat) / 1000),
      };
    });
  }

  /** Admin: switch a device off/on (demo of an offline device) or repair the degraded scanner. */
  async updateDevice(code: string, change: { enabled?: boolean; repair?: boolean }): Promise<DeviceInfo | null> {
    const d = this.devices.get(code);
    if (!d) return null;
    if (change.enabled !== undefined && change.enabled !== d.row.enabled) {
      d.row.enabled = change.enabled;
      await this.deps.store.setDeviceEnabled(code, change.enabled);
      if (change.enabled) d.lastHeartbeat = this.realNow();
    }
    if (change.repair && this.deps.config.degradedDevice === code) {
      this.degradationStartedAt = null;
      d.recent = [];
      this.rebuildScans();
      await this.persist();
    }
    await this.monitorDevices();
    return this.deviceList().find((x) => x.code === code) ?? null;
  }

  /** Real heartbeat from an external device (Phase 6 scripts). */
  heartbeat(code: string): boolean {
    const d = this.devices.get(code);
    if (!d) return false;
    d.lastHeartbeat = this.realNow();
    return true;
  }

  /** Scans reported by a real device; same processing as simulated scans. */
  async ingestScans(
    code: string,
    events: { at?: string; barcode: string | null; readOk: boolean; facesRead?: number; itemCounted?: boolean }[],
  ): Promise<number | null> {
    const d = this.devices.get(code);
    if (!d) return null;
    const now = this.deps.clock.now();
    const scans: ScanEvent[] = events.map((e) => ({
      at: e.at ? Date.parse(e.at) : now,
      device: code,
      barcode: e.readOk ? e.barcode : null,
      readOk: e.readOk,
      facesRead: e.facesRead ?? (e.readOk ? 1 : 0),
      itemCounted: e.itemCounted ?? true,
      parcel: e.barcode ?? "",
      truth: "ok",
    }));
    await this.emitScans(scans);
    d.lastHeartbeat = this.realNow();
    return scans.length;
  }

  /** Summary of the loaded scenarios (for the admin / tests / demo script). */
  scenarioSummary(): object[] {
    return [...this.days.values()].map(({ scenario, scans, plan }) => {
      const incident = scenario.incidentTripId === null ? null : scenario.schedules.get(scenario.incidentTripId);
      return {
        day: scenario.day,
        seed: scenario.seed,
        weather: scenario.weather,
        incident: incident?.incident
          ? {
              tripId: incident.trip.id,
              direction: incident.trip.directionCode,
              plate: incident.trip.vehiclePlate,
              startsAt: iso(incident.incident.startsAt),
              durationMin: incident.incident.durationMin,
              arrival: incident.arriveDepot === undefined ? null : iso(incident.arriveDepot),
            }
          : null,
        degradation: this.readRateModel().degradation,
        unexpectedCars: scenario.unexpectedCars.map(iso),
        scans: scans.length,
        wrongDirectionScans: scans.filter((s) => s.truth === "wrong_direction").length,
        trips: plan.trips.map((t) => {
          const s = scenario.schedules.get(t.id);
          return {
            tripId: t.id,
            direction: t.directionCode,
            kind: t.kind,
            plate: t.vehiclePlate,
            delayMin: s?.delayMin ?? null,
            plannedArrival: t.plannedArrival,
            arrival: s?.arriveDepot !== undefined ? iso(s.arriveDepot) : s?.atDoor !== undefined ? iso(s.atDoor) : null,
            plannedDeparture: t.plannedDeparture,
            departure: s?.departDepot !== undefined ? iso(s.departDepot) : null,
          };
        }),
      };
    });
  }

  // ------------------------------------------------------------------ tick

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.step(this.deps.clock.now());
    } finally {
      this.ticking = false;
    }
  }

  /** Process the simulated interval (lastT, now]. Public for tests. */
  async step(now: number): Promise<void> {
    const from = this.lastT;
    const fastForward = now - from > FAST_FORWARD_MS || now < from;
    const day = operatingDay(now);
    await this.ensureDay(day);
    if (now >= operatingDayStart(addDays(day, 1)) - 2 * HOUR) void this.ensureDay(addDays(day, 1));
    for (const d of this.days.keys()) if (d < addDays(day, -1)) this.days.delete(d);

    const scans: ScanEvent[] = [];
    const gate: GateRow[] = [];
    for (const state of this.days.values()) {
      while (state.scanIdx < state.scans.length && (state.scans[state.scanIdx]?.at ?? Infinity) <= now) {
        const ev = state.scans[state.scanIdx++] as ScanEvent;
        if (!fastForward && ev.at > from) scans.push(ev);
      }
      while (state.gateIdx < state.gate.length && (state.gate[state.gateIdx]?.at ?? Infinity) <= now) {
        const ev = state.gate[state.gateIdx++] as GateRow;
        if (!fastForward && ev.at > from) gate.push(ev);
      }
    }
    await this.emitScans(scans.filter((s) => this.simulated(s.device)));
    await this.emitGate(gate);
    this.updateTrips(now);
    await this.updateVehicles(now);
    if (!fastForward) await this.emitSensors(from, now);
    await this.flushMetrics(now, fastForward);
    this.lastT = now;
  }

  // ------------------------------------------------------------------ days / scenario

  private readRateModel(): ReadRateModel {
    const dev = this.deps.config.degradedDevice;
    return {
      ...DEFAULT_READ_RATE,
      degradation:
        dev && this.degradationStartedAt !== null
          ? { device: dev, startedAt: this.degradationStartedAt, hours: this.deps.config.degradationHours, from: 0.97, to: 0.85 }
          : null,
    };
  }

  async ensureDay(day: string): Promise<void> {
    if (this.days.has(day) || this.loadingDays.has(day)) return;
    if ((this.dayRetryAt.get(day) ?? 0) > this.realNow()) return;
    this.loadingDays.add(day);
    try {
      const plan = await this.deps.app.getPlan(day);
      const scenario = buildScenario(plan, {
        seed: this.seedValue,
        forceCascade: this.deps.config.forceCascade,
        routes: this.deps.routes,
      });
      const manifests = new Map<string, string[]>();
      const directions = new Set([
        ...plan.trips.filter((t) => t.kind === "outbound").map((t) => t.directionCode),
        ...plan.localDirections,
      ]);
      for (const dir of [...directions].sort()) manifests.set(dir, await this.deps.app.getManifest(dir, day));
      const state: DayState = { plan, scenario, manifests, scans: [], scanIdx: 0, gate: [], gateIdx: 0 };
      this.buildDayEvents(state);
      // skip what already happened before the engine got here (restart, prefetch)
      const now = this.lastT;
      state.scanIdx = state.scans.findIndex((s) => s.at > now);
      if (state.scanIdx < 0) state.scanIdx = state.scans.length;
      state.gateIdx = state.gate.findIndex((g) => g.at > now);
      if (state.gateIdx < 0) state.gateIdx = state.gate.length;
      this.days.set(day, state);
      this.deps.log.info(
        { day, trips: plan.trips.length, scans: state.scans.length, weather: scenario.weather, incidentTrip: scenario.incidentTripId },
        "operating day loaded",
      );
    } catch (err) {
      this.dayRetryAt.set(day, this.realNow() + 5000);
      this.deps.log.warn({ day, err: String(err) }, "cannot load operating day yet (app unavailable?), retry in 5 s");
    } finally {
      this.loadingDays.delete(day);
    }
  }

  private dockDevice(doorCode: string | null): string | null {
    if (!doorCode) return null;
    for (const d of this.devices.values()) if (d.row.kind === "dock_scanner" && d.row.doorCode === doorCode) return d.row.code;
    return null;
  }

  private lineDevice(): string | null {
    for (const d of this.devices.values()) if (d.row.kind === "line_scanner") return d.row.code;
    return null;
  }

  /** Scans and gate passages of a day, fully determined by the scenario and the manifests. */
  private buildDayEvents(state: DayState): void {
    const { plan, scenario, manifests } = state;
    const model = this.readRateModel();
    const scans: ScanEvent[] = [];
    const outbound = plan.trips.filter((t) => t.kind === "outbound");
    for (const trip of outbound) {
      const s = scenario.schedules.get(trip.id);
      const device = this.dockDevice(trip.doorCode);
      if (!s || !device || s.loadStart === undefined || s.loadEnd === undefined) continue;
      const foreign = outbound
        .filter((o) => o.directionCode !== trip.directionCode)
        .flatMap((o) => manifests.get(o.directionCode) ?? []);
      scans.push(
        ...loadingScans({
          seed: this.seedValue,
          day: plan.day,
          key: `${trip.directionCode}-${String(trip.id)}`,
          device,
          start: s.loadStart,
          end: s.loadEnd,
          manifest: manifests.get(trip.directionCode) ?? [],
          foreign,
          model,
        }),
      );
    }
    const line = this.lineDevice();
    if (line) {
      const next = addDays(plan.day, 1);
      const morning = [
        ...outbound.filter((t) => t.directionType === "transit").map((t) => t.directionCode),
        ...plan.localDirections,
      ].flatMap((dir) => manifests.get(dir) ?? []);
      scans.push(
        ...lineScans({
          seed: this.seedValue,
          day: plan.day,
          device: line,
          start: zonedToUtc(next, "01:15"),
          end: zonedToUtc(next, "05:30"),
          parcels: morning,
          model,
        }),
      );
    }
    state.scans = scans.sort((a, b) => a.at - b.at || a.device.localeCompare(b.device));

    const rng = rngFor(this.seedValue, plan.day, "gate");
    const gate: GateRow[] = [];
    for (const s of scenario.schedules.values()) {
      for (const g of gateEvents(s)) {
        const misread = rng.chance(0.03);
        gate.push({
          at: g.at,
          direction: g.direction,
          vehicleType: "truck",
          plate: misread ? null : g.plate,
          plateConfidence: misread ? Number(rng.float(0.2, 0.55).toFixed(2)) : Number(rng.float(0.86, 0.99).toFixed(2)),
          snapshotPath: null,
          expected: true,
        });
      }
    }
    for (const at of scenario.unexpectedCars) {
      gate.push({
        at,
        direction: "in",
        vehicleType: "car",
        plate: `${rng.pick(["KE", "KS", "PO", "MI"])}-${String(rng.int(100, 999))}${rng.pick(["AB", "CE", "HK", "TT", "ZZ"])}`,
        plateConfidence: Number(rng.float(0.8, 0.97).toFixed(2)),
        snapshotPath: null,
        expected: false,
      });
    }
    state.gate = gate.sort((a, b) => a.at - b.at);
  }

  /** Recompute future scans after the read-rate model changed (scanner repaired). */
  private rebuildScans(): void {
    const now = this.deps.clock.now();
    for (const state of this.days.values()) {
      this.buildDayEvents(state);
      const s = state.scans.findIndex((x) => x.at > now);
      state.scanIdx = s < 0 ? state.scans.length : s;
      const g = state.gate.findIndex((x) => x.at > now);
      state.gateIdx = g < 0 ? state.gate.length : g;
    }
  }

  private schedules(): TripSchedule[] {
    return [...this.days.values()].flatMap((d) => [...d.scenario.schedules.values()]);
  }

  // ------------------------------------------------------------------ trips -> app

  private updateTrips(now: number): void {
    for (const s of this.schedules()) {
      const exec = executionAt(s, now);
      const key = JSON.stringify(exec);
      if (this.reported.get(s.trip.id) !== key) this.pendingTrips.set(s.trip.id, exec);
      else this.pendingTrips.delete(s.trip.id);
    }
  }

  async flushTrips(): Promise<void> {
    if (this.flushing || this.pendingTrips.size === 0) return;
    this.flushing = true;
    const batch = [...this.pendingTrips.values()];
    try {
      await this.deps.app.postTripEvents(iso(this.deps.clock.now()), batch);
      for (const exec of batch) {
        this.reported.set(exec.tripId, JSON.stringify(exec));
        if (this.pendingTrips.get(exec.tripId) === exec) this.pendingTrips.delete(exec.tripId);
      }
    } catch (err) {
      this.deps.log.warn({ err: String(err), trips: batch.length }, "trip sync to app failed, will retry");
    } finally {
      this.flushing = false;
    }
  }

  // ------------------------------------------------------------------ vehicles

  private vehiclePosition(plate: string, now: number): { pos: Position; schedule: TripSchedule | null } {
    const own = this.schedules()
      .filter((s) => s.trip.vehiclePlate === plate)
      .sort((a, b) => activeWindow(a)[0] - activeWindow(b)[0]);
    const book = this.deps.routes;
    const active = own.filter((s) => {
      const [a, b] = activeWindow(s);
      return now >= a && now < b;
    });
    const current = active[active.length - 1];
    if (current) return { pos: positionAt(current, now, book), schedule: current };
    const past = own.filter((s) => activeWindow(s)[1] <= now);
    const last = past[past.length - 1];
    const next = own.find((s) => activeWindow(s)[0] > now);
    const at = last ? endLocation(last, book) : next ? startLocation(next, book) : book.depot;
    return { pos: { lat: at[0], lon: at[1], speedKmh: 0, heading: 0, moving: false }, schedule: null };
  }

  private vehicleEvent(plate: string, kind: string, now: number): { data: VehicleEventData; pos: Position } {
    const { pos, schedule } = this.vehiclePosition(plate, now);
    return {
      pos,
      data: {
        plate,
        kind,
        lat: Number(pos.lat.toFixed(5)),
        lon: Number(pos.lon.toFixed(5)),
        speedKmh: pos.speedKmh,
        heading: Math.round(pos.heading),
        moving: pos.moving,
        tripId: schedule?.trip.id ?? null,
        tripKind: schedule?.trip.kind ?? null,
        status: schedule ? statusAt(schedule, now) : null,
        directionCode: schedule?.trip.directionCode ?? null,
        doorCode: schedule?.trip.doorCode ?? null,
      },
    };
  }

  private plates(): Map<string, "truck" | "van"> {
    const plates = new Map<string, "truck" | "van">();
    for (const d of this.days.values()) for (const t of d.plan.trips) plates.set(t.vehiclePlate, t.vehicleKind);
    return plates;
  }

  private vehicleSnapshot(): WsEvent[] {
    const now = this.deps.clock.now();
    return [...this.plates()].map(([plate, kind]) => ({
      channel: "vehicles" as const,
      type: "position",
      data: this.vehicleEvent(plate, kind, now).data,
    }));
  }

  private async updateVehicles(now: number): Promise<void> {
    const gps: GpsRow[] = [];
    const minute = Math.floor(now / MINUTE);
    for (const [plate, kind] of this.plates()) {
      const { data, pos } = this.vehicleEvent(plate, kind, now);
      const key = JSON.stringify(data);
      let v = this.vehicles.get(plate);
      if (!v) {
        v = { lastKey: "", lastStatus: null, lastGpsMinute: 0 };
        this.vehicles.set(plate, v);
      }
      if (key === v.lastKey) continue;
      const status = data.status;
      const statusChanged = status !== v.lastStatus;
      v.lastKey = key;
      v.lastStatus = status;
      this.deps.hub.publish("vehicles", "position", data, plate);
      if ((pos.moving && minute > v.lastGpsMinute) || statusChanged) {
        v.lastGpsMinute = minute;
        gps.push({ plate, at: now, lat: pos.lat, lon: pos.lon, speedKmh: pos.speedKmh, heading: pos.heading });
      }
    }
    await this.safe("gps", () => this.deps.store.insertGps(gps));
  }

  // ------------------------------------------------------------------ devices

  private simulated(code: string): boolean {
    const d = this.devices.get(code);
    return d !== undefined && !d.external && d.row.enabled;
  }

  private async emitScans(events: ScanEvent[]): Promise<void> {
    if (events.length === 0) return;
    const rows: ScanRow[] = [];
    for (const ev of events) {
      const d = this.devices.get(ev.device);
      if (!d) continue;
      rows.push({
        deviceId: d.row.id,
        at: ev.at,
        barcode: ev.barcode,
        readOk: ev.readOk,
        facesRead: ev.facesRead,
        itemCounted: ev.itemCounted,
      });
      d.recent.push({ at: ev.at, ok: ev.readOk });
      d.lastScanAt = ev.at;
      const minute = Math.floor(ev.at / MINUTE) * MINUTE;
      const mkey = `${String(d.row.id)}|${String(minute)}`;
      const m = this.metrics.get(mkey) ?? { deviceId: d.row.id, minute, items: 0, readsOk: 0 };
      if (ev.itemCounted) m.items++;
      if (ev.readOk) m.readsOk++;
      this.metrics.set(mkey, m);
      this.deps.hub.publish("devices", "scan", {
        device: ev.device,
        doorCode: d.row.doorCode,
        at: iso(ev.at),
        barcode: ev.barcode,
        readOk: ev.readOk,
        facesRead: ev.facesRead,
        itemCounted: ev.itemCounted,
      });
    }
    await this.safe("scans", () => this.deps.store.insertScans(rows));
  }

  private async emitGate(rows: GateRow[]): Promise<void> {
    if (rows.length === 0) return;
    for (const g of rows) {
      this.deps.hub.publish("devices", "gate_passage", { ...g, at: iso(g.at), device: "GATE-CAM-01" });
    }
    await this.safe("gate", () => this.deps.store.insertGatePassages(rows));
  }

  private async emitSensors(from: number, now: number): Promise<void> {
    const rows: SensorRow[] = [];
    const first = Math.floor(from / MINUTE) + 1;
    const last = Math.floor(now / MINUTE);
    for (let m = Math.max(first, last - 30); m <= last; m++) {
      const at = m * MINUTE;
      const wave = this.waveProgress(at);
      if (wave === null) continue;
      const rng = rngFor(this.seedValue, "sensors", m);
      const load = Math.min(100, 25 + 55 * Math.sin(Math.PI * wave) + rng.normal(0, 4));
      const values: Record<(typeof SENSORS)[number], number> = {
        "LINE-SNS-01": 1.8 + rng.normal(0, 0.03), // belt speed m/s
        "LINE-SNS-02": 32 + 18 * Math.min(1, wave * 3) + rng.normal(0, 0.4), // motor °C
        "LINE-SNS-03": Math.max(0, load), // belt load %
      };
      for (const sensor of SENSORS) {
        if (!this.simulated(sensor)) continue;
        rows.push({ at, sensor, value: Number(values[sensor].toFixed(2)) });
      }
    }
    await this.safe("sensors", () => this.deps.store.insertSensorReadings(rows));
  }

  /** 0..1 progress through the current sorting wave, or null outside the waves. */
  private waveProgress(at: number): number | null {
    const p = localParts(at);
    const mins = p.hour * 60 + p.minute;
    if (mins >= 15 * 60 + 30 && mins < 22 * 60) return (mins - (15 * 60 + 30)) / (6.5 * 60);
    if (mins >= 60 && mins < 6 * 60) return (mins - 60) / (5 * 60);
    return null;
  }

  private async flushMetrics(now: number, all: boolean): Promise<void> {
    const currentMinute = Math.floor(now / MINUTE) * MINUTE;
    const done: MetricRow[] = [];
    for (const [key, m] of this.metrics) {
      if (all || m.minute < currentMinute) {
        done.push(m);
        this.metrics.delete(key);
      }
    }
    await this.safe("metrics", () => this.deps.store.upsertMetrics(done));
  }

  async heartbeats(): Promise<void> {
    const at = this.deps.clock.now();
    const rows: HeartbeatRow[] = [];
    for (const d of this.devices.values()) {
      if (d.external || !d.row.enabled) continue;
      d.lastHeartbeat = this.realNow();
      rows.push({ deviceId: d.row.id, at, status: d.status === "offline" ? "online" : d.status });
    }
    await this.safe("heartbeats", () => this.deps.store.insertHeartbeats(rows));
  }

  async monitorDevices(): Promise<void> {
    const now = this.deps.clock.now();
    const real = this.realNow();
    for (const d of this.devices.values()) {
      d.recent = d.recent.filter((r) => r.at > now - ROLLING_MS);
      const rate = d.recent.length >= MIN_ITEMS_FOR_RATE ? d.recent.filter((r) => r.ok).length / d.recent.length : null;
      let status: DeviceStatus = "online";
      if (real - d.lastHeartbeat > OFFLINE_AFTER_MS) status = "offline";
      else if (rate !== null && rate < this.deps.config.degradedThreshold) status = "degraded";
      if (status === d.status) continue;
      const previous = d.status;
      d.status = status;
      const info = this.deviceList().find((x) => x.code === d.row.code);
      if (info) this.deps.hub.publish("devices", "status", info, d.row.code);
      if (status === "offline" || previous === "offline") {
        await this.safe("alert", () =>
          this.deps.app.postAlert({
            kind: "device_offline",
            severity: "critical",
            message: `Zariadenie ${d.row.code}${d.row.doorCode ? ` (brána ${d.row.doorCode})` : ""} neposiela heartbeat – je offline.`,
            refType: "device",
            refId: d.row.code,
            at: iso(now),
            resolved: status !== "offline",
          }),
        );
      }
    }
  }

  private deviceEvent(d: DeviceInfo): WsEvent {
    return { channel: "devices", type: "status", data: d };
  }

  private clockEvent(): WsEvent {
    return { channel: "clock", type: "tick", data: this.clockInfo() };
  }

  async persist(): Promise<void> {
    const { simTime, speed, paused } = this.deps.clock.state();
    await this.safe("sim_state", () =>
      this.deps.store.saveSimState({
        simTime,
        speed,
        paused,
        seed: this.seedValue,
        envSeed: this.deps.config.envSeed,
        degradedDevice: this.deps.config.degradedDevice,
        degradationStartedAt: this.degradationStartedAt,
      }),
    );
  }

  private async safe(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.deps.log.error({ err: String(err), what }, "telemetry write failed");
    }
  }
}

/** Initial simulator state when db-telemetry has none yet (first start). */
export function initialSimTime(startDate: string | null, startTime: string, realNow: number): number {
  return zonedToUtc(startDate ?? localDate(realNow), startTime);
}
