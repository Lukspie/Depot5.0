import { Clone, useGLTF } from "@react-three/drei";
import { WithModel } from "./gltf";
import { hallOf, type DepotLayout } from "./layout";
import { MODELS } from "./models";
import { box, mat } from "./parts";
import { useShadowStore } from "./store";

function Van() {
  const gltf = useGLTF(MODELS.van.url);
  return <Clone object={gltf.scene} scale={MODELS.van.scale} />;
}

const FALLBACK = box(2, 2.4, 5.2, mat(0xf4f4f2), 0, 1.3, 0);

/**
 * Courier vans being loaded (morning, ADR-041) stand outside the south wall behind their staging
 * bay (KE-0N -> SB-0N). Positions come from the telematics "vehicles" channel, not from the plan.
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
            <WithModel fallback={<primitive object={FALLBACK.clone()} />}>
              <Van />
            </WithModel>
          </group>
        );
      })}
    </>
  );
}
