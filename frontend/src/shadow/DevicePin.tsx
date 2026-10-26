import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { DeviceStatus } from "./layout";
import { useShadowStore } from "./store";

const PULSE_MS = 700;
const DOT: Record<DeviceStatus, string> = { online: "bg-ok-600", degraded: "bg-warn-600", offline: "bg-danger-600" };
const LABEL: Record<DeviceStatus, string> = { online: "online", degraded: "degradované", offline: "offline" };

/**
 * IoT pin above a device (drei Html): colour by status, a short pulse on every scan. The pulse
 * is driven from useFrame by writing to the DOM node directly (no React render per scan).
 */
export function DevicePin({ code, x, z, height, selected, onSelect }: { code: string; x: number; z: number; height: number; selected: boolean; onSelect: (code: string) => void }) {
  const status = useShadowStore((s) => s.devices[code]?.status ?? "offline");
  const ring = useRef<HTMLSpanElement>(null);

  useFrame((state) => {
    const el = ring.current;
    if (!el) return;
    const last = useShadowStore.getState().pulses[code];
    const age = last === undefined ? Infinity : performance.now() - last;
    if (age < PULSE_MS) {
      const k = age / PULSE_MS;
      el.style.transform = `scale(${String(1 + k * 1.6)})`;
      el.style.opacity = String(0.7 * (1 - k));
      state.invalidate();
    } else if (el.style.opacity !== "0") {
      el.style.opacity = "0";
    }
  });

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[0.15, height, 0.15]} />
        <meshStandardMaterial color="#9c9c97" />
      </mesh>
      <Html position={[0, height + 0.8, 0]} center zIndexRange={[20, 10]}>
        <button
          type="button"
          data-pin
          onClick={() => onSelect(code)}
          title={`${code} · ${LABEL[status]}`}
          aria-label={`Zariadenie ${code}, ${LABEL[status]}`}
          className={`relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow-md ${DOT[status]} ${selected ? "ring-ink ring-2 ring-offset-1" : ""}`}
        >
          <span ref={ring} className={`pointer-events-none absolute inset-0 rounded-full opacity-0 ${DOT[status]}`} />
        </button>
      </Html>
    </group>
  );
}
