import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { disposeTree, TRUCK_COLOR, truckModel } from "./parts";

const ENTER_S = 1.6;
const TOP_TRAILER = new THREE.BoxGeometry(2.7, 0.02, 13.7);
const ENTER_FROM = -26;

/** how long a departing truck stays in the scene (it drives away meanwhile) */
export const LEAVE_MS = ENTER_S * 1000;

/**
 * Truck backed into a door (cab + trailer, colour by direction type). It drives in smoothly on
 * arrival and away on departure (`leaving`); while moving it requests frames itself
 * (frameloop="demand").
 */
export function Truck({
  x,
  z,
  directionType,
  leaving = false,
  onSelect,
  selected = false,
  label,
}: {
  x: number;
  z: number;
  directionType: string;
  leaving?: boolean;
  onSelect?: () => void;
  /** orange outline of the top and the floating label (maketa-tien) */
  selected?: boolean;
  label?: string;
}) {
  // white trailer, tractor dark for linehaul and orange for transit trucks (maketa-tien)
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
      <primitive object={model} />
      {selected && (
        <>
          {/* orange outline round the top of the trailer and the cab */}
          <lineSegments position={[0, 4.12, -7.4]}>
            <edgesGeometry args={[TOP_TRAILER]} />
            <lineBasicMaterial color="#f39200" linewidth={2} />
          </lineSegments>
          <mesh position={[0, 4.13, -7.4]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[2.6, 13.6]} />
            <meshBasicMaterial color="#f39200" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        </>
      )}
      {label && (
        <Html position={[0, 6.2, -9]} center zIndexRange={[6, 3]} style={{ pointerEvents: "none" }}>
          <div
            className={`bg-surface flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-bold whitespace-nowrap shadow-md ${selected ? "border-brand-500 border-2" : "border-line border"}`}
          >
            <span className={`h-2 w-2 rounded-full ${selected ? "bg-brand-500" : "bg-neutral-600"}`} />
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
