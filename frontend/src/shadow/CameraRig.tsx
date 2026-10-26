import { Bounds, OrbitControls, OrthographicCamera, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, type ReactNode } from "react";
import * as THREE from "three";

/** polar angle of an isometric view from [1, 1, -1] (doors and trucks face the viewer) */
const ISO = Math.atan(Math.SQRT2);
const MIN_ZOOM = 2;
const MAX_ZOOM = 40;

/** Camera buttons of the floating panel (+, −, rotate, home) and "focus on an object". */
export interface CameraApi {
  zoom(factor: number): void;
  rotate(radians: number): void;
  home(): void;
  focus(x: number, z: number): void;
}

interface Orbit {
  update(): void;
  getAzimuthalAngle(): number;
  setAzimuthalAngle(angle: number): void;
}

/** Hands the camera controls to the page (inside <Bounds>, so "home" and "focus" can fit). */
function CameraBridge({ onReady }: { onReady: (api: CameraApi) => void }) {
  const bounds = useBounds();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Orbit | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    onReady({
      zoom(factor) {
        camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
        camera.updateProjectionMatrix();
        invalidate();
      },
      rotate(radians) {
        if (!controls) return;
        controls.setAzimuthalAngle(controls.getAzimuthalAngle() + radians);
        controls.update();
        invalidate();
      },
      home() {
        bounds.refresh().fit();
      },
      focus(x, z) {
        bounds.refresh(new THREE.Box3(new THREE.Vector3(x - 16, 0, z - 22), new THREE.Vector3(x + 16, 8, z + 10))).fit();
      },
    });
  }, [bounds, camera, controls, invalidate, onReady]);
  return null;
}

/**
 * Isometric orthographic camera (zadanie §7): rotation only around the vertical axis, zoom with
 * limits, no panning or flipping. drei <Bounds> fits the whole depot into the view on load and
 * on resize.
 */
export function CameraRig({ children, onReady }: { children: ReactNode; onReady?: (api: CameraApi) => void }) {
  return (
    <>
      <OrthographicCamera makeDefault position={[70, 80, -90]} zoom={5} near={-500} far={2000} />
      <OrbitControls makeDefault enablePan={false} enableDamping={false} minPolarAngle={ISO} maxPolarAngle={ISO} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />
      <Bounds fit observe margin={1.2} maxDuration={0.6}>
        {children}
        {onReady && <CameraBridge onReady={onReady} />}
      </Bounds>
    </>
  );
}
