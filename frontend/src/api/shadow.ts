/** Digital shadow (ADR-045): scene data from the app, device sparkline from telematics. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./client";
import { telematics } from "./telematicsApi";
import type { Alert, Clock, DirectionType, ParcelStatus, TripBrief } from "./wms";

export interface ShadowDock {
  code: string;
  defaultDirection: string | null;
  defaultDirectionName: string | null;
  trip: TripBrief | null;
  cascade: Alert | null;
}

export interface Shadow {
  depot: { code: string; name: string; kind: "depot" | "hub"; lat: number; lon: number };
  clock: Clock;
  kpis: {
    parcelsTotal: number;
    parcelsLoaded: number;
    parcelsStaged: number;
    parcelsSorted: number;
    parcelsWaiting: number;
    parcelsMissing: number;
    trucksOnSite: number;
    readRate: number | null;
    unidentified: number;
    openAlerts: number;
    waveKind: "evening" | "night" | null;
    parcelsWave: number | null;
    nextWaveAt: string | null;
  } | null;
  docks: ShadowDock[];
  staged: { doorCode: string; directionCode: string; parcels: number }[];
  trucks: { plate: string; tripId: number; state: "arriving" | "at_hub" | "loading_at_hub" | "departed"; at: string | null }[];
  alerts: Alert[];
}

export interface ShadowDockDetail {
  dock: ShadowDock;
  missing: { barcode: string; status: ParcelStatus; weightKg: number }[];
  missingCount: number;
  wrongDirection: { at: string; barcode: string | null; parcelDirection: string | null }[];
}

export interface ParcelLocate {
  id: number;
  barcode: string;
  status: ParcelStatus;
  directionCode: string;
  directionName: string;
  directionType: DirectionType;
  place: { kind: "belt" | "door" | "bay" | "outside"; code: string | null };
  events: { status: ParcelStatus; at: string; doorCode: string | null }[];
}

export interface MetricBucket {
  at: string;
  items: number;
  readRate: number | null;
}

export function useShadow(depot: string) {
  return useQuery({
    queryKey: ["shadow", depot],
    queryFn: () => getJson<Shadow>(`/api/shadow/${encodeURIComponent(depot)}`),
    refetchInterval: 5000,
  });
}

export function useDockDetail(code: string | null) {
  return useQuery({
    queryKey: ["shadow", "dock", code],
    queryFn: () => getJson<ShadowDockDetail>(`/api/shadow/doors/${encodeURIComponent(code ?? "")}`),
    enabled: code !== null,
    refetchInterval: 5000,
  });
}

export function useParcelLocate(barcode: string | null) {
  return useQuery({
    queryKey: ["shadow", "parcel", barcode],
    queryFn: () => getJson<ParcelLocate>(`/api/shadow/parcels/${encodeURIComponent(barcode ?? "")}`),
    enabled: barcode !== null,
    retry: false,
    refetchInterval: 10_000,
  });
}

export function useDeviceMetrics(code: string | null, hours = 6) {
  return useQuery({
    queryKey: ["telematics", "metrics", code, hours],
    queryFn: () => telematics<{ code: string; buckets: MetricBucket[] }>("GET", `/devices/${encodeURIComponent(code ?? "")}/metrics?hours=${String(hours)}`),
    enabled: code !== null,
    refetchInterval: 30_000,
  });
}

// ------------------------------------------------------------------ WMS actions (ADR-048)

export interface MaintenanceOrder {
  id: number;
  deviceCode: string;
  note: string | null;
  minutes: number;
  createdAt: string;
  until: string;
}

export function useMoveTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, doorCode }: { tripId: number; doorCode: string }) =>
      sendJson<TripBrief>("PATCH", `/api/trips/${String(tripId)}/door`, { doorCode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shadow"] }),
  });
}

export function useStartMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, minutes }: { code: string; minutes: number }) =>
      sendJson<MaintenanceOrder>("POST", `/api/devices/${encodeURIComponent(code)}/maintenance`, { minutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
  });
}

export function useMaintenanceOrders() {
  return useQuery({
    queryKey: ["maintenance"],
    queryFn: () => getJson<MaintenanceOrder[]>("/api/maintenance"),
    refetchInterval: 30_000,
  });
}

// ------------------------------------------------------------------ what-if scenarios (ADR-047)

export type Intervention =
  | { kind: "delay"; tripId: number; minutes: number }
  | { kind: "device_outage"; device: string }
  | { kind: "read_rate"; device: string; rate: number }
  | { kind: "extra_scanner"; doorCode: string }
  | { kind: "move_trip"; tripId: number; doorCode: string };

export interface WhatIfKpis {
  transitDelayMin: number;
  transitLate: number;
  cascadeWarnings: number;
  unidentified: number;
  wrongDirection: number;
  wrongUndetected: number;
}

export interface WhatIfResult {
  from: string;
  to: string;
  lateThresholdMin: number;
  plan: WhatIfKpis;
  scenario: WhatIfKpis;
  trips: {
    tripId: number;
    kind: "inbound" | "outbound";
    directionCode: string;
    directionName: string;
    doorCode: string | null;
    planned: string | null;
    base: string | null;
    scenario: string | null;
    deltaMin: number;
  }[];
  affected: { trips: number[]; doors: string[]; devices: string[] };
  notes: string[];
}

export function useWhatIf() {
  return useMutation({
    mutationFn: (interventions: Intervention[]) => telematics<WhatIfResult>("POST", "/sim/what-if", { interventions }),
  });
}
