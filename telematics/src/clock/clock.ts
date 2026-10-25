/**
 * Simulated clock owned by telematics. Simulated time advances `speed` times faster than real
 * time, can be paused and can jump forward. The app reads it via GET /sim/clock.
 */

import { nextOccurrence } from "./time.js";

export interface ClockState {
  /** simulated time, epoch ms */
  simTime: number;
  /** simulated seconds per real second */
  speed: number;
  paused: boolean;
}

export const MIN_SPEED = 1;
export const MAX_SPEED = 1000;

type Listener = (state: ClockState, reason: "pause" | "resume" | "speed" | "jump") => void;

export class SimClock {
  private anchorSim: number;
  private anchorReal: number;
  private speedValue: number;
  private pausedValue: boolean;
  private readonly listeners: Listener[] = [];

  constructor(
    initial: ClockState,
    private readonly realNow: () => number = Date.now,
  ) {
    this.anchorSim = initial.simTime;
    this.anchorReal = realNow();
    this.speedValue = initial.speed;
    this.pausedValue = initial.paused;
  }

  now(): number {
    if (this.pausedValue) return this.anchorSim;
    return this.anchorSim + (this.realNow() - this.anchorReal) * this.speedValue;
  }

  get speed(): number {
    return this.speedValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  state(): ClockState {
    return { simTime: this.now(), speed: this.speedValue, paused: this.pausedValue };
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  pause(): void {
    if (this.pausedValue) return;
    this.rebase();
    this.pausedValue = true;
    this.emit("pause");
  }

  resume(): void {
    if (!this.pausedValue) return;
    this.anchorReal = this.realNow();
    this.pausedValue = false;
    this.emit("resume");
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new RangeError(`speed must be between ${String(MIN_SPEED)} and ${String(MAX_SPEED)}`);
    }
    this.rebase();
    this.speedValue = speed;
    this.emit("speed");
  }

  /** Set the simulated time (used by jumps and day restarts). */
  set(simTime: number): void {
    this.anchorSim = simTime;
    this.anchorReal = this.realNow();
    this.emit("jump");
  }

  /** Jump forward to the next local `HH:MM` (e.g. "01:00" during the evening = tonight). */
  jumpTo(hhmm: string): number {
    const target = nextOccurrence(this.now(), hhmm);
    this.set(target);
    return target;
  }

  private rebase(): void {
    this.anchorSim = this.now();
    this.anchorReal = this.realNow();
  }

  private emit(reason: Parameters<Listener>[1]): void {
    const state = this.state();
    for (const l of this.listeners) l(state, reason);
  }
}
