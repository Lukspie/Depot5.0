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

export function useShell(enabled = true) {
  return useQuery({ queryKey: ["shell"], queryFn: () => getJson<Shell>("/api/shell"), refetchInterval: 15_000, enabled });
}

/** Open alerts of the current operating day (the list behind the bell). */
export function useCurrentAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ["alerts", "current"],
    queryFn: () => getJson<{ alerts: Alert[] }>("/api/alerts?current=true"),
    refetchInterval: 15_000,
    enabled,
  });
}
