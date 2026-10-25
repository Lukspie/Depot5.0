/**
 * Offline road routing (ADR-038): A* over the road graph built from OpenStreetMap by
 * tools/osm/build_osm_data.py (data/roads.json.gz). No routing API is called at runtime, and the
 * same request always gives the same route, so the simulation stays deterministic.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { haversineKm, type LatLon } from "./routes.js";

export const DEFAULT_ROADS_FILE = fileURLToPath(new URL("../../data/roads.json.gz", import.meta.url));

interface RoadsFile {
  format: string;
  classes: string[];
  nodes: [number, number][];
  /** [from, to, class, oneway (0 both, 1 forward, -1 backward), length m, flat inner geometry] */
  edges: [number, number, number, number, number, number[]][];
}

/** Truck speeds by road class (km/h): motorway, trunk, primary, secondary, tertiary, residential, service */
export const TRUCK_SPEED_KMH = [85, 75, 65, 55, 45, 30, 20];

export interface RoadRoute {
  points: LatLon[];
  lengthKm: number;
  minutes: number;
}

/** Binary min-heap on (priority, node). */
class Heap {
  private readonly prio: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    this.prio.push(p);
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.prio[parent] ?? 0) <= p) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const lastP = this.prio.pop() as number;
    const lastI = this.items.pop() as number;
    if (this.items.length > 0) {
      this.prio[0] = lastP;
      this.items[0] = lastI;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && (this.prio[l] ?? 0) < (this.prio[m] ?? 0)) m = l;
        if (r < this.items.length && (this.prio[r] ?? 0) < (this.prio[m] ?? 0)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.prio[a], this.prio[b]] = [this.prio[b] as number, this.prio[a] as number];
    [this.items[a], this.items[b]] = [this.items[b] as number, this.items[a] as number];
  }
}

export class RoadRouter {
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  /** CSR adjacency: arcs of node n are arcStart[n] .. arcStart[n+1] */
  private readonly arcStart: Int32Array;
  private readonly arcTo: Int32Array;
  private readonly arcEdge: Int32Array;
  private readonly arcReversed: Uint8Array;
  private readonly arcMinutes: Float64Array;
  private readonly component: Int32Array;
  private readonly mainComponent: number;
  private readonly cache = new Map<string, RoadRoute>();

  constructor(private readonly data: RoadsFile) {
    const n = data.nodes.length;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    data.nodes.forEach(([la, lo], i) => {
      this.lat[i] = la / 1e5;
      this.lon[i] = lo / 1e5;
    });
    // count arcs per node
    const count = new Int32Array(n + 1);
    for (const [a, b, , oneway] of data.edges) {
      if (oneway >= 0) count[a] = (count[a] ?? 0) + 1;
      if (oneway <= 0) count[b] = (count[b] ?? 0) + 1;
    }
    this.arcStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.arcStart[i + 1] = (this.arcStart[i] ?? 0) + (count[i] ?? 0);
    const total = this.arcStart[n] ?? 0;
    this.arcTo = new Int32Array(total);
    this.arcEdge = new Int32Array(total);
    this.arcReversed = new Uint8Array(total);
    this.arcMinutes = new Float64Array(total);
    const fill = this.arcStart.slice(0, n);
    data.edges.forEach(([a, b, cls, oneway, length], e) => {
      const minutes = (length / 1000 / (TRUCK_SPEED_KMH[cls] ?? 30)) * 60;
      const add = (from: number, to: number, reversed: boolean): void => {
        const k = fill[from] ?? 0;
        fill[from] = k + 1;
        this.arcTo[k] = to;
        this.arcEdge[k] = e;
        this.arcReversed[k] = reversed ? 1 : 0;
        this.arcMinutes[k] = minutes;
      };
      if (oneway >= 0) add(a, b, false);
      if (oneway <= 0) add(b, a, true);
    });
    // connected components (undirected) so endpoints snap to the main network
    this.component = new Int32Array(n).fill(-1);
    const undirected: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of data.edges) {
      undirected[a]?.push(b);
      undirected[b]?.push(a);
    }
    const sizes: number[] = [];
    for (let s = 0; s < n; s++) {
      if (this.component[s] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [s];
      this.component[s] = id;
      while (stack.length) {
        const v = stack.pop() as number;
        size++;
        for (const w of undirected[v] ?? []) {
          if (this.component[w] === -1) {
            this.component[w] = id;
            stack.push(w);
          }
        }
      }
      sizes.push(size);
    }
    this.mainComponent = sizes.indexOf(Math.max(...sizes));
  }

  static load(file: string = DEFAULT_ROADS_FILE): RoadRouter | null {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as RoadsFile;
    return new RoadRouter(raw);
  }

  get nodeCount(): number {
    return this.lat.length;
  }

  /** Nearest node of the main connected network. */
  nearest(p: LatLon): number {
    let best = -1;
    let bestD = Infinity;
    const k = Math.cos((p[0] * Math.PI) / 180);
    for (let i = 0; i < this.lat.length; i++) {
      if (this.component[i] !== this.mainComponent) continue;
      const dy = (this.lat[i] ?? 0) - p[0];
      const dx = ((this.lon[i] ?? 0) - p[1]) * k;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Fastest route for a truck between two points (snapped to the network); cached. */
  route(from: LatLon, to: LatLon): RoadRoute | null {
    const key = `${from.join(",")}>${to.join(",")}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const s = this.nearest(from);
    const t = this.nearest(to);
    if (s < 0 || t < 0) return null;
    const maxSpeed = Math.max(...TRUCK_SPEED_KMH);
    const tLat = this.lat[t] ?? 0;
    const tLon = this.lon[t] ?? 0;
    const h = (v: number): number => (haversineKm([this.lat[v] ?? 0, this.lon[v] ?? 0], [tLat, tLon]) / maxSpeed) * 60;
    const g = new Float64Array(this.nodeCount).fill(Infinity);
    const viaArc = new Int32Array(this.nodeCount).fill(-1);
    const done = new Uint8Array(this.nodeCount);
    const heap = new Heap();
    g[s] = 0;
    heap.push(s, h(s));
    while (heap.size > 0) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      if (v === t) break;
      for (let k = this.arcStart[v] ?? 0; k < (this.arcStart[v + 1] ?? 0); k++) {
        const w = this.arcTo[k] ?? 0;
        const cost = (g[v] ?? 0) + (this.arcMinutes[k] ?? 0);
        if (cost < (g[w] ?? Infinity)) {
          g[w] = cost;
          viaArc[w] = k;
          heap.push(w, cost + h(w));
        }
      }
    }
    if (!Number.isFinite(g[t] ?? Infinity)) return null;

    // walk back, then expand edge geometries in travel order
    const arcs: number[] = [];
    for (let v = t; v !== s; ) {
      const k = viaArc[v] ?? -1;
      if (k < 0) return null;
      arcs.push(k);
      const e = this.data.edges[this.arcEdge[k] ?? 0];
      v = this.arcReversed[k] ? (e?.[1] ?? s) : (e?.[0] ?? s);
    }
    arcs.reverse();
    const points: LatLon[] = [[this.lat[s] ?? 0, this.lon[s] ?? 0]];
    let meters = 0;
    for (const k of arcs) {
      const edge = this.data.edges[this.arcEdge[k] ?? 0];
      if (!edge) continue;
      const [a, b, , , length, flat] = edge;
      const inner: LatLon[] = [];
      for (let i = 0; i < flat.length; i += 2) inner.push([(flat[i] ?? 0) / 1e5, (flat[i + 1] ?? 0) / 1e5]);
      const reversed = this.arcReversed[k] === 1;
      if (reversed) inner.reverse();
      const end = reversed ? a : b;
      points.push(...inner, [this.lat[end] ?? 0, this.lon[end] ?? 0]);
      meters += length;
    }
    const route: RoadRoute = { points, lengthKm: meters / 1000, minutes: g[t] ?? 0 };
    this.cache.set(key, route);
    return route;
  }
}
