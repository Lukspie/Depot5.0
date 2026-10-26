import { ContactShadows } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type * as THREE from "three";
import type { Shadow } from "../api/shadow";
import { CameraRig } from "./CameraRig";
import { Conveyor } from "./Conveyor";
import { DevicePin } from "./DevicePin";
import { Dock, StagingBay } from "./Dock";
import { FpsProbe } from "./FpsProbe";
import { Hall, YardGround } from "./Hall";
import { Highlight } from "./Highlight";
import { devicePosition, type DepotLayout } from "./layout";
import { ParcelFlow } from "./ParcelFlow";
import { cssColor } from "./parts";
import { useShadowStore } from "./store";
import { Truck } from "./Truck";
import { YardCars } from "./YardCars";

export type Selection = { kind: "dock" | "device"; code: string } | null;

export interface SceneMarks {
  /** objects touched by a what-if scenario (doors / devices), drawn with a red ring */
  affected?: string[];
  /** where the searched parcel is: [x, z] */
  found?: [number, number] | null;
}

interface Props {
  layout: DepotLayout;
  live: Shadow | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  marks?: SceneMarks;
  /** measurement mode: render every frame and report fps */
  onFps?: (fps: number) => void;
}

/** Re-render on demand: whenever the live store changes and the tab is visible. */
function Invalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const unsub = useShadowStore.subscribe(() => {
      if (!document.hidden) invalidate();
    });
    const onVisible = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [invalidate]);
  return null;
}

/** Brand colour of the current theme (re-read when the theme switches). */
function useBrand(): THREE.Color {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return useMemo(() => {
    void theme;
    return cssColor("--color-brand-500", "#f39200");
  }, [theme]);
}

function Depot({ layout, live, selection, onSelect, marks }: Omit<Props, "onFps">) {
  const brand = useBrand();
  const devices = useShadowStore((s) => s.devices);
  const doors = useMemo(() => new Map(layout.doors.map((d) => [d.code, d])), [layout]);
  const docks = useMemo(() => new Map((live?.docks ?? []).map((d) => [d.code, d])), [live]);
  const staged = useMemo(() => new Map((live?.staged ?? []).map((s) => [s.doorCode, s.parcels])), [live]);
  const selectDock = (code: string) => onSelect({ kind: "dock", code });
  const selectDevice = (code: string) => onSelect({ kind: "device", code });

  const trucks: { key: string; x: number; z: number; type: string; door: string }[] = [];
  if (layout.depot.kind === "depot") {
    for (const d of live?.docks ?? []) {
      const t = d.trip;
      const door = doors.get(d.code);
      if (t && door && (t.status === "at_door" || t.status === "loading")) {
        trucks.push({ key: `${t.vehiclePlate}-${String(t.id)}`, x: door.x, z: door.y, type: t.directionType, door: d.code });
      }
    }
  } else {
    // hub: trucks standing at the hub fill the ramps from the left
    const ramps = layout.doors.filter((d) => d.kind === "loading_dock");
    const here = (live?.trucks ?? []).filter((t) => t.state === "at_hub" || t.state === "loading_at_hub");
    here.slice(0, ramps.length).forEach((t, i) => {
      const r = ramps[i];
      if (r) trucks.push({ key: t.plate, x: r.x, z: r.y, type: "linehaul", door: r.code });
    });
  }

  const ringAt = (code: string): [number, number] | null => {
    const door = doors.get(code);
    if (door) return [door.x, door.kind === "loading_dock" ? door.y - 3 : door.y];
    const dev = devices[code];
    return dev ? devicePosition(layout, dev) : null;
  };
  const selected = selection ? ringAt(selection.code) : null;

  return (
    <group>
      <Hall layout={layout} brand={brand} />
      <Conveyor layout={layout} />
      {layout.doors.map((door) =>
        door.kind === "loading_dock" ? (
          <Dock key={door.code} door={door} brand={brand} label={docks.get(door.code)?.trip?.directionCode ?? door.directionCode} onSelect={selectDock} />
        ) : door.kind === "staging_bay" ? (
          <StagingBay key={door.code} door={door} brand={brand} parcels={staged.get(door.code) ?? 0} />
        ) : null,
      )}
      {trucks.map((t) => (
        <Truck key={t.key} x={t.x} z={t.z} directionType={t.type} onSelect={() => selectDock(t.door)} />
      ))}
      {Object.values(devices).map((d) => {
        const p = devicePosition(layout, d);
        if (!p) return null;
        return (
          <DevicePin
            key={d.code}
            code={d.code}
            x={p[0]}
            z={p[1]}
            height={d.kind === "dock_scanner" ? 6.5 : 5}
            selected={selection?.kind === "device" && selection.code === d.code}
            onSelect={selectDevice}
          />
        );
      })}
      <ParcelFlow layout={layout} />
      <YardCars layout={layout} />
      {selected && <Highlight x={selected[0]} z={selected[1]} radius={selection?.kind === "device" ? 2 : 3.5} />}
      {(marks?.affected ?? []).map((code) => {
        const p = ringAt(code);
        return p ? <Highlight key={`a-${code}`} x={p[0]} z={p[1]} radius={4.5} tone="affected" /> : null;
      })}
      {marks?.found && <Highlight x={marks.found[0]} z={marks.found[1]} radius={2.2} tone="found" />}
    </group>
  );
}

/**
 * The 3D scene of the digital shadow (zadanie §7, ADR-046): React Three Fiber, rendered on demand
 * (frameloop="demand"); live updates, moving parcels and arriving trucks request frames themselves.
 */
export function ShadowScene({ onFps, ...props }: Props) {
  return (
    <Canvas
      shadows="percentage"
      frameloop={onFps ? "always" : "demand"}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={(e) => {
        // a click on a pin (drei Html, DOM) bubbles to the canvas as a "miss": keep the selection
        if (e.target instanceof Element && e.target.closest("[data-pin]")) return;
        props.onSelect(null);
      }}
      aria-label="3D scéna haly"
    >
      <hemisphereLight args={["#ffffff", "#d9dde3", 1.5]} />
      <directionalLight
        position={[-60, 120, -40]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
      />
      <YardGround layout={props.layout} />
      <CameraRig>
        <Depot {...props} />
      </CameraRig>
      <ContactShadows position={[0, 0.12, -10]} scale={240} blur={2.4} opacity={0.3} far={18} resolution={1024} />
      <Invalidator />
      {onFps && <FpsProbe onSample={onFps} />}
    </Canvas>
  );
}
