/**
 * 3D model of a depot/hub built from the same layout as /shadow (GET /api/layout), rendered inside
 * MapLibre as a custom WebGL layer with Three.js (ADR-040). The parts (hall, belt, doors, trucks,
 * piles, pins) are shared with the digital shadow (src/shadow/parts.ts, ADR-049).
 *
 * Zoomed out, only a big stylised warehouse marker is drawn (constant size on screen).
 */

import * as maplibregl from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";
import { devicePosition, facingOf, facingRotation, type DepotLayout, type DeviceStatus } from "../../shadow/layout";
import { cardboardPile, cssColor, hallStatic, pinModel, TRUCK_COLOR, truckModel, warehouseMarker } from "../../shadow/parts";

export type { DepotLayout, LayoutDoor } from "../../shadow/layout";

export interface DepotLive {
  /** trucks standing at doors (depot) */
  occupied: { doorCode: string; plate: string; status: string; directionType: string }[];
  /** parcels waiting on courier staging bays */
  staged: { doorCode: string; parcels: number }[];
  /** trucks at the hub */
  trucksAtHub: number;
  /** IoT devices: status per door / line / gate */
  devices: { code: string; kind: string; doorCode: string | null; status: DeviceStatus }[];
}

/** Below this zoom only the warehouse marker is drawn. */
export const DETAIL_ZOOM = 15;
const MARKER_PX = 54;

function at<T extends THREE.Object3D>(o: T, x: number, z: number): T {
  o.position.set(x, 0, z);
  return o;
}

export interface DepotLayerHandle {
  layer: CustomLayerInterface;
  update(live: DepotLive): void;
}

export function createDepotLayer(id: string, layout: DepotLayout): DepotLayerHandle {
  // the hall is drawn around its centre; the depot's lat/lon is its routing point (ADR-064)
  const [lat, lon] = layout.layout.origin ?? [layout.depot.lat, layout.depot.lon];
  const origin = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  const rotation = ((layout.layout.hall?.rotationDeg ?? 0) * Math.PI) / 180;
  const modelMatrix = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationY(-rotation));

  let map: MapLibreMap | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  const detail = new THREE.Group();
  const live = new THREE.Group();
  const marker = new THREE.Group();
  let pending: DepotLive | null = null;

  function rebuildLive(state: DepotLive): void {
    live.clear();
    const doors = new Map(layout.doors.map((d) => [d.code, d]));
    if (layout.depot.kind === "depot") {
      for (const o of state.occupied) {
        const d = doors.get(o.doorCode);
        if (d) {
          const truck = at(truckModel(TRUCK_COLOR[o.directionType] ?? 0x8a8a86), d.x, d.y);
          truck.rotation.y = facingRotation(facingOf(layout, d));
          live.add(truck);
        }
      }
      for (const s of state.staged) {
        const d = doors.get(s.doorCode);
        if (d && s.parcels > 0) live.add(at(cardboardPile(s.parcels), d.x, d.y));
      }
      for (const dev of state.devices) {
        const p = devicePosition(layout, dev);
        if (p) live.add(at(pinModel(dev.status, dev.kind === "dock_scanner" ? 6.5 : 5), p[0], p[1]));
      }
    }
    // trucks of other depots' directions that end here (hub, Žilina): free ramps from the left
    const busy = new Set(state.occupied.map((o) => o.doorCode));
    const free = layout.doors.filter((d) => d.kind === "loading_dock" && !busy.has(d.code));
    free.slice(0, state.trucksAtHub).forEach((r) => {
      const truck = at(truckModel(TRUCK_COLOR.linehaul ?? 0), r.x, r.y);
      truck.rotation.y = facingRotation(facingOf(layout, r));
      live.add(truck);
    });
    map?.triggerRepaint();
  }

  const layer: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      map = m;
      const brand = cssColor("--color-brand-500", "#f39200");
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dde3, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-60, 120, -40);
      scene.add(sun);
      detail.add(hallStatic(layout, brand), live);
      marker.add(warehouseMarker(brand));
      scene.add(detail, marker);
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      if (pending) rebuildLive(pending);
    },
    render(_gl, options) {
      if (!map || !renderer) return;
      const zoom = map.getZoom();
      const zoomedIn = zoom >= DETAIL_ZOOM;
      detail.visible = zoomedIn;
      marker.visible = !zoomedIn;
      if (!zoomedIn) {
        // keep the marker about MARKER_PX wide on screen
        const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
        const s = Math.max(1, (MARKER_PX * metersPerPixel) / 64);
        marker.scale.setScalar(s);
      }
      const projection = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]);
      camera.projectionMatrix = projection.multiply(modelMatrix);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      renderer?.dispose();
      renderer = null;
      map = null;
    },
  };

  return {
    layer,
    update(state) {
      pending = state;
      if (renderer) rebuildLive(state);
    },
  };
}
