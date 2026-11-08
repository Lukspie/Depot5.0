/** WMS endpoints of the app backend (camelCase JSON). */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./client";

export type TripStatus = "planned" | "en_route" | "at_door" | "loading" | "departed" | "completed" | "cancelled";
export type ParcelStatus =
  | "collected"
  | "on_belt"
  | "sorted"
  | "loaded"
  | "staged"
  | "out_for_delivery"
  | "delivered"
  | "failed_delivery"
  | "returned";
export type ScanResult = "ok" | "wrong_direction" | "duplicate" | "unidentified";
export type DirectionType = "linehaul" | "transit" | "local";

export interface LoadStats {
  expected: number;
  loaded: number;
  loadedKg: number;
  counted: number;
  read: number;
  unidentified: number;
  wrongDirection: number;
  duplicate: number;
}

export interface TripBrief {
  id: number;
  operatingDay: string;
  kind: "inbound" | "outbound";
  status: TripStatus;
  directionCode: string;
  directionName: string;
  directionType: DirectionType;
  vehiclePlate: string;
  vehicleKind: "truck" | "van";
  capacityKg: number;
  capacityParcels: number;
  doorCode: string | null;
  plannedArrival: string | null;
  plannedDeparture: string | null;
  actualArrival: string | null;
  actualDeparture: string | null;
  predictedArrival: string | null;
  /** "ml" before the trip, "telematics" during it (ADR-057) */
  predictedBy?: string | null;
  delayMin: number | null;
  load: LoadStats | null;
}

export interface ParcelBrief {
  id: number;
  barcode: string;
  status: ParcelStatus;
  directionCode: string;
  weightKg: number;
  recipientName: string;
  address: string;
}

export interface Clock {
  simTime: string;
  operatingDay: string;
  wave: "evening" | "night" | null;
}

export interface Alert {
  id: number;
  kind: "wrong_direction" | "cascade_delay" | "scanner_degradation" | "device_offline" | "other";
  severity: "info" | "warning" | "critical";
  message: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface DirectionRow {
  code: string;
  name: string;
  type: DirectionType;
  total: number;
  loaded: number;
  staged: number;
  waiting: number;
  missing: number;
}

export interface Dashboard {
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
  };
  directions: DirectionRow[];
  trips: TripBrief[];
  alerts: Alert[];
}

export interface DoorSummary {
  code: string;
  defaultDirection: string | null;
  trip: TripBrief | null;
}

export interface ScanRow {
  id: number;
  at: string;
  result: ScanResult;
  barcode: string | null;
  parcelId: number | null;
  parcelDirection: string | null;
  device: string | null;
}

export interface LoadingView {
  door: DoorSummary;
  missing: ParcelBrief[];
  recent: ScanRow[];
}

export interface ManualScanResult {
  result: ScanResult;
  parcel: ParcelBrief | null;
  tripDirection: string | null;
  message: string;
}

export interface Vehicle {
  plate: string;
  kind: "truck" | "van";
  capacityKg: number;
  capacityParcels: number;
  trip: TripBrief | null;
  /** [lat, lon] of the parking spot of a van in a depot without simulated operations (ADR-066) */
  parkedAt?: [number, number] | null;
  /** home depot code */
  depot?: string | null;
}

export interface VehicleDetail extends Vehicle {
  parcels: ParcelBrief[];
  parcelsCount: number;
  parcelsKg: number;
  remainingStops: string[];
}

export interface ParcelEvent {
  status: ParcelStatus;
  at: string;
  source: "iot" | "manual" | "system";
  doorCode: string | null;
  tripId: number | null;
  vehiclePlate: string | null;
  userName: string | null;
  /** checkpoint of the sorting line (ADR-071) */
  checkpoint?: string | null;
  checkpointLabel?: string | null;
}

export interface ParcelDetail extends ParcelBrief {
  directionName: string;
  directionType: DirectionType;
  sender: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  lat: number;
  lon: number;
  createdAt: string;
  events: ParcelEvent[];
  scans: ScanRow[];
}

export interface Board {
  /** "Budimír · prekládkové depo" (phase 7d) */
  depot: string;
  clock: Clock;
  arrivals: TripBrief[];
  departures: TripBrief[];
  warnings: Alert[];
  devices: { online: number; degraded: number; offline: number; readRate: number | null; lineStatus: string };
}

export interface DirectionAdmin {
  id: number;
  code: string;
  name: string;
  type: DirectionType;
  cutoffTime: string | null;
  plannedDeparture: string | null;
  dependsOnLinehaul: string[];
  doorCode: string | null;
}

// ------------------------------------------------------------------ hooks

export function useDashboard(depot: string | null) {
  return useQuery({
    queryKey: ["dashboard", depot],
    queryFn: () => getJson<Dashboard>(`/api/dashboard?depot=${encodeURIComponent(depot ?? "")}`),
    enabled: depot !== null,
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sendJson<Alert>("POST", `/api/alerts/${String(id)}/ack`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["dispatch"] });
      await qc.invalidateQueries({ queryKey: ["shell"] });
      await qc.invalidateQueries({ queryKey: ["shadow"] });
    },
  });
}

export function useDoors(depot: string | null) {
  return useQuery({
    queryKey: ["loading", "doors", depot],
    queryFn: () => getJson<DoorSummary[]>(`/api/loading/doors?depot=${encodeURIComponent(depot ?? "")}`),
    enabled: depot !== null,
    refetchInterval: 10_000,
  });
}

export function useDoorView(code: string | null) {
  return useQuery({
    queryKey: ["loading", "door", code],
    queryFn: () => getJson<LoadingView>(`/api/loading/doors/${code ?? ""}`),
    enabled: code !== null,
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
}

export function useManualScan(door: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (barcode: string) =>
      sendJson<ManualScanResult>("POST", `/api/loading/doors/${door ?? ""}/scan`, { barcode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loading"] }),
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: ["fleet", "vehicles"],
    queryFn: () => getJson<Vehicle[]>("/api/fleet/vehicles"),
    refetchInterval: 10_000,
  });
}

export function useVehicle(plate: string | null) {
  return useQuery({
    queryKey: ["fleet", "vehicle", plate],
    queryFn: () => getJson<VehicleDetail>(`/api/fleet/vehicles/${encodeURIComponent(plate ?? "")}`),
    enabled: plate !== null,
    refetchInterval: 10_000,
  });
}

export function useParcel(id: number) {
  return useQuery({
    queryKey: ["parcel", id],
    queryFn: () => getJson<ParcelDetail>(`/api/parcels/${String(id)}`),
    refetchInterval: 10_000,
  });
}

export function useParcelSearch(q: string) {
  return useQuery({
    queryKey: ["parcels", "search", q],
    queryFn: () => getJson<ParcelBrief[]>(`/api/parcels?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 3,
  });
}

export function useDirectionsAdmin() {
  return useQuery({
    queryKey: ["admin", "directions"],
    queryFn: () => getJson<DirectionAdmin[]>("/api/admin/directions"),
  });
}

export function useUpdateDirection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; plannedDeparture?: string; cutoffTime?: string }) =>
      sendJson<DirectionAdmin>("PATCH", `/api/admin/directions/${String(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "directions"] }),
  });
}
