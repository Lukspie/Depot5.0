/**
 * Simulated time for animations inside the canvas, without re-rendering React: the "clock"
 * channel writes the last tick here, `simNow()` advances it by the speed (like useSimClock).
 */

import { useChannel, type SimClockInfo } from "../hooks/telematics";

const tick = { sim: 0, real: 0, speed: 1, paused: true };

export function simNow(): number {
  if (tick.sim === 0) return 0;
  return tick.paused ? tick.sim : tick.sim + (performance.now() - tick.real) * tick.speed;
}

/** Seed the time from a REST answer until the first tick of the clock arrives. */
export function seedSimTime(simTime: string): void {
  if (tick.sim !== 0) return;
  tick.sim = Date.parse(simTime);
  tick.real = performance.now();
}

/** Keep the time in step with the clock channel (called once by the shadow page). */
export function useSimTimeFeed(): void {
  useChannel<SimClockInfo>("clock", (ev) => {
    tick.sim = Date.parse(ev.data.simTime);
    tick.real = performance.now();
    tick.speed = ev.data.speed;
    tick.paused = ev.data.paused;
  });
}
