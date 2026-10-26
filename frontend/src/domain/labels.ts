/** Slovak labels and tones of domain states, and time formatting in the depot time zone. */

import type { Tone } from "../components/ui";
import type { Alert, DirectionType, ParcelStatus, ScanResult, TripBrief, TripStatus } from "../api/wms";

export const TIME_ZONE = "Europe/Bratislava";

export const TRIP_STATUS: Record<TripStatus, { label: string; tone: Tone }> = {
  planned: { label: "Plánovaná", tone: "neutral" },
  en_route: { label: "Na ceste", tone: "info" },
  at_door: { label: "Pri bráne", tone: "brand" },
  loading: { label: "Nakladá sa", tone: "ok" },
  departed: { label: "Odišiel", tone: "info" },
  completed: { label: "Dokončená", tone: "neutral" },
  cancelled: { label: "Zrušená", tone: "danger" },
};

export const PARCEL_STATUS: Record<ParcelStatus, { label: string; tone: Tone }> = {
  collected: { label: "Prijatý", tone: "neutral" },
  on_belt: { label: "Na páse", tone: "info" },
  sorted: { label: "Vytriedený", tone: "info" },
  loaded: { label: "Naložený", tone: "ok" },
  staged: { label: "Odstavený", tone: "brand" },
  out_for_delivery: { label: "V doručovaní", tone: "info" },
  delivered: { label: "Doručený", tone: "ok" },
  failed_delivery: { label: "Nedoručený", tone: "warn" },
  returned: { label: "Vrátený", tone: "danger" },
};

/** States of a courier van as reported by the simulator. */
export const VAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  loading: { label: "Nakladá", tone: "ok" },
  en_route: { label: "Na trase", tone: "info" },
  at_stop: { label: "Na zastávke", tone: "ok" },
  returning: { label: "Vracia sa", tone: "info" },
};

export const SCAN_RESULT: Record<ScanResult, { label: string; tone: Tone }> = {
  ok: { label: "Naložené", tone: "ok" },
  wrong_direction: { label: "Zlý smer", tone: "danger" },
  duplicate: { label: "Duplicitný", tone: "neutral" },
  unidentified: { label: "Neidentifikovaný", tone: "warn" },
};

export const DIRECTION_TYPE: Record<DirectionType, string> = {
  linehaul: "Diaľkový",
  transit: "Prechod",
  local: "Rajón",
};

export const ALERT_SEVERITY: Record<Alert["severity"], { label: string; tone: Tone }> = {
  info: { label: "Info", tone: "info" },
  warning: { label: "Varovanie", tone: "warn" },
  critical: { label: "Kritické", tone: "danger" },
};

export const ALERT_KIND: Record<Alert["kind"], string> = {
  wrong_direction: "Zlý smer",
  cascade_delay: "Kaskáda meškania",
  scanner_degradation: "Skener",
  device_offline: "Zariadenie offline",
  other: "Iné",
};

export const SOURCE: Record<"iot" | "manual" | "system", string> = {
  iot: "IoT skener",
  manual: "Ručný sken",
  system: "Systém",
};

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("sk-SK", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
}

export function hhmmss(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("sk-SK", { timeZone: TIME_ZONE });
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" });
}

/** "+12 min", "včas", "−3 min" */
export function delayLabel(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (Math.abs(min) < 3) return "včas";
  return min > 0 ? `+${String(min)} min` : `−${String(-min)} min`;
}

export function delayTone(min: number | null | undefined): Tone {
  if (min === null || min === undefined || min < 10) return "ok";
  return min < 30 ? "warn" : "danger";
}

/** Expected time of the trip's key event (arrival for inbound, departure for outbound). */
export function expectedTime(t: TripBrief): string | null {
  if (t.kind === "inbound") return t.actualArrival ?? t.predictedArrival ?? t.plannedArrival;
  return t.actualDeparture ?? t.plannedDeparture;
}

export function plannedTime(t: TripBrief): string | null {
  return t.kind === "inbound" ? t.plannedArrival : t.plannedDeparture;
}

export const WAVE_LABEL: Record<string, string> = {
  evening: "Večerná vlna",
  night: "Nočná / ranná vlna",
};
