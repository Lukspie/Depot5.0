import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

export interface ModelMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Geometry and material of the first mesh in a GLTF file, scaled to metres and standing on y = 0,
 * for instancing (<Instances>): one draw call for all copies, no clones (plan-doplnky 5c-4).
 */
export function useModelMesh(url: string, scale: number): ModelMesh {
  const gltf = useGLTF(url);
  return useMemo(() => {
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
    return { geometry, material: mesh.material as THREE.Material };
  }, [gltf, url, scale]);
}
