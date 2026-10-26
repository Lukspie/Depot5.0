/**
 * Scans of one operating day as a pure function of (plan, scenario, manifests, read-rate model,
 * seed, devices). The live engine replays them against the clock; a what-if scenario computes
 * them again with changed inputs (ADR-047), so both use exactly the same code.
 */

import type { ManifestParcel, PlanWithLocal } from "../app-client.js";
import { addDays, MINUTE, zonedToUtc } from "../clock/time.js";
import type { DayScenario } from "./scenario.js";
import { lineScans, loadingScans, type ReadRateModel, type ScanEvent } from "./scanners.js";

export const BELT_AFTER_ARRIVAL = 10 * MINUTE;
export const DOCK_AFTER_ARRIVAL = 25 * MINUTE;

export interface DayScanInput {
  plan: PlanWithLocal;
  scenario: DayScenario;
  manifests: ReadonlyMap<string, ManifestParcel[]>;
  model: ReadRateModel;
  seed: number;
  /** dock scanner at a door (null = no scanner / switched off) */
  dockDevice: (doorCode: string | null) => string | null;
  lineDevice: string | null;
}

export function dayScans(input: DayScanInput): ScanEvent[] {
  const { plan, scenario, manifests, model, seed } = input;
  const scans: ScanEvent[] = [];
  const outbound = plan.trips.filter((t) => t.kind === "outbound");
  const barcodes = (dir: string): string[] => (manifests.get(dir) ?? []).map((p) => p.barcode);
  // parcels on the night trucks can be scanned only after their truck arrived
  const beltEarliest = new Map<string, number>();
  const dockEarliest = new Map<string, number>();
  for (const parcels of manifests.values()) {
    for (const p of parcels) {
      if (p.arrivesWithTripId === null) continue;
      const arrive = scenario.schedules.get(p.arrivesWithTripId)?.arriveDepot;
      if (arrive === undefined) continue;
      beltEarliest.set(p.barcode, arrive + BELT_AFTER_ARRIVAL);
      dockEarliest.set(p.barcode, arrive + DOCK_AFTER_ARRIVAL);
    }
  }
  for (const trip of outbound) {
    const s = scenario.schedules.get(trip.id);
    const device = input.dockDevice(trip.doorCode);
    if (!s || !device || s.loadStart === undefined || s.loadEnd === undefined) continue;
    const foreign = outbound.filter((o) => o.directionCode !== trip.directionCode).flatMap((o) => barcodes(o.directionCode));
    scans.push(
      ...loadingScans({
        seed,
        day: plan.day,
        key: `${trip.directionCode}-${String(trip.id)}`,
        device,
        start: s.loadStart,
        end: s.loadEnd,
        manifest: barcodes(trip.directionCode),
        foreign,
        model,
        earliest: dockEarliest,
      }),
    );
  }
  if (input.lineDevice) {
    const next = addDays(plan.day, 1);
    const morning = [...outbound.filter((t) => t.directionType === "transit").map((t) => t.directionCode), ...plan.localDirections].flatMap((dir) =>
      barcodes(dir),
    );
    scans.push(
      ...lineScans({
        seed,
        day: plan.day,
        device: input.lineDevice,
        start: zonedToUtc(next, "01:15"),
        end: zonedToUtc(next, "05:30"),
        parcels: morning,
        model,
        earliest: beltEarliest,
      }),
    );
  }
  return scans.sort((a, b) => a.at - b.at || a.device.localeCompare(b.device));
}
