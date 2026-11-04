import { Bounds, OrbitControls, OrthographicCamera, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
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
  target: THREE.Vector3;
  update(): void;
  getAzimuthalAngle(): number;
  setAzimuthalAngle(angle: number): void;
}

/** Hands the camera controls to the page (focus, home, zoom, rotate). */
function CameraBridge({ onReady, homeBox }: { onReady: (api: CameraApi) => void; homeBox?: THREE.Box3 }) {
  const bounds = useBounds();
  const get = useThree((s) => s.get);
  const homed = useRef(false);
  useEffect(() => {
    /** look at the box: orbit target to its centre, zoom so that it fills the view (no animation) */
    const view = (box?: THREE.Box3) => {
      if (!box) {
        bounds.refresh().fit();
        return;
      }
      const { camera, controls, invalidate } = get();
      const orbit = controls as unknown as Orbit | null;
      const ortho = camera as THREE.OrthographicCamera;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      if (orbit) {
        const offset = camera.position.clone().sub(orbit.target);
        orbit.target.copy(center);
        camera.position.copy(center).add(offset);
      }
      const extent = Math.max(size.x, size.z) * 1.15;
      const zoom = Math.min((ortho.right - ortho.left) / extent, (ortho.top - ortho.bottom) / (extent * 0.6));
      ortho.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      ortho.updateProjectionMatrix();
      orbit?.update();
      invalidate();
    };
    onReady({
      zoom(factor) {
        const { camera, invalidate } = get();
        camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
        camera.updateProjectionMatrix();
        invalidate();
      },
      rotate(radians) {
        const { controls, invalidate } = get();
        const orbit = controls as unknown as Orbit | null;
        if (!orbit) return;
        orbit.setAzimuthalAngle(orbit.getAzimuthalAngle() + radians);
        orbit.update();
        invalidate();
      },
      home() {
        view(homeBox);
      },
      focus(x, z) {
        // the detail panel covers the right part of the view: extend the box to the screen right,
        // so the object ends up left of the panel
        const right = new THREE.Vector3().setFromMatrixColumn(get().camera.matrixWorld, 0).setY(0).normalize().multiplyScalar(14);
        const box = new THREE.Box3(new THREE.Vector3(x - 14, 0, z - 20), new THREE.Vector3(x + 14, 8, z + 8));
        box.union(box.clone().translate(right));
        view(box);
      },
    });
    // the first view is the facade with the doors (reference), not the whole yard; only once
    if (homeBox && !homed.current) {
      // after the initial fit of <Bounds>; cancelled when the scene goes away (or re-planned)
      const t = window.setTimeout(() => {
        homed.current = true;
        view(homeBox);
      }, 300);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [bounds, get, onReady, homeBox]);
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
