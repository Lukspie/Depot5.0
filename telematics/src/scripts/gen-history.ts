/**
 * History generator for ML training (Phase 6):  npm run gen:history -- --days 180 --out ../ml/data
 *
 * Writes two CSV files with N days of simulated history ending yesterday:
 *   trips_history.csv           - truck trips with arrival/departure delays and their features
 *   device_metrics_history.csv  - per-minute scanner metrics incl. labelled degradation episodes
 * It uses the same delay and read-rate models as the live simulator.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { addDays, localDate, localParts, MINUTE, zonedToUtc } from "../clock/time.js";
import { arrivalDelay, departureDelay, weatherFor } from "../simulator/delays.js";
import { rngFor } from "../simulator/rng.js";
import { RoadRouter } from "../simulator/roads.js";
import { buildRouteBook, routeFor, type LatLon } from "../simulator/routes.js";

// mirrors the plan created by the app (app/src/depotrack/services/trip_plan.py + seed reference)
const LINEHAUL = [
  { code: "BB", departure: "20:30", nightArrival: "01:00" },
  { code: "BA", departure: "21:30", nightArrival: "01:30" },
  { code: "ZA", departure: "21:00", nightArrival: "02:00" },
];
const TRANSIT = [
  { code: "MI", departure: "06:00", eveningArrival: "15:45" },
  { code: "TV", departure: "06:15", eveningArrival: "16:00" },
  { code: "HE", departure: "06:00", eveningArrival: "16:15" },
  { code: "SL", departure: "05:45", eveningArrival: "16:30" },
  { code: "SE", departure: "06:30", eveningArrival: "16:45" },
];
const DOCK_SCANNERS = [...LINEHAUL, ...TRANSIT].map((d, i) => ({
  device: `DOCK-SCN-${String(i + 1).padStart(2, "0")}`,
  code: d.code,
  // linehaul docks load in the evening, transit docks in the morning
  window: i < LINEHAUL.length ? (["17:05", "21:15"] as const) : (["03:05", "05:35"] as const),
  perMinute: i < LINEHAUL.length ? 2.2 : 1.6,
}));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

function csvLine(values: (string | number | null)[]): string {
  return values.map((v) => (v === null ? "" : String(v))).join(",") + "\n";
}

function binomial(rng: ReturnType<typeof rngFor>, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng.next() < p) k++;
  return k;
}

const days = Number(arg("days", "180"));
const seed = Number(arg("seed", "42"));
const outDir = resolve(arg("out", "../ml/data"));
const end = arg("end", addDays(localDate(Date.now()), -1));
const start = addDays(end, -(days - 1));
mkdirSync(outDir, { recursive: true });
// same real-road distances as the live simulator (Budimír depot, ADR-039)
const DEPOT: LatLon = [48.79256, 21.3071];
const DESTINATIONS: Record<string, LatLon> = {
  BA: [48.1645, 17.1795], BB: [48.7363, 19.1462], ZA: [49.2232, 18.7394], MI: [48.7543, 21.9195],
  TV: [48.6286, 21.7178], HE: [48.9371, 21.9063], SL: [49.2986, 20.6866], SE: [48.6794, 17.3667],
};
const routes = buildRouteBook(RoadRouter.load(), DEPOT, DESTINATIONS);

// ---------------------------------------------------------------- trips
const trips = createWriteStream(join(outDir, "trips_history.csv"));
trips.write(
  csvLine([
    "operating_day", "direction", "direction_type", "kind", "event", "planned_at",
    "weekday", "month", "hour", "weather", "distance_km", "prev_delay_min", "delay_min",
  ]),
);
const prevDelay = new Map<string, number>();
let tripRows = 0;
for (let day = start; day <= end; day = addDays(day, 1)) {
  const weather = weatherFor(seed, day);
  const next = addDays(day, 1);
  const events: { code: string; type: string; kind: string; event: string; at: number }[] = [
    ...TRANSIT.map((t) => ({ code: t.code, type: "transit", kind: "inbound", event: "arrival", at: zonedToUtc(day, t.eveningArrival) })),
    ...LINEHAUL.map((l) => ({ code: l.code, type: "linehaul", kind: "outbound", event: "departure", at: zonedToUtc(day, l.departure) })),
    ...LINEHAUL.map((l) => ({ code: l.code, type: "linehaul", kind: "inbound", event: "arrival", at: zonedToUtc(next, l.nightArrival) })),
    ...TRANSIT.map((t) => ({ code: t.code, type: "transit", kind: "outbound", event: "departure", at: zonedToUtc(next, t.departure) })),
  ];
  for (const e of events) {
    const p = localParts(e.at);
    const km = Math.round(routeFor(routes, e.code).lengthKm);
    const key = `${e.code}|${e.kind}`;
    const prev = prevDelay.get(key) ?? 0;
    const ctx = { weekday: p.weekday, month: p.month, hour: p.hour, weather, prevDelayMin: prev, distanceKm: km };
    const rng = rngFor(seed, day, "history-trip", e.code, e.kind);
    const delay = e.event === "arrival" ? arrivalDelay(ctx, rng) : departureDelay(ctx, rng);
    prevDelay.set(key, delay);
    trips.write(
      csvLine([day, e.code, e.type, e.kind, e.event, new Date(e.at).toISOString(), p.weekday, p.month, p.hour, weather, km, prev, delay]),
    );
    tripRows++;
  }
}
trips.end();

// ---------------------------------------------------------------- device metrics
const metrics = createWriteStream(join(outDir, "device_metrics_history.csv"));
metrics.write(csvLine(["device", "minute", "items", "reads_ok", "read_rate", "degraded"]));
let metricRows = 0;
let episodes = 0;
for (const scanner of DOCK_SCANNERS) {
  const epRng = rngFor(seed, "history-episodes", scanner.device);
  // degradation episodes: optics get dirty over 6-48 h, stay bad until serviced 1-3 days later
  let nextEpisodeDay = epRng.int(10, 40);
  let episode: { from: number; to: number; target: number; repairedAt: number } | null = null;
  let dayIndex = 0;
  for (let day = start; day <= end; day = addDays(day, 1), dayIndex++) {
    const base = scanner.window[0] === "17:05" ? 0.94 : 0.96; // evening wave: random orientation
    const loadDay = scanner.window[0] === "17:05" ? day : addDays(day, 1);
    const from = zonedToUtc(loadDay, scanner.window[0]);
    const to = zonedToUtc(loadDay, scanner.window[1]);
    if (!episode && dayIndex >= nextEpisodeDay) {
      const hours = epRng.int(6, 48);
      episode = {
        from,
        to: from + hours * 60 * MINUTE,
        target: epRng.float(0.8, 0.88),
        repairedAt: from + (hours + epRng.int(24, 72)) * 60 * MINUTE,
      };
      episodes++;
    }
    const rng = rngFor(seed, day, "history-metrics", scanner.device);
    for (let t = from; t < to; t += MINUTE) {
      let rate = base;
      let degraded = 0;
      if (episode && t >= episode.from) {
        if (t >= episode.repairedAt) {
          episode = null;
          nextEpisodeDay = dayIndex + epRng.int(20, 45);
        } else {
          const progress = Math.min((t - episode.from) / (episode.to - episode.from), 1);
          rate = base + (episode.target - base) * progress;
          degraded = 1;
        }
      }
      const items = Math.max(0, Math.round(rng.normal(scanner.perMinute, 1.1)));
      const ok = binomial(rng, items, rate);
      metrics.write(csvLine([scanner.device, new Date(t).toISOString(), items, ok, items > 0 ? (ok / items).toFixed(4) : null, degraded]));
      metricRows++;
    }
  }
}
metrics.end();

console.log(
  JSON.stringify({ outDir, from: start, to: end, seed, tripRows, metricRows, degradationEpisodes: episodes }),
);
