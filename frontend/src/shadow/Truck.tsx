import { useFrame } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { MODEL_URLS } from "./models";
import { disposeTree, TRUCK_COLOR, truckModel } from "./parts";

const GltfModel = lazy(() => import("./GltfModel"));

const ENTER_S = 1.6;
const ENTER_FROM = -26;

/**
 * Truck backed into a door (cab + trailer, colour by direction type). On arrival it drives in
 * smoothly; while moving it requests frames itself (frameloop="demand").
 */
export function Truck({ x, z, directionType, onSelect }: { x: number; z: number; directionType: string; onSelect?: () => void }) {
  const model = useMemo(() => truckModel(TRUCK_COLOR[directionType] ?? 0x8a8a86), [directionType]);
  useEffect(() => () => disposeTree(model), [model]);
  const group = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now() / 1000;
    born.current ??= now;
    const t = Math.min(1, (now - born.current) / ENTER_S);
    const ease = 1 - (1 - t) ** 3;
    g.position.z = z + ENTER_FROM * (1 - ease);
    if (t < 1) state.invalidate();
  });

  return (
    <group
      ref={group}
      position={[x, 0, z + ENTER_FROM]}
      onClick={(e) => {
        if (!onSelect) return;
        e.stopPropagation();
        onSelect();
      }}
    >
      {MODEL_URLS.truck ? (
        <Suspense fallback={<primitive object={model} />}>
          <GltfModel src={MODEL_URLS.truck} />
        </Suspense>
      ) : (
        <primitive object={model} />
      )}
    </group>
  );
}
