import { Gltf } from "@react-three/drei";

/** A GLTF model from MODEL_URLS; loaded lazily so the loader is not in the bundle by default. */
export default function GltfModel({ src }: { src: string }) {
  return <Gltf src={src} castShadow />;
}
