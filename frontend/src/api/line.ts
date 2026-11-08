/** Sorting line of a depot from telematics (phase 7d step 5d, ADR-071). */

import { useQuery } from "@tanstack/react-query";
import type { LineVariant } from "../shadow/layout";
import { telematics } from "./telematicsApi";

export interface CheckpointView {
  code: string;
  node: string;
  kind: string;
  label: string;
  perHour: number;
  today: number;
  readRate: number | null;
  unread: number;
  queue: number | null;
}

export interface VariantKpis {
  parcels: number;
  peakPerHour: number;
  unread: number;
  recirculated: number;
  avgMinutes: number | null;
  manual: number;
}

export interface LineHop {
  node: string;
  at: string;
}

export interface LineView {
  depot: string;
  variant: LineVariant;
  variants: LineVariant[];
  simTime: string;
  checkpoints: CheckpointView[];
  parcels: { barcode: string; unread: boolean; hops: LineHop[] }[];
  compare: Partial<Record<LineVariant, VariantKpis>>;
}

export interface LineParcelRoute {
  barcode: string;
  variant: LineVariant;
  door: string;
  hops: LineHop[];
  passages: { checkpoint: string; at: string; read: boolean | null }[];
  current: { checkpoint: string; at: string } | null;
}

/** Polled while the roof is open: the parcels on the line move between two polls by the clock. */
export function useLine(depot: string, variant: LineVariant, enabled: boolean) {
  return useQuery({
    queryKey: ["telematics", "line", depot, variant],
    queryFn: () => telematics<LineView>("GET", `/line/${depot}?variant=${variant}`),
    enabled,
    refetchInterval: 4000,
    retry: false,
  });
}

export function useLineParcel(depot: string, barcode: string | null, variant: LineVariant, enabled: boolean) {
  return useQuery({
    queryKey: ["telematics", "line-parcel", depot, barcode, variant],
    queryFn: () => telematics<LineParcelRoute>("GET", `/line/${depot}/parcels/${encodeURIComponent(barcode ?? "")}?variant=${variant}`),
    enabled: enabled && barcode !== null,
    refetchInterval: 10_000,
    retry: false,
  });
}
