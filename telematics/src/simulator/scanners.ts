/**
 * IoT scanners (cameras at the end of the belt at every loading door, and one on the sorting line).
 *
 * Every parcel passing a scanner is COUNTED (item_counted), even when its label cannot be read;
 * the label is read with probability read_rate. A few parcels end up at the wrong door (~0.5 %),
 * a few are scanned twice. One configured scanner degrades over time (dirty optics), which the
 * predictive-maintenance model in Phase 6 has to detect.
 */

import { HOUR, localParts, MINUTE } from "../clock/time.js";
import { rngFor, type Rng } from "./rng.js";

export type ScanTruth = "ok" | "wrong_direction" | "duplicate";

export interface ScanEvent {
  at: number;
  device: string;
  /** what the scanner read; null when the label was not readable */
  barcode: string | null;
  readOk: boolean;
  facesRead: number;
  itemCounted: boolean;
  /** the parcel that physically passed (simulation ground truth, not sent as a reading) */
  parcel: string;
  truth: ScanTruth;
}

export interface Degradation {
  device: string;
  /** epoch ms when the optics start to get worse */
  startedAt: number;
  hours: number;
  from: number;
  to: number;
}

export interface ReadRateModel {
  base: number;
  /** evening wave: parcels lie on the belt randomly rotated */
  eveningPenalty: number;
  line: number;
  degradation: Degradation | null;
}

export const DEFAULT_READ_RATE: Omit<ReadRateModel, "degradation"> = {
  base: 0.96,
  eveningPenalty: 0.02,
  line: 0.985,
};

export function readRate(model: ReadRateModel, device: string, t: number): number {
  const d = model.degradation;
  if (d && d.device === device && t >= d.startedAt) {
    const progress = Math.min((t - d.startedAt) / (d.hours * HOUR), 1);
    return d.from + (d.to - d.from) * progress;
  }
  if (device.startsWith("LINE-")) return model.line;
  const hour = localParts(t).hour;
  const evening = hour >= 15 && hour < 23;
  return model.base - (evening ? model.eveningPenalty : 0);
}

function facesRead(rng: Rng, readOk: boolean): number {
  if (!readOk) return 0;
  return 1 + (rng.chance(0.35) ? 1 : 0) + (rng.chance(0.1) ? 1 : 0);
}

function scan(rng: Rng, model: ReadRateModel, device: string, at: number, parcel: string, truth: ScanTruth): ScanEvent {
  const readOk = rng.chance(readRate(model, device, at));
  return {
    at,
    device,
    barcode: readOk ? parcel : null,
    readOk,
    facesRead: facesRead(rng, readOk),
    itemCounted: true,
    parcel,
    truth,
  };
}

export interface LoadingScanArgs {
  seed: number;
  day: string;
  key: string;
  device: string;
  start: number;
  end: number;
  manifest: readonly string[];
  /** parcels of other directions that can end up at this door by mistake */
  foreign: readonly string[];
  model: ReadRateModel;
  wrongDirectionP?: number;
  duplicateP?: number;
  /** parcels that are not in the depot from the start (night trucks): not before this time */
  earliest?: ReadonlyMap<string, number>;
}

/** Scans at one loading door while a truck is loaded. Deterministic per (seed, day, key). */
export function loadingScans(a: LoadingScanArgs): ScanEvent[] {
  const rng = rngFor(a.seed, a.day, "scans", a.key);
  const wrongP = a.wrongDirectionP ?? 0.005;
  const dupP = a.duplicateP ?? 0.003;
  const span = Math.max(a.end - a.start, MINUTE);
  const events: ScanEvent[] = [];
  for (const parcel of a.manifest) {
    let at = a.start + Math.floor(rng.next() * span);
    const notBefore = a.earliest?.get(parcel);
    if (notBefore !== undefined && at < notBefore) at = notBefore + rng.int(3, 20) * MINUTE;
    events.push(scan(rng, a.model, a.device, at, parcel, "ok"));
    if (rng.chance(dupP)) {
      events.push(scan(rng, a.model, a.device, at + rng.int(2, 20) * 1000, parcel, "duplicate"));
    }
    if (a.foreign.length > 0 && rng.chance(wrongP)) {
      const stray = rng.pick(a.foreign);
      events.push(scan(rng, a.model, a.device, at + rng.int(5, 90) * 1000, stray, "wrong_direction"));
    }
  }
  return events.sort((x, y) => x.at - y.at);
}

export interface LineScanArgs {
  seed: number;
  day: string;
  device: string;
  start: number;
  end: number;
  parcels: readonly string[];
  model: ReadRateModel;
  earliest?: ReadonlyMap<string, number>;
}

/** Morning wave: parcels from the night trucks pass the line scanner (labels face up). */
export function lineScans(a: LineScanArgs): ScanEvent[] {
  const rng = rngFor(a.seed, a.day, "line-scans", a.device);
  const span = Math.max(a.end - a.start, MINUTE);
  return a.parcels
    .map((parcel) => {
      let at = a.start + Math.floor(rng.next() * span);
      const notBefore = a.earliest?.get(parcel);
      if (notBefore !== undefined && at < notBefore) at = notBefore + rng.int(1, 15) * MINUTE;
      return scan(rng, a.model, a.device, at, parcel, "ok");
    })
    .sort((x, y) => x.at - y.at);
}
