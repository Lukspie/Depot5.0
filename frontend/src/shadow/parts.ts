/**
 * Shared 3D parts of a depot (ADR-049), plain three.js so that both renderers use them:
 * - the digital shadow (/shadow, React Three Fiber, wrapped as <primitive> in small components),
 * - the 3D hall on the MapLibre map (components/map/depot3d.ts, custom WebGL layer).
 *
 * Low-poly primitives in the style of docs/design/reference.png: light floor, white low walls,
 * transparent roof, dark belt, coloured doors, cardboard piles. Positions only from the layout.
 */

import * as THREE from "three";
import { beltZ, hallOf, type DepotLayout, type DeviceStatus, type LayoutDoor } from "./layout";

export const STATUS_COLOR: Record<DeviceStatus, number> = { online: 0x23874f, degraded: 0xd99a1e, offline: 0xc93434, maintenance: 0x7c5cd6 };
export const TRUCK_COLOR: Record<string, number> = { linehaul: 0x2f5be9, transit: 0x23874f, local: 0x8a8a86 };

export function cssColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...extra });

export function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Truck (cab + trailer) backed into a door at (0, 0), pointing north (-z). */
export function truckModel(cabColor: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.6, 3.7, 13.6, mat(0xf7f7f5), 0, 2.25, -7.4));
  g.add(box(2.6, 0.5, 13.6, mat(0x5b5b58), 0, 0.25, -7.4));
  g.add(box(2.5, 3.0, 2.4, mat(cabColor), 0, 1.9, -15.6));
  g.add(box(2.3, 0.9, 0.1, mat(0x1d1d1b), 0, 2.6, -16.85)); // windscreen
  return g;
}

/** Car on the yard (gate passages of unexpected vehicles). */
export function carModel(color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.8, 0.8, 4.2, mat(color), 0, 0.6, 0));
  g.add(box(1.6, 0.6, 2.2, mat(0xdfe6ee), 0, 1.3, 0.2));
  return g;
}

/** Pile of parcels on a staging bay at (0, 0), height proportional to the count. */
export function cardboardPile(n: number): THREE.Group {
  const g = new THREE.Group();
  const a = mat(0xd9a066);
  const b = mat(0xc28b52);
  const count = Math.min(18, Math.ceil(n / 25));
  for (let i = 0; i < count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3) % 2;
    const level = Math.floor(i / 6);
    g.add(box(1.4, 1.0, 1.1, i % 2 ? a : b, -1.6 + col * 1.6, 0.8 + level * 1.05, -0.7 + row * 1.3));
  }
  return g;
}

/** IoT pin (pole + coloured head) at (0, 0); used on the map, the shadow draws its own head. */
export function pinModel(status: DeviceStatus, height: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.15, height, 0.15, mat(0x9c9c97), 0, height / 2, 0));
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 16, 12),
    mat(STATUS_COLOR[status], { emissive: STATUS_COLOR[status], emissiveIntensity: 0.35 }),
  );
  head.position.set(0, height + 0.9, 0);
  g.add(head);
  return g;
}

/** Yard asphalt around the hall (trucks stand on it north of the doors). */
export function yardGround(l: DepotLayout): THREE.Object3D {
  const { width: w, depth: d } = hallOf(l);
  const g = new THREE.Group();
  const m = box(w * 1.6, 0.1, d * 3.2, mat(0xd6d9de), 0, 0.05, -d * 0.55);
  m.castShadow = false;
  g.add(m, yardMarkings(l));
  return g;
}

/** Door openings in the facade (north wall), metres. */
export const OPENING_W = 4.4;
export const OPENING_H = 4.6;

/** Floor and full-height walls; the north facade has an opening at every loading door. */
export function hallShell(l: DepotLayout, brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = hallOf(l);
  const wall = mat(0xf4f4f2);
  g.add(box(w + 2, 0.3, d + 2, mat(0xeceae5), 0, 0.2, 0)); // hall floor
  g.add(box(w, h, 0.5, wall, 0, h / 2, d / 2));
  g.add(box(0.5, h, d, wall, -w / 2, h / 2, 0));
  g.add(box(0.5, h, d, wall, w / 2, h / 2, 0));
  // facade: wall pieces between the openings and a lintel above each opening
  const xs = l.doors.filter((x) => x.kind === "loading_dock").map((x) => x.x).sort((a, b) => a - b);
  let from = -w / 2;
  for (const x of [...xs, w / 2 + OPENING_W / 2]) {
    const to = Math.min(x - OPENING_W / 2, w / 2);
    if (to > from) g.add(box(to - from, h, 0.5, wall, (from + to) / 2, h / 2, -d / 2));
    if (x <= w / 2) g.add(box(OPENING_W, h - OPENING_H, 0.5, wall, x, OPENING_H + (h - OPENING_H) / 2, -d / 2));
    from = x + OPENING_W / 2;
  }
  g.add(box(w + 0.6, 0.6, 0.7, mat(brand), 0, h - 0.3, -d / 2)); // brand band on the facade
  return g;
}

/** Roof slab (hidden when the roof is "revealed" to look inside). */
export function hallRoof(l: DepotLayout, brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = hallOf(l);
  g.add(box(w + 1, 0.4, d + 1, mat(0xe7e7e3), 0, h + 0.2, 0));
  g.add(box(w + 1.2, 0.5, 0.6, mat(brand), 0, h + 0.45, -d / 2 - 0.3));
  return g;
}

/** Door number plate above an opening (canvas texture, no font download at runtime). */
export function numberPlate(text: string, brand: THREE.Color): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = `#${brand.getHexString()}`;
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: tex }));
  m.rotation.y = Math.PI; // faces north, to the yard
  return m;
}

/** Sectional door: closed panel in the opening, or rolled up under the lintel when open. */
export function doorLeaf(open: boolean): THREE.Group {
  const g = new THREE.Group();
  const panel = mat(0xc9ced6);
  if (open) {
    g.add(box(OPENING_W - 0.2, 0.5, 0.3, panel, 0, OPENING_H - 0.3, 0.1));
    return g;
  }
  g.add(box(OPENING_W - 0.2, OPENING_H - 0.1, 0.15, panel, 0, OPENING_H / 2, 0));
  for (let i = 1; i < 5; i++) g.add(box(OPENING_W - 0.2, 0.05, 0.17, mat(0x9aa1ab), 0, (OPENING_H / 5) * i, 0));
  return g;
}

/** Yard markings: truck stalls in front of the doors and a dashed driving lane. */
export function yardMarkings(l: DepotLayout): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d } = hallOf(l);
  const paint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const line = (len: number, x: number, z: number, along: "x" | "z") => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(along === "x" ? len : 0.18, 0.02, along === "z" ? len : 0.18), paint);
    m.position.set(x, 0.12, z);
    g.add(m);
  };
  const stallDepth = 18;
  for (const door of l.doors.filter((x) => x.kind === "loading_dock")) {
    line(stallDepth, door.x - 3, -d / 2 - stallDepth / 2, "z");
    line(stallDepth, door.x + 3, -d / 2 - stallDepth / 2, "z");
  }
  const laneZ = -d / 2 - stallDepth - 6;
  for (let x = -w * 0.75; x < w * 0.75; x += 6) line(3, x + 1.5, laneZ, "x");
  line(w * 1.5, 0, laneZ - 6, "x");
  return g;
}

/** Main sorting belt with branch conveyors to the loading doors. */
export function conveyor(l: DepotLayout): THREE.Group {
  const g = new THREE.Group();
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
  const z0 = beltZ(l);
  for (const door of l.doors) {
    if (door.kind !== "loading_dock") continue;
    const len = Math.abs(door.y - z0) - 2;
    if (belt.length > 1 && len > 0) g.add(box(1.2, 0.7, len, beltMat, door.x, 0.65, (door.y + z0) / 2));
  }
  return g;
}

/** Loading door frame in the north wall, centred at (0, 0). */
export function dockFrame(brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.add(box(4.6, 0.5, 0.8, mat(brand), 0, 4.6, 0));
  g.add(box(0.5, 4.6, 0.8, mat(brand), -2.3, 2.3, 0));
  g.add(box(0.5, 4.6, 0.8, mat(brand), 2.3, 2.3, 0));
  g.add(box(4.1, 4.3, 0.3, mat(0x3a3a37), 0, 2.2, -0.2)); // opening
  return g;
}

/** Courier staging bay: a translucent area on the floor, centred at (0, 0). */
export function stagingBay(brand: THREE.Color): THREE.Mesh {
  const m = box(6.5, 0.06, 4.5, mat(brand, { transparent: true, opacity: 0.35 }), 0, 0.38, 0);
  m.castShadow = false;
  return m;
}

/** Yard entrance: gatehouse and barrier. */
export function yardGate(brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.add(box(3, 3, 3, mat(0xffffff), 0, 1.5, 0));
  g.add(box(3.2, 0.3, 3.2, mat(brand), 0, 3.1, 0));
  g.add(box(8, 0.25, 0.25, mat(0xc93434), -5.5, 1.1, 0)); // barrier
  return g;
}

/** Everything static of a hall in one group (the map layer draws it like this). */
export function hallStatic(l: DepotLayout, brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.add(yardGround(l), hallShell(l, brand), conveyor(l));
  for (const door of l.doors) g.add(placeDoor(door, brand));
  const gate = l.layout.yardGate;
  if (gate) {
    const y = yardGate(brand);
    y.position.set(gate[0], 0, gate[1]);
    g.add(y);
  }
  return g;
}

function placeDoor(door: LayoutDoor, brand: THREE.Color): THREE.Object3D {
  const o = door.kind === "loading_dock" ? dockFrame(brand) : door.kind === "staging_bay" ? stagingBay(brand) : new THREE.Group();
  o.position.set(door.x, o.position.y, door.y);
  return o;
}

/** Stylised warehouse (map marker when zoomed out); base footprint 60 x 30 m. */
export function warehouseMarker(brand: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.add(box(70, 1, 40, mat(0xffffff), 0, 0.5, 0)); // plinth
  g.add(box(60, 18, 30, mat(0xffffff), 0, 10, 0)); // hall
  g.add(box(62, 2.5, 32, mat(brand), 0, 20, 0)); // roof in the theme colour
  g.add(box(60, 2, 0.4, mat(brand), 0, 14, -15.2)); // stripe over the doors
  for (const x of [-21, -7, 7, 21]) g.add(box(9, 10, 0.6, mat(0x3a3a37), x, 6, -15.3)); // loading doors
  return g;
}

/** Free GPU memory of a group built from these parts. */
export function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      (c.geometry as THREE.BufferGeometry).dispose();
      const m = c.material as THREE.Material | THREE.Material[];
      (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    }
  });
}
