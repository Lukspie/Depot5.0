import { describe, expect, it } from "vitest";
import { SimClock } from "../src/clock/clock.js";
import {
  localHhmm,
  nextOccurrence,
  operatingDay,
  operatingDayStart,
  zonedToUtc,
} from "../src/clock/time.js";

describe("time zone helpers (Europe/Bratislava)", () => {
  it("converts local time in summer (CEST, UTC+2) and winter (CET, UTC+1)", () => {
    expect(new Date(zonedToUtc("2026-07-01", "15:00")).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(new Date(zonedToUtc("2026-12-01", "15:00")).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("handles the DST change on 25 Oct 2026 (03:00 CEST -> 02:00 CET)", () => {
    expect(new Date(zonedToUtc("2026-10-25", "01:00")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(new Date(zonedToUtc("2026-10-25", "06:00")).toISOString()).toBe("2026-10-25T05:00:00.000Z");
    expect(localHhmm(zonedToUtc("2026-10-25", "15:30"))).toBe("15:30");
  });

  it("operating day runs from 15:00 to 15:00", () => {
    expect(operatingDay(zonedToUtc("2026-10-23", "15:00"))).toBe("2026-10-23");
    expect(operatingDay(zonedToUtc("2026-10-24", "05:59"))).toBe("2026-10-23");
    expect(operatingDay(zonedToUtc("2026-10-24", "14:59"))).toBe("2026-10-23");
    expect(operatingDay(zonedToUtc("2026-10-24", "15:00"))).toBe("2026-10-24");
    expect(operatingDayStart("2026-10-23")).toBe(zonedToUtc("2026-10-23", "15:00"));
  });

  it("next occurrence of a wall-clock time is always in the future", () => {
    const evening = zonedToUtc("2026-10-23", "16:10");
    expect(nextOccurrence(evening, "01:00")).toBe(zonedToUtc("2026-10-24", "01:00"));
    expect(nextOccurrence(evening, "15:30")).toBe(zonedToUtc("2026-10-24", "15:30"));
    expect(nextOccurrence(evening, "18:00")).toBe(zonedToUtc("2026-10-23", "18:00"));
  });
});

describe("SimClock", () => {
  function make(speed = 60) {
    let real = 1_000_000;
    const clock = new SimClock({ simTime: zonedToUtc("2026-10-23", "15:00"), speed, paused: false }, () => real);
    return { clock, advance: (ms: number) => (real += ms) };
  }

  it("runs `speed` times faster than real time", () => {
    const { clock, advance } = make(60);
    const t0 = clock.now();
    advance(1000);
    expect(clock.now() - t0).toBe(60_000);
  });

  it("pauses and resumes without jumping", () => {
    const { clock, advance } = make(60);
    advance(1000);
    clock.pause();
    const frozen = clock.now();
    advance(10_000);
    expect(clock.now()).toBe(frozen);
    clock.resume();
    advance(1000);
    expect(clock.now()).toBe(frozen + 60_000);
  });

  it("changing speed keeps the current time", () => {
    const { clock, advance } = make(60);
    advance(1000);
    const t = clock.now();
    clock.setSpeed(600);
    expect(clock.now()).toBe(t);
    advance(1000);
    expect(clock.now()).toBe(t + 600_000);
    expect(() => {
      clock.setSpeed(0);
    }).toThrow(RangeError);
    expect(() => {
      clock.setSpeed(5000);
    }).toThrow(RangeError);
  });

  it("jumps to the evening wave, the night trucks and the morning departures", () => {
    const { clock } = make();
    const reasons: string[] = [];
    clock.onChange((_, reason) => reasons.push(reason));
    expect(localHhmm(clock.jumpTo("15:30"))).toBe("15:30");
    expect(clock.jumpTo("01:00")).toBe(zonedToUtc("2026-10-24", "01:00"));
    expect(clock.jumpTo("06:00")).toBe(zonedToUtc("2026-10-24", "06:00"));
    expect(reasons).toEqual(["jump", "jump", "jump"]);
  });
});
