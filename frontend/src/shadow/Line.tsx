import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CheckpointView, LineView } from "../api/line";
import type { LineEdge, LineGraph, LineNode } from "./layout";
import { box, disposeTree, mat } from "./parts";
import { simNow } from "./simTime";

/**
 * heights (m): hall floor, top of a belt, the platform of the night trucks (below the belt tops,
 * so the exit belts to the linehaul doors stay visible on it) and the belts from the platform,
 * which run as a bridge over the exit belts
 */
const FLOOR = 0.36;
const TOP = 1.2;
const PLATFORM = 0.55;
const BRIDGE = 0.85;
const DECK = 0.45;
const LIMIT = 300;
const WIDTH: Record<LineEdge["kind"], number> = { belt: 1.2, loop: 1.5, feed: 0.9, telescopic: 0.9, chute: 1.0, manual: 0 };

const C = {
  belt: 0x4f4f4c,
  beltTop: 0x8a8a86,
  chute: 0xbdbab3,
  platform: 0xbfbcb3,
  edge: 0xeebd45,
  bridge: 0x2f2f2d,
  office: 0xf4f3ef,
  table: 0xe9e2d4,
} as const;

function yOf(e: LineEdge): number {
  return e.raised ? TOP + BRIDGE : TOP;
}

/** Nodes where a bridge belt ends: a floor belt leaving one starts with a ramp down. */
function bridgeEnds(g: LineGraph): Set<string> {
  const raised = g.edges.filter((e) => e.raised && e.kind !== "chute");
  return new Set(raised.flatMap((e) => [e.from, e.to]));
}

/** Height of a parcel / belt top on segment `k` of an edge at fraction `u` (ramps from a bridge). */
function topAt(e: LineEdge, k: number, u: number, ends: Set<string>): number {
  if (!e.raised && k === 1 && ends.has(e.from)) return TOP + BRIDGE * (1 - u);
  return yOf(e);
}

/** A sloped segment from (x1, y1, z1) to (x2, y2, z2) (top surface), `h` thick. */
function ramp(x1: number, z1: number, y1: number, x2: number, z2: number, y2: number, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const run = Math.hypot(x2 - x1, z2 - z1);
  const s = box(Math.hypot(run, y2 - y1) + w * 0.5, h, w, m, (x1 + x2) / 2, (y1 + y2) / 2 - h / 2, (z1 + z2) / 2);
  // Euler XYZ: the tilt (z) is applied before the turn (y)
  s.rotation.set(0, -Math.atan2(z2 - z1, x2 - x1), Math.atan2(y2 - y1, run));
  return s;
}

/** Direction of the line at a node: the first segment of the belt leaving it (or arriving). */
function dirAt(g: LineGraph, id: string): number {
  const e = g.edges.find((x) => x.from === id && x.kind !== "manual") ?? g.edges.find((x) => x.to === id && x.kind !== "manual");
  if (!e || e.points.length < 2) return 0;
  const [a, b] = e.from === id ? [e.points[0], e.points[1]] : [e.points[e.points.length - 2], e.points[e.points.length - 1]];
  return Math.atan2((b?.[1] ?? 0) - (a?.[1] ?? 0), (b?.[0] ?? 0) - (a?.[0] ?? 0));
}

/** A segment as a box from (x1, z1) to (x2, z2), top at `top`. */
function segment(x1: number, z1: number, x2: number, z2: number, w: number, h: number, top: number, m: THREE.Material): THREE.Mesh {
  const len = Math.hypot(x2 - x1, z2 - z1) + w * 0.5;
  const s = box(len, h, w, m, (x1 + x2) / 2, top - h / 2, (z1 + z2) / 2);
  s.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  return s;
}

/** Static model of the line: belts, loop, chutes, platform, scanner bridge or tunnel, sorters, zones. */
function lineModel(g: LineGraph, brand: THREE.Color): THREE.Group {
  const out = new THREE.Group();
  const belt = mat(C.belt);
  const top = mat(C.beltTop);
  const chute = mat(C.chute);
  const brandMat = mat(brand);
  for (const z of g.zones) {
    const [x0, y0, x1, y1] = z.rect;
    if (z.kind === "platform") {
      out.add(box(x1 - x0, PLATFORM, y1 - y0, mat(C.platform), (x0 + x1) / 2, FLOOR + PLATFORM / 2, (y0 + y1) / 2));
      // yellow safety edge round the platform (dock edge marking)
      const e = mat(C.edge);
      const yT = FLOOR + PLATFORM + 0.01;
      out.add(box(x1 - x0, 0.03, 0.25, e, (x0 + x1) / 2, yT, y0 + 0.12), box(x1 - x0, 0.03, 0.25, e, (x0 + x1) / 2, yT, y1 - 0.12));
      out.add(box(0.25, 0.03, y1 - y0, e, x0 + 0.12, yT, (y0 + y1) / 2), box(0.25, 0.03, y1 - y0, e, x1 - 0.12, yT, (y0 + y1) / 2));
    }
    if (z.kind === "manual") {
      const m = box(x1 - x0, 0.04, y1 - y0, mat(brand, { transparent: true, opacity: 0.12 }), (x0 + x1) / 2, FLOOR + 0.03, (y0 + y1) / 2);
      m.castShadow = false;
      out.add(m);
    }
    if (z.kind === "office") {
      const w = mat(C.office);
      out.add(box(x1 - x0, 3, y1 - y0, w, (x0 + x1) / 2, FLOOR + 1.5, (y0 + y1) / 2));
      out.add(box(x1 - x0 + 0.2, 0.25, y1 - y0 + 0.2, brandMat, (x0 + x1) / 2, FLOOR + 3.1, (y0 + y1) / 2));
    }
  }
  const ends = bridgeEnds(g);
  const legs = mat(C.bridge);
  for (const e of g.edges) {
    if (e.kind === "manual") continue;
    const y = yOf(e);
    const w = WIDTH[e.kind];
    if (e.raised && e.kind !== "chute") {
      // a bridge: a deck on legs, the exit belts pass under it
      for (const [px, pz] of e.points) out.add(box(0.22, y - DECK - FLOOR, 0.22, legs, px, FLOOR + (y - DECK - FLOOR) / 2, pz));
    }
    for (let i = 1; i < e.points.length; i++) {
      const [x1, z1] = e.points[i - 1] as [number, number];
      const [x2, z2] = e.points[i] as [number, number];
      if (e.kind === "chute") {
        // a gravity chute: a light slide down to the staging place
        out.add(segment(x1, z1, x2, z2, w, 0.12, i === e.points.length - 1 ? FLOOR + 0.6 : TOP - 0.1, chute));
        continue;
      }
      if (!e.raised && i === 1 && ends.has(e.from)) {
        // down from the bridge to the floor belts
        out.add(ramp(x1, z1, TOP + BRIDGE - 0.1, x2, z2, TOP - 0.1, w, DECK, belt));
        out.add(ramp(x1, z1, TOP + BRIDGE, x2, z2, TOP, w * 0.8, 0.08, top));
        continue;
      }
      out.add(segment(x1, z1, x2, z2, w, e.raised ? DECK : y - FLOOR - 0.3, y - 0.1, belt));
      out.add(segment(x1, z1, x2, z2, w * 0.8, 0.08, y, top));
    }
  }
  for (const n of g.nodes) {
    const a = dirAt(g, n.id);
    const part = new THREE.Group();
    part.position.set(n.x, 0, n.y);
    part.rotation.y = -a;
    if (n.kind === "scanner") {
      // the overhead bridge with the scanner over the loop (team sketch)
      for (const s of [-1.6, 1.6]) part.add(box(0.3, 3.4, 0.3, mat(C.bridge), 0, FLOOR + 1.7, s));
      part.add(box(0.7, 0.45, 3.6, mat(C.bridge), 0, FLOOR + 3.4, 0));
      part.add(box(0.72, 0.12, 3.62, brandMat, 0, FLOOR + 3.68, 0));
    } else if (n.kind === "tunnel") {
      // multi-sided scan tunnel (proposal)
      part.add(box(3.2, 2.0, 2.4, mat(0xf0eeea), 0, TOP + 0.6, 0));
      part.add(box(3.22, 0.25, 2.42, brandMat, 0, TOP + 1.5, 0));
      part.add(box(3.24, 0.9, 1.0, mat(C.bridge), 0, TOP + 0.35, 0));
    } else if (n.kind === "counter") {
      for (const s of [-0.9, 0.9]) part.add(box(0.18, 1.3, 0.18, mat(C.bridge), 0, TOP + 0.2, s));
      part.add(box(0.2, 0.12, 2, brandMat, 0, TOP + 0.9, 0));
    } else if (n.kind === "exit" && n.serves?.length) {
      // wheel sorter / pusher: an orange patch on the belt
      part.add(box(1.3, 0.1, 1.5, brandMat, 0, TOP + 0.04, 0));
    } else if (n.kind === "manual" || n.kind === "decode") {
      const tables = n.kind === "manual" ? [-6, -2, 2, 6] : [0];
      for (const t of tables) part.add(box(2.2, 0.9, 1.2, mat(C.table), t, FLOOR + 0.45, 1.6));
    } else if (n.kind === "input") {
      part.add(box(1.2, 0.06, 1.2, brandMat, 0, FLOOR + 0.04, 0));
    }
    if (part.children.length) out.add(part);
  }
  return out;
}

export function LineModel({ graph, brand }: { graph: LineGraph; brand: THREE.Color }) {
  const object = useMemo(() => lineModel(graph, brand), [graph, brand]);
  useEffect(() => () => disposeTree(object), [object]);
  return (
    <>
      <primitive object={object} />
      {graph.zones
        .filter((z) => z.kind !== "platform")
        .map((z) => (
          <Html key={z.label} position={[(z.rect[0] + z.rect[2]) / 2, z.kind === "office" ? 4.4 : 1.2, (z.rect[1] + z.rect[3]) / 2]} center zIndexRange={[4, 2]} style={{ pointerEvents: "none" }}>
            <span className="bg-surface/90 text-ink rounded-md px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap shadow-sm">{z.label}</span>
          </Html>
        ))}
    </>
  );
}

/** Orange trace of the route of the searched parcel over the belts it takes. */
export function LineRoute({ graph, nodes }: { graph: LineGraph; nodes: string[] }) {
  const object = useMemo(() => {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: "#2f5be9", transparent: true, opacity: 0.85 });
    const seen = new Set<string>();
    for (let i = 1; i < nodes.length; i++) {
      const key = `${nodes[i - 1] ?? ""}>${nodes[i] ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = graph.edges.find((x) => x.from === nodes[i - 1] && x.to === nodes[i]);
      if (!e) continue;
      const y = e.kind === "manual" ? FLOOR + 0.06 : e.kind === "chute" ? TOP : e.raised ? yOf(e) + 0.06 : TOP + 0.06;
      for (let k = 1; k < e.points.length; k++) {
        const [x1, z1] = e.points[k - 1] as [number, number];
        const [x2, z2] = e.points[k] as [number, number];
        const s = segment(x1, z1, x2, z2, e.kind === "manual" ? 0.35 : 0.5, 0.05, y, m);
        s.castShadow = false;
        g.add(s);
      }
    }
    return g;
  }, [graph, nodes]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}

/** Pin of a checkpoint without a device pin of its own; amber when it reads badly or a queue grows. */
export function CheckpointPin({
  node,
  view,
  selected,
  onSelect,
}: {
  node: LineNode;
  view: CheckpointView | undefined;
  selected: boolean;
  onSelect: (code: string) => void;
}) {
  const code = node.checkpoint as string;
  const warn = (view?.readRate !== null && view?.readRate !== undefined && view.readRate < 0.95) || (view?.queue ?? 0) > 3;
  const dot = warn ? "bg-warn-600" : "bg-ok-600";
  return (
    <group position={[node.x, 0, node.y]}>
      <mesh position={[0, 2.4, 0]}>
        <boxGeometry args={[0.12, 4.8, 0.12]} />
        <meshStandardMaterial color="#9c9c97" />
      </mesh>
      <Html position={[0, 5.4, 0]} center zIndexRange={[8, 5]}>
        <button
          type="button"
          data-pin
          onClick={() => onSelect(code)}
          aria-label={`Kontrolný bod ${node.label ?? code}`}
          className="group relative flex h-6 w-6 -translate-y-2 items-center justify-center"
        >
          <span className={`absolute inset-0.5 -rotate-45 rounded-[50%_50%_50%_0] border-2 border-white shadow-md ${dot} ${selected ? "outline-brand-500 outline-2" : ""}`} />
          <span className="relative h-1.5 w-1.5 rounded-full bg-white" />
          <span
            className={`bg-surface text-ink pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold whitespace-nowrap shadow-md ${selected ? "flex" : "hidden group-hover:flex"}`}
          >
            <i className={`inline-block h-2 w-2 rounded-full ${dot}`} />
            {node.label ?? code}
            {view ? ` · ${String(view.perHour)}/h` : ""}
          </span>
        </button>
      </Html>
    </group>
  );
}

interface Track {
  unread: boolean;
  found: boolean;
  /** per hop: arrival (ms), and the edge to the next hop */
  at: Float64Array;
  edges: (LineEdge | null)[];
  cum: Float32Array[];
}

const READ = new THREE.Color("#d9a066");
const UNREAD = new THREE.Color("#e0604a");
const FOUND = new THREE.Color("#2f5be9");

/**
 * Parcels on the line (at most 300, one InstancedMesh): each walks its hops by the simulated
 * clock, waits at a node while it is handled, then moves along the belt. Nothing is allocated per
 * frame; while parcels are visible the demand loop keeps rendering.
 */
export function LineParcels({ graph, view, found }: { graph: LineGraph; view: LineView | undefined; found: string | null }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const scratch = useRef(new THREE.Object3D());
  const ends = useMemo(() => bridgeEnds(graph), [graph]);
  const tracks = useMemo<Track[]>(() => {
    const edges = new Map(graph.edges.map((e) => [`${e.from}>${e.to}`, e]));
    return (view?.parcels ?? []).slice(0, LIMIT).map((p) => {
      const list = p.hops.map((h, i) => (i + 1 < p.hops.length ? (edges.get(`${h.node}>${p.hops[i + 1]?.node ?? ""}`) ?? null) : null));
      return {
        unread: p.unread,
        found: p.barcode === found,
        at: Float64Array.from(p.hops.map((h) => Date.parse(h.at))),
        edges: list,
        cum: list.map((e) => {
          const c = new Float32Array(e ? e.points.length : 1);
          for (let k = 1; e && k < e.points.length; k++) {
            const [ax, az] = e.points[k - 1] as [number, number];
            const [bx, bz] = e.points[k] as [number, number];
            c[k] = (c[k - 1] as number) + Math.hypot(bx - ax, bz - az);
          }
          return c;
        }),
      };
    });
  }, [graph, view, found]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    tracks.forEach((t, i) => m.setColorAt(i, t.found ? FOUND : t.unread ? UNREAD : READ));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [tracks]);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const now = simNow();
    const dummy = scratch.current;
    let visible = 0;
    for (let i = 0; i < LIMIT; i++) {
      const t = tracks[i];
      let shown = false;
      if (t && now > 0) {
        const n = t.at.length;
        let h = -1;
        for (let k = 0; k < n - 1; k++) if ((t.at[k] as number) <= now && now < (t.at[k + 1] as number)) h = k;
        const e = h >= 0 ? t.edges[h] : null;
        if (e) {
          const travel = (e.length / e.speed) * 1000;
          const depart = (t.at[h + 1] as number) - travel;
          const f = now < depart ? 0 : (now - depart) / travel;
          const cum = t.cum[h] as Float32Array;
          const total = cum[cum.length - 1] as number;
          const d = f * total;
          let k = 1;
          while (k < cum.length - 1 && d > (cum[k] as number)) k++;
          const a = cum[k - 1] as number;
          const seg = (cum[k] as number) - a || 1;
          const u = Math.min(1, Math.max(0, (d - a) / seg));
          const [x0, z0] = e.points[k - 1] as [number, number];
          const [x1, z1] = e.points[k] as [number, number];
          const y = e.kind === "manual" ? FLOOR + 0.9 : e.kind === "chute" ? TOP - f * (TOP - FLOOR - 0.8) : topAt(e, k, u, ends);
          dummy.position.set(x0 + (x1 - x0) * u, y + 0.25, z0 + (z1 - z0) * u);
          dummy.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
          dummy.scale.setScalar(t.found ? 1.6 : 1);
          shown = true;
        }
      }
      if (!shown) dummy.scale.setScalar(0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (shown) visible++;
    }
    m.instanceMatrix.needsUpdate = true;
    if (visible > 0) state.invalidate();
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, LIMIT]} castShadow frustumCulled={false}>
      <boxGeometry args={[1.0, 0.7, 0.9]} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  );
}
