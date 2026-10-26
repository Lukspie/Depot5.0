import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { DepotLayout } from "./layout";
import { disposeTree, hallShell, yardGate, yardGround } from "./parts";

/** Floor, walls, roof, pillars and the yard entrance (static). */
export function Hall({ layout, brand }: { layout: DepotLayout; brand: THREE.Color }) {
  const object = useMemo(() => {
    const g = new THREE.Group();
    g.add(hallShell(layout, brand));
    const gate = layout.layout.yardGate;
    if (gate) {
      const y = yardGate(brand);
      y.position.set(gate[0], 0, gate[1]);
      g.add(y);
    }
    return g;
  }, [layout, brand]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}

/** Yard asphalt: drawn outside <Bounds>, so the camera fits the hall and not the whole yard. */
export function YardGround({ layout }: { layout: DepotLayout }) {
  const object = useMemo(() => yardGround(layout), [layout]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}
