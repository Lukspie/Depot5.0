/**
 * Time-zone helpers for the depot (Europe/Bratislava) without external libraries.
 * Simulated time is kept as epoch milliseconds (UTC); local wall-clock times are derived here,
 * including daylight-saving transitions.
 */

export const TIME_ZONE = "Europe/Bratislava";
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** The operating day starts at 15:00 local time (see app ADR-022). */
export const OPERATING_DAY_START = "15:00";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export function localParts(ms: number): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? "Mon"] ?? 1,
  };
}

/** Offset of local time from UTC at the given instant (ms). */
function offsetMs(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DD" + "HH:MM" local time -> epoch ms. */
export function zonedToUtc(date: string, hhmm: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess);
  const second = guess - offsetMs(first);
  return second;
}

export function localDate(ms: number): string {
  const p = localParts(ms);
  return `${String(p.year)}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localHhmm(ms: number): string {
  const p = localParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Operating day an instant belongs to (from 15:00 that day to 15:00 the next day). */
export function operatingDay(ms: number): string {
  const day = localDate(ms);
  return ms >= zonedToUtc(day, OPERATING_DAY_START) ? day : addDays(day, -1);
}

export function operatingDayStart(day: string): number {
  return zonedToUtc(day, OPERATING_DAY_START);
}

/** Next instant (strictly after `ms`) whose local time is `hhmm`. */
export function nextOccurrence(ms: number, hhmm: string): number {
  const today = zonedToUtc(localDate(ms), hhmm);
  return today > ms ? today : zonedToUtc(addDays(localDate(ms), 1), hhmm);
}
