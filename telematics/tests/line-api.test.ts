import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckpointForward } from "../src/app-client.js";
import { buildApp, registerSimulation } from "../src/app.js";
import { SimClock } from "../src/clock/clock.js";
import { MINUTE, operatingDayStart, zonedToUtc } from "../src/clock/time.js";
import { Engine } from "../src/simulator/engine.js";
import type { DepotLine, LinesData } from "../src/simulator/line.js";
import { loadRoutes } from "../src/simulator/routes.js";
import { Hub } from "../src/ws/hub.js";
import { TicketVerifier } from "../src/ws/ticket.js";
import { FakeApp, LOCAL, MemoryStore, SECRET, silentLog, ticket } from "./fixtures.js";

const SERVICE = "svc-token";
const DAY = "2026-10-23";
const LINES = JSON.parse(readFileSync(new URL("./data/lines.json", import.meta.url), "utf8")) as Record<string, DepotLine>;

/** The app with the sorting line of Budimír (layout graph exported from the seed). */
class LineApp extends FakeApp {
  readonly checkpoints: CheckpointForward[] = [];
  /** the app is not ready with its lines for this many calls */
  failLines = 0;
  /** with Žilina: the linehaul ZA ends there (phase 7c) */
  withZilina = false;
  override planFor(day: string): ReturnType<FakeApp["planFor"]> {
    const plan = super.planFor(day);
    return this.withZilina ? { ...plan, destinationDepots: { ZA: "ZIL" } } : plan;
  }
  getLines(): Promise<LinesData> {
    if (this.failLines > 0) {
      this.failLines--;
      return Promise.reject(new Error("app not ready"));
    }
    const doorDirections: Record<string, string> = { "LD-01": "BB", "LD-02": "BA", "LD-03": "ZA", "LD-04": "MI", "LD-05": "TV", "LD-06": "HE", "LD-07": "SL", "LD-08": "SE" };
    LOCAL.forEach((dir, i) => (doorDirections[`SB-0${String(i + 1)}`] = dir));
    const depots: Record<string, DepotLine> = { BUD: LINES.BUD as DepotLine };
    if (this.withZilina) depots.ZIL = LINES.ZIL as DepotLine;
    return Promise.resolve({ depots, doorDirections });
  }
  postCheckpoints(passages: CheckpointForward[]): Promise<void> {
    if (this.down) return Promise.reject(new Error("app down"));
    this.checkpoints.push(...passages);
    return Promise.resolve();
  }
}

async function makeEngine(
  setup: (app: LineApp) => void = () => undefined,
): Promise<{ engine: Engine; clock: SimClock; app: LineApp; runUntil: (t: number) => Promise<void>; advanceReal: (ms: number) => void }> {
  const clock = new SimClock({ simTime: operatingDayStart(DAY), speed: 30, paused: true });
  const app = new LineApp();
  setup(app);
  let real = Date.parse("2026-01-01T00:00:00Z");
  const engine = new Engine({
    clock,
    store: new MemoryStore(),
    app,
    hub: new Hub(),
    routes: loadRoutes(),
    log: silentLog,
    realNow: () => real,
    config: {
      seed: 42,
      envSeed: 42,
      forceCascade: false,
      degradedDevice: null,
      degradationStartedAt: null,
      degradationHours: 6,
      externalDevices: [],
      degradedThreshold: 0.92,
    },
  });
  await engine.init();
  const runUntil = async (until: number): Promise<void> => {
    for (let t = clock.now() + MINUTE; t <= until; t += MINUTE) {
      clock.set(t);
      await engine.step(t);
      await engine.flushTrips();
    }
  };
  return { engine, clock, app, runUntil, advanceReal: (ms: number) => (real += ms) };
}

describe("sorting line API and passages (ADR-071)", () => {
  let http: FastifyInstance;
  let env: Awaited<ReturnType<typeof makeEngine>>;
  const bearer = async (role = "dispatcher") => ({ authorization: `Bearer ${await ticket(role)}` });

  beforeAll(async () => {
    env = await makeEngine();
    await env.runUntil(zonedToUtc(DAY, "20:00"));
    http = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db: { ping: () => Promise.resolve(), close: () => Promise.resolve() } });
    await registerSimulation(http, { clock: env.clock, engine: env.engine, hub: new Hub(), verifier: new TicketVerifier(SECRET), serviceToken: SERVICE });
  });

  afterAll(async () => {
    await http.close();
  });

  it("only dispatchers, admins and the security of the depot see its line (ADR-068)", async () => {
    const as = async (role: string, depot?: string | null) => ({ authorization: `Bearer ${await ticket(role, { depot })}` });
    const get = async (headers: Record<string, string>, url = "/line/BUD") => (await http.inject({ method: "GET", url, headers })).statusCode;
    expect(await get(await as("security", "ZIL"))).toBe(403);
    expect(await get(await as("security", "ZIL"), "/line/BUD/parcels/DP1")).toBe(403);
    expect(await get(await as("security", "BUD"))).toBe(200);
    expect(await get(await as("courier", "BUD"))).toBe(403);
    expect(await get(await as("operator", "BUD"))).toBe(403);
    // a ticket of a depot-bound role without the claim sees no depot
    expect(await get(await as("security"))).toBe(403);
    expect(await get(await as("dispatcher", null))).toBe(200);
    expect(await get(await as("admin", null), "/line/BUD?variant=proposal")).toBe(200);
  });

  it("needs a ticket and knows only depots with a line", async () => {
    expect((await http.inject({ method: "GET", url: "/line/BUD" })).statusCode).toBe(401);
    expect((await http.inject({ method: "GET", url: "/line/ZIL", headers: await bearer() })).statusCode).toBe(404);
    expect((await http.inject({ method: "GET", url: "/line/BUD?variant=twin", headers: await bearer() })).statusCode).toBe(400);
  });

  it("current variant: checkpoints, parcels on the line, comparison of the whole day", async () => {
    const res = await http.inject({ method: "GET", url: "/line/BUD", headers: await bearer() });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      variant: string;
      variants: string[];
      checkpoints: { code: string; perHour: number; readRate: number | null }[];
      parcels: { barcode: string; hops: { node: string; at: string }[] }[];
      compare: Record<string, { parcels: number; manual: number }>;
    }>();
    expect(body.variant).toBe("current");
    expect(body.variants).toEqual(["current", "proposal"]);
    const scanner = body.checkpoints.find((c) => c.code === "LINE-SCN-01");
    expect(scanner?.perHour).toBeGreaterThan(0);
    expect(scanner?.readRate).toBeGreaterThan(0.9);
    expect(body.parcels.length).toBeGreaterThan(0);
    expect(body.parcels.length).toBeLessThanOrEqual(300);
    expect(body.compare.current?.parcels).toBe(body.compare.proposal?.parcels);
    expect(body.compare.proposal?.manual).toBeLessThan(body.compare.current?.manual ?? 0);
  });

  it("proposal variant has the tunnel and the counters", async () => {
    const res = await http.inject({ method: "GET", url: "/line/BUD?variant=proposal", headers: await bearer() });
    const codes = res.json<{ checkpoints: { code: string }[] }>().checkpoints.map((c) => c.code);
    expect(codes).toContain("CP-BUD-TUN");
    expect(codes).toContain("CP-BUD-DEK");
    expect(codes).not.toContain("LINE-SCN-01");
  });

  it("route of one parcel with its last checkpoint", async () => {
    const barcode = env.app.checkpoints[0]?.barcode as string;
    const res = await http.inject({ method: "GET", url: `/line/BUD/parcels/${barcode}`, headers: await bearer() });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ hops: unknown[]; current: { checkpoint: string } | null }>();
    expect(body.hops.length).toBeGreaterThan(3);
    expect(body.current).not.toBeNull();
    expect((await http.inject({ method: "GET", url: "/line/BUD/parcels/NOPE-1", headers: await bearer() })).statusCode).toBe(404);
  });

  it("sends the current passages to the app, never the proposal and never the dock scans again", () => {
    const codes = new Set(env.app.checkpoints.map((c) => c.checkpoint));
    expect(codes.has("LINE-SCN-01")).toBe(true);
    expect([...codes].some((c) => c.startsWith("DOCK-") || c === "CP-BUD-TUN")).toBe(false);
    const until = zonedToUtc(DAY, "20:00");
    expect(env.app.checkpoints.every((c) => Date.parse(c.at) <= until)).toBe(true);
  });

  it("a restart of the day replays the same passages", async () => {
    const fresh = await makeEngine();
    await fresh.runUntil(zonedToUtc(DAY, "20:00"));
    expect(fresh.app.checkpoints).toEqual(env.app.checkpoints);
  });

  it("lines that come after the day was loaded are picked up, the passages so far are sent", async () => {
    const late = await makeEngine((a) => (a.failLines = 1));
    await late.runUntil(zonedToUtc(DAY, "19:00"));
    expect(late.app.checkpoints).toEqual([]);
    late.advanceReal(6000);
    await late.runUntil(zonedToUtc(DAY, "20:00"));
    const fresh = env.app.checkpoints.map((c) => `${c.checkpoint}|${c.barcode}|${c.at}`).sort();
    expect(late.app.checkpoints.map((c) => `${c.checkpoint}|${c.barcode}|${c.at}`).sort()).toEqual(fresh);
  });

  it("the line of Žilina gets the parcels of the linehaul that ends there", async () => {
    const z = await makeEngine((a) => (a.withZilina = true));
    await z.runUntil(zonedToUtc(DAY, "16:00"));
    const view = z.engine.lineView("ZIL", "proposal") as { variant: string; variants: string[]; compare: Record<string, { parcels: number }> };
    // no proposal outside Budimír: the current variant answers
    expect(view.variant).toBe("current");
    expect(view.variants).toEqual(["current"]);
    expect(view.compare.current?.parcels).toBeGreaterThan(0);
  });
});
