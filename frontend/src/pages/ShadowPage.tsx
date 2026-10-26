import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLayout } from "../api/depots";
import { useParcelLocate, useShadow, type ParcelLocate } from "../api/shadow";
import { Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { beltZ, type DepotLayout } from "../shadow/layout";
import { DevicePanel } from "../shadow/panels/DevicePanel";
import { KpiBar } from "../shadow/panels/KpiBar";
import { ParcelSearch } from "../shadow/panels/ParcelSearch";
import { TruckPanel } from "../shadow/panels/TruckPanel";
import { ShadowScene, type Selection } from "../shadow/ShadowScene";
import { useShadowFeed } from "../shadow/useShadowFeed";

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
    <div className="bg-surface/90 shadow-card pointer-events-none absolute bottom-3 left-3 hidden flex-wrap gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-[11px] sm:flex">
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-ok-600`} />online</span>
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-warn-600`} />degradované</span>
      <span className="flex items-center gap-1.5"><i className={`${dot} bg-danger-600`} />offline</span>
      <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm bg-[#2f5be9]" />diaľkový</span>
      <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm bg-[#23874f]" />prechod</span>
    </div>
  );
}

/**
 * Digital shadow of a depot (zadanie §7, ADR-045): the hall from GET /api/layout, mirrored live
 * from telematics (scans, devices, gate) and the app (trucks at doors, piles, alarms). Reality ->
 * model automatically; model -> reality only through human decisions in the WMS.
 */
export function ShadowPage() {
  const [params] = useSearchParams();
  const code = params.get("depot") ?? "BUD";
  const measuring = params.get("fps") === "1";
  const layout = useLayout(code);
  const live = useShadow(code);
  useShadowFeed(code);
  const [selection, setSelection] = useState<Selection>(null);
  const [barcode, setBarcode] = useState<string | null>(null);
  const parcel = useParcelLocate(barcode);
  const [fps, setFps] = useState<number | null>(null);
  const onFps = useCallback((v: number) => setFps(v), []);
  const close = useCallback(() => setSelection(null), []);

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
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Digitálny tieň – ${l.depot.name}`}
        subtitle="Hala naživo zo skenerov, vozidiel a WMS. Do reality sa zasahuje len rozhodnutím človeka."
      />
      <KpiBar data={live.data} />
      <Card flush className="relative overflow-hidden">
        <div className="relative h-[55vh] min-h-[360px] md:h-[62vh]">
          <ShadowScene
            layout={l}
            live={live.data}
            selection={selection}
            onSelect={setSelection}
            marks={{ found }}
            onFps={measuring ? onFps : undefined}
          />
          <Legend />
          {measuring && (
            <div data-testid="fps" className="bg-ink absolute top-3 left-3 rounded-lg px-2 py-1 font-mono text-xs text-white">
              {fps === null ? "… fps" : `${String(fps)} fps`}
            </div>
          )}
          {selection?.kind === "device" && <DevicePanel code={selection.code} onClose={close} />}
          {selection?.kind === "dock" && <TruckPanel code={selection.code} onClose={close} />}
        </div>
      </Card>
      <ParcelSearch result={parcel.data} error={parcel.error} loading={parcel.isFetching && !parcel.data} onSearch={setBarcode} />
    </div>
  );
}
