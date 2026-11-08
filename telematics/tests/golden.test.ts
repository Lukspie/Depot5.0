/**
 * Golden output of Budimír (phase 7c): the situation evening-peak driven by the plan the app gave
 * at the tag `pre-depots` (app/tests/data/golden/bud_pre_depots_app.json). The summary was captured
 * by this test on the code of the tag (GOLDEN_WRITE=1 in a git worktree). More depots must not
 * change Budimír: a difference here means the simulator of Budimír changed - fix the code, do not
 * refresh the golden file.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AlertPayload, AppApi, CourierEventOut, GateForward, ManifestParcel, PlanWithLocal, ScanForward } from "../src/app-client.js";
import { SimClock } from "../src/clock/clock.js";
import { operatingDayStart } from "../src/clock/time.js";
import type { CourierPlan } from "../src/simulator/couriers.js";
import { Engine } from "../src/simulator/engine.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { loadSituations } from "../src/simulator/situations.js";
import type { TripExecution } from "../src/simulator/types.js";
import { Hub } from "../src/ws/hub.js";
import { MemoryStore, silentLog } from "./fixtures.js";

const APP_GOLDEN = new URL("../../app/tests/data/golden/bud_pre_depots_app.json", import.meta.url);
const SIM_GOLDEN = new URL("./data/golden_bud_sim.json", import.meta.url);

interface AppGolden {
  day: string;
  plan: PlanWithLocal;
  manifests: Record<string, ManifestParcel[]>;
  courierRoutes: CourierPlan;
}

/** The app of the tag: serves the captured plan, records what the simulator reports. */
class GoldenApp implements AppApi {
  readonly trips = new Map<number, TripExecution>();
  readonly scans: ScanForward[] = [];
  readonly alerts: AlertPayload[] = [];
  readonly couriers: CourierEventOut[] = [];
  readonly gate: GateForward[] = [];
  constructor(private readonly g: AppGolden) {}

  getPlan(day: string): Promise<PlanWithLocal> {
    return Promise.resolve(day === this.g.day ? this.g.plan : { ...this.g.plan, day, trips: [] });
  }
  getManifest(direction: string, day: string): Promise<ManifestParcel[]> {
    return Promise.resolve(day === this.g.day ? (this.g.manifests[direction] ?? []) : []);
  }
  getCourierRoutes(day: string): Promise<CourierPlan> {
    return Promise.resolve(day === this.g.day ? this.g.courierRoutes : { ...this.g.courierRoutes, day, routes: [] });
  }
  postTripEvents(_simTime: string, trips: TripExecution[]): Promise<void> {
    for (const t of trips) this.trips.set(t.tripId, t);
    return Promise.resolve();
  }
  postScans(scans: ScanForward[]): Promise<void> {
    this.scans.push(...scans);
    return Promise.resolve();
  }
  resetDay(): Promise<void> {
    this.trips.clear();
    this.scans.length = 0;
    this.alerts.length = 0;
    this.couriers.length = 0;
    this.gate.length = 0;
    return Promise.resolve();
  }
  postAlert(alert: AlertPayload): Promise<void> {
    this.alerts.push(alert);
    return Promise.resolve();
  }
  postCourierEvents(_simTime: string, events: CourierEventOut[]): Promise<void> {
    this.couriers.push(...events);
    return Promise.resolve();
  }
  postGatePassages(passages: GateForward[]): Promise<void> {
    this.gate.push(...passages);
    return Promise.resolve();
  }
}

const sha = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

describe("golden: Budimír as at the tag pre-depots", () => {
  it("evening-peak gives the same scans, trips, gate passages and alarms", async () => {
    const golden = JSON.parse(readFileSync(APP_GOLDEN, "utf8")) as AppGolden;
    const app = new GoldenApp(golden);
    const clock = new SimClock({ simTime: operatingDayStart(golden.day) + 60_000, speed: 1, paused: true }, () => 0);
    const engine = new Engine({
      clock,
      store: new MemoryStore(),
      app,
      hub: new Hub(),
      routes: loadRoutes(),
      log: silentLog,
      realNow: () => 0,
      config: { seed: 42, envSeed: 42, forceCascade: true, degradedDevice: "DOCK-SCN-02", degradationStartedAt: null, degradationHours: 6, externalDevices: [], degradedThreshold: 0.92 },
    });
    await engine.init();
    const situation = loadSituations().find((s) => s.id === "evening-peak");
    if (!situation) throw new Error("no evening-peak");
    await engine.loadSituation(situation);
    await engine.flushTrips();

    const trips = [...app.trips.values()].sort((a, b) => a.tripId - b.tripId);
    const summary = {
      simTime: new Date(clock.now()).toISOString(),
      scans: app.scans.length,
      scansHash: sha(app.scans),
      trips: trips.length,
      tripStates: Object.fromEntries(trips.map((t) => [String(t.tripId), t.status])),
      tripsHash: sha(trips),
      gate: app.gate.length,
      gateHash: sha(app.gate),
      alerts: app.alerts.map((a) => `${a.kind}:${a.refId}`).sort(),
      couriers: app.couriers.length,
    };
    if (process.env.GOLDEN_WRITE) writeFileSync(SIM_GOLDEN, JSON.stringify(summary, null, 1) + "\n");
    const expected = JSON.parse(readFileSync(SIM_GOLDEN, "utf8")) as typeof summary;
    expect(summary).toEqual(expected);
    // the test seed has 200 parcels a day: a few dozen scans by 18:30, the trips at the doors
    expect(summary.scans).toBeGreaterThan(10);
  }, 60_000);
});
