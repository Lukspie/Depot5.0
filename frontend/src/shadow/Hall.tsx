import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { DepotLayout } from "./layout";
import { disposeTree, hallRoof, hallShell, placedYardGate, yardGround } from "./parts";

/** Floor, walls with the door openings, the roof (unless revealed) and the yard entrance. */
export function Hall({ layout, brand, roofOpen }: { layout: DepotLayout; brand: THREE.Color; roofOpen: boolean }) {
  const object = useMemo(() => {
    const g = new THREE.Group();
    g.add(hallShell(layout, brand));
    const gate = placedYardGate(layout, brand);
    if (gate) g.add(gate);
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
  const object = useMemo(() => yardGround(layout), [layout]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}
