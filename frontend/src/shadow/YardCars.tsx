import { Clone, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { WithModel } from "./gltf";
import type { DepotLayout } from "./layout";
import { MODELS } from "./models";
import { carModel, disposeTree } from "./parts";
import { useShadowStore } from "./store";

const COLORS = [0x6b7f99, 0xb0473c, 0x3f6b4a, 0xc9c2b4, 0x2d2d2b, 0x8c6d9e];

function PrimitiveCar({ color }: { color: number }) {
  const model = useMemo(() => carModel(color), [color]);
  useEffect(() => () => disposeTree(model), [model]);
  return <primitive object={model} />;
}

function KitCar({ index }: { index: number }) {
  const spec = MODELS.cars[index % MODELS.cars.length] ?? MODELS.cars[0];
  const gltf = useGLTF(spec.url);
  // <Clone> shares geometry and materials of the loaded model
  return <Clone object={gltf.scene} scale={spec.scale} castShadow />;
}

/** Unexpected cars that entered through the yard gate (and have not left), parked by the gate. */
export function YardCars({ layout }: { layout: DepotLayout }) {
  const yard = useShadowStore((s) => s.yard);
  const gate = layout.layout.yardGate;
  if (!gate) return null;
  return (
    <>
      {yard.map((c, i) => (
        <group key={c.plate} position={[gate[0] - 8 - i * 3.4, 0, gate[1] + 6]}>
          <WithModel fallback={<PrimitiveCar color={COLORS[i % COLORS.length] ?? 0x6b7f99} />}>
            <KitCar index={i} />
          </WithModel>
        </group>
      ))}
    </>
  );
}
