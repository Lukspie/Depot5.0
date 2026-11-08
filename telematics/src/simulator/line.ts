/**
 * Sorting line of a depot (phase 7d step 5d, ADR-071): parcels walk through the graph from the
 * layout (`depots.layout.line`, owned by the app) and pass its checkpoints.
 *
 * A pure function of (graph, parcels, seed, day), like the scans (ADR-047): the live engine sends
 * the passages of the current variant to the app, the proposal (Depot 5.0) is computed on demand
 * from the same parcels and never stored. Every parcel has its own random stream per variant and
 * always draws the same number of numbers, so one parcel never shifts another.
 *
 * The current variant is anchored in what the simulator already produces: a linehaul parcel
 * reaches the end of its exit belt when the dock scanner reads it, a morning parcel passes the
 * overhead scanner at its line scan (with the same read result). The time it entered the line
 * follows from the path; the proposal starts the parcel at the same input at the same time.
 */

import { HOUR, MINUTE } from "../clock/time.js";
import { rngFor } from "./rng.js";

export type NodeKind = "input" | "merge" | "loop" | "scanner" | "tunnel" | "counter" | "exit" | "staging" | "manual" | "decode";
export type EdgeKind = "belt" | "loop" | "feed" | "telescopic" | "chute" | "manual";
export type Variant = "current" | "proposal";
export const VARIANTS: readonly Variant[] = ["current", "proposal"];

export interface LineNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  label?: string;
  /** device code in db-telemetry */
  checkpoint?: string;
  /** staging place or input at this door */
  door?: string;
  /** scanner read rate; "line" = the line rate of the read-rate model */
  read?: number | "line";
  /** doors an exit diverts to */
  serves?: string[];
  /** exit for parcels without a decision (current: "Prechody + KE") */
  default?: boolean;
  /** exit to the decoding station after unread rounds (proposal) */
  reject?: boolean;
  /** seconds of work by hand at the node [min, max] */
  handling?: [number, number];
}

export interface LineEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** m/s */
  speed: number;
  /** metres */
  length: number;
  points: [number, number][];
  raised?: boolean;
}

export interface LineGraph {
  label: string;
  nodes: LineNode[];
  edges: LineEdge[];
  zones: { kind: string; label: string; rect: [number, number, number, number] }[];
}

export interface DepotLine {
  variants: Partial<Record<Variant, LineGraph>> & { current: LineGraph };
}

/** GET /internal/lines of the app */
export interface LinesData {
  depots: Record<string, DepotLine>;
  doorDirections: Record<string, string>;
}

/** unread parcels go round the loop again this many times before the decoding station */
export const RECIRCULATIONS = 2;
/** a manual carry is chosen only when no belt leads there */
const MANUAL_PENALTY_S = 600;

export interface Hop {
  node: string;
  /** epoch ms of the arrival at the node */
  at: number;
}

export interface Passage {
  checkpoint: string;
  at: number;
  /** scanner and tunnel: was the label read; counters: null */
  read: boolean | null;
  barcode: string;
  /** sent to the app as a parcel event (false: the scan itself already made the event) */
  forward: boolean;
}

export interface ParcelRun {
  barcode: string;
  door: string;
  input: string;
  hops: Hop[];
  passages: Passage[];
  enterAt: number;
  stagedAt: number;
  /** the first read failed */
  unread: boolean;
  /** extra loop rounds (proposal) */
  rounds: number;
  /** sorted or decoded by hand */
  manual: boolean;
}

/** A parcel the line has to move: where it goes and what anchors it in time. */
export interface LineParcel {
  barcode: string;
  /** staging door (LD-02, SB-05, ZI-SB01) */
  door: string;
  /** what feeds the line: night linehaul trucks, couriers in the evening, a feeder truck */
  source: "night" | "evening" | "feeder";
  /** door of the truck that brought it (night inputs at that door are preferred) */
  truckDoor?: string | null;
  /** current variant: the time the parcel is at this node (dock scan / line scan) */
  anchor?: { node: "staging" | "scanner"; at: number; readOk?: boolean };
  /** feeder parcels: the line starts at this time */
  enterAt?: number;
}

/** Shortest paths by travel time; manual carries only where no belt leads. */
export class LineRouter {
  readonly byId: Map<string, LineNode>;
  private readonly out = new Map<string, LineEdge[]>();
  private readonly cache = new Map<string, string[] | null>();
  readonly scanner: LineNode | undefined;
  readonly reject: LineNode | undefined;
  readonly fallback: LineNode | undefined;

  constructor(readonly graph: LineGraph) {
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
      const list = this.out.get(e.from) ?? [];
      list.push(e);
      this.out.set(e.from, list);
    }
    this.scanner = graph.nodes.find((n) => n.kind === "scanner" || n.kind === "tunnel");
    this.reject = graph.nodes.find((n) => n.reject);
    this.fallback = graph.nodes.find((n) => n.default);
  }

  edge(from: string, to: string): LineEdge | undefined {
    return this.out.get(from)?.find((e) => e.to === to);
  }

  staging(door: string): LineNode | undefined {
    return this.graph.nodes.find((n) => n.kind === "staging" && n.door === door);
  }

  /** node ids from `a` to `b` (both included); `viaLoop`: leave `a` along the loop first (a round). */
  path(a: string, b: string, viaLoop = false): string[] | null {
    const key = `${a}>${b}>${String(viaLoop)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    // a round: leave `a` along its loop edge, then search from the next node back to `b`
    const first = viaLoop ? (this.out.get(a) ?? []).find((e) => e.kind === "loop") : undefined;
    if (viaLoop && !first) return null;
    const src = first ? first.to : a;
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    let found: string[] | null = null;
    for (;;) {
      let u: string | null = null;
      let best = Infinity;
      for (const [n, d] of dist) if (!done.has(n) && d < best) [u, best] = [n, d];
      if (u === null) break;
      if (u === b) {
        const ids = [u];
        for (let c = u; c !== src; ) {
          c = prev.get(c) as string;
          ids.unshift(c);
        }
        found = first ? [a, ...ids] : ids;
        break;
      }
      done.add(u);
      for (const e of this.out.get(u) ?? []) {
        const cost = best + e.length / e.speed + (e.kind === "manual" ? MANUAL_PENALTY_S : 0);
        if (!done.has(e.to) && cost < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, cost);
          prev.set(e.to, u);
        }
      }
    }
    this.cache.set(key, found);
    return found;
  }
}

function join(...parts: (string[] | null)[]): string[] | null {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) return null;
    out.push(...(out.length && out[out.length - 1] === p[0] ? p.slice(1) : p));
  }
  return out;
}

export interface LineContext {
  seed: number;
  day: string;
  depot: string;
  /** read rate of the line scanners now (the simulator's read-rate model) */
  lineRate: number;
}

/**
 * One parcel through one variant, entering at time 0 (the caller shifts it). The draws per parcel
 * are fixed: input, 3 reads, handling.
 */
function walk(r: LineRouter, p: LineParcel, input: string, ctx: LineContext, variant: Variant, forcedRead?: boolean): Omit<ParcelRun, "enterAt"> | null {
  const rng = rngFor(ctx.seed, ctx.day, "line", ctx.depot, variant, p.barcode);
  const reads = [rng.next(), rng.next(), rng.next()];
  const handle = rng.next();
  const target = r.staging(p.door);
  if (!target) return null;
  const sc = r.scanner;
  const rate = sc ? (sc.read === "line" || sc.read === undefined ? ctx.lineRate : sc.read) : 1;
  const attempts: boolean[] = [];
  let ids: string[] | null;
  if (!sc) {
    ids = r.path(input, target.id);
  } else {
    const toScanner = r.path(input, sc.id);
    attempts.push(forcedRead ?? (reads[0] as number) < rate);
    if (attempts[0]) {
      ids = join(toScanner, r.path(sc.id, target.id));
    } else if (r.reject) {
      // proposal: another round, read again; still unread after the rounds -> decoding station
      const rounds: (string[] | null)[] = [toScanner];
      let ok = false;
      for (let k = 1; k <= RECIRCULATIONS && !ok; k++) {
        rounds.push(r.path(sc.id, sc.id, true));
        ok = (reads[k] as number) < rate;
        attempts.push(ok);
      }
      const decode = r.graph.nodes.find((n) => n.kind === "decode");
      ids = ok
        ? join(...rounds, r.path(sc.id, target.id))
        : join(...rounds, r.path(sc.id, r.reject.id), decode ? r.path(r.reject.id, decode.id) : null, decode ? r.path(decode.id, target.id) : null);
    } else {
      // current: no decision, the default exit (manual area) sorts it by hand
      const fb = r.fallback;
      const man = r.graph.nodes.find((n) => n.kind === "manual");
      ids =
        fb && man
          ? join(toScanner, r.path(sc.id, fb.id), r.path(fb.id, man.id), r.path(man.id, target.id))
          : join(toScanner, r.path(sc.id, target.id));
    }
  }
  if (!ids) return null;
  const hops: Hop[] = [];
  const passages: Passage[] = [];
  let t = 0;
  let manual = false;
  let scanIdx = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as string;
    if (i > 0) {
      const e = r.edge(ids[i - 1] as string, id);
      if (!e) return null;
      t += (e.length / e.speed) * 1000;
    }
    const n = r.byId.get(id) as LineNode;
    hops.push({ node: id, at: Math.round(t) });
    if (n.checkpoint) {
      const isScanner = n.kind === "scanner" || n.kind === "tunnel";
      const read = isScanner ? (attempts[scanIdx++] ?? true) : null;
      passages.push({ checkpoint: n.checkpoint, at: Math.round(t), read, barcode: p.barcode, forward: true });
    }
    if (n.handling) {
      manual = true;
      const [lo, hi] = n.handling;
      t += (lo + (hi - lo) * handle) * 1000;
    }
  }
  return {
    barcode: p.barcode,
    door: p.door,
    input,
    hops,
    passages,
    stagedAt: Math.round(t),
    unread: attempts[0] === false,
    rounds: Math.max(0, attempts.length - 1),
    manual,
  };
}

function shift(run: Omit<ParcelRun, "enterAt">, by: number): ParcelRun {
  return {
    ...run,
    enterAt: by,
    stagedAt: run.stagedAt + by,
    hops: run.hops.map((h) => ({ node: h.node, at: h.at + by })),
    passages: run.passages.map((x) => ({ ...x, at: x.at + by })),
  };
}

/** The input a parcel enters at: same in both variants (drawn from its own stream). */
function inputOf(r: LineRouter, p: LineParcel, ctx: LineContext): string | null {
  const inputs = r.graph.nodes.filter((n) => n.kind === "input");
  if (inputs.length === 0) return null;
  const rng = rngFor(ctx.seed, ctx.day, "line-input", ctx.depot, p.barcode);
  const u = rng.next();
  const pick = rng.next();
  const of = (prefix: string): LineNode[] => inputs.filter((n) => n.id.startsWith(prefix));
  let pool: LineNode[];
  if (p.source === "evening") {
    // couriers 70 %, transit pickups 20 %, carts from the back 10 % (ADR-071)
    pool = u < 0.7 ? of("K") : u < 0.9 ? of("G") : of("M");
  } else {
    const night = [...of("T"), ...of("I")];
    const atDoor = night.filter((n) => n.door === p.truckDoor);
    pool = atDoor.length ? atDoor : night;
  }
  if (pool.length === 0) pool = inputs;
  return (pool[Math.floor(pick * pool.length)] as LineNode).id;
}

/** Decoding station: one worker, first in first out; later hops wait for him. */
function queueDecode(r: LineRouter, runs: ParcelRun[]): ParcelRun[] {
  const decode = r.graph.nodes.find((n) => n.kind === "decode");
  if (!decode) return runs;
  const at = (run: ParcelRun): number => run.hops.find((h) => h.node === decode.id)?.at ?? Infinity;
  const waiting = runs.filter((run) => at(run) < Infinity).sort((a, b) => at(a) - at(b) || a.barcode.localeCompare(b.barcode));
  let free = -Infinity;
  const [lo, hi] = decode.handling ?? [60, 60];
  const out = new Map<string, ParcelRun>();
  for (const run of waiting) {
    const arrive = at(run);
    const idx = run.hops.findIndex((h) => h.node === decode.id);
    const next = run.hops[idx + 1];
    // the handling already in the run: time to the next hop minus the walk to it
    const own = next ? Math.min(next.at - arrive, hi * 1000) : lo * 1000;
    const wait = Math.max(0, free - arrive);
    free = arrive + wait + own;
    if (wait === 0) continue;
    out.set(run.barcode, {
      ...run,
      stagedAt: run.stagedAt + wait,
      hops: run.hops.map((h, i) => (i > idx ? { node: h.node, at: h.at + wait } : h)),
      passages: run.passages.map((x) => (x.at > arrive ? { ...x, at: x.at + wait } : x)),
    });
  }
  return out.size ? runs.map((run) => out.get(run.barcode) ?? run) : runs;
}

/**
 * Runs of all parcels through both variants of a depot line. The proposal (when the graph has
 * one) uses the input and the entry time of the current run.
 */
export function lineRuns(line: DepotLine, parcels: readonly LineParcel[], ctx: LineContext): Record<Variant, ParcelRun[]> {
  const current = new LineRouter(line.variants.current);
  const proposalGraph = line.variants.proposal;
  const proposal = proposalGraph ? new LineRouter(proposalGraph) : null;
  const runs: Record<Variant, ParcelRun[]> = { current: [], proposal: [] };
  for (const p of parcels) {
    const input = inputOf(current, p, ctx);
    if (!input) continue;
    const base = walk(current, p, input, ctx, "current", p.anchor?.readOk);
    if (!base) continue;
    let enterAt: number;
    if (p.anchor) {
      const anchorHop = p.anchor.node === "staging" ? base.hops[base.hops.length - 1] : base.hops.find((h) => h.node === current.scanner?.id);
      if (!anchorHop) continue;
      enterAt = p.anchor.at - anchorHop.at;
    } else {
      enterAt = p.enterAt ?? 0;
    }
    const run = shift(base, enterAt);
    // the anchor scan is already an event in the app (dock scan, morning line scan)
    for (const x of run.passages) {
      if (x.checkpoint.startsWith("DOCK-")) x.forward = false;
      if (p.anchor?.node === "scanner" && x.at === p.anchor.at) x.forward = false;
    }
    runs.current.push(run);
    if (proposal) {
      const alt = walk(proposal, p, input, ctx, "proposal");
      if (alt) runs.proposal.push(shift(alt, enterAt));
    }
  }
  runs.current = queueDecode(current, runs.current);
  if (proposal) runs.proposal = queueDecode(proposal, runs.proposal);
  return runs;
}

// ------------------------------------------------------------------ views

export interface VariantKpis {
  parcels: number;
  /** most parcels staged within one clock hour */
  peakPerHour: number;
  /** first read failed */
  unread: number;
  /** extra loop rounds (proposal) */
  recirculated: number;
  /** mean minutes from the input to the staging place */
  avgMinutes: number | null;
  /** parcels sorted or decoded by hand */
  manual: number;
}

export function variantKpis(runs: readonly ParcelRun[]): VariantKpis {
  const hours = new Map<number, number>();
  let sum = 0;
  for (const r of runs) {
    const h = Math.floor(r.stagedAt / HOUR);
    hours.set(h, (hours.get(h) ?? 0) + 1);
    sum += r.stagedAt - r.enterAt;
  }
  return {
    parcels: runs.length,
    peakPerHour: Math.max(0, ...hours.values()),
    unread: runs.filter((r) => r.unread).length,
    recirculated: runs.filter((r) => r.rounds > 0).length,
    avgMinutes: runs.length ? Math.round((sum / runs.length / MINUTE) * 10) / 10 : null,
    manual: runs.filter((r) => r.manual).length,
  };
}

export interface CheckpointView {
  code: string;
  node: string;
  kind: NodeKind;
  label: string;
  /** passages in the last hour */
  perHour: number;
  /** passages today up to now */
  today: number;
  /** read share of the last hour (scanners only, null without readings) */
  readRate: number | null;
  /** unread today (scanners) */
  unread: number;
  /** parcels waiting or being decoded now (decoding station) */
  queue: number | null;
}

export function checkpointViews(graph: LineGraph, runs: readonly ParcelRun[], now: number): CheckpointView[] {
  const byCode = new Map<string, Passage[]>();
  for (const r of runs) for (const x of r.passages) if (x.at <= now) (byCode.get(x.checkpoint) ?? byCode.set(x.checkpoint, []).get(x.checkpoint))?.push(x);
  return graph.nodes
    .filter((n) => n.checkpoint)
    .map((n) => {
      const all = byCode.get(n.checkpoint as string) ?? [];
      const hour = all.filter((x) => x.at > now - HOUR);
      const reads = hour.filter((x) => x.read !== null);
      let queue: number | null = null;
      if (n.kind === "decode") {
        queue = runs.filter((r) => {
          const i = r.hops.findIndex((h) => h.node === n.id);
          const next = r.hops[i + 1];
          return i >= 0 && (r.hops[i] as Hop).at <= now && (next?.at ?? Infinity) > now;
        }).length;
      }
      return {
        code: n.checkpoint as string,
        node: n.id,
        kind: n.kind,
        label: n.label ?? n.id,
        perHour: hour.length,
        today: all.length,
        readRate: reads.length ? reads.filter((x) => x.read).length / reads.length : null,
        unread: all.filter((x) => x.read === false).length,
        queue,
      };
    });
}

/** Parcels on the line around `now` (at most `limit`, nearest first), hops cut to [now, now + ahead]. */
export function inFlight(runs: readonly ParcelRun[], now: number, ahead: number, limit = 300): { barcode: string; unread: boolean; hops: Hop[] }[] {
  const live = runs.filter((r) => r.enterAt <= now + ahead && r.stagedAt >= now);
  live.sort((a, b) => Math.abs(a.enterAt - now) - Math.abs(b.enterAt - now) || a.barcode.localeCompare(b.barcode));
  return live.slice(0, limit).map((r) => {
    const from = Math.max(0, r.hops.findIndex((h) => h.at > now) - 1);
    let to = r.hops.findIndex((h) => h.at > now + ahead);
    to = to < 0 ? r.hops.length : to + 1;
    return { barcode: r.barcode, unread: r.unread, hops: r.hops.slice(from, to) };
  });
}

/** Where a parcel is on the line now: its last passed checkpoint. */
export function lastCheckpoint(run: ParcelRun, now: number): Passage | null {
  return [...run.passages].reverse().find((x) => x.at <= now) ?? null;
}
