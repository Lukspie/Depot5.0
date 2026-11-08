/** What the top bar and the side navigation show (GET /api/shell, phase 7d). */

import { useQuery } from "@tanstack/react-query";
import { getJson } from "./client";
import type { Alert } from "./wms";

export interface Shell {
  simTime: string;
  operatingDay: string;
  wave: { code: string; name: string; start: string; end: string } | null;
  /** null: the role does not see them */
  openAlerts: number | null;
  gateQueue: number | null;
  boardUrl: string | null;
}

const q = (depot: string | null) => (depot ? `depot=${encodeURIComponent(depot)}` : "");

export function useShell(depot: string | null) {
  return useQuery({
    queryKey: ["shell", depot],
    queryFn: () => getJson<Shell>(`/api/shell?${q(depot)}`),
    refetchInterval: 15_000,
    enabled: depot !== null,
  });
}

/** Open alerts of the current operating day in the depot (the list behind the bell). */
export function useCurrentAlerts(depot: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["alerts", "current", depot],
    queryFn: () => getJson<{ alerts: Alert[] }>(`/api/alerts?current=true&${q(depot)}`),
    refetchInterval: 15_000,
    enabled: enabled && depot !== null,
  });
}

export interface SearchHit {
  kind: "parcel" | "vehicle" | "trip" | "door";
  key: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Search of the top bar within the depot (GET /api/search, scoped by role and depot). */
export function useSearch(term: string, depot: string | null) {
  return useQuery({
    queryKey: ["search", depot, term],
    queryFn: () => getJson<{ depot: string; hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(term)}&${q(depot)}`),
    enabled: term.trim().length >= 2 && depot !== null,
  });
}
