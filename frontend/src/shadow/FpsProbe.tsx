import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

declare global {
  interface Window {
    /** frames per second of the shadow scene, measured by FpsProbe (?fps=1) */
    __shadowFps?: number[];
  }
}

/**
 * Measurement mode (/shadow?fps=1, docs/fazy/faza-5): the scene renders every frame and this probe
 * counts rendered frames per second. Each one-second sample goes to window.__shadowFps (read by
 * the Playwright script) and to `onSample` (overlay).
 */
export function FpsProbe({ onSample }: { onSample: (fps: number) => void }) {
  const frames = useRef(0);
  const since = useRef<number | null>(null);
  useFrame(() => {
    const now = performance.now();
    since.current ??= now;
    frames.current++;
    const elapsed = now - since.current;
    if (elapsed >= 1000) {
      const fps = Math.round((frames.current * 1000) / elapsed);
      (window.__shadowFps ??= []).push(fps);
      onSample(fps);
      frames.current = 0;
      since.current = now;
    }
  });
  return null;
}
