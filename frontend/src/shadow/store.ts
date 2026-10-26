/**
 * High-frequency live data of the digital shadow (zustand, ADR-046).
 *
 * The WebSocket feed writes here; the 3D scene reads it with `useShadowStore.getState()` inside
 * `useFrame` (no React re-render per scan). Only panels subscribe with selectors, e.g. the last
 * 20 scans of the selected device.
 */

import { create } from "zustand";
import type { DeviceInfo } from "../api/telematicsApi";

export interface LiveScan {
  device: string;
  doorCode: string | null;
  at: string;
  barcode: string | null;
  readOk: boolean;
}

/** A parcel to animate along the belt (consumed by ParcelFlow). */
export interface FlowItem {
  doorCode: string | null;
  readOk: boolean;
}

export interface DoorReading {
  device: string;
  doorCode: string;
  state: "open" | "closed" | "fault";
  at: string;
}

export interface YardCar {
  plate: string;
  since: string;
}

const RECENT = 20;
const MAX_FLOW_QUEUE = 300;
const MAX_CARS = 6;

interface ShadowStore {
  devices: Record<string, DeviceInfo>;
  /** last 20 scans per device, newest first */
  recent: Record<string, LiveScan[]>;
  /** real time (performance.now) of the last scan per device, for the pin pulse */
  pulses: Record<string, number>;
  /** parcels waiting to enter the belt animation */
  flow: FlowItem[];
  /** unexpected cars on the yard (gate passages in, removed on the way out) */
  yard: YardCar[];
  /** door contact sensors by door code (the only source of the door state in the scene) */
  doors: Record<string, DoorReading>;
  door(r: DoorReading): void;
  setDevices(list: DeviceInfo[]): void;
  device(info: DeviceInfo): void;
  scan(s: LiveScan): void;
  gate(p: { direction: "in" | "out"; vehicleType: string; plate: string | null; at: string }): void;
  /** take the queued parcels (called by the scene every frame) */
  takeFlow(): FlowItem[];
  /** fps stress test (?fps=stress): synthetic parcels on the belt, no simulation involved */
  pushFlow(items: FlowItem[]): void;
  reset(): void;
}

export const useShadowStore = create<ShadowStore>((set, get) => ({
  devices: {},
  recent: {},
  pulses: {},
  flow: [],
  yard: [],
  doors: {},
  door: (r) => set((s) => ({ doors: { ...s.doors, [r.doorCode]: r } })),
  setDevices: (list) => set({ devices: Object.fromEntries(list.map((d) => [d.code, d])) }),
  device: (info) => set((s) => ({ devices: { ...s.devices, [info.code]: info } })),
  scan: (sc) =>
    set((s) => ({
      recent: { ...s.recent, [sc.device]: [sc, ...(s.recent[sc.device] ?? [])].slice(0, RECENT) },
      pulses: { ...s.pulses, [sc.device]: performance.now() },
      flow: s.flow.length >= MAX_FLOW_QUEUE ? s.flow : [...s.flow, { doorCode: sc.doorCode, readOk: sc.readOk }],
    })),
  gate: (p) => {
    if (p.vehicleType !== "car" || !p.plate) return;
    const plate = p.plate;
    set((s) =>
      p.direction === "in"
        ? { yard: [...s.yard.filter((c) => c.plate !== plate), { plate, since: p.at }].slice(-MAX_CARS) }
        : { yard: s.yard.filter((c) => c.plate !== plate) },
    );
  },
  takeFlow: () => {
    const items = get().flow;
    if (items.length > 0) set({ flow: [] });
    return items;
  },
  pushFlow: (items) => set((s) => ({ flow: [...s.flow, ...items].slice(-MAX_FLOW_QUEUE) })),
  reset: () => set({ devices: {}, recent: {}, pulses: {}, flow: [], yard: [], doors: {} }),
}));
