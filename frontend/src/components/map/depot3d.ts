/**
 * 3D model of a depot/hub built from the same layout as /shadow (GET /api/layout), rendered inside
 * MapLibre as a custom WebGL layer with Three.js (ADR-040).
 *
 * Model space: metres, x = east, y = up, z = south (layout y). Low-poly primitives in the style of
 * docs/design/reference.png: light floor, white low walls, transparent roof, dark belt, coloured
 * doors, trucks at occupied doors, cardboard piles on staging bays, IoT pins coloured by status.
 * Zoomed out, only a big stylised warehouse marker is drawn (constant size on screen).
 */

import * as maplibregl from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import * as THREE from "three";

export interface LayoutDoor {
  code: string;
  kind: "loading_dock" | "staging_bay" | "yard_gate";
  x: number;
  y: number;
  directionCode: string | null;
  directionName: string | null;
}

export interface DepotLayout {
  depot: { code: string; name: string; kind: "depot" | "hub"; lat: number; lon: number };
  layout: {
    hall?: { width: number; depth: number; height: number; rotationDeg?: number };
    belt?: [number, number][];
    lineScanner?: [number, number];
    yardGate?: [number, number];
  };
  doors: LayoutDoor[];
}

export interface DepotLive {
  /** trucks standing at doors (depot) */
  occupied: { doorCode: string; plate: string; status: string; directionType: string }[];
  /** parcels waiting on courier staging bays */
  staged: { doorCode: string; parcels: number }[];
  /** trucks at the hub */
  trucksAtHub: number;
  /** IoT devices: status per door / line / gate */
  devices: { code: string; kind: string; doorCode: string | null; status: "online" | "degraded" | "offline" }[];
}

/** Below this zoom only the warehouse marker is drawn. */
export const DETAIL_ZOOM = 15;
const MARKER_PX = 54;

function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...extra });

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

const STATUS_COLOR = { online: 0x23874f, degraded: 0xd99a1e, offline: 0xc93434 } as const;
const TRUCK_COLOR: Record<string, number> = { linehaul: 0x2f5be9, transit: 0x23874f, local: 0x8a8a86 };

/** Truck (cab + trailer) backed into a door on the north wall, pointing north. */
function truck(cabColor: THREE.ColorRepresentation, x: number, wallZ: number): THREE.Group {
  const g = new THREE.Group();
  const trailer = mat(0xf7f7f5);
  g.add(box(2.6, 3.7, 13.6, trailer, x, 2.25, wallZ - 7.4));
  g.add(box(2.6, 0.5, 13.6, mat(0x5b5b58), x, 0.25, wallZ - 7.4));
  g.add(box(2.5, 3.0, 2.4, mat(cabColor), x, 1.9, wallZ - 15.6));
  g.add(box(2.3, 0.9, 0.1, mat(0x1d1d1b), x, 2.6, wallZ - 16.85)); // windscreen
  return g;
}

function cardboard(n: number, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const a = mat(0xd9a066);
  const b = mat(0xc28b52);
  const count = Math.min(18, Math.ceil(n / 25));
  for (let i = 0; i < count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3) % 2;
    const level = Math.floor(i / 6);
    g.add(box(1.4, 1.0, 1.1, i % 2 ? a : b, x - 1.6 + col * 1.6, 0.8 + level * 1.05, z - 0.7 + row * 1.3));
  }
  return g;
}

function pin(status: keyof typeof STATUS_COLOR, x: number, z: number, height: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.15, height, 0.15, mat(0x9c9c97), x, height / 2, z));
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 16, 12),
    mat(STATUS_COLOR[status], { emissive: STATUS_COLOR[status], emissiveIntensity: 0.35 }),
  );
  head.position.set(x, height + 0.9, z);
  g.add(head);
  return g;
}

/** Static hall: floor, low walls, transparent roof, belt with branches, doors, yard gate. */
function buildHall(l: DepotLayout, brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const hall = l.layout.hall ?? { width: 60, depth: 30, height: 9 };
  const { width: w, depth: d, height: h } = hall;
  const wallH = Math.min(6, h * 0.6);
  const white = mat(0xffffff);
  g.add(box(w * 1.6, 0.1, d * 3.2, mat(0xdfe2e6), 0, 0.05, -d * 0.55)); // yard asphalt
  g.add(box(w + 2, 0.3, d + 2, mat(0xeceae5), 0, 0.2, 0)); // hall floor
  g.add(box(w, wallH, 0.5, white, 0, wallH / 2, -d / 2));
  g.add(box(w, wallH, 0.5, white, 0, wallH / 2, d / 2));
  g.add(box(0.5, wallH, d, white, -w / 2, wallH / 2, 0));
  g.add(box(0.5, wallH, d, white, w / 2, wallH / 2, 0));
  // brand-coloured roof edge and a see-through roof
  g.add(box(w + 0.6, 0.35, 0.7, mat(brand), 0, h, -d / 2));
  g.add(box(w + 0.6, 0.35, 0.7, mat(brand), 0, h, d / 2));
  g.add(box(w, 0.15, d, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }), 0, h, 0));
  for (const x of [-w / 2, -w / 4, 0, w / 4, w / 2]) {
    for (const z of [-d / 2, d / 2]) g.add(box(0.5, h, 0.5, white, x, h / 2, z)); // pillars
  }

  const belt = l.layout.belt ?? [];
  const beltMat = mat(0x4f4f4c);
  const topMat = mat(0x8a8a86);
  for (let i = 1; i < belt.length; i++) {
    const [x1, z1] = belt[i - 1] as [number, number];
    const [x2, z2] = belt[i] as [number, number];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const seg = box(len, 0.9, 1.8, beltMat, (x1 + x2) / 2, 0.75, (z1 + z2) / 2);
    seg.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    g.add(seg);
    const top = box(len, 0.08, 1.4, topMat, (x1 + x2) / 2, 1.24, (z1 + z2) / 2);
    top.rotation.y = seg.rotation.y;
    g.add(top);
  }
  const beltZ = belt[0]?.[1] ?? 0;
  for (const door of l.doors) {
    if (door.kind === "loading_dock") {
      // branch conveyor from the main belt to the door
      const len = Math.abs(door.y - beltZ) - 2;
      if (belt.length > 1 && len > 0) g.add(box(1.2, 0.7, len, beltMat, door.x, 0.65, (door.y + beltZ) / 2));
      g.add(box(4.6, 0.5, 0.8, mat(brand), door.x, 4.6, door.y)); // frame
      g.add(box(0.5, 4.6, 0.8, mat(brand), door.x - 2.3, 2.3, door.y));
      g.add(box(0.5, 4.6, 0.8, mat(brand), door.x + 2.3, 2.3, door.y));
      g.add(box(4.1, 4.3, 0.3, mat(0x3a3a37), door.x, 2.2, door.y - 0.2)); // opening
    } else if (door.kind === "staging_bay") {
      g.add(box(6.5, 0.06, 4.5, mat(brand, { transparent: true, opacity: 0.35 }), door.x, 0.38, door.y));
    }
  }
  const gate = l.layout.yardGate;
  if (gate) {
    g.add(box(3, 3, 3, white, gate[0], 1.5, gate[1]));
    g.add(box(3.2, 0.3, 3.2, mat(brand), gate[0], 3.1, gate[1]));
    g.add(box(8, 0.25, 0.25, mat(0xc93434), gate[0] - 5.5, 1.1, gate[1])); // barrier
  }
  return g;
}

/** Stylised warehouse (marker shown when zoomed out); base footprint 60 x 30 m. */
function buildMarker(brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.add(box(70, 1, 40, mat(0xffffff), 0, 0.5, 0)); // plinth
  g.add(box(60, 18, 30, mat(0xffffff), 0, 10, 0)); // hall
  g.add(box(62, 2.5, 32, mat(brand), 0, 20, 0)); // roof in the theme colour
  g.add(box(60, 2, 0.4, mat(brand), 0, 14, -15.2)); // stripe over the doors
  for (const x of [-21, -7, 7, 21]) g.add(box(9, 10, 0.6, mat(0x3a3a37), x, 6, -15.3)); // loading doors
  return g;
}

export interface DepotLayerHandle {
  layer: CustomLayerInterface;
  update(live: DepotLive): void;
}

export function createDepotLayer(id: string, layout: DepotLayout): DepotLayerHandle {
  const { lat, lon } = layout.depot;
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
  let brand = new THREE.Color("#f39200");
  let pending: DepotLive | null = null;

  function rebuildLive(state: DepotLive): void {
    live.clear();
    const doors = new Map(layout.doors.map((d) => [d.code, d]));
    if (layout.depot.kind === "depot") {
      for (const o of state.occupied) {
        const d = doors.get(o.doorCode);
        if (d) live.add(truck(TRUCK_COLOR[o.directionType] ?? 0x8a8a86, d.x, d.y));
      }
      for (const s of state.staged) {
        const d = doors.get(s.doorCode);
        if (d && s.parcels > 0) live.add(cardboard(s.parcels, d.x, d.y));
      }
      for (const dev of state.devices) {
        if (dev.kind === "dock_scanner" && dev.doorCode) {
          const d = doors.get(dev.doorCode);
          if (d) live.add(pin(dev.status, d.x, d.y + 2.5, 6.5));
        } else if (dev.kind === "line_scanner" && layout.layout.lineScanner) {
          live.add(pin(dev.status, layout.layout.lineScanner[0], layout.layout.lineScanner[1], 5));
        } else if (dev.kind === "gate_camera" && layout.layout.yardGate) {
          live.add(pin(dev.status, layout.layout.yardGate[0] + 2, layout.layout.yardGate[1], 5));
        }
      }
    } else {
      // hub: trucks fill the ramps from the left
      const ramps = layout.doors.filter((d) => d.kind === "loading_dock");
      ramps.slice(0, state.trucksAtHub).forEach((r) => live.add(truck(TRUCK_COLOR.linehaul ?? 0, r.x, r.y)));
    }
    map?.triggerRepaint();
  }

  const layer: CustomLayerInterface = {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      map = m;
      brand = cssColor("--color-brand-500", "#f39200");
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dde3, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-60, 120, -40);
      scene.add(sun);
      detail.add(buildHall(layout, brand), live);
      marker.add(buildMarker(brand));
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
