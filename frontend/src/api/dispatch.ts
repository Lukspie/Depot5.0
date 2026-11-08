/** Dispatching of design system v2 (GET /api/dispatch?depot=, phase 7d, maketa-dispecing). */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Tone } from "../components/ui";
import { getJson } from "./client";
import type { Alert, Clock } from "./wms";

export interface Kpi {
  key: string;
  label: string;
  tone: Tone;
  value: string;
  unit: string | null;
  spark: number[];
  delta: { value: string; tone: Tone } | null;
  context: string | null;
}

export interface TripRow {
  key: string;
  group: string;
  kind: "inbound" | "outbound";
  status: string;
  statusLabel: string;
  statusTone: Tone;
  plan: string | null;
  direction: string;
  plate: string;
  typeLabel: string;
  door: string | null;
  loaded: number;
  expected: number;
  missing: number | null;
  loadingFrom: string | null;
  eta: string | null;
  deltaMin: number | null;
  etaBy: string | null;
  risk: { label: string; tone: Tone; reason: string } | null;
  href: string | null;
}

export interface TripGroup {
  key: string;
  tab: "out" | "in";
  title: string;
  sub: string;
  tone: Tone;
}

export interface AlertCard {
  id: number;
  kind: Alert["kind"];
  severity: Alert["severity"];
  at: string;
  source: string | null;
  title: string;
  facts: string[];
  action: { label: string; kind: "link" | "maintenance" | "scenario"; target: string } | null;
}

export interface Dispatch {
  depot: { code: string; name: string; label: string; mode: "transship" | "delivery" };
  clock: Clock;
  summary: string;
  kpis: Kpi[];
  groups: TripGroup[];
  trips: TripRow[];
  alerts: AlertCard[];
  legend: string[];
  legendTotals: number[];
  directions: { name: string; parts: number[]; total: number }[];
  dayStart: string;
  timeline: { name: string; start: string; end: string; tone: Tone | "primary"; state: string; stateTone: Tone }[];
}

export function useDispatch(depot: string | null) {
  return useQuery({
    queryKey: ["dispatch", depot],
    queryFn: () => getJson<Dispatch>(`/api/dispatch?depot=${encodeURIComponent(depot ?? "")}`),
    enabled: depot !== null,
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
}
