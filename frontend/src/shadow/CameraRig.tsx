import { Bounds, OrbitControls, OrthographicCamera, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, type ReactNode } from "react";
import * as THREE from "three";

/** camera from the yard side (doors and trucks face the viewer), ~38° above the ground */
const POSITION: [number, number, number] = [40, 85, -100];
const POLAR = Math.atan2(Math.hypot(POSITION[0], POSITION[2]), POSITION[1]);
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
function CameraBridge({ onReady, homeBox }: { onReady: (api: CameraApi) => void; homeBox?: THREE.Box3 }) {
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
        bounds.refresh(homeBox).fit();
      },
      focus(x, z) {
        bounds.refresh(new THREE.Box3(new THREE.Vector3(x - 16, 0, z - 22), new THREE.Vector3(x + 16, 8, z + 10))).fit();
      },
    });
  }, [bounds, camera, controls, invalidate, onReady, homeBox]);
  // the first view is the facade with the doors (reference), not the whole yard
  useEffect(() => {
    if (homeBox) bounds.refresh(homeBox).fit();
  }, [bounds, homeBox]);
  return null;
}

/**
 * Isometric orthographic camera (zadanie §7): rotation only around the vertical axis, zoom with
 * limits, no panning or flipping. drei <Bounds> fits the whole depot into the view on load and
 * on resize.
 */
export function CameraRig({ children, onReady, homeBox }: { children: ReactNode; onReady?: (api: CameraApi) => void; homeBox?: THREE.Box3 }) {
  return (
    <>
      <OrthographicCamera makeDefault position={POSITION} zoom={5} near={-500} far={2000} />
      <OrbitControls makeDefault enablePan={false} enableDamping={false} minPolarAngle={POLAR} maxPolarAngle={POLAR} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />
      <Bounds fit observe margin={1.1} maxDuration={0.6}>
        {children}
        {onReady && <CameraBridge onReady={onReady} homeBox={homeBox} />}
      </Bounds>
    </>
  );
}
