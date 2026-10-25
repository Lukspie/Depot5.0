/** REST client telematics -> app (X-Service-Token). The app owns trips and parcels. */

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

export interface PlanWithLocal extends Plan {
  localDirections: string[];
}

export interface AppApi {
  getPlan(day: string): Promise<PlanWithLocal>;
  getManifest(direction: string, day: string): Promise<string[]>;
  postTripEvents(simTime: string, trips: TripExecution[]): Promise<void>;
  postAlert(alert: AlertPayload): Promise<void>;
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

  async getManifest(direction: string, day: string): Promise<string[]> {
    const body = await this.request<{ parcels: { barcode: string }[] }>(
      `/internal/manifest?direction=${encodeURIComponent(direction)}&day=${day}`,
    );
    return body.parcels.map((p) => p.barcode);
  }

  async postTripEvents(simTime: string, trips: TripExecution[]): Promise<void> {
    await this.request("/internal/events/trips", {
      method: "POST",
      body: JSON.stringify({ simTime, trips }),
    });
  }

  async postAlert(alert: AlertPayload): Promise<void> {
    await this.request("/internal/alerts", { method: "POST", body: JSON.stringify(alert) });
  }
}
