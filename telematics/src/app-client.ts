/** REST client telematics -> app (X-Service-Token). The app owns trips and parcels. */

import type { CourierEventKind, CourierPlan } from "./simulator/couriers.js";
import type { Plan, TripExecution } from "./simulator/types.js";

export interface AlertPayload {
  kind: "device_offline" | "scanner_degradation" | "wrong_direction" | "cascade_delay" | "other";
  severity: "info" | "warning" | "critical";
  message: string;
  refType: string;
  refId: string;
  at: string;
  resolved?: boolean;
}

export interface PlanDepot {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export interface PlanWithLocal extends Plan {
  localDirections: string[];
  /** depot the plan belongs to (routes start here) */
  depot?: PlanDepot;
  /** destination point of every direction (hub for linehaul BA) */
  destinations?: Record<string, [number, number]>;
}

export interface ManifestParcel {
  barcode: string;
  /** night parcels: the inbound trip that brings them (null = already in the depot) */
  arrivesWithTripId: number | null;
}

/** A scan forwarded to the app for the loading check (dock) or sorting (line, doorCode null). */
export interface ScanForward {
  device: string;
  doorCode: string | null;
  at: string;
  barcode: string | null;
  readOk: boolean;
}

/** Courier execution reported to the app (POST /internal/events/couriers). */
export interface CourierEventOut {
  routeId: number;
  kind: CourierEventKind;
  stopId: number | null;
  at: string;
}

export interface StopEtaOut {
  stopId: number;
  eta: string;
}

export interface AppApi {
  getPlan(day: string): Promise<PlanWithLocal>;
  getManifest(direction: string, day: string): Promise<ManifestParcel[]>;
  postTripEvents(simTime: string, trips: TripExecution[]): Promise<void>;
  postScans(scans: ScanForward[]): Promise<void>;
  /** undo the execution of an operating day in the app (replay from 15:00) */
  resetDay(day: string): Promise<void>;
  postAlert(alert: AlertPayload): Promise<void>;
  /** courier routes for the parcels of an operating day (driven the next morning) */
  getCourierRoutes(day: string): Promise<CourierPlan>;
  postCourierEvents(simTime: string, events: CourierEventOut[], etas: StopEtaOut[]): Promise<void>;
}

export class HttpAppApi implements AppApi {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs = 5000,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "X-Service-Token": this.serviceToken, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`app ${init?.method ?? "GET"} ${path} -> ${String(res.status)}`);
    return (await res.json()) as T;
  }

  getPlan(day: string): Promise<PlanWithLocal> {
    return this.request<PlanWithLocal>(`/internal/plan?day=${day}`);
  }

  async getManifest(direction: string, day: string): Promise<ManifestParcel[]> {
    const body = await this.request<{ parcels: ManifestParcel[] }>(
      `/internal/manifest?direction=${encodeURIComponent(direction)}&day=${day}`,
    );
    return body.parcels.map((p) => ({ barcode: p.barcode, arrivesWithTripId: p.arrivesWithTripId }));
  }

  async postScans(scans: ScanForward[]): Promise<void> {
    await this.request("/internal/events/scans", { method: "POST", body: JSON.stringify({ scans }) });
  }

  async postTripEvents(simTime: string, trips: TripExecution[]): Promise<void> {
    await this.request("/internal/events/trips", {
      method: "POST",
      body: JSON.stringify({ simTime, trips }),
    });
  }

  async resetDay(day: string): Promise<void> {
    await this.request(`/internal/days/${day}/reset`, { method: "POST" });
  }

  async postAlert(alert: AlertPayload): Promise<void> {
    await this.request("/internal/alerts", { method: "POST", body: JSON.stringify(alert) });
  }

  getCourierRoutes(day: string): Promise<CourierPlan> {
    return this.request<CourierPlan>(`/internal/courier-routes?day=${day}`);
  }

  async postCourierEvents(simTime: string, events: CourierEventOut[], etas: StopEtaOut[]): Promise<void> {
    await this.request("/internal/events/couriers", {
      method: "POST",
      body: JSON.stringify({ simTime, events, etas }),
    });
  }
}
