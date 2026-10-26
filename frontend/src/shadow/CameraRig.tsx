import { Bounds, OrbitControls, OrthographicCamera } from "@react-three/drei";
import type { ReactNode } from "react";

/** polar angle of an isometric view from [1, 1, -1] (doors and trucks face the viewer) */
const ISO = Math.atan(Math.SQRT2);

/**
 * Isometric orthographic camera (zadanie §7): rotation only around the vertical axis, zoom with
 * limits, no panning or flipping. drei <Bounds> fits the whole depot into the view on load and
 * on resize.
 */
export function CameraRig({ children }: { children: ReactNode }) {
  return (
    <>
      <OrthographicCamera makeDefault position={[70, 80, -90]} zoom={5} near={-500} far={2000} />
      <OrbitControls makeDefault enablePan={false} enableDamping={false} minPolarAngle={ISO} maxPolarAngle={ISO} minZoom={2} maxZoom={40} />
      <Bounds fit observe margin={1.2} maxDuration={0.6}>
        {children}
      </Bounds>
    </>
  );
}
