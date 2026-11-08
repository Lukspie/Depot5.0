import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLayout } from "../api/depots";
import { useDepot } from "../hooks/useDepot";
import { useParcelLocate, useShadow, type ParcelLocate } from "../api/shadow";
import { Button, Card, EmptyState, Spinner } from "../components/ui";
import type { CameraApi } from "../shadow/CameraRig";
import { CameraControls } from "../shadow/hud/CameraControls";
import { KpiStack } from "../shadow/hud/KpiStack";
import { ObjectList, type Pick } from "../shadow/hud/ObjectList";
import { ParcelTrack } from "../shadow/hud/ParcelTrack";
import { TopBar } from "../shadow/hud/TopBar";
import { beltZ, devicePosition, type DepotLayout } from "../shadow/layout";
import { DevicePanel } from "../shadow/panels/DevicePanel";
import { ScenarioPanel } from "../shadow/panels/ScenarioPanel";
import { TruckPanel } from "../shadow/panels/TruckPanel";
import { useCanAct } from "../shadow/permissions";
import { ShadowScene, type Selection } from "../shadow/ShadowScene";
import { useShadowStore } from "../shadow/store";
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

function Legend() {
  const dot = "inline-block h-2.5 w-2.5 rounded-full";
  return (
    <div className="bg-surface/90 shadow-card hidden flex-wrap gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-[11px] md:flex">
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-ok-600`} />online</span>
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-warn-600`} />degradované</span>
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-danger-600`} />offline</span>
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-[#7c5cd6]`} />údržba</span>
    </div>
  );
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
    const t = window.setTimeout(() => camera.current?.focus(at[0], at[1]), 900);
    return () => window.clearTimeout(t);
  }, [cameraReady, layout.data]);

  const found = useMemo(() => (layout.data ? foundAt(layout.data, parcel.data) : null), [layout.data, parcel.data]);

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

  // the roof opens on request, or by itself when something inside the hall is selected or found
  const roofOpen = roof || selection?.kind === "device" || found !== null;
  const panel = "z-10 px-3 md:absolute md:px-0";
  return (
    <div className="bg-canvas relative flex flex-col gap-3 pb-4 md:block md:h-full md:overflow-hidden md:rounded-2xl md:pb-0">
      <div className="h-[52vh] min-h-[320px] md:absolute md:inset-0 md:h-auto">
        <ShadowScene
          layout={l}
          live={live.data}
          selection={selection}
          onSelect={setSelection}
          marks={{ found, affected: affected ?? [] }}
          onFps={measuring ? onFps : undefined}
          onCamera={onCamera}
          roofOpen={roofOpen}
        />
      </div>

      <div className={`${panel} z-20 md:top-3 md:right-3 md:left-3`}>
        <TopBar depot={code} live={live.data} onSearch={search} onScenario={canAct && live.data?.kpis ? () => setScenario(true) : undefined} />
      </div>

      <div className={`${panel} flex flex-col gap-2 md:top-[76px] md:left-3 md:w-60`}>
        <KpiStack data={live.data} />
        <Legend />
        {measuring && (
          <div data-testid="fps" className="bg-ink w-fit rounded-lg px-2 py-1 font-mono text-xs text-white">
            {fps === null ? "… fps" : `${String(fps)} fps`}
          </div>
        )}
      </div>

      <div className="absolute top-[76px] right-3 z-10 hidden md:block">
        <CameraControls api={getCamera} roofOpen={roofOpen} onRoof={() => setRoof(!roof)} />
      </div>

      {barcode && (
        <div className={`${panel} md:bottom-3 md:left-3 md:w-[min(560px,45%)]`}>
          <ParcelTrack barcode={barcode} result={parcel.data} error={parcel.error} canOpen={canAct} onClose={() => setBarcode(null)} />
        </div>
      )}

      {vehicle && (
        <div className={`${panel} md:bottom-3 md:left-3 md:w-[min(560px,45%)]`}>
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

      {/* the list gives way to the detail panel on the right */}
      <div className={`${panel} md:right-3 md:bottom-3 md:h-[40%] md:w-[360px] ${selection ? "md:hidden" : ""}`}>
        <ObjectList live={live.data} onPick={pick} />
      </div>

      {selection?.kind === "device" && <DevicePanel code={selection.code} alerts={live.data?.alerts ?? []} onClose={close} />}
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
