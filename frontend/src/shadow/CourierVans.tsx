import { Clone, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { WithModel } from "./gltf";
import { facingRotation, hallOf, type DepotLayout } from "./layout";
import { MODELS } from "./models";
import { box, disposeTree, mat } from "./parts";
import { useShadowStore } from "./store";

function Van() {
  const gltf = useGLTF(MODELS.van.url);
  return <Clone object={gltf.scene} scale={MODELS.van.scale} castShadow />;
}

/** The orange stripe along both sides of a courier van (maketa-tien: white vans, orange stripe). */
function Stripe() {
  return (
    <>
      {[-1.06, 1.06].map((x) => (
        <mesh key={x} position={[x, 1.05, 0]}>
          <boxGeometry args={[0.04, 0.32, 3.9]} />
          <meshStandardMaterial color="#f39200" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

function PrimitiveVan() {
  const model = useMemo(() => box(2, 2.4, 5.2, mat(0xf4f4f2), 0, 1.3, 0), []);
  useEffect(() => () => disposeTree(model), [model]);
  return <primitive object={model} />;
}

/**
 * Courier vans of the depot (ADR-041, phases 7b and 7c): parked on the yard's van parking
 * overnight and after the round, from 06:30 loading in front of their staging bay (KE-0N -> SB-0N),
 * until they leave. Places come from the layout, states from the telematics "vehicles" channel.
 * Depots without operations send their parked vans with the layout (`parked`, ADR-066).
 */
export function CourierVans({ layout }: { layout: DepotLayout }) {
  const vans = useShadowStore((s) => s.vans);
  const south = hallOf(layout).depth / 2;
  const bays = layout.doors.filter((d) => d.kind === "staging_bay");
  const yard = layout.layout.yard;
  return (
    <>
      {Object.values(vans).map((v) => {
        const bay = bays.find((d) => d.code === v.doorCode || d.directionCode === v.directionCode);
        if (!bay) return null; // a van of another depot
        const index = bays.indexOf(bay);
        const slot = v.status === "parked" ? yard?.vanParking[index] : yard?.vanLoading.find((s) => s.bay === bay.code);
        const [x, z, rot] = slot ? [slot.x, slot.y, facingRotation(slot.heading)] : [bay.x, south + 4, Math.PI];
        return (
          <group key={v.plate} position={[x, 0, z]} rotation-y={rot}>
            <WithModel fallback={<PrimitiveVan />}>
              <Van />
            </WithModel>
            <Stripe />
          </group>
        );
      })}
      {(layout.parked ?? []).map((v) => (
        // a depot without simulated operations (Dunajská Streda, Trenčín): its vans stand parked
        <group key={v.plate} position={[v.x, 0, v.y]} rotation-y={facingRotation(v.heading)}>
          <WithModel fallback={<PrimitiveVan />}>
            <Van />
          </WithModel>
          <Stripe />
        </group>
      ))}
    </>
  );
}
