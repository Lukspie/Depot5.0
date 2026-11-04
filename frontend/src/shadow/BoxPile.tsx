import { Instance, Instances } from "@react-three/drei";
import { useMemo } from "react";
import { WithModel } from "./gltf";
import { useModelMesh, type ModelMesh } from "./useModelMesh";
import { MODELS } from "./models";

const MAX_BOXES = 18;

/** Box slots of a pile (3 x 2 per level), the same arrangement as parts.cardboardPile. */
function slots(count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3) % 2;
    const level = Math.floor(i / 6);
    return [-1.6 + col * 1.6, 0.3 + level * 0.7, -0.7 + row * 1.3];
  });
}

function Pile({ boxes, limit, mesh }: { boxes: number; limit: number; mesh: ModelMesh | null }) {
  const at = useMemo(() => slots(boxes), [boxes]);
  if (boxes === 0) return null;
  return (
    <Instances limit={limit} castShadow receiveShadow geometry={mesh?.geometry} material={mesh?.material}>
      {!mesh && <boxGeometry args={[1.4, 0.65, 1.1]} />}
      {!mesh && <meshStandardMaterial color="#d9a066" roughness={0.85} />}
      {at.map((p, i) => (
        <Instance key={i} position={p} rotation-y={(i % 4) * 0.08} />
      ))}
    </Instances>
  );
}

function PileWithModel({ boxes, limit }: { boxes: number; limit: number }) {
  const mesh = useModelMesh(MODELS.pileBox.url, MODELS.pileBox.scale);
  return <Pile boxes={boxes} limit={limit} mesh={mesh} />;
}

/**
 * A pile of parcels proportional to `parcels` (one box per 25). The boxes are instances of the
 * Factory Kit box geometry (one draw call per pile, no clones), primitives as a fallback.
 */
export function BoxPile({ parcels, max = MAX_BOXES }: { parcels: number; max?: number }) {
  const boxes = Math.min(max, Math.ceil(parcels / 25));
  return (
    <WithModel fallback={<Pile boxes={boxes} limit={max} mesh={null} />}>
      <PileWithModel boxes={boxes} limit={max} />
    </WithModel>
  );
}
