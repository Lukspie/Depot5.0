import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import * as THREE from "three";
import { useLayout } from "../api/depots";
import { useLine, useLineParcel } from "../api/line";
import { useDepot } from "../hooks/useDepot";
import { useParcelLocate, useShadow, type ParcelLocate } from "../api/shadow";
import { Button, Card, EmptyState, Spinner } from "../components/ui";
import type { CameraApi } from "../shadow/CameraRig";
import { CameraControls } from "../shadow/hud/CameraControls";
import { KpiStack } from "../shadow/hud/KpiStack";
import { LinePanel } from "../shadow/hud/LinePanel";
import { ObjectList, type Pick } from "../shadow/hud/ObjectList";
import { ParcelTrack } from "../shadow/hud/ParcelTrack";
import { TopBar } from "../shadow/hud/TopBar";
import { beltZ, devicePosition, lineGraph, type DepotLayout, type LineVariant } from "../shadow/layout";
import { CheckpointPanel } from "../shadow/panels/CheckpointPanel";
import { DevicePanel } from "../shadow/panels/DevicePanel";
import { ScenarioPanel } from "../shadow/panels/ScenarioPanel";
import { TruckPanel } from "../shadow/panels/TruckPanel";
import { useCanAct } from "../shadow/permissions";
import { ShadowScene, type Selection } from "../shadow/ShadowScene";
import { useShadowStore } from "../shadow/store";
import { seedSimTime, useSimTimeFeed } from "../shadow/simTime";
import { useShadowFeed } from "../shadow/useShadowFeed";

/** Slovak plate as used by the depot vehicles, e.g. KE-102LH */
const PLATE = /^[A-Z]{2}-\d{3}[A-Z]{2}$/;

/** Where to mark a found parcel in the scene, if it is physically in the hall. */
function foundAt(layout: DepotLayout, p: ParcelLocate | undefined): [number, number] | null {
  if (!p) return null;
  if (p.place.kind === "belt") return layout.layout.lineScanner ?? [0, beltZ(layout)];
  if (p.place.kind === "door" || p.place.kind === "bay") {
    const d = layout.doors.find((x) => x.code === p.place.code);
    if (!d) return null;
    return [d.x, d.kind === "loading_dock" ? d.y + 3 : d.y];
  }
  return null;
}

/**
 * Digital shadow of a depot (zadanie §7, ADR-045, layout plan-doplnky 5c): the scene fills the area
 * under the top bar, everything else floats above it like in docs/design/reference.png. Reality ->
 * model automatically; model -> reality only through human decisions in the WMS.
 */
export function ShadowPage() {
  // a new depot = a fresh page: the devices channel is subscribed again and sends its snapshot
  const { code } = useDepot();
  if (!code) return null;
  return <ShadowView key={code} code={code} />;
}

function ShadowView({ code }: { code: string }) {
  const [params] = useSearchParams();
  // the depot comes from the shell (useDepot): address, last choice or home depot (ADR-068)
  // fps measurement (docs/fazy/faza-5): ?fps=1 live data, ?fps=stress also a full belt (~300 parcels)
  const stress = params.get("fps") === "stress";
  const measuring = params.get("fps") === "1" || stress;
  const layout = useLayout(code);
  const live = useShadow(code);
  useShadowFeed(code);
  useSimTimeFeed();
  const canAct = useCanAct();
  const devices = useShadowStore((s) => s.devices);
  // ?door=LD-02 / ?device=DOCK-SCN-02 open a panel directly (demo, links from other screens)
  const [selection, setSelection] = useState<Selection>(() => {
    const door = params.get("door");
    const device = params.get("device");
    return door ? { kind: "dock", code: door } : device ? { kind: "device", code: device } : null;
  });
  const [barcode, setBarcode] = useState<string | null>(null);
  /** a searched vehicle that is not at a door right now */
  const [vehicle, setVehicle] = useState<string | null>(null);
  const parcel = useParcelLocate(barcode);
  const [fps, setFps] = useState<number | null>(null);
  // ?scenario=1 opens the what-if panel (from the dispatching page and its alerts)
  const [scenario, setScenario] = useState(() => params.get("scenario") === "1");
  const [roof, setRoof] = useState(false);
  const [affected, setAffected] = useState<string[] | null>(null);
  const camera = useRef<CameraApi | null>(null);
  // a panel opened from the URL (?door=, ?device=) also turns the camera to its object, once
  const initialFocus = useRef<string | null>(params.get("door") ?? params.get("device"));
  const [cameraReady, setCameraReady] = useState(false);
  const onCamera = useCallback((api: CameraApi) => {
    camera.current = api;
    setCameraReady(true);
  }, []);
  const getCamera = useCallback(() => camera.current, []);
  const onFps = useCallback((v: number) => setFps(v), []);
  const close = useCallback(() => setSelection(null), []);

  useEffect(() => {
    if (!stress || !layout.data) return;
    const docks = layout.data.doors.filter((d) => d.kind === "loading_dock").map((d) => d.code);
    let i = 0;
    const t = window.setInterval(() => {
      useShadowStore.getState().pushFlow(Array.from({ length: 8 }, () => ({ doorCode: docks[i++ % docks.length] ?? null, readOk: i % 9 !== 0 })));
    }, 100);
    return () => window.clearInterval(t);
  }, [stress, layout.data]);

  useEffect(() => {
    const code = initialFocus.current;
    const l = layout.data;
    if (!cameraReady || !code || !l || !camera.current) return;
    const door = l.doors.find((d) => d.code === code);
    const dev = useShadowStore.getState().devices[code];
    const at = door ? ([door.x, door.y] as const) : dev ? devicePosition(l, dev) : null;
    if (!at) return;
    initialFocus.current = null;
    // after the initial fit of <Bounds> (it would overwrite an earlier focus)
    // the home view first (its zoom), then the object in it (maketa-tien keeps the overview)
    const t = window.setTimeout(() => {
      camera.current?.home();
      camera.current?.focus(at[0], at[1]);
    }, 900);
    return () => window.clearTimeout(t);
  }, [cameraReady, layout.data]);

  // the sorting line (phase 7d step 5d): variant, live view with the roof open, searched route
  const [variant, setVariant] = useState<LineVariant>("current");
  const hasLine = Boolean(layout.data?.layout.line);
  const route = useLineParcel(code, barcode, variant, hasLine);
  const graph = useMemo(() => (layout.data ? lineGraph(layout.data, variant) : null), [layout.data, variant]);
  const found = useMemo((): [number, number] | null => {
    // on the line: the checkpoint the parcel passed last, otherwise where the WMS has it
    const node = route.data?.current ? graph?.nodes.find((n) => n.checkpoint === route.data.current?.checkpoint) : undefined;
    if (node) return [node.x, node.y];
    return layout.data ? foundAt(layout.data, parcel.data) : null;
  }, [layout.data, parcel.data, route.data, graph]);
  // the roof opens on request, or by itself when something inside the hall is selected or found
  const roofOpen = roof || selection?.kind === "device" || selection?.kind === "checkpoint" || found !== null;
  const line = useLine(code, variant, hasLine && roofOpen);
  // still on the belts (not yet at its staging place): the name of the last checkpoint
  const onLine = useMemo(() => {
    const r = route.data;
    if (!r?.current || Date.parse(r.hops.at(-1)?.at ?? "") <= Date.parse(r.current.at)) return null;
    return graph?.nodes.find((n) => n.checkpoint === r.current?.checkpoint)?.label ?? r.current.checkpoint;
  }, [route.data, graph]);
  useEffect(() => {
    if (line.data) seedSimTime(line.data.simTime);
  }, [line.data]);

  if (layout.isPending) return <Spinner label="Načítavam sklad…" className="py-20" />;
  if (layout.isError) {
    return (
      <Card>
        <EmptyState title="Sklad neexistuje" action={<Link to="/fleet" className="text-brand-700 underline">Späť na mapu</Link>} />
      </Card>
    );
  }
  const l = layout.data;

  /** select an object and turn the camera to it */
  const pick = (p: Pick) => {
    setSelection(p);
    const door = l.doors.find((d) => d.code === p.code);
    const dev = devices[p.code];
    const at = door ? ([door.x, door.y] as const) : dev ? devicePosition(l, dev) : null;
    if (at) camera.current?.focus(at[0], at[1]);
  };

  /** the search box: door, device, truck plate, otherwise a parcel barcode */
  const search = (q: string) => {
    const door = l.doors.find((d) => d.code === q);
    if (door?.kind === "loading_dock") return pick({ kind: "dock", code: q });
    if (door) return camera.current?.focus(door.x, door.y);
    if (devices[q]) return pick({ kind: "device", code: q });
    const truck = live.data?.docks.find((d) => d.trip?.vehiclePlate === q);
    if (truck) return pick({ kind: "dock", code: truck.code });
    setVehicle(null);
    setBarcode(null);
    if (PLATE.test(q)) setVehicle(q);
    else setBarcode(q);
  };

  /** the roof button: opening it over a line turns the camera to the line, closing goes home */
  const toggleRoof = () => {
    const open = !roofOpen;
    setRoof(open);
    if (!open) {
      if (selection?.kind === "checkpoint" || selection?.kind === "device") setSelection(null);
      camera.current?.home();
      return;
    }
    const nodes = l.layout.line?.variants.current.nodes ?? [];
    if (!nodes.length) return;
    // a short line (Žilina, Dunajská Streda) still shows its part of the hall, not a close-up
    const box = new THREE.Box3().setFromPoints(nodes.map((n) => new THREE.Vector3(n.x, 0, n.y)));
    box.expandByVector(new THREE.Vector3(1, 0, 1).multiplyScalar(Math.max(0, 70 - Math.max(...box.getSize(new THREE.Vector3()).toArray())) / 2));
    camera.current?.interior(box);
  };
  const panel = "z-10 px-3 md:absolute md:px-0";
  return (
    <div className="bg-canvas relative flex flex-col gap-3 pb-4 md:block md:h-full md:overflow-hidden md:rounded-2xl md:pb-0">
      {/* overflow-hidden: labels in the scene (drei Html) must not widen the page on a phone */}
      <div className="relative h-[52vh] min-h-[320px] overflow-hidden md:absolute md:inset-0 md:h-auto">
        <ShadowScene
          layout={l}
          live={live.data}
          selection={selection}
          onSelect={setSelection}
          marks={{ found, affected: affected ?? [] }}
          onFps={measuring ? onFps : undefined}
          onCamera={onCamera}
          roofOpen={roofOpen}
          line={hasLine ? { variant, view: line.data, route: route.data?.hops.map((h) => h.node) ?? null, found: barcode } : undefined}
        />
      </div>

      <div className={`${panel} z-20 md:top-4 md:right-4 md:left-4`}>
        <TopBar depot={code} live={live.data} onSearch={search} onScenario={canAct && live.data?.kpis ? () => setScenario(true) : undefined} />
      </div>

      {/* KPI row under the top bar, left of the detail panel (maketa-tien) */}
      <div className={`${panel} flex flex-col gap-2 md:top-[76px] md:left-4 ${selection ? "md:right-[452px]" : "md:right-[76px]"}`}>
        <KpiStack data={live.data} />
        {hasLine && roofOpen && (
          <LinePanel view={line.data} variant={variant} onVariant={setVariant} hasProposal={Boolean(l.layout.line?.variants.proposal)} />
        )}
        {measuring && (
          <div data-testid="fps" className="bg-ink w-fit rounded-lg px-2 py-1 font-mono text-xs text-white">
            {fps === null ? "… fps" : `${String(fps)} fps`}
          </div>
        )}
      </div>

      <div className="absolute top-[76px] right-4 z-10 hidden md:block">
        <CameraControls api={getCamera} roofOpen={roofOpen} onRoof={toggleRoof} />
      </div>

      {barcode && (
        <div className={`${panel} md:bottom-4 md:left-4 md:w-[min(620px,calc(100%-460px))]`}>
          <ParcelTrack
            barcode={barcode}
            result={parcel.data}
            error={parcel.error}
            canOpen={canAct}
            onClose={() => setBarcode(null)}
            onLine={onLine}
          />
        </div>
      )}

      {vehicle && (
        <div className={`${panel} md:bottom-4 md:left-4 md:w-[min(620px,calc(100%-460px))]`}>
          <div className="bg-surface shadow-card flex items-center gap-3 rounded-2xl p-4 text-sm">
            <span className="min-w-0 flex-1">
              Vozidlo <b className="font-mono">{vehicle}</b> práve nestojí pri bráne tohto skladu.
            </span>
            {canAct && (
              <Link to={`/fleet?plate=${encodeURIComponent(vehicle)}`} className="text-brand-700 shrink-0 underline">
                Na mape
              </Link>
            )}
            <Button variant="ghost" size="sm" className="!p-1" aria-label="Zavrieť" onClick={() => setVehicle(null)}>
              <X size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* the list in the bottom right corner stays next to the detail (maketa-tien) */}
      <div className={`${panel} md:right-4 md:bottom-4 md:h-[38%] md:min-h-[260px] md:w-[400px]`}>
        <ObjectList live={live.data} onPick={pick} selected={selection?.code ?? null} />
      </div>

      {selection?.kind === "device" && <DevicePanel code={selection.code} alerts={live.data?.alerts ?? []} onClose={close} />}
      {selection?.kind === "checkpoint" && (
        <CheckpointPanel code={selection.code} view={line.data?.checkpoints.find((c) => c.code === selection.code)} variant={variant} onClose={close} />
      )}
      {selection?.kind === "dock" && <TruckPanel code={selection.code} layout={l} onClose={close} onMoved={(door) => setSelection({ kind: "dock", code: door })} />}

      {scenario && (
        <div className="bg-canvas fixed inset-0 z-50 overflow-y-auto p-3 md:absolute md:inset-y-auto md:top-3 md:right-3 md:left-auto md:max-h-[calc(100%-1.5rem)] md:w-[640px] md:rounded-2xl md:p-0 md:shadow-[var(--shadow-float)]">
          <div className="relative">
            <Button variant="secondary" size="sm" className="absolute top-3 right-3 z-10 !p-1.5" aria-label="Zavrieť scenár" onClick={() => setScenario(false)}>
              <X size={16} />
            </Button>
            <ScenarioPanel layout={l} onAffected={setAffected} />
          </div>
        </div>
      )}
    </div>
  );
}
