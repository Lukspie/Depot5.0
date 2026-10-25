/** System endpoints of both backends. The frontend talks to each one directly. */

import { useQuery } from "@tanstack/react-query";
import { getJson } from "./client";

export interface Hello {
  service: string;
  language: string;
  version: string;
  time: string;
}

export interface Health {
  status: "ok" | "error";
  db: "ok" | "unreachable";
}

export interface PublicConfig {
  telematics_url: string;
}

const REFRESH_MS = 10_000;

export function usePublicConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => getJson<PublicConfig>("/api/config"),
    staleTime: Infinity,
  });
}

export function useAppStatus() {
  const hello = useQuery({
    queryKey: ["app", "hello"],
    queryFn: () => getJson<Hello>("/api/hello"),
    refetchInterval: REFRESH_MS,
  });
  const health = useQuery({
    queryKey: ["app", "health"],
    queryFn: () => getJson<Health>("/api/health"),
    refetchInterval: REFRESH_MS,
  });
  return { hello, health };
}

/** Calls telematics directly from the browser (different origin, CORS-allowed). */
export function useTelematicsStatus(baseUrl: string | undefined) {
  const enabled = baseUrl !== undefined;
  const hello = useQuery({
    queryKey: ["telematics", "hello", baseUrl],
    queryFn: () => getJson<Hello>(`${baseUrl}/hello`, { credentials: "omit" }),
    enabled,
    refetchInterval: REFRESH_MS,
  });
  const health = useQuery({
    queryKey: ["telematics", "health", baseUrl],
    queryFn: () => getJson<Health>(`${baseUrl}/health`, { credentials: "omit" }),
    enabled,
    refetchInterval: REFRESH_MS,
  });
  return { hello, health };
}
