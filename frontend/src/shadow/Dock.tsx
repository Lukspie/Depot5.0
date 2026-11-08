import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import { facingOf, facingRotation, type DepotLayout, type LayoutDoor } from "./layout";
import type { DoorState } from "./layout";
import { BoxPile } from "./BoxPile";
import { disposeTree, dockFrame, dockLeveler, doorLeaf, doorUnknown, numberPlate, OPENING_H, stagingBay, telescopicConveyor } from "./parts";

/**
 * Loading door in the facade: frame, number plate, sectional door and its equipment (dock leveler
 * or telescopic conveyor, ADR-050). Open / closed comes only from the door contact sensor; with a
 * sensor fault the door is drawn neutral with a "senzor – porucha" tag (no guessing from trucks).
 * The label shows only on hover or selection.
 */
export function Dock({
  door,
  layout,
  brand,
  label,
  state,
  selected,
  onSelect,
}: {
  door: LayoutDoor;
  layout: DepotLayout;
  brand: THREE.Color;
  label: string | null;
  state: DoorState | undefined;
  selected: boolean;
  onSelect: (code: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const frame = useMemo(() => dockFrame(brand), [brand]);
  // "02 BA": the door number and the direction loading there (maketa-tien)
  const plate = useMemo(() => numberPlate(`${door.code.replace(/^\D+-?/, "")}${label ? ` ${label}` : ""}`, brand), [door.code, label, brand]);
  const open = state === "open";
  const fault = state === "fault";
  // no valid reading (no sensor, switched off, not received yet): neutral, never a guess
  const neutral = state !== "open" && state !== "closed";
  const leaf = useMemo(() => (neutral ? doorUnknown() : doorLeaf(open)), [open, neutral]);
  const equipment = useMemo(
    () => (door.dockEquipment === "dock_leveler" ? dockLeveler(open) : door.dockEquipment === "telescopic_conveyor" ? telescopicConveyor(open) : null),
    [door.dockEquipment, open],
  );
  useEffect(() => () => (equipment ? disposeTree(equipment) : undefined), [equipment]);
  useEffect(() => () => disposeTree(frame), [frame]);
  useEffect(() => () => disposeTree(plate), [plate]);
  useEffect(() => () => disposeTree(leaf), [leaf]);
  const pointer = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(on);
    document.body.style.cursor = on ? "pointer" : "";
  };
  return (
    <group position={[door.x, 0, door.y]} rotation-y={facingRotation(facingOf(layout, door))}>
      <primitive object={frame} />
      <primitive object={leaf} />
      {/* parcels at the threshold, beside the trailer, so they are visible from the yard */}
      {open && (
        <group position={[1.55, 0.3, -0.2]} scale={0.45}>
          <BoxPile parcels={60} />
        </group>
      )}
      {equipment && <primitive object={equipment} />}
      {(fault || state === "unknown") && (
        <Html position={[0, OPENING_H / 2, -0.6]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <div className="bg-warn-100 text-warn-700 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap shadow">{fault ? "senzor – porucha" : "senzor – bez údajov"}</div>
        </Html>
      )}
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
  useEffect(() => () => disposeTree(bay), [bay]);
  return (
    <group position={[door.x, 0, door.y]}>
      <primitive object={bay} />
      <BoxPile parcels={parcels} />
    </group>
  );
}
