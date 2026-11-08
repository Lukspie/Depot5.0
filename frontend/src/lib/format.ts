/**
 * Slovak number and time formats for the whole UI (design system v2, ADR-067):
 * `1 989`, `88,9 %`, `06:06`, `o 3 h 20 min`. Times are simulated times in Europe/Bratislava.
 */

export const TZ = "Europe/Bratislava";

const numFmt = new Map<number, Intl.NumberFormat>();

function nf(decimals: number): Intl.NumberFormat {
  let f = numFmt.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("sk-SK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    numFmt.set(decimals, f);
  }
  return f;
}

/** `1 989`, `9 870`; with decimals `6,4`. "—" for a missing value. */
export function num(value: number | null | undefined, decimals = 0): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : nf(decimals).format(value);
}

/** A ratio 0–1 as percent: `88,9 %`. */
export function pct(ratio: number | null | undefined, decimals = 1): string {
  return ratio === null || ratio === undefined ? "—" : `${nf(decimals).format(ratio * 100)} %`;
}

/** The number part of a percent without the sign (KPI value with the unit set apart): `88,9`. */
export function pctValue(ratio: number | null | undefined, decimals = 1): string {
  return ratio === null || ratio === undefined ? "—" : nf(decimals).format(ratio * 100);
}

/** Kilograms: `9 870 kg`, small weights with one decimal `6,4 kg`. */
export function kg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${num(value, value < 100 ? 1 : 0)} kg`;
}

const toDate = (t: Date | string | number): Date => (t instanceof Date ? t : new Date(t));

/** `06:06` in the depot's time zone. */
export function hhmm(t: Date | string | number | null | undefined): string {
  if (t === null || t === undefined) return "—";
  return toDate(t).toLocaleTimeString("sk-SK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/** `15. 3.` */
export function dayMonth(t: Date | string | number): string {
  return toDate(t).toLocaleDateString("sk-SK", { timeZone: TZ, day: "numeric", month: "numeric" });
}

/** A length of time: `45 min`, `3 h 20 min`, `2 h`. */
export function duration(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${String(m)} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${String(h)} h ${String(rest).padStart(2, "0")} min` : `${String(h)} h`;
}

/** Relative to the simulated now: `o 3 h 20 min`, `pred 5 min`, `teraz`. */
export function relative(t: Date | string | number | null | undefined, now: Date | null | undefined): string {
  if (t === null || t === undefined || !now) return "";
  const minutes = (toDate(t).getTime() - now.getTime()) / 60_000;
  if (Math.abs(minutes) < 1) return "teraz";
  return minutes > 0 ? `o ${duration(minutes)}` : `pred ${duration(minutes)}`;
}

/** A signed difference in minutes: `+4 min`, `−1 min` (true minus sign), `0 min`. */
export function signedMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m === 0) return "0 min";
  return `${m > 0 ? "+" : "−"}${String(Math.abs(m))} min`;
}

/** A signed number for a change: `+186`, `−1,6`. */
export function signed(value: number, decimals = 0): string {
  if (value === 0) return nf(decimals).format(0);
  return `${value > 0 ? "+" : "−"}${nf(decimals).format(Math.abs(value))}`;
}
