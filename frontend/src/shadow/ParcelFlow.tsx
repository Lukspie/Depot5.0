import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { beltZ, inFront, type DepotLayout } from "./layout";
import { WithModel } from "./gltf";
import { useModelMesh, type ModelMesh } from "./useModelMesh";
import { MODELS } from "./models";
import { useShadowStore, type FlowItem } from "./store";

const LIMIT = 300;
/** belt speed in the animation (m/s of real time; the simulation itself runs faster) */
const SPEED = 22;
/** at most this many parcels enter the belt per frame, so bursts spread out */
const SPAWN_PER_FRAME = 2;
const Y = 1.65;
/** tint of the instances: the GLTF box has its own texture (white = unchanged), the primitive is cardboard */
const READ_PRIMITIVE = new THREE.Color("#d9a066");
const READ_MODEL = new THREE.Color("#ffffff");
const UNREAD = new THREE.Color("#e0604a");

interface Slot {
  active: boolean;
  t0: number;
  /** polyline x/z points and cumulative lengths (preallocated, reused) */
  xs: Float32Array;
  zs: Float32Array;
  cum: Float32Array;
  n: number;
}

type InstanceRef = THREE.Object3D & { color: THREE.Color };

const POOL = Array.from({ length: LIMIT }, (_, i) => i);

function makeSlots(): Slot[] {
  return POOL.map(() => ({ active: false, t0: 0, xs: new Float32Array(3), zs: new Float32Array(3), cum: new Float32Array(3), n: 0 }));
}

/**
 * Every scan sends a small parcel along the belt to the door that scanned it (dock scanners) or
 * along the whole line (line scanner). drei <Instances> with a fixed pool of 300 <Instance>s:
 * positions are written in useFrame, nothing is allocated per frame, and while any parcel moves
 * the component calls invalidate() so the "demand" frame loop keeps animating.
 */
export function ParcelFlow({ layout }: { layout: DepotLayout }) {
  return (
    <WithModel fallback={<Flow layout={layout} mesh={null} />}>
      <FlowWithModel layout={layout} />
    </WithModel>
  );
}

function FlowWithModel({ layout }: { layout: DepotLayout }) {
  const mesh = useModelMesh(MODELS.parcel.url, MODELS.parcel.scale);
  return <Flow layout={layout} mesh={mesh} />;
}

function Flow({ layout, mesh }: { layout: DepotLayout; mesh: ModelMesh | null }) {
  const READ = mesh ? READ_MODEL : READ_PRIMITIVE;
  const refs = useRef<(InstanceRef | null)[]>([]);
  const queue = useRef<FlowItem[]>([]);
  const slots = useRef<Slot[]>([]);
  const geo = useMemo(() => {
    const belt = layout.layout.belt ?? [];
    const z = beltZ(layout);
    const startX = belt[0]?.[0] ?? 0;
    const endX = belt[belt.length - 1]?.[0] ?? startX;
    const doors = new Map(layout.doors.filter((d) => d.kind === "loading_dock").map((d) => [d.code, d]));
    return { z, startX, endX, doors, hasBelt: belt.length > 1 };
  }, [layout]);

  useFrame((state) => {
    if (!geo.hasBelt) return;
    if (slots.current.length === 0) slots.current = makeSlots();
    const now = performance.now() / 1000;
    const incoming = useShadowStore.getState().takeFlow();
    if (incoming.length > 0) {
      queue.current.push(...incoming);
      if (queue.current.length > LIMIT) queue.current.splice(0, queue.current.length - LIMIT);
    }

    let spawned = 0;
    let active = 0;
    for (let i = 0; i < LIMIT; i++) {
      const s = slots.current[i] as Slot;
      const inst = refs.current[i];
      if (!inst) continue;
      if (!s.active && spawned < SPAWN_PER_FRAME && queue.current.length > 0) {
        const item = queue.current.shift() as FlowItem;
        const door = item.doorCode ? geo.doors.get(item.doorCode) : undefined;
        s.xs[0] = geo.startX;
        s.zs[0] = geo.z;
        if (door) {
          s.xs[1] = door.x;
          s.zs[1] = geo.z;
          // just inside the door, whichever wall it is on
          const [ix, iz] = inFront(layout, door, -1.5);
          s.xs[2] = ix;
          s.zs[2] = iz;
          s.n = 3;
        } else {
          s.xs[1] = geo.endX;
          s.zs[1] = geo.z;
          s.n = 2;
        }
        s.cum[0] = 0;
        for (let k = 1; k < s.n; k++) {
          s.cum[k] = (s.cum[k - 1] as number) + Math.hypot((s.xs[k] as number) - (s.xs[k - 1] as number), (s.zs[k] as number) - (s.zs[k - 1] as number));
        }
        s.active = true;
        s.t0 = now;
        inst.color.copy(item.readOk ? READ : UNREAD);
        spawned++;
      }
      if (!s.active) {
        if (inst.scale.x !== 0) inst.scale.setScalar(0);
        continue;
      }
      const dist = (now - s.t0) * SPEED;
      const total = s.cum[s.n - 1] as number;
      if (dist >= total) {
        s.active = false;
        inst.scale.setScalar(0);
        continue;
      }
      let k = 1;
      while (k < s.n - 1 && dist > (s.cum[k] as number)) k++;
      const a = s.cum[k - 1] as number;
      const seg = (s.cum[k] as number) - a || 1;
      const f = (dist - a) / seg;
      const x0 = s.xs[k - 1] as number;
      const z0 = s.zs[k - 1] as number;
      inst.position.set(x0 + ((s.xs[k] as number) - x0) * f, k === 1 ? Y : Y - 0.2, z0 + ((s.zs[k] as number) - z0) * f);
      inst.scale.setScalar(1);
      active++;
    }
    if (active > 0 || queue.current.length > 0) state.invalidate();
  });

  return (
    <Instances limit={LIMIT} castShadow geometry={mesh?.geometry} material={mesh?.material}>
      {!mesh && <boxGeometry args={[0.9, 0.6, 0.8]} />}
      {!mesh && <meshStandardMaterial roughness={0.8} />}
      {POOL.map((i) => (
        <Instance
          key={i}
          scale={0}
          color={READ}
          ref={(r: InstanceRef | null) => {
            refs.current[i] = r;
          }}
        />
      ))}
    </Instances>
  );
}
