import { Bounds, OrbitControls, OrthographicCamera, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";

/**
 * Isometric camera from the yard side (maketa-tien): 45° to the facade with the doors, so the
 * facade runs diagonally through the view, ~40° above the ground.
 */
const POSITION: [number, number, number] = [-72, 88, -72];
const POLAR = Math.atan2(Math.hypot(POSITION[0], POSITION[2]), POSITION[1]);
const MIN_ZOOM = 2;
/** the home view keeps some room round the doors: the diagonal view projects them longer */
const HOME_MARGIN = 1.05;
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
function CameraBridge({ onReady, homeBox, homeTurn = 0 }: { onReady: (api: CameraApi) => void; homeBox?: THREE.Box3; homeTurn?: number }) {
  const bounds = useBounds();
  const get = useThree((s) => s.get);
  const homed = useRef(false);
  // zoom of the home view: a focus never zooms out beyond it (the first fit shows the whole yard)
  const homeZoom = useRef<number | null>(null);
  // azimuth of the default camera (it looks at doors on the north wall); turned by homeTurn
  const baseAzimuth = useRef<number | null>(null);
  useEffect(() => {
    /** look at the box: orbit target to its centre, zoom so that it fills the view (no animation) */
    const view = (box?: THREE.Box3, margin = 1.15) => {
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
      const extent = Math.max(size.x, size.z) * margin;
      const zoom = Math.min((ortho.right - ortho.left) / extent, (ortho.top - ortho.bottom) / (extent * 0.6));
      ortho.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      if (margin === HOME_MARGIN) homeZoom.current = ortho.zoom;
      ortho.updateProjectionMatrix();
      orbit?.update();
      invalidate();
    };
    /**
     * The home box widened to the screen right and down: the panels on the right (detail, list)
     * and the KPI row on top cover part of the view, so the doors end up in the free part.
     */
    const shifted = (box: THREE.Box3): THREE.Box3 => {
      const size = box.getSize(new THREE.Vector3());
      const camera = get().camera;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      const k = Math.max(size.x, size.z);
      return box.clone().union(box.clone().translate(right.multiplyScalar(k * 0.22)));
    };
    /** turn the camera to the wall with the ramps (phase 7c: they are not always on the north) */
    const turnHome = () => {
      const orbit = get().controls as unknown as Orbit | null;
      if (!orbit) return;
      baseAzimuth.current ??= orbit.getAzimuthalAngle();
      orbit.setAzimuthalAngle(baseAzimuth.current + homeTurn);
      orbit.update();
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
        turnHome();
        view(homeBox && shifted(homeBox), HOME_MARGIN);
      },
      focus(x, z) {
        // move the view to the object and keep the zoom (maketa-tien: the overview stays); the
        // panels on the right cover part of the screen, so the object goes a bit left of centre
        const { camera, controls, invalidate } = get();
        const orbit = controls as unknown as Orbit | null;
        if (!orbit) return;
        const ortho = camera as THREE.OrthographicCamera;
        if (homeZoom.current !== null && ortho.zoom < homeZoom.current) {
          ortho.zoom = homeZoom.current;
          ortho.updateProjectionMatrix();
        }
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
        const shift = ((ortho.right - ortho.left) / ortho.zoom) * 0.14;
        const target = new THREE.Vector3(x, 0, z).add(right.multiplyScalar(shift));
        const offset = camera.position.clone().sub(orbit.target);
        orbit.target.copy(target);
        camera.position.copy(target).add(offset);
        orbit.update();
        invalidate();
      },
    });
    // the first view is the facade with the doors (reference), not the whole yard; only once
    if (homeBox && !homed.current) {
      // after the initial fit of <Bounds>; cancelled when the scene goes away (or re-planned)
      const t = window.setTimeout(() => {
        homed.current = true;
        turnHome();
        view(shifted(homeBox), HOME_MARGIN);
        // after the fit animation of <Bounds> (maxDuration 0.6 s), which would turn the camera back
      }, 800);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [bounds, get, onReady, homeBox, homeTurn]);
  return null;
}

/**
 * Isometric orthographic camera (zadanie §7): rotation only around the vertical axis, zoom with
 * limits, no panning or flipping. drei <Bounds> fits the whole depot into the view on load and
 * on resize.
 */
export function CameraRig({
  children,
  onReady,
  homeBox,
  homeTurn,
}: {
  children: ReactNode;
  onReady?: (api: CameraApi) => void;
  homeBox?: THREE.Box3;
  homeTurn?: number;
}) {
  return (
    <>
      <OrthographicCamera makeDefault position={POSITION} zoom={5} near={-500} far={2000} />
      <OrbitControls makeDefault enablePan={false} enableDamping={false} minPolarAngle={POLAR} maxPolarAngle={POLAR} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />
      <Bounds fit observe margin={1.1} maxDuration={0.6}>
        {children}
        {onReady && <CameraBridge onReady={onReady} homeBox={homeBox} homeTurn={homeTurn} />}
      </Bounds>
    </>
  );
}
