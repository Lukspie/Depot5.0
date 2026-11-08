/** Delivery part (Phase 4): public tracking, courier screen, admin list of simulated SMS. */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, isApiError, sendJson } from "./client";
import { telematics } from "./telematicsApi";
import type { ParcelStatus } from "./wms";

// ------------------------------------------------------------------ public tracking

export interface TrackInfo {
  status: "preparing" | "on_the_way" | "delivered" | "failed";
  barcode: string;
  district?: string;
  courierName?: string;
  positionInLine?: number;
  stopsAhead?: number;
  etaFrom?: string;
  etaTo?: string;
  destination?: { lat: number; lon: number };
  /** exact position (≤ 3rd in line) or an approximate circle – decided by the server */
  courier?: {
    exact: boolean;
    lat: number;
    lon: number;
    heading?: number;
    radiusM?: number;
  };
  deliveredAt?: string;
  failedAt?: string;
  updatedAt?: string;
}

export const TRACK_POLL_MS = 5000;

export function useTrack(token: string) {
  return useQuery({
    queryKey: ["track", token],
    queryFn: () => getJson<TrackInfo>(`/api/track/${encodeURIComponent(token)}`),
    // poll every 5 s until delivered; a dead link is not asked again
    refetchInterval: (q) => (q.state.data?.status === "delivered" || isApiError(q.state.error, 404) ? false : TRACK_POLL_MS),
    retry: (count, err) => !isApiError(err, 404) && !isApiError(err, 429) && count < 2,
  });
}

// ------------------------------------------------------------------ courier screen

export type StopOutcome = "delivered" | "failed";

export interface CourierStop {
  id: number;
  sequence: number;
  parcelId: number;
  barcode: string;
  recipientName: string;
  address: string;
  lat: number;
  lon: number;
  weightKg: number;
  parcelStatus: ParcelStatus;
  plannedEta: string | null;
  predictedEta: string | null;
  deliveredAt: string | null;
  outcome: StopOutcome | null;
  /** ADR-062 */
  deliveryType: "handover" | "mailbox" | "locker";
  windowFrom: string | null;
  windowTo: string | null;
}

export interface CourierRouteBrief {
  id: number;
  date: string;
  courierUsername: string;
  courierName: string;
  vehiclePlate: string;
  districtCode: string;
  districtName: string;
  departedAt: string | null;
  returnedAt: string | null;
  stops: number;
  delivered: number;
  failed: number;
  loaded: number;
  stagingBay: string | null;
  plannedDeparture: string | null;
}

export interface CourierRoute extends CourierRouteBrief {
  vehicle: {
    lat: number;
    lon: number;
    heading: number;
    moving: boolean;
  } | null;
  depot: { code: string; name: string; lat: number; lon: number };
  stopList: CourierStop[];
}

export function useCourierRoutes(enabled: boolean, depot: string | null = null) {
  return useQuery({
    queryKey: ["courier", "routes", depot],
    queryFn: () => getJson<CourierRouteBrief[]>(`/api/courier/routes${depot ? `?depot=${encodeURIComponent(depot)}` : ""}`),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCourierRoute(courier: string | null) {
  return useQuery({
    queryKey: ["courier", "route", courier],
    queryFn: () => getJson<CourierRoute>(`/api/courier/route${courier ? `?courier=${encodeURIComponent(courier)}` : ""}`),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
    retry: (count, err) => !isApiError(err, 404) && !isApiError(err, 403) && count < 1,
  });
}

export function useFinishStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stopId, outcome }: { stopId: number; outcome: StopOutcome }) =>
      sendJson<CourierStop>("POST", `/api/courier/stops/${String(stopId)}`, {
        outcome,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier"] }),
  });
}

export interface ScanResult {
  action: "loaded" | "selected" | "done";
  stop: CourierStop;
}

/** The Bluetooth scanner paired with the van (simulated): loads before the departure, then selects. */
export function useCourierScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (barcode: string) => sendJson<ScanResult>("POST", "/api/courier/scan", { barcode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courier"] }),
  });
}

/** Remaining street path of a courier van (dispatcher map, from telematics). */
export function useVehiclePath(plate: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["telematics", "path", plate],
    queryFn: () => telematics<{ points: [number, number][] }>("GET", `/routes/vehicle/${encodeURIComponent(plate ?? "")}`),
    enabled: enabled && plate !== null,
    refetchInterval: 30_000,
    retry: false,
  });
}

// ------------------------------------------------------------------ admin: simulated SMS

export interface Notification {
  id: number;
  parcelId: number;
  barcode: string;
  channel: string;
  recipient: string;
  message: string;
  link: string;
  createdAt: string;
}

export function useNotifications(q: string) {
  return useQuery({
    queryKey: ["admin", "notifications", q],
    queryFn: () => getJson<Notification[]>(`/api/admin/notifications${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
}
