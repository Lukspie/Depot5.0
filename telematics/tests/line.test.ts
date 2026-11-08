import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MINUTE } from "../src/clock/time.js";
import { checkpointViews, inFlight, lineRuns, LineRouter, variantKpis, type DepotLine, type LineParcel } from "../src/simulator/line.js";

const LINES = JSON.parse(readFileSync(new URL("./data/lines.json", import.meta.url), "utf8")) as Record<string, DepotLine>;
const BUD = LINES.BUD as DepotLine;
const ZIL = LINES.ZIL as DepotLine;
const T0 = Date.parse("2026-10-25T16:00:00Z");
const ctx = { seed: 42, day: "2026-10-25", depot: "BUD", lineRate: 0.985 };

function evening(n: number, door = "LD-02"): LineParcel[] {
  return Array.from({ length: n }, (_, i) => ({ barcode: `E-${String(i)}`, door, source: "evening" as const, anchor: { node: "staging" as const, at: T0 + i * 20_000 } }));
}

function morning(n: number, door = "LD-05"): LineParcel[] {
  return Array.from({ length: n }, (_, i) => ({
    barcode: `M-${String(i)}`,
    door,
    source: "night" as const,
    truckDoor: "LD-02",
    anchor: { node: "scanner" as const, at: T0 + i * 15_000, readOk: i % 10 !== 0 },
  }));
}

describe("line graph of Budimír", () => {
  it("routes every input through the scanner to every staging place in both variants", () => {
    for (const variant of ["current", "proposal"] as const) {
      const g = BUD.variants[variant];
      if (!g) throw new Error(variant);
      const r = new LineRouter(g);
      expect(r.scanner).toBeDefined();
      const sc = r.scanner?.id as string;
      for (const input of g.nodes.filter((n) => n.kind === "input")) expect(r.path(input.id, sc), `${variant} ${input.id}`).not.toBeNull();
      for (const s of g.nodes.filter((n) => n.kind === "staging")) expect(r.path(sc, s.id), `${variant} ${s.id}`).not.toBeNull();
      // a round of the loop comes back to the scanner
      expect(r.path(sc, sc, true)?.length).toBeGreaterThan(5);
    }
  });

  it("current: linehaul by belt, transits and Košice by hand; proposal: chutes, no manual area", () => {
    const cur = new LineRouter(BUD.variants.current);
    expect(cur.path("SC", "D2")?.some((n) => n === "MAN")).toBe(false);
    expect(cur.path("SC", "S-LD-05")).toContain("MAN");
    expect(cur.path("SC", "S-SB-03")).toContain("MAN");
    const pro = new LineRouter(BUD.variants.proposal as NonNullable<DepotLine["variants"]["proposal"]>);
    expect(pro.graph.nodes.some((n) => n.kind === "manual")).toBe(false);
    expect(pro.path("SC", "S-LD-05")).toContain("E-LD-05");
    expect(pro.path("SC", "S-SB-03")).toContain("E-SB-03");
  });
});

describe("lineRuns", () => {
  it("anchors the current variant in the dock scan and the line scan", () => {
    const runs = lineRuns(BUD, [...evening(30), ...morning(30)], ctx);
    for (const [i, r] of runs.current.filter((x) => x.barcode.startsWith("E-")).entries()) {
      expect(r.stagedAt).toBe(T0 + i * 20_000);
      expect(r.hops.at(-1)?.node).toBe("D2");
      expect(r.enterAt).toBeLessThan(r.stagedAt);
    }
    for (const [i, r] of runs.current.filter((x) => x.barcode.startsWith("M-")).entries()) {
      const sc = r.passages.find((x) => x.checkpoint === "LINE-SCN-01");
      expect(sc?.at).toBe(T0 + i * 15_000);
      expect(sc?.read).toBe(i % 10 !== 0);
      // the scan already made the event in the app: not sent twice
      expect(sc?.forward).toBe(false);
      expect(r.manual).toBe(true);
    }
    // dock scanner passages are the loading scans themselves
    expect(runs.current.flatMap((r) => r.passages).filter((x) => x.checkpoint.startsWith("DOCK-") && x.forward)).toEqual([]);
  });

  it("proposal starts at the same input and time and sorts transits without hands", () => {
    const parcels = morning(60);
    const runs = lineRuns(BUD, parcels, ctx);
    expect(runs.proposal).toHaveLength(runs.current.length);
    for (const [i, p] of runs.proposal.entries()) {
      const c = runs.current[i];
      expect(p.input).toBe(c?.input);
      expect(p.enterAt).toBe(c?.enterAt);
    }
    const cur = variantKpis(runs.current);
    const pro = variantKpis(runs.proposal);
    expect(cur.manual).toBe(60);
    expect(pro.manual).toBeLessThan(5);
    expect(pro.avgMinutes ?? 0).toBeLessThan(cur.avgMinutes ?? 0);
  });

  it("is deterministic and a parcel does not depend on the others", () => {
    const a = lineRuns(BUD, evening(40), ctx);
    const b = lineRuns(BUD, evening(40), ctx);
    expect(b).toEqual(a);
    const alone = lineRuns(BUD, evening(40).slice(7, 8), ctx);
    expect(alone.current[0]).toEqual(a.current[7]);
    expect(alone.proposal[0]).toEqual(a.proposal[7]);
    expect(lineRuns(BUD, evening(40), { ...ctx, seed: 7 })).not.toEqual(a);
  });

  it("proposal: unread parcels go round again, then to the decoding station with a queue", () => {
    // a dirty tunnel: it reads only 30 %
    const dirty = structuredClone(BUD);
    for (const n of dirty.variants.proposal?.nodes ?? []) if (n.kind === "tunnel") n.read = 0.3;
    const runs = lineRuns(dirty, morning(200), ctx);
    const p = runs.proposal;
    const decoded = p.filter((r) => r.hops.some((h) => h.node === "DK"));
    expect(p.some((r) => r.rounds > 0)).toBe(true);
    expect(decoded.length).toBeGreaterThan(0);
    // up to two extra rounds: three readings at most at the tunnel
    for (const r of p) expect(r.passages.filter((x) => x.checkpoint === "CP-BUD-TUN").length).toBeLessThanOrEqual(3);
    // one worker: decoding never overlaps
    const spans = decoded
      .map((r) => {
        const i = r.hops.findIndex((h) => h.node === "DK");
        return [r.hops[i]?.at ?? 0, r.hops[i + 1]?.at ?? 0] as const;
      })
      .sort((x, y) => x[0] - y[0]);
    const views = checkpointViews(BUD.variants.proposal as NonNullable<DepotLine["variants"]["proposal"]>, p, T0 + 60 * MINUTE);
    expect(views.find((v) => v.code === "CP-BUD-DEK")?.queue).toBeGreaterThanOrEqual(0);
    expect(spans.length).toBe(decoded.length);
  });

  it("checkpoint views count passages and read rates up to now", () => {
    const runs = lineRuns(BUD, evening(120), ctx);
    const now = T0 + 30 * MINUTE;
    const views = checkpointViews(BUD.variants.current, runs.current, now);
    const sc = views.find((v) => v.code === "LINE-SCN-01");
    expect(sc?.perHour).toBeGreaterThan(50);
    expect(sc?.readRate).toBeGreaterThan(0.9);
    expect(views.find((v) => v.code === "CP-BUD-ZB")?.readRate).toBeNull();
    const live = inFlight(runs.current, now, 60_000, 300);
    expect(live.length).toBeGreaterThan(0);
    for (const l of live) expect(l.hops.length).toBeGreaterThan(0);
  });

  it("other depots have one variant and a straight belt", () => {
    expect(ZIL.variants.proposal).toBeUndefined();
    const parcels: LineParcel[] = ["ZI-SB01", "ZI-SB02", "ZI-SB03", "ZI-SB04"].map((door, i) => ({ barcode: `Z-${String(i)}`, door, source: "feeder", enterAt: T0 }));
    const runs = lineRuns(ZIL, parcels, { ...ctx, depot: "ZIL" });
    expect(runs.current).toHaveLength(4);
    expect(runs.proposal).toEqual([]);
    for (const r of runs.current) expect(r.hops.at(-1)?.node).toBe(`S-${r.door}`);
  });
});
