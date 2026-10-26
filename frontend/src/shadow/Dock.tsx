import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { hallOf, type DepotLayout, type LayoutDoor } from "./layout";
import { cardboardPile, disposeTree, dockFrame, doorLeaf, numberPlate, OPENING_H, stagingBay } from "./parts";

/**
 * Loading door in the facade: frame, number plate above it, sectional door (open while a truck is
 * at the door, with parcels in the opening). The label shows only on hover or selection.
 */
export function Dock({
  door,
  layout,
  brand,
  label,
  open,
  selected,
  onSelect,
}: {
  door: LayoutDoor;
  layout: DepotLayout;
  brand: THREE.Color;
  label: string | null;
  open: boolean;
  selected: boolean;
  onSelect: (code: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const frame = useMemo(() => dockFrame(brand), [brand]);
  const plate = useMemo(() => numberPlate(door.code.replace(/^\D+-?0?/, ""), brand), [door.code, brand]);
  const leaf = useMemo(() => doorLeaf(open), [open]);
  const pile = useMemo(() => (open ? cardboardPile(60) : null), [open]);
  useEffect(() => () => disposeTree(frame), [frame]);
  useEffect(() => () => disposeTree(plate), [plate]);
  useEffect(() => () => disposeTree(leaf), [leaf]);
  useEffect(() => () => (pile ? disposeTree(pile) : undefined), [pile]);
  const facadeZ = -hallOf(layout).depth / 2;
  const pointer = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(on);
    document.body.style.cursor = on ? "pointer" : "";
  };
  return (
    <group position={[door.x, 0, facadeZ]}>
      <primitive object={frame} />
      <primitive object={leaf} />
      {/* parcels at the threshold, beside the trailer, so they are visible from the yard */}
      {pile && <primitive object={pile} position={[1.55, 0.3, -0.2]} scale={0.45} />}
      <primitive object={plate} position={[0, OPENING_H + 1.4, -0.3]} />
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
      {(hover || selected) && (
        <Html position={[0, OPENING_H + 2.4, -0.5]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div className="bg-surface shadow-card rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap">
            {door.code}
            {label ? <span className="text-ink-muted font-normal"> · {label}</span> : null}
          </div>
        </Html>
      )}
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
