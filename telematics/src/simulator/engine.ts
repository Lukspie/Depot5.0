/**
 * Simulation engine: replays the deterministic day scenario against the simulated clock.
 *
 * Every tick (250 ms real time) it processes the simulated interval (last tick, now]:
 *   - trip status / ETA changes      -> app   (POST /internal/events/trips, batched every 1 s)
 *   - scans at loading doors / line  -> db-telemetry + WebSocket "devices"
 *   - gate passages, line sensors    -> db-telemetry (+ WebSocket)
 *   - vehicle positions              -> db-telemetry (1×/sim-minute) + WebSocket "vehicles"
 *   - courier rounds (loaded, delivered…, ETAs) -> app (POST /internal/events/couriers)
 * A jump of the clock (> 15 sim-minutes in one tick) fast-forwards: states are updated, but the
 * skipped scans/passages are not generated. Courier events are state changes and are always sent.
 *
 * Device heartbeats run in REAL time (every 10 s); a device without a heartbeat for 30 s is offline.
 */

import { addDays, HOUR, localDate, localHhmm, localParts, MINUTE, operatingDay, operatingDayStart, TIME_ZONE, zonedToUtc } from "../clock/time.js";
import type { SimClock } from "../clock/clock.js";
import type { AppApi, CourierEventOut, GateForward, ManifestParcel, PlanWithLocal, ScanForward, StopEtaOut } from "../app-client.js";
import { BufferedSink } from "../db/buffered.js";
import type { DeviceRow, GateRow, GpsRow, HeartbeatRow, MetricRow, ScanRow, SensorRow, TelemetrySink } from "../db/telemetry.js";
import type { Hub, WsEvent } from "../ws/hub.js";
import {
  buildCourierSchedules,
  courierEvents,
  courierStateAt,
  predictedEtas,
  remainingPath,
  type CourierEvent,
  type CourierSchedule,
} from "./couriers.js";
import { depotGateMix, gateMix } from "./gatemix.js";
import { rngFor } from "./rng.js";
import type { RoadRouter } from "./roads.js";
import type { LatLon, RouteBook } from "./routes.js";
import { buildScenario, type DayScenario, type TripSchedule } from "./scenario.js";
import { dayScans } from "./dayevents.js";
import { DEFAULT_LATE_THRESHOLD_MIN, runWhatIf, validateInterventions, type Intervention, type WhatIfResult } from "./whatif.js";
import { situationTarget, type Situation } from "./situations.js";
import { DEFAULT_READ_RATE, type ReadRateModel, type ScanEvent } from "./scanners.js";
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
  /** SIM_CONTROLS_ENABLED (default true): shown to the admin UI in the clock info */
  controlsEnabled?: boolean;
  /** what-if: a transit departure is late above this many minutes (WHATIF_LATE_THRESHOLD_MIN, default 15) */
  lateThresholdMin?: number;
  /** a situation loaded before the last restart (sim_state): its switches win over .env */
  situation?: { id: string; forceCascade: boolean; degradedDevice: string | null } | null;
}

export interface EngineDeps {
  clock: SimClock;
  store: TelemetrySink;
  app: AppApi;
  hub: Hub;
  /** fixed book (tests) or a builder from the plan's depot and destinations (real roads) */
  routes: RouteBook | ((plan: PlanWithLocal) => RouteBook);
  /** street graph for the courier vans (null = straight lines, unit tests) */
  router?: RoadRouter | null;
  log: Logger;
  config: EngineConfig;
  realNow?: () => number;
}

/** Door contact sensor (ADR-050): the only source of the door state shown in the shadow. */
/** "unknown": the sensor is switched off or external without data, nothing to show as valid */
export type DoorState = "open" | "closed" | "fault" | "unknown";

export interface DoorEvent {
  device: string;
  doorCode: string;
  state: DoorState;
  at: string;
}

/** "maintenance": marked by a dispatcher in the WMS, no scans until the service is done */
export type DeviceStatus = "online" | "degraded" | "offline" | "maintenance";

export interface MetricBucket {
  at: string;
  items: number;
  readRate: number | null;
}

export interface DeviceInfo {
  code: string;
  depotCode: string;
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

/** Result of a replay (`advance`): how much was simulated and where the real time went. */
export interface AdvanceResult {
  from: string;
  to: string;
  minutes: number;
  /** scans forwarded to the app */
  scans: number;
  /** real milliseconds: total, simulation steps (incl. db-telemetry), sync to the app */
  ms: number;
  stepMs: number;
  syncMs: number;
}

/** A replay, day restart, seed change or reset is running: the API answers 409. */
export class ReplayBusyError extends Error {
  constructor() {
    super("the simulation is busy (replay or reset running)");
  }
}

/** A replay could not reach the app or load an operating day: it stops where it is (503). */
export class ReplayStoppedError extends Error {
  constructor(
    message: string,
    readonly stoppedAt: number,
  ) {
    super(message);
  }
}

const FINISHED_TRIP = new Set(["departed", "completed", "cancelled"]);

export interface ClockInfo {
  simTime: string;
  localTime: string;
  timeZone: string;
  operatingDay: string;
  speed: number;
  paused: boolean;
  seed: number;
  controlsEnabled: boolean;
  /** id of the loaded situation (ADR-054), null after a clean reset */
  situation: string | null;
}

interface DayState {
  plan: PlanWithLocal;
  book: RouteBook;
  scenario: DayScenario;
  manifests: Map<string, ManifestParcel[]>;
  scans: ScanEvent[];
  scanIdx: number;
  gate: GateRow[];
  gateIdx: number;
  couriers: CourierSchedule[];
  courierEvents: CourierEvent[];
  courierIdx: number;
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
  /** courier vans: route in the app and progress */
  routeId?: number | null;
  stopsDone?: number;
  stopsTotal?: number;
}

const TICK_MS = 250;
const FAST_FORWARD_MS = 15 * MINUTE;
/** a replay sends trips and scans to the app this often (simulated time) */
const REPLAY_SYNC_MS = 10 * MINUTE;
const HEARTBEAT_MS = 10_000;
const OFFLINE_AFTER_MS = 30_000;
const ROLLING_MS = 30 * MINUTE;
const MIN_ITEMS_FOR_RATE = 30;
const SENSORS = ["LINE-SNS-01", "LINE-SNS-02", "LINE-SNS-03"] as const;
/** night parcels reach the belt / the dock this long after their truck arrived */
const MAX_SCAN_QUEUE = 20_000;
const BUCKET_MS = 10 * MINUTE;

const iso = (ms: number): string => new Date(ms).toISOString();

export class Engine {
  private readonly days = new Map<string, DayState>();
  /** operating days being loaded; a step waits for the load of its own day */
  private readonly dayLoads = new Map<string, Promise<void>>();
  /** real time before which a failed day load is not retried */
  private readonly dayRetryAt = new Map<string, number>();
  private readonly reported = new Map<number, string>();
  private readonly pendingTrips = new Map<number, TripExecution>();
  /** scans waiting to be sent to the app (loading check / sorting) */
  private scanQueue: ScanForward[] = [];
  /** courier events and the latest ETA predictions per route, waiting for the app */
  private courierQueue: CourierEventOut[] = [];
  /** simulated gate passages for the decision rules in the app (ADR-061) */
  private gateQueue: GateForward[] = [];
  private readonly pendingEtas = new Map<number, StopEtaOut[]>();
  private readonly devices = new Map<string, DeviceRuntime>();
  private readonly vehicles = new Map<string, VehicleState>();
  private readonly metrics = new Map<string, MetricRow>();
  private lastT: number;
  private ticking = false;
  private flushing = false;
  /** target of the running replay (`advance`), null when the clock runs normally */
  private replayTarget: number | null = null;
  /** mutual exclusion of replay, restart, seed, reset and situations */
  private busy = false;
  /** scans queued for the app since start (a replay reports its share; the background flush drains the queue) */
  private forwardedScans = 0;
  /** during a replay the telemetry rows are written in batches (Azure latency, ADR-056) */
  private buffer: BufferedSink | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly realNow: () => number;
  private seedValue: number;
  /** scenario switches: .env, or the loaded situation (ADR-054) */
  private forceCascadeValue: boolean;
  private degradedDeviceValue: string | null;
  private situationId: string | null;
  private degradationStartedAt: number | null;
  /** last reported state of every door sensor */
  private readonly doorStates = new Map<string, DoorEvent>();
  /** devices under maintenance: until when (simulated time) */
  private readonly maintenanceUntil = new Map<string, number>();
  /** routes of the most recently loaded day (depot + destinations rarely change) */
  private book: RouteBook | null = null;

  constructor(private readonly deps: EngineDeps) {
    this.realNow = deps.realNow ?? Date.now;
    this.lastT = deps.clock.now();
    this.seedValue = deps.config.seed;
    this.forceCascadeValue = deps.config.situation?.forceCascade ?? deps.config.forceCascade;
    this.degradedDeviceValue = deps.config.situation ? deps.config.situation.degradedDevice : deps.config.degradedDevice;
    this.situationId = deps.config.situation?.id ?? null;
    this.degradationStartedAt = deps.config.degradationStartedAt;
    deps.hub.setSnapshot("clock", () => [this.clockEvent()]);
    deps.hub.setSnapshot("vehicles", () => this.vehicleSnapshot());
    deps.hub.setSnapshot("devices", () =>
      this.devices.size
        ? [...this.deviceList().map((d) => this.deviceEvent(d)), ...[...this.doorStates.values()].map((e) => ({ channel: "devices" as const, type: "door", data: e }))]
        : [],
    );
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
    every(1000, () => (this.replayTarget === null ? this.flushTrips() : undefined));
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
      controlsEnabled: this.deps.config.controlsEnabled ?? true,
      situation: this.situationId,
    };
  }

  /** New seed = the current operating day starts again from 15:00 with the new scenario. */
  async setSeed(seed: number): Promise<void> {
    await this.exclusive(async () => {
      this.seedValue = seed;
      await this.restartDayNow();
    });
  }

  /**
   * Clean reset (phase 5d, ADR-053): the seed from .env, every switched-off device on again, and the
   * operating day from 15:00 with the app also dropping the day's maintenance orders and closing
   * older open alerts. Maintenance windows, moved trips and the door states go with restartDay.
   */
  async cleanReset(): Promise<void> {
    await this.exclusive(() => this.cleanResetNow());
  }

  private async cleanResetNow(): Promise<void> {
    this.seedValue = this.deps.config.envSeed;
    this.forceCascadeValue = this.deps.config.forceCascade;
    this.degradedDeviceValue = this.deps.config.degradedDevice;
    this.situationId = null;
    await this.cleanRestart();
  }

  /**
   * Load a situation (ADR-054): a clean reset with its seed and scenario switches, then a replay
   * from 15:00 to its time. The switches stay until the next clean reset (also over a restart).
   */
  async loadSituation(s: Situation): Promise<AdvanceResult> {
    return this.exclusive(() => this.loadSituationNow(s));
  }

  private async loadSituationNow(s: Situation): Promise<AdvanceResult> {
    this.seedValue = s.seed;
    this.forceCascadeValue = s.forceCascade ?? this.deps.config.forceCascade;
    this.degradedDeviceValue = s.degradedDevice === undefined ? this.deps.config.degradedDevice : s.degradedDevice;
    this.situationId = s.id;
    await this.cleanRestart();
    return this.advanceNow(situationTarget(this.deps.clock.now(), s));
  }

  private async cleanRestart(): Promise<void> {
    for (const d of this.devices.values()) {
      if (!d.external && !d.row.enabled) await this.updateDevice(d.row.code, { enabled: true });
    }
    await this.restartDayNow({ clean: true });
  }

  async restartDay(opts: { clean?: boolean } = {}): Promise<void> {
    await this.exclusive(() => this.restartDayNow(opts));
  }

  /** Restart without the mutex (callers hold it); no tick or flush runs during the reset. */
  private async restartDayNow(opts: { clean?: boolean } = {}): Promise<void> {
    while (this.ticking || this.flushing) await new Promise((r) => setTimeout(r, 5));
    this.ticking = true;
    try {
      await this.restartDayInner(opts);
    } finally {
      this.ticking = false;
    }
  }

  private async restartDayInner(opts: { clean?: boolean }): Promise<void> {
    const day = operatingDay(this.deps.clock.now());
    const start = operatingDayStart(day);
    // the app keeps parcel/trip states: they must be reset too, or the replay would differ
    await this.deps.app.resetDay(day, opts.clean ?? false);
    this.pendingTrips.clear();
    this.reported.clear();
    await this.deps.store.deleteSince(start);
    this.days.clear();
    this.metrics.clear();
    this.scanQueue = [];
    this.courierQueue = [];
    this.gateQueue = [];
    this.pendingEtas.clear();
    // maintenance windows are in simulated time: the replayed day starts without them
    this.maintenanceUntil.clear();
    this.doorStates.clear();
    for (const d of this.devices.values()) {
      d.recent = [];
      d.lastScanAt = null;
      if (d.status === "maintenance") d.status = "online";
    }
    this.degradationStartedAt = this.degradedDeviceValue ? start + 30 * MINUTE : null;
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
        depotCode: d.row.depotCode,
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

  /**
   * Read rate of a device in 10-minute buckets over the last `hours` (sparkline in /shadow).
   * Flushed minutes come from db-telemetry, the current minute from memory.
   */
  async deviceMetrics(code: string, hours: number): Promise<MetricBucket[] | null> {
    const d = this.devices.get(code);
    if (!d) return null;
    const now = this.deps.clock.now();
    const from = Math.floor((now - hours * HOUR) / BUCKET_MS) * BUCKET_MS;
    const stored = await this.deps.store.deviceMetrics(d.row.id, from, now + MINUTE);
    const pending = [...this.metrics.values()].filter((m) => m.deviceId === d.row.id && m.minute >= from);
    const buckets = new Map<number, { items: number; readsOk: number }>();
    for (const m of [...stored, ...pending]) {
      const at = Math.floor(m.minute / BUCKET_MS) * BUCKET_MS;
      const b = buckets.get(at) ?? { items: 0, readsOk: 0 };
      b.items += m.items;
      b.readsOk += m.readsOk;
      buckets.set(at, b);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([at, b]) => ({ at: iso(at), items: b.items, readRate: b.items > 0 ? Number((b.readsOk / b.items).toFixed(4)) : null }));
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
    if (change.repair) await this.repair(code);
    await this.monitorDevices();
    return this.deviceList().find((x) => x.code === code) ?? null;
  }

  /**
   * Clean the optics of the degraded scanner: its read rate is back to normal for the rest of
   * the operating day. The optics get dirty again from the next day (15:30), so the guaranteed
   * degradation scenario of the default seed stays for phase 6 (and restartDay starts it again).
   */
  private async repair(code: string): Promise<void> {
    const d = this.devices.get(code);
    if (!d) return;
    d.recent = [];
    if (this.degradedDeviceValue !== code) return;
    const day = operatingDay(this.deps.clock.now());
    this.degradationStartedAt = operatingDayStart(addDays(day, 1)) + 30 * MINUTE;
    this.rebuildScans();
    await this.persist();
  }

  /**
   * WMS action "mark for maintenance" (app -> POST /internal/devices/:code/maintenance): the device
   * shows status "maintenance" and sends no scans for `minutes` of simulated time (operators scan by
   * hand meanwhile), then it is repaired.
   */
  async startMaintenance(code: string, minutes: number): Promise<DeviceInfo | null> {
    if (!this.devices.has(code)) return null;
    this.maintenanceUntil.set(code, this.deps.clock.now() + minutes * MINUTE);
    await this.monitorDevices();
    return this.deviceList().find((x) => x.code === code) ?? null;
  }

  /** maintenance windows that are over: repair the device */
  private async finishMaintenance(now: number): Promise<void> {
    for (const [code, until] of this.maintenanceUntil) {
      if (now < until) continue;
      this.maintenanceUntil.delete(code);
      await this.repair(code);
      await this.monitorDevices();
    }
  }

  /**
   * One door sensor per operating day fails for 30-75 min during the evening wave; its own random
   * stream, so scans, trips and the cascade stay exactly as before (ADR-023, ADR-050).
   */
  private doorFault(day: string): { door: string; from: number; to: number } | null {
    const doors = [...this.devices.values()].filter((d) => d.row.kind === "door_sensor" && d.row.doorCode).map((d) => d.row.doorCode as string).sort();
    if (doors.length === 0) return null;
    const rng = rngFor(this.seedValue, day, "door");
    const door = rng.pick(doors);
    // starts 17:30-20:45 and lasts at most 75 min: always over by the end of the wave (22:00)
    const from = zonedToUtc(day, "17:30") + rng.int(0, 195) * MINUTE;
    return { door, from, to: from + rng.int(30, 75) * MINUTE };
  }

  /** What the door sensor of `door` reads at `now`: open while a truck is at the door, or fault. */
  doorState(door: string, now: number, fault = this.doorFault(operatingDay(now))): DoorState {
    if (fault && fault.door === door && now >= fault.from && now < fault.to) return "fault";
    for (const state of this.days.values()) {
      for (const s of state.scenario.schedules.values()) {
        if (s.trip.doorCode !== door) continue;
        const atDoor = s.trip.kind === "outbound" ? s.atDoor : s.arriveDepot;
        const leaves = s.trip.kind === "outbound" ? s.departDepot : s.unloadedAt;
        if (atDoor !== undefined && leaves !== undefined && now >= atDoor && now < leaves) return "open";
      }
    }
    return "closed";
  }

  /** Publish door sensor changes on the "devices" channel (type "door"). */
  private updateDoors(now: number): void {
    const fault = this.doorFault(operatingDay(now));
    for (const d of this.devices.values()) {
      if (d.row.kind !== "door_sensor" || !d.row.doorCode) continue;
      // a switched-off sensor gives no reading: the shadow must not keep the last one as valid
      const state = this.simulated(d.row.code) ? this.doorState(d.row.doorCode, now, fault) : "unknown";
      if (this.doorStates.get(d.row.code)?.state === state) continue;
      const ev: DoorEvent = { device: d.row.code, doorCode: d.row.doorCode, state, at: iso(now) };
      this.doorStates.set(d.row.code, ev);
      // own coalescing key: the "status" event of the same device must not overwrite it in a batch
      this.deps.hub.publish("devices", "door", ev, `door:${d.row.code}`);
    }
  }

  private inMaintenance(code: string, at: number): boolean {
    const until = this.maintenanceUntil.get(code);
    return until !== undefined && at < until;
  }

  /**
   * What-if scenario of the current operating day (ADR-047): computed on copies, from now to the
   * end of the day. null = the day is not loaded yet.
   */
  whatIf(list: Intervention[]): { result: WhatIfResult } | { errors: string[] } | null {
    const now = this.deps.clock.now();
    const state = this.days.get(operatingDay(now));
    if (!state) return null;
    const ctx = {
      plan: state.plan,
      manifests: state.manifests,
      seed: this.seedValue,
      forceCascade: this.forceCascadeValue,
      routes: state.book,
      model: this.readRateModel(),
      devices: [...this.devices.values()].filter((d) => this.simulated(d.row.code)).map((d) => d.row),
      now,
      lateThresholdMin: this.deps.config.lateThresholdMin ?? DEFAULT_LATE_THRESHOLD_MIN,
    };
    const errors = validateInterventions(ctx, list);
    return errors.length > 0 ? { errors } : { result: runWhatIf(ctx, list) };
  }

  /** The app changed the plan (a trip moved to another door): reload it and rebuild future scans. */
  async refreshPlan(): Promise<string[]> {
    const days = [...this.days.keys()];
    // fetch everything first, then swap without awaiting, so a tick never sees half a change
    const plans = await Promise.all(days.map((day) => this.deps.app.getPlan(day)));
    days.forEach((day, i) => {
      const state = this.days.get(day);
      const plan = plans[i];
      if (!state || !plan) return;
      state.plan = plan;
      state.scenario = buildScenario(plan, { seed: this.seedValue, forceCascade: this.forceCascadeValue, routes: state.book });
    });
    this.rebuildScans(this.lastT);
    return days;
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

  routeBook(): RouteBook {
    if (this.book) return this.book;
    if (typeof this.deps.routes !== "function") return this.deps.routes;
    throw new Error("routes not loaded yet");
  }

  /** Routes for the map (GET /routes): depot and road geometry per direction. */
  routesSummary(): { depot: readonly [number, number]; routes: Record<string, { points: (readonly [number, number])[]; minutes: number }> } | null {
    const book = this.book ?? (typeof this.deps.routes === "function" ? null : this.deps.routes);
    if (!book) return null;
    return { depot: book.depot, routes: book.routes };
  }

  // ------------------------------------------------------------------ replay (phase 5d, ADR-053)

  /** where telemetry rows go: the replay buffer, or db-telemetry directly */
  private get sink(): TelemetrySink {
    return this.buffer ?? this.deps.store;
  }

  /** a replay, restart, seed change, clean reset or situation is running (API: 409) */
  get replaying(): boolean {
    return this.busy;
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ReplayBusyError();
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Simulate every minute from now to `target` as fast as possible, with all data: scans, gate
   * passages and sensor readings go to db-telemetry, trips and scans to the app every 10 simulated
   * minutes (the app must see a trip loading before its scans and departed after them). Single
   * scans are not broadcast on the WebSocket; the clock channel shows the progress. A "+N min" step
   * and a jump in replay mode are both this method, so they give the same data as each other and
   * as the live clock (the day is precomputed, the step size does not change it, ADR-023).
   */
  async advance(target: number): Promise<AdvanceResult> {
    return this.exclusive(() => this.advanceNow(target));
  }

  private async advanceNow(target: number): Promise<AdvanceResult> {
    const started = this.realNow();
    this.replayTarget = target;
    const clock = this.deps.clock;
    const wasPaused = clock.state().paused;
    clock.pause();
    while (this.ticking) await new Promise((r) => setTimeout(r, 5));
    this.ticking = true;
    this.buffer = new BufferedSink(this.deps.store);
    const from = this.lastT;
    const forwardedBefore = this.forwardedScans;
    let stepMs = 0;
    let syncMs = 0;
    try {
      let nextSync = from + REPLAY_SYNC_MS;
      for (let t = from; t < target; ) {
        t = Math.min(target, t + MINUTE);
        clock.set(t);
        const a = this.realNow();
        await this.step(t);
        // the day of this minute must be loaded (a slow app would otherwise lose its data silently)
        if (!this.days.has(operatingDay(t))) throw new ReplayStoppedError("operating day could not be loaded, replay stopped", t);
        stepMs += this.realNow() - a;
        if (t >= nextSync || t === target) {
          const b = this.realNow();
          await this.syncToApp();
          syncMs += this.realNow() - b;
          nextSync = t + REPLAY_SYNC_MS;
        }
      }
      await this.persist();
    } finally {
      const buffer = this.buffer;
      this.buffer = null;
      await this.safe("replay telemetry", () => buffer.flush());
      this.ticking = false;
      this.replayTarget = null;
      if (!wasPaused) clock.resume();
    }
    const scans = this.forwardedScans - forwardedBefore;
    return { from: iso(from), to: iso(target), minutes: Math.round((target - from) / MINUTE), scans, ms: this.realNow() - started, stepMs, syncMs };
  }

  /** Send everything pending to the app now (waits for a running flush); throws if the app is down. */
  private async syncToApp(): Promise<void> {
    await this.buffer?.flush();
    while (this.flushing) await new Promise((r) => setTimeout(r, 5));
    await this.flushTrips();
    if (this.pendingTrips.size > 0 || this.scanQueue.length > 0) {
      throw new ReplayStoppedError("app unavailable, replay stopped", this.deps.clock.now());
    }
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
    await this.emitScans(scans.filter((s) => this.simulated(s.device) && !this.inMaintenance(s.device, s.at)));
    await this.finishMaintenance(now);
    await this.emitGate(gate);
    this.updateDoors(now);
    this.updateCouriers(now);
    this.updateTrips(now);
    await this.updateVehicles(now);
    if (!fastForward) await this.emitSensors(from, now);
    await this.flushMetrics(now, fastForward);
    this.lastT = now;
  }

  // ------------------------------------------------------------------ days / scenario

  private readRateModel(): ReadRateModel {
    const dev = this.degradedDeviceValue;
    return {
      ...DEFAULT_READ_RATE,
      degradation:
        dev && this.degradationStartedAt !== null
          ? { device: dev, startedAt: this.degradationStartedAt, hours: this.deps.config.degradationHours, from: 0.97, to: 0.85 }
          : null,
    };
  }

  async ensureDay(day: string): Promise<void> {
    if (this.days.has(day)) return;
    const running = this.dayLoads.get(day);
    if (running) return running;
    if ((this.dayRetryAt.get(day) ?? 0) > this.realNow()) return;
    const load = this.loadDay(day).finally(() => this.dayLoads.delete(day));
    this.dayLoads.set(day, load);
    return load;
  }

  private async loadDay(day: string): Promise<void> {
    try {
      const plan = await this.deps.app.getPlan(day);
      const book = typeof this.deps.routes === "function" ? this.deps.routes(plan) : this.deps.routes;
      this.book = book;
      const scenario = buildScenario(plan, {
        seed: this.seedValue,
        forceCascade: this.forceCascadeValue,
        routes: book,
      });
      const manifests = new Map<string, ManifestParcel[]>();
      const directions = new Set([
        ...plan.trips.filter((t) => t.kind === "outbound").map((t) => t.directionCode),
        ...plan.localDirections,
      ]);
      for (const dir of [...directions].sort()) manifests.set(dir, await this.deps.app.getManifest(dir, day));
      const couriers = buildCourierSchedules(await this.deps.app.getCourierRoutes(day), {
        seed: this.seedValue,
        router: this.deps.router ?? null,
      });
      const state: DayState = {
        plan,
        book,
        scenario,
        manifests,
        scans: [],
        scanIdx: 0,
        gate: [],
        gateIdx: 0,
        couriers,
        courierEvents: courierEvents(couriers),
        courierIdx: 0,
      };
      this.buildDayEvents(state);
      // skip what already happened before the engine got here (restart, prefetch)
      const now = this.lastT;
      state.scanIdx = state.scans.findIndex((s) => s.at > now);
      if (state.scanIdx < 0) state.scanIdx = state.scans.length;
      state.gateIdx = state.gate.findIndex((g) => g.at > now);
      if (state.gateIdx < 0) state.gateIdx = state.gate.length;
      // passages before a restart may not have reached the app (the queue is in memory): send them
      // again, the app skips the ones it has (phase 7b review)
      this.forwardGate(state.gate.slice(0, state.gateIdx));
      state.courierIdx = state.courierEvents.findIndex((e) => e.at > now);
      if (state.courierIdx < 0) state.courierIdx = state.courierEvents.length;
      // After a restart in the middle of the courier round the queued events were lost with the
      // process: resend what already happened. The app applies them idempotently (a finished stop
      // is not finished twice, departure/return only once); "loaded" is not resent, it would send
      // the tracking SMS again (phase 5b /courier fix).
      for (const ev of state.courierEvents.slice(0, state.courierIdx)) {
        if (ev.kind === "loaded") continue;
        this.courierQueue.push({ routeId: ev.routeId, kind: ev.kind, stopId: ev.stopId, at: iso(ev.at) });
      }
      this.days.set(day, state);
      this.deps.log.info(
        {
          day,
          trips: plan.trips.length,
          scans: state.scans.length,
          weather: scenario.weather,
          incidentTrip: scenario.incidentTripId,
          courierRoutes: couriers.length,
          couriersBack: couriers.length ? localHhmm(Math.max(...couriers.map((c) => c.returnAt))) : null,
        },
        "operating day loaded",
      );
    } catch (err) {
      this.dayRetryAt.set(day, this.realNow() + 5000);
      this.deps.log.warn({ day, err: String(err) }, "cannot load operating day yet (app unavailable?), retry in 5 s");
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
    const { plan, scenario } = state;
    state.scans = dayScans({
      plan,
      scenario,
      manifests: state.manifests,
      model: this.readRateModel(),
      seed: this.seedValue,
      dockDevice: (door) => this.dockDevice(door),
      lineDevice: this.lineDevice(),
    });

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
    // Budimír: the same draws as before phase 7c (golden test); other depots: their own stream
    const home = state.couriers.filter((c) => c.depotCode === "BUD");
    const rows = gateMix(gate, home, plan.day, this.seedValue);
    const ends = plan.destinationDepots ?? {};
    const others = [...new Set([...state.couriers.map((c) => c.depotCode), ...Object.values(ends)])].filter((c) => c !== "BUD" && c !== "BAH");
    for (const code of others.sort()) {
      const trucks = [...scenario.schedules.values()].filter((s) => ends[s.trip.directionCode] === code);
      rows.push(...depotGateMix(code, trucks, state.couriers.filter((c) => c.depotCode === code), plan.day, this.seedValue));
    }
    state.gate = rows.sort((a, b) => a.at - b.at);
  }

  /** Recompute future scans after the read-rate model or the plan changed. */
  private rebuildScans(now: number = this.deps.clock.now()): void {
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

  /** Send trip states first (a scan needs the truck to be "loading"), then queued scans. */
  async flushTrips(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      // The app attributes a scan to the trip loading at its door, so it must see a trip
      // "loading" before its scans and "departed" only after them. Order: trips still open, then
      // for each finished trip (by departure) the scans up to its departure and the trip, then
      // the remaining scans (a batched replay has many of each, phase 5d review).
      const batch = [...this.pendingTrips.values()];
      const open = batch.filter((e) => !FINISHED_TRIP.has(e.status));
      const done = batch
        .filter((e) => FINISHED_TRIP.has(e.status))
        .sort((a, b) => (a.actualDeparture ?? "").localeCompare(b.actualDeparture ?? ""));
      await this.postTrips(open);
      for (const exec of done) {
        const dep = exec.actualDeparture === null ? Infinity : Date.parse(exec.actualDeparture);
        await this.postScansWhere((s) => Date.parse(s.at) <= dep);
        await this.postTrips([exec]);
      }
      await this.postScansWhere(() => true);
      await this.flushCouriers();
      await this.flushGate();
    } catch (err) {
      this.deps.log.warn(
        { err: String(err), trips: this.pendingTrips.size, scans: this.scanQueue.length },
        "sync to app failed, will retry",
      );
      if (this.scanQueue.length > MAX_SCAN_QUEUE) {
        this.deps.log.warn({ dropped: this.scanQueue.length - MAX_SCAN_QUEUE }, "scan queue full, dropping oldest");
        this.scanQueue = this.scanQueue.slice(-MAX_SCAN_QUEUE);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async postTrips(batch: TripExecution[]): Promise<void> {
    if (batch.length === 0) return;
    await this.deps.app.postTripEvents(iso(this.deps.clock.now()), batch);
    for (const exec of batch) {
      this.reported.set(exec.tripId, JSON.stringify(exec));
      if (this.pendingTrips.get(exec.tripId) === exec) this.pendingTrips.delete(exec.tripId);
    }
  }

  /** Send the queued scans that match, in queue order and chunks of 1000; keep the others. */
  private async postScansWhere(match: (s: ScanForward) => boolean): Promise<void> {
    const send = this.scanQueue.filter(match);
    for (let i = 0; i < send.length; i += 1000) {
      const chunk = send.slice(i, i + 1000);
      await this.deps.app.postScans(chunk);
      const sent = new Set(chunk);
      this.scanQueue = this.scanQueue.filter((x) => !sent.has(x));
    }
  }

  /** Queue simulated passages for the decision rules in the app; the key makes a resend harmless. */
  private forwardGate(rows: GateRow[]): void {
    for (const g of rows) {
      const at = iso(g.at);
      this.gateQueue.push({
        // an unread plate: the random confidence keeps two such passages in one ms apart
        key: `${g.depot && g.depot !== "BUD" ? `${g.depot}:` : ""}${at}:${g.direction}:${g.plate ?? `${g.vehicleType}-${String(g.vehicleConfidence ?? 0)}`}`,
        ...(g.depot && g.depot !== "BUD" ? { depot: g.depot } : {}),
        at,
        direction: g.direction,
        vehicleType: g.vehicleType,
        vehicleConfidence: g.vehicleConfidence ?? null,
        plate: g.plate,
        plateConfidence: g.plateConfidence,
      });
    }
    if (this.gateQueue.length > MAX_SCAN_QUEUE) this.gateQueue = this.gateQueue.slice(-MAX_SCAN_QUEUE);
  }

  private async flushGate(): Promise<void> {
    while (this.gateQueue.length > 0) {
      const batch = this.gateQueue.slice(0, 1000);
      await this.deps.app.postGatePassages(batch);
      this.gateQueue = this.gateQueue.slice(batch.length);
    }
  }

  // ------------------------------------------------------------------ couriers -> app

  private updateCouriers(now: number): void {
    for (const state of this.days.values()) {
      const touched = new Set<number>();
      while (state.courierIdx < state.courierEvents.length && (state.courierEvents[state.courierIdx]?.at ?? Infinity) <= now) {
        const ev = state.courierEvents[state.courierIdx++] as CourierEvent;
        this.courierQueue.push({ routeId: ev.routeId, kind: ev.kind, stopId: ev.stopId, at: iso(ev.at) });
        touched.add(ev.routeId);
      }
      for (const s of state.couriers) {
        if (!touched.has(s.route.routeId)) continue;
        this.pendingEtas.set(
          s.route.routeId,
          predictedEtas(s, now).map((e) => ({ stopId: e.stopId, eta: iso(e.eta) })),
        );
      }
    }
  }

  /** Events in order; the newest ETA predictions of the touched routes go with the first batch. */
  private async flushCouriers(): Promise<void> {
    while (this.courierQueue.length > 0 || this.pendingEtas.size > 0) {
      const events = this.courierQueue.slice(0, 2000);
      const routes = [...this.pendingEtas.keys()];
      const etas = [...this.pendingEtas.values()].flat();
      await this.deps.app.postCourierEvents(iso(this.deps.clock.now()), events, etas);
      this.courierQueue = this.courierQueue.slice(events.length);
      for (const r of routes) this.pendingEtas.delete(r);
    }
  }

  private courierSchedules(): CourierSchedule[] {
    return [...this.days.values()].flatMap((d) => d.couriers);
  }

  /** The van's round that matters at `now`: running, else the last finished, else the next one. */
  private courierOf(plate: string, now: number): CourierSchedule | null {
    const own = this.courierSchedules()
      .filter((s) => s.route.vehiclePlate === plate)
      .sort((a, b) => a.loadStart - b.loadStart);
    const running = own.find((s) => now >= s.loadStart && now < s.returnAt);
    if (running) return running;
    const past = own.filter((s) => s.returnAt <= now);
    return past[past.length - 1] ?? own[0] ?? null;
  }

  private courierVehicleEvent(plate: string, s: CourierSchedule, now: number): { data: VehicleEventData; pos: Position } {
    const st = courierStateAt(s, now);
    // a parked van (overnight, after the return) has no running round
    const active = st.status !== null && st.status !== "parked";
    return {
      pos: st.pos,
      data: {
        plate,
        kind: "van",
        lat: Number(st.pos.lat.toFixed(5)),
        lon: Number(st.pos.lon.toFixed(5)),
        speedKmh: st.pos.speedKmh,
        heading: Math.round(st.pos.heading),
        moving: st.pos.moving,
        tripId: null,
        tripKind: null,
        status: st.status,
        directionCode: s.route.districtCode,
        doorCode: s.route.stagingBay,
        routeId: active ? s.route.routeId : null,
        stopsDone: active ? st.done : 0,
        stopsTotal: active ? s.visits.length : 0,
      },
    };
  }

  /** Current position of one vehicle (app: customer tracking, courier screen). */
  vehicleNow(plate: string): VehicleEventData | null {
    const kind = this.plates().get(plate);
    if (!kind) return null;
    return this.vehicleEvent(plate, kind, this.deps.clock.now()).data;
  }

  /** Remaining road path of a courier van (dispatcher map); null for other vehicles. */
  vehiclePath(plate: string): LatLon[] | null {
    const now = this.deps.clock.now();
    const s = this.courierOf(plate, now);
    return s ? remainingPath(s, now) : null;
  }

  // ------------------------------------------------------------------ vehicles

  private vehiclePosition(plate: string, now: number): { pos: Position; schedule: TripSchedule | null } {
    const own = this.schedules()
      .filter((s) => s.trip.vehiclePlate === plate)
      .sort((a, b) => activeWindow(a)[0] - activeWindow(b)[0]);
    const book = this.routeBook();
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
    if (kind === "van") {
      const courier = this.courierOf(plate, now);
      if (courier) return this.courierVehicleEvent(plate, courier, now);
    }
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
    for (const d of this.days.values()) {
      for (const t of d.plan.trips) plates.set(t.vehiclePlate, t.vehicleKind);
      for (const c of d.couriers) plates.set(c.route.vehiclePlate, "van");
    }
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
    await this.safe("gps", () => this.sink.insertGps(gps));
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
      if (d.row.kind === "dock_scanner" || d.row.kind === "line_scanner") {
        this.forwardedScans++;
        this.scanQueue.push({
          device: ev.device,
          doorCode: d.row.kind === "dock_scanner" ? d.row.doorCode : null,
          at: iso(ev.at),
          barcode: ev.barcode,
          readOk: ev.readOk,
        });
      }
      d.lastScanAt = ev.at;
      const minute = Math.floor(ev.at / MINUTE) * MINUTE;
      const mkey = `${String(d.row.id)}|${String(minute)}`;
      const m = this.metrics.get(mkey) ?? { deviceId: d.row.id, minute, items: 0, readsOk: 0 };
      if (ev.itemCounted) m.items++;
      if (ev.readOk) m.readsOk++;
      this.metrics.set(mkey, m);
      // a replay does not flood the WebSocket with every scan of the skipped interval
      if (this.replayTarget === null) this.deps.hub.publish("devices", "scan", {
        device: ev.device,
        doorCode: d.row.doorCode,
        at: iso(ev.at),
        barcode: ev.barcode,
        readOk: ev.readOk,
        facesRead: ev.facesRead,
        itemCounted: ev.itemCounted,
      });
    }
    await this.safe("scans", () => this.sink.insertScans(rows));
  }

  /** A real gate camera passage (app POST /api/gate/detect, ADR-059): stored and broadcast like a
   * simulated one, at the simulated time. */
  async recordGatePassage(p: Omit<GateRow, "at" | "snapshotPath">): Promise<GateRow> {
    const row: GateRow = { ...p, at: this.deps.clock.now(), snapshotPath: null };
    await this.emitGate([row], false);
    return row;
  }

  private async emitGate(rows: GateRow[], forward = true): Promise<void> {
    if (rows.length === 0) return;
    if (forward) this.forwardGate(rows);
    for (const g of rows) {
      if (this.replayTarget !== null) break;
      const depot = g.depot ?? "BUD";
      this.deps.hub.publish("devices", "gate_passage", { ...g, at: iso(g.at), depot, device: depot === "BUD" ? "GATE-CAM-01" : `${depot}-GATE-CAM` });
    }
    await this.safe("gate", () => this.sink.insertGatePassages(rows));
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
    await this.safe("sensors", () => this.sink.insertSensorReadings(rows));
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
    await this.safe("metrics", () => this.sink.upsertMetrics(done));
  }

  async heartbeats(): Promise<void> {
    const at = this.deps.clock.now();
    const rows: HeartbeatRow[] = [];
    for (const d of this.devices.values()) {
      if (d.external || !d.row.enabled) continue;
      d.lastHeartbeat = this.realNow();
      rows.push({ deviceId: d.row.id, at, status: d.status === "offline" ? "online" : d.status });
    }
    await this.safe("heartbeats", () => this.sink.insertHeartbeats(rows));
  }

  async monitorDevices(): Promise<void> {
    const now = this.deps.clock.now();
    const real = this.realNow();
    for (const d of this.devices.values()) {
      d.recent = d.recent.filter((r) => r.at > now - ROLLING_MS);
      const rate = d.recent.length >= MIN_ITEMS_FOR_RATE ? d.recent.filter((r) => r.ok).length / d.recent.length : null;
      let status: DeviceStatus = "online";
      if (this.maintenanceUntil.has(d.row.code)) status = "maintenance";
      else if (real - d.lastHeartbeat > OFFLINE_AFTER_MS) status = "offline";
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
        degradedDevice: this.degradedDeviceValue,
        degradationStartedAt: this.degradationStartedAt,
        situation: this.situationId,
        forceCascade: this.situationId === null ? null : this.forceCascadeValue,
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
