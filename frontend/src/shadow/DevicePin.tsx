import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { DeviceStatus } from "./layout";
import { useShadowStore } from "./store";

const PULSE_MS = 700;
const STEPS = 14;
// precomputed CSS values of the pulse, so useFrame allocates nothing
const SCALE = Array.from({ length: STEPS }, (_, i) => `scale(${String(1 + (i / STEPS) * 1.6)})`);
const OPACITY = Array.from({ length: STEPS }, (_, i) => String(0.7 * (1 - i / STEPS)));
const DOT: Record<DeviceStatus, string> = { online: "bg-ok-600", degraded: "bg-warn-600", offline: "bg-danger-600", maintenance: "bg-[#7c5cd6]" };
const LABEL: Record<DeviceStatus, string> = { online: "online", degraded: "degradované", offline: "offline", maintenance: "údržba" };

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
      const step = Math.min(STEPS - 1, Math.floor((age / PULSE_MS) * STEPS));
      el.style.transform = SCALE[step] ?? "";
      el.style.opacity = OPACITY[step] ?? "0";
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
      <Html position={[0, height + 0.8, 0]} center zIndexRange={[8, 5]}>
        <button
          type="button"
          data-pin
          onClick={() => onSelect(code)}
          aria-label={`Zariadenie ${code}, ${LABEL[status]}`}
          className="group relative flex h-7 w-7 -translate-y-2 items-center justify-center"
        >
          {/* drop: a rotated square with three round corners, the tip points down */}
          <span
            className={`absolute inset-0.5 -rotate-45 rounded-[50%_50%_50%_0] border-2 border-white shadow-md ${DOT[status]} ${selected ? "outline-ink outline-2" : ""}`}
          />
          <span className="relative h-2 w-2 rounded-full bg-white" />
          <span ref={ring} className={`pointer-events-none absolute inset-0 rounded-full opacity-0 ${DOT[status]}`} />
          <span
            className={`bg-surface shadow-card text-ink pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${selected ? "block" : "hidden group-hover:block"}`}
          >
            {code} · {LABEL[status]}
          </span>
        </button>
      </Html>
    </group>
  );
}
