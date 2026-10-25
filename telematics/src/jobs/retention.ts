/**
 * GDPR retention: gate passages contain licence plates and camera snapshots (personal data).
 * Records older than GATE_RETENTION_DAYS (by simulated time) are deleted every hour, together with
 * their snapshot files.
 */

import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { TelemetrySink } from "../db/telemetry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeGate(
  store: TelemetrySink,
  simNow: number,
  retentionDays: number,
  snapshotDir: string,
): Promise<{ rows: number; files: number }> {
  const paths = await store.purgeGatePassages(simNow - retentionDays * DAY_MS);
  const root = resolve(snapshotDir) + sep;
  let files = 0;
  for (const p of paths) {
    const full = resolve(snapshotDir, p);
    if (!full.startsWith(root)) continue; // never delete outside the snapshot directory
    try {
      await unlink(full);
      files++;
    } catch {
      // already gone
    }
  }
  return { rows: paths.length, files };
}
