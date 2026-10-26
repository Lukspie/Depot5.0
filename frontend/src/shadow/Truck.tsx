import { useFrame } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { MODEL_URLS } from "./models";
import { cssColor, disposeTree, truckModel } from "./parts";

const GltfModel = lazy(() => import("./GltfModel"));

const ENTER_S = 1.6;
const ENTER_FROM = -26;

/** how long a departing truck stays in the scene (it drives away meanwhile) */
export const LEAVE_MS = ENTER_S * 1000;

/**
 * Truck backed into a door (cab + trailer, colour by direction type). It drives in smoothly on
 * arrival and away on departure (`leaving`); while moving it requests frames itself
 * (frameloop="demand").
 */
export function Truck({ x, z, directionType, leaving = false, onSelect }: { x: number; z: number; directionType: string; leaving?: boolean; onSelect?: () => void }) {
  // cab colour from the theme tokens (linehaul = info, transit = ok, others neutral)
  const model = useMemo(
    () => truckModel(cssColor(directionType === "linehaul" ? "--color-info-600" : directionType === "transit" ? "--color-ok-600" : "--color-neutral-600", "#8a8a86")),
    [directionType],
  );
  useEffect(() => () => disposeTree(model), [model]);
  const group = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now() / 1000;
    born.current ??= now;
    const t = Math.min(1, (now - born.current) / ENTER_S);
    const ease = leaving ? t ** 3 : 1 - (1 - t) ** 3;
    g.position.z = leaving ? z + ENTER_FROM * ease : z + ENTER_FROM * (1 - ease);
    if (t < 1) state.invalidate();
  });

  return (
    <group
      ref={group}
      position={[x, 0, leaving ? z : z + ENTER_FROM]}
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
