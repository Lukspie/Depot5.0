/**
 * Delay model for trucks, shared by the live simulator and the history generator
 * (`npm run gen:history`), so the ML model in Phase 6 learns the same patterns it later predicts.
 *
 * Patterns: Fridays, December (and winter), bad weather, night driving (less traffic),
 * distance, and the delay of the previous trip on the same direction (delays propagate).
 */

import { rngFor, type Rng } from "./rng.js";

export type Weather = "clear" | "rain" | "fog" | "snow";

/** Simulated weather of a day, by season. */
export function weatherFor(seed: number, day: string): Weather {
  const month = Number(day.slice(5, 7));
  const rng = rngFor(seed, day, "weather");
  const winter = month === 12 || month <= 2;
  const autumn = month >= 10 || month === 3;
  const pSnow = winter ? 0.22 : 0;
  const pFog = autumn ? 0.12 : winter ? 0.08 : 0.03;
  const pRain = winter ? 0.15 : autumn ? 0.25 : 0.18;
  const r = rng.next();
  if (r < pSnow) return "snow";
  if (r < pSnow + pFog) return "fog";
  if (r < pSnow + pFog + pRain) return "rain";
  return "clear";
}

export interface DelayContext {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  month: number;
  /** local hour of the planned event */
  hour: number;
  weather: Weather;
  /** delay of the previous trip on the same direction, minutes */
  prevDelayMin: number;
  distanceKm: number;
}

const WEATHER_MEAN: Record<Weather, number> = { clear: 0, rain: 7, fog: 10, snow: 22 };
const WEATHER_SD: Record<Weather, number> = { clear: 0, rain: 3, fog: 4, snow: 8 };

/** Arrival delay of an inbound truck in minutes (negative = early). */
export function arrivalDelay(ctx: DelayContext, rng: Rng): number {
  let mean = 4;
  if (ctx.weekday === 5) mean += 9;
  if (ctx.month === 12) mean += 12;
  else if (ctx.month <= 2) mean += 4;
  mean += WEATHER_MEAN[ctx.weather];
  mean += 0.35 * ctx.prevDelayMin;
  if (ctx.hour >= 22 || ctx.hour < 5) mean -= 3;
  mean += (ctx.distanceKm / 100) * 2;
  const sd = 6 + WEATHER_SD[ctx.weather];
  let delay = rng.normal(mean, sd);
  // rare incidents (accident, closure)
  if (rng.chance(0.04)) delay += rng.float(30, 120);
  return Math.round(Math.max(delay, -10));
}

/** Departure delay at the depot in minutes (usually small). */
export function departureDelay(ctx: DelayContext, rng: Rng): number {
  let mean = 2;
  if (ctx.weekday === 5) mean += 3;
  if (ctx.month === 12) mean += 4;
  mean += WEATHER_MEAN[ctx.weather] / 4;
  const delay = rng.normal(mean, 4);
  return Math.round(Math.max(delay, -5));
}
