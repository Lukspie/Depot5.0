/**
 * REST calls from the browser straight to telematics (simulation control, devices).
 * Authorisation: a short-lived ticket from the app (Bearer), cached until shortly before expiry.
 */

import { getJson, sendJson } from "./client";
import type { PublicConfig } from "./system";

interface Ticket {
  ticket: string;
  expiresIn: number;
}

let cached: { token: string; until: number } | null = null;
let baseUrl: string | null = null;

async function ticket(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const t = await sendJson<Ticket>("POST", "/api/auth/ws-ticket");
  cached = { token: t.ticket, until: Date.now() + (t.expiresIn - 10) * 1000 };
  return t.ticket;
}

async function base(): Promise<string> {
  baseUrl ??= (await getJson<PublicConfig>("/api/config")).telematics_url;
  return baseUrl;
}

export async function telematics<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const url = `${await base()}${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${await ticket()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return getJson<T>(url, {
    method,
    credentials: "omit",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface DeviceInfo {
  code: string;
  depotCode: string;
  kind: "dock_scanner" | "line_scanner" | "gate_camera" | "line_sensor" | "door_sensor";
  doorCode: string | null;
  enabled: boolean;
  external: boolean;
  status: "online" | "degraded" | "offline" | "maintenance";
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
  /** false when SIM_CONTROLS_ENABLED=false (production): the admin UI hides the controls */
  controlsEnabled?: boolean;
  /** a jump in replay mode or a step: what was simulated (ADR-053) */
  replay?: { from: string; to: string; minutes: number; scans: number; ms: number; stepMs: number; syncMs: number };
}
