/**
 * The delay cascade rule (ADR-030), the same as in the app (services/cascade.py):
 *
 *   ready = eta of the night truck + sorting buffer
 *   at risk when ready > planned departure of the transit truck; critical when eta > departure
 *
 * Both implementations are checked against contracts/cascade-cases.json (ADR-047), so a what-if
 * scenario shows the same cascade warnings as the dispatcher dashboard.
 */

import { MINUTE } from "../clock/time.js";

export interface CascadeRisk {
  severity: "warning" | "critical";
  lateMin: number;
}

export function cascadeRisk(eta: number, departure: number, bufferMin: number): CascadeRisk | null {
  const ready = eta + bufferMin * MINUTE;
  if (ready <= departure) return null;
  return { severity: eta > departure ? "critical" : "warning", lateMin: Math.floor((ready - departure) / MINUTE) };
}
