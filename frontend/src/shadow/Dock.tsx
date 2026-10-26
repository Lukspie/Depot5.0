import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import type { LayoutDoor } from "./layout";
import { cardboardPile, disposeTree, dockFrame, stagingBay } from "./parts";

function pointer(on: boolean) {
  return (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = on ? "pointer" : "";
  };
}

/** Loading door: frame in the north wall, direction label, click opens the truck panel. */
export function Dock({ door, brand, label, onSelect }: { door: LayoutDoor; brand: THREE.Color; label: string | null; onSelect: (code: string) => void }) {
  const frame = useMemo(() => dockFrame(brand), [brand]);
  useEffect(() => () => disposeTree(frame), [frame]);
  return (
    <group position={[door.x, 0, door.y]}>
      <primitive object={frame} />
      {/* invisible click target over the door and the truck in front of it */}
      <mesh
        position={[0, 2.5, -7]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(door.code);
        }}
        onPointerOver={pointer(true)}
        onPointerOut={pointer(false)}
      >
        <boxGeometry args={[5, 5, 18]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 5.6, -2.2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }} className="hidden md:block">
        <div className="bg-surface/90 shadow-card rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap">
          {door.code}
          {label ? <span className="text-ink-muted font-normal"> · {label}</span> : null}
        </div>
      </Html>
    </group>
  );
}

/** Courier staging bay with a pile of parcels proportional to the count. */
export function StagingBay({ door, brand, parcels }: { door: LayoutDoor; brand: THREE.Color; parcels: number }) {
  const bay = useMemo(() => stagingBay(brand), [brand]);
  // rebuild the pile only when it visibly changes (one box per 25 parcels)
  const boxes = Math.min(18, Math.ceil(parcels / 25));
  const pile = useMemo(() => cardboardPile(boxes * 25), [boxes]);
  useEffect(() => () => disposeTree(bay), [bay]);
  useEffect(() => () => disposeTree(pile), [pile]);
  return (
    <group position={[door.x, 0, door.y]}>
      <primitive object={bay} />
      <primitive object={pile} />
    </group>
  );
}
