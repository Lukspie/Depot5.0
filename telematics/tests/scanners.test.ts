import { describe, expect, it } from "vitest";
import { HOUR, zonedToUtc } from "../src/clock/time.js";
import { DEFAULT_READ_RATE, loadingScans, readRate, type ReadRateModel } from "../src/simulator/scanners.js";

const DAY = "2026-10-23";
const start = zonedToUtc(DAY, "15:30");
const model: ReadRateModel = {
  ...DEFAULT_READ_RATE,
  degradation: { device: "DOCK-SCN-02", startedAt: start, hours: 6, from: 0.97, to: 0.85 },
};

describe("read rate model", () => {
  it("the degraded scanner loses read rate from 0.97 to 0.85 over 6 hours, then stays low", () => {
    expect(readRate(model, "DOCK-SCN-02", start)).toBeCloseTo(0.97);
    expect(readRate(model, "DOCK-SCN-02", start + 3 * HOUR)).toBeCloseTo(0.91);
    expect(readRate(model, "DOCK-SCN-02", start + 6 * HOUR)).toBeCloseTo(0.85);
    expect(readRate(model, "DOCK-SCN-02", start + 20 * HOUR)).toBeCloseTo(0.85);
  });

  it("other scanners read slightly worse in the evening (random orientation)", () => {
    expect(readRate(model, "DOCK-SCN-01", zonedToUtc(DAY, "18:00"))).toBeCloseTo(0.94);
    expect(readRate(model, "DOCK-SCN-01", zonedToUtc("2026-10-24", "04:00"))).toBeCloseTo(0.96);
    expect(readRate(model, "LINE-SCN-01", zonedToUtc("2026-10-24", "04:00"))).toBeCloseTo(0.985);
  });
});

describe("loading scans", () => {
  const manifest = Array.from({ length: 4000 }, (_, i) => `BA${String(i)}`);
  const foreign = Array.from({ length: 500 }, (_, i) => `MI${String(i)}`);
  const args = {
    seed: 42,
    day: DAY,
    key: "BA-1",
    device: "DOCK-SCN-01",
    start: zonedToUtc("2026-10-24", "03:00"),
    end: zonedToUtc("2026-10-24", "05:30"),
    manifest,
    foreign,
    model,
  };
  const scans = loadingScans(args);

  it("counts every parcel even when the label is unreadable", () => {
    const real = scans.filter((s) => s.truth === "ok");
    expect(real).toHaveLength(manifest.length);
    expect(scans.every((s) => s.itemCounted)).toBe(true);
    const unreadable = scans.filter((s) => !s.readOk);
    expect(unreadable.every((s) => s.barcode === null && s.facesRead === 0)).toBe(true);
    const rate = real.filter((s) => s.readOk).length / real.length;
    expect(rate).toBeGreaterThan(0.94);
    expect(rate).toBeLessThan(0.98);
  });

  it("about 0.5 % of parcels arrive at the wrong door", () => {
    const wrong = scans.filter((s) => s.truth === "wrong_direction");
    expect(wrong.length / manifest.length).toBeGreaterThan(0.002);
    expect(wrong.length / manifest.length).toBeLessThan(0.01);
    expect(wrong.every((s) => s.parcel.startsWith("MI"))).toBe(true);
  });

  it("scans are inside the loading window, sorted and deterministic", () => {
    expect(scans.every((s) => s.at >= args.start && s.at <= args.end + 120_000)).toBe(true);
    expect(scans.map((s) => s.at)).toEqual([...scans.map((s) => s.at)].sort((a, b) => a - b));
    expect(loadingScans(args)).toEqual(scans);
    expect(loadingScans({ ...args, seed: 7 })).not.toEqual(scans);
  });
});
