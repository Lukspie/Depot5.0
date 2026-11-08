import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { facingOf, facingRotation, hallOf, inFront, type DepotLayout } from "./layout";
import { disposeTree, facadeSign, hallRoof, hallShell, OPENING_H, placedYardGate, yardGround } from "./parts";

/**
 * The sign "Depot 5.0 · <DEPOT>" above the doors of the facade with most ramps (maketa-tien), next
 * to the first doors, between the door plates and the parapet.
 */
function placedSign(layout: DepotLayout, brand: THREE.Color): THREE.Object3D | null {
  const docks = layout.doors.filter((d) => d.kind === "loading_dock");
  if (docks.length === 0) return null;
  const count = new Map<number, number>();
  for (const d of docks) count.set(facingOf(layout, d), (count.get(facingOf(layout, d)) ?? 0) + 1);
  const heading = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const wall = docks.filter((d) => facingOf(layout, d) === heading);
  const first = wall.slice(-Math.min(3, wall.length));
  const x = first.reduce((s, d) => s + d.x, 0) / first.length;
  const y = first.reduce((s, d) => s + d.y, 0) / first.length;
  const [sx, sz] = inFront(layout, { ...first[0]!, x, y }, 0.45);
  const { height: h } = hallOf(layout);
  const sign = facadeSign(layout.depot.name, brand);
  const holder = new THREE.Group();
  holder.add(sign);
  // between the plates over the doors (OPENING_H + 1.4) and the parapet (h - 0.9)
  sign.position.set(0, Math.max(OPENING_H + 3.3, h - 2.6), 0);
  holder.position.set(sx, 0, sz);
  holder.rotation.y = facingRotation(heading);
  return holder;
}

/** Floor, walls with the door openings, the roof (unless revealed) and the yard entrance. */
export function Hall({ layout, brand, roofOpen }: { layout: DepotLayout; brand: THREE.Color; roofOpen: boolean }) {
  const object = useMemo(() => {
    const g = new THREE.Group();
    g.add(hallShell(layout, brand));
    const gate = placedYardGate(layout, brand);
    if (gate) g.add(gate);
    const sign = placedSign(layout, brand);
    if (sign) g.add(sign);
    return g;
  }, [layout, brand]);
  const roof = useMemo(() => hallRoof(layout, brand), [layout, brand]);
  useEffect(() => () => disposeTree(object), [object]);
  useEffect(() => () => disposeTree(roof), [roof]);
  return (
    <>
      <primitive object={object} />
      <primitive object={roof} visible={!roofOpen} />
    </>
  );
}

/** Yard asphalt with stalls and lanes: drawn outside <Bounds>, so the camera fits the hall. */
export function YardGround({ layout }: { layout: DepotLayout }) {
  const object = useMemo(() => yardGround(layout, true), [layout]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}
