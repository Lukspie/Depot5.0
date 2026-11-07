import { Clone, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { WithModel } from "./gltf";
import { hallOf, type DepotLayout } from "./layout";
import { MODELS } from "./models";
import { box, disposeTree, mat } from "./parts";
import { useShadowStore } from "./store";

function Van() {
  const gltf = useGLTF(MODELS.van.url);
  return <Clone object={gltf.scene} scale={MODELS.van.scale} castShadow />;
}

function PrimitiveVan() {
  const model = useMemo(() => box(2, 2.4, 5.2, mat(0xf4f4f2), 0, 1.3, 0), []);
  useEffect(() => () => disposeTree(model), [model]);
  return <primitive object={model} />;
}

/**
 * Courier vans parked in the yard and being loaded (from 06:30, ADR-041, phase 7b) stand outside
 * the south wall behind their staging bay (KE-0N -> SB-0N) until they leave. Positions come from
 * the telematics "vehicles" channel, not from the plan.
 */
export function CourierVans({ layout }: { layout: DepotLayout }) {
  const vans = useShadowStore((s) => s.vans);
  const south = hallOf(layout).depth / 2;
  return (
    <>
      {Object.values(vans).map((v) => {
        const bay = layout.doors.find((d) => d.kind === "staging_bay" && (d.code === v.doorCode || d.directionCode === v.directionCode));
        if (!bay) return null;
        return (
          <group key={v.plate} position={[bay.x, 0, south + 4]} rotation-y={Math.PI}>
            <WithModel fallback={<PrimitiveVan />}>
              <Van />
            </WithModel>
          </group>
        );
      })}
    </>
  );
}
