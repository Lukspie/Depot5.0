/**
 * Situations (phase 5d, ADR-054): named, deterministic starting points for demos, screenshots and
 * tests. A situation is a seed, the scenario switches (guaranteed cascade, degraded scanner) and a
 * local time; loading it is a clean reset with these settings and a replay from 15:00 to the time,
 * so the same situation always gives the same numbers.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextOccurrence } from "../clock/time.js";

export interface Situation {
  id: string;
  /** Slovak name and description for the admin UI */
  name: string;
  description: string;
  /** local HH:MM of the operating day (15:00 to 15:00 next day) */
  time: string;
  seed: number;
  /** default: SIM_FORCE_CASCADE */
  forceCascade?: boolean;
  /** default: SIM_DEGRADED_DEVICE; null = no degraded scanner */
  degradedDevice?: string | null;
}

export const DEFAULT_SITUATIONS_FILE = fileURLToPath(new URL("../../data/situations.json", import.meta.url));

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function loadSituations(file: string = DEFAULT_SITUATIONS_FILE): Situation[] {
  const list = JSON.parse(readFileSync(file, "utf8")) as Situation[];
  const ids = new Set<string>();
  for (const s of list) {
    if (!/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id)) throw new Error(`bad or duplicate situation id ${s.id}`);
    if (!HHMM.test(s.time) || s.time === "15:00") throw new Error(`situation ${s.id}: time must be HH:MM after 15:00`);
    ids.add(s.id);
  }
  return list;
}

/** The situation's time within the operating day that starts at `dayStart` (15:00 local). */
export function situationTarget(dayStart: number, s: Situation): number {
  return nextOccurrence(dayStart, s.time);
}
