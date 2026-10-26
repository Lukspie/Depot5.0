import { useEffect, useMemo } from "react";
import type { DepotLayout } from "./layout";
import { carModel, disposeTree } from "./parts";
import { useShadowStore } from "./store";

function Car({ x, z, color }: { x: number; z: number; color: number }) {
  const model = useMemo(() => carModel(color), [color]);
  useEffect(() => () => disposeTree(model), [model]);
  return <primitive object={model} position={[x, 0, z]} />;
}

const COLORS = [0x6b7f99, 0xb0473c, 0x3f6b4a, 0xc9c2b4, 0x2d2d2b, 0x8c6d9e];

/** Unexpected cars that entered through the yard gate (and have not left), parked by the gate. */
export function YardCars({ layout }: { layout: DepotLayout }) {
  const yard = useShadowStore((s) => s.yard);
  const gate = layout.layout.yardGate;
  if (!gate) return null;
  return (
    <>
      {yard.map((c, i) => (
        <Car key={c.plate} x={gate[0] - 8 - i * 3.2} z={gate[1] + 6} color={COLORS[i % COLORS.length] ?? 0x6b7f99} />
      ))}
    </>
  );
}
