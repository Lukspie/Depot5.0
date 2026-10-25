/** Depots, hall layouts, live depot state (app) and truck routes / devices (telematics). */

import { useQuery } from "@tanstack/react-query";
import type { DepotLayout } from "../components/map/depot3d";
import { getJson } from "./client";
import { telematics, type DeviceInfo } from "./telematicsApi";

export interface Depot {
  code: string;
  name: string;
  kind: "depot" | "hub";
  lat: number;
  lon: number;
}

export interface DepotState {
  depot: Depot;
  simTime: string;
  occupied: { doorCode: string; plate: string; tripId: number; tripKind: string; status: string; directionCode: string; directionType: string }[];
  staged: { doorCode: string; directionCode: string; parcels: number }[];
  trucks: { plate: string; tripId: number; state: "arriving" | "at_hub" | "loading_at_hub" | "departed"; at: string | null }[];
}

export interface Routes {
  depot: [number, number];
  routes: Record<string, { points: [number, number][]; minutes: number }>;
}

export function useDepots() {
  return useQuery({ queryKey: ["depots"], queryFn: () => getJson<Depot[]>("/api/depots"), staleTime: Infinity });
}

export function useLayout(code: string) {
  return useQuery({
    queryKey: ["layout", code],
    queryFn: () => getJson<DepotLayout>(`/api/layout?depot=${code}`),
    staleTime: Infinity,
  });
}

export function useDepotState(code: string) {
  return useQuery({
    queryKey: ["depot-state", code],
    queryFn: () => getJson<DepotState>(`/api/depots/${code}/state`),
    refetchInterval: 10_000,
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["telematics", "devices"],
    queryFn: () => telematics<{ devices: DeviceInfo[] }>("GET", "/devices"),
    refetchInterval: 10_000,
  });
}

export function useRoutes() {
  return useQuery({
    queryKey: ["telematics", "routes"],
    queryFn: () => telematics<Routes>("GET", "/routes"),
    staleTime: 5 * 60_000,
  });
}
