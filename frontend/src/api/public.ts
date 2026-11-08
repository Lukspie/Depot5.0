/** The login page before sign-in (GET /api/public/login-info, phase 7d). */

import { useQuery } from "@tanstack/react-query";
import type { Role } from "./auth";
import { getJson } from "./client";

export interface LoginInfo {
  depots: { code: string; name: string; label: string; kind: "depot" | "hub"; lat: number; lon: number }[];
  links: { origin: string; destination: string; kind: "linehaul" | "planned" }[];
  servicesOk: boolean;
  telemetryLive: boolean;
  mlModels: number;
  sessionHours: number;
  /** names and roles of the demo accounts; null outside the demo mode. Never passwords. */
  demoAccounts: { username: string; role: Role; depot: string | null }[] | null;
}

export function useLoginInfo() {
  return useQuery({ queryKey: ["public", "login-info"], queryFn: () => getJson<LoginInfo>("/api/public/login-info"), staleTime: 60_000, retry: 1 });
}
