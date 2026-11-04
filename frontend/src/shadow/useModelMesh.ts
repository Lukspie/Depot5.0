import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export interface ModelMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** One prepared geometry per model and scale, shared by every pile and the belt (never disposed: a few kB each). */
const cache = new Map<string, ModelMesh>();

/**
 * Geometry and material of the first mesh in a GLTF file, scaled to metres and standing on y = 0,
 * for instancing (<Instances>): one draw call for all copies, no clones (plan-doplnky 5c-4).
 */
export function useModelMesh(url: string, scale: number): ModelMesh {
  const gltf = useGLTF(url);
  const key = `${url}@${String(scale)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let found: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!found && o instanceof THREE.Mesh) found = o;
  });
  const mesh = found as THREE.Mesh | null;
  if (!mesh) throw new Error(`no mesh in ${url}`);
  const geometry = mesh.geometry.clone();
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const out = { geometry, material: mesh.material as THREE.Material };
  cache.set(key, out);
  return out;
}
