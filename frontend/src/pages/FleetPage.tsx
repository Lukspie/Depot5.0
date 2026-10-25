import { Building2, Maximize2, Truck, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useDepots, useRoutes } from "../api/depots";
import { useVehicle, useVehicles, type Vehicle } from "../api/wms";
import { DepotsOnMap } from "../components/map/DepotsOnMap";
import { MapView, SLOVAKIA, useMap } from "../components/map/MapView";
import { RouteLine } from "../components/map/RouteLine";
import { VehicleMarkers, type MapVehicle } from "../components/map/VehicleMarkers";
import { Badge, Card, DataTable, EmptyState, KeyValue, PageHeader, Progress, SidePanel, Spinner, Tabs, type Column } from "../components/ui";
import { DIRECTION_TYPE, PARCEL_STATUS, TRIP_STATUS, delayLabel, delayTone, hhmm } from "../domain/labels";
import { useChannel } from "../hooks/telematics";

interface Position {
  plate: string;
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
  moving: boolean;
  status: string | null;
  directionCode: string | null;
}

/** Camera: smooth flight to the selected vehicle; buttons for Slovakia and the depots. */
function Camera({ target, view }: { target: [number, number] | null; view: string | null }) {
  const map = useMap();
  const depots = useDepots();
  // /fleet?view=BUD: open zoomed in on a depot (links, demo)
  const viewDepot = depots.data?.find((d) => d.code === view);
  useEffect(() => {
    if (map && viewDepot) {
      map.flyTo({ center: [viewDepot.lon, viewDepot.lat], zoom: 17.2, pitch: 60, bearing: -25, duration: 2000 });
    }
  }, [map, viewDepot]);
  useEffect(() => {
    if (map && target) map.flyTo({ center: [target[1], target[0]], zoom: Math.max(map.getZoom(), 11), pitch: 50, duration: 1600, essential: true });
    // fly only when the selection changes, not on every position update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, target?.[0] === undefined, target === null]);
  if (!map) return null;
  const btn = "bg-surface shadow-card hover:bg-canvas flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap";
  return (
    <div className="absolute top-3 left-14 z-10 flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => map.fitBounds(SLOVAKIA, { padding: 30, pitch: 45, duration: 1200 })}>
        <Maximize2 size={14} /> Celé Slovensko
      </button>
      {depots.data?.map((d) => (
        <button
          key={d.code}
          type="button"
          className={btn}
          onClick={() => map.flyTo({ center: [d.lon, d.lat], zoom: 17.2, pitch: 60, bearing: -25, duration: 2000 })}
        >
          {d.kind === "hub" ? <Building2 size={14} /> : <Warehouse size={14} />} {d.name}
        </button>
      ))}
    </div>
  );
}

function VehiclePanel({ plate, onClose }: { plate: string; onClose: () => void }) {
  const v = useVehicle(plate);
  const d = v.data;
  return (
    <SidePanel
      open
      onClose={onClose}
      eyebrow={d ? `${d.kind === "van" ? "Dodávka" : "Kamión"}${d.trip ? ` · ${DIRECTION_TYPE[d.trip.directionType]}` : ""}` : "Vozidlo"}
      title={plate}
      subtitle={d?.trip ? `${d.trip.directionName}${d.trip.doorCode ? ` · brána ${d.trip.doorCode}` : ""}` : "bez jazdy"}
      icon={<Truck size={22} />}
    >
      {v.isPending ? (
        <Spinner className="py-8" />
      ) : !d ? (
        <EmptyState title="Vozidlo sa nepodarilo načítať" />
      ) : (
        <div className="space-y-5">
          {d.trip && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TRIP_STATUS[d.trip.status].tone}>{TRIP_STATUS[d.trip.status].label}</Badge>
              {d.trip.delayMin !== null && d.trip.delayMin >= 3 && (
                <Badge tone={delayTone(d.trip.delayMin)}>meškanie {delayLabel(d.trip.delayMin)}</Badge>
              )}
            </div>
          )}
          <div>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-ink-muted">Hmotnosť nákladu</span>
              <span className="font-medium tabular-nums">
                {d.parcelsKg.toLocaleString("sk-SK")} / {d.capacityKg.toLocaleString("sk-SK")} kg
              </span>
            </div>
            <Progress value={d.parcelsKg} max={d.capacityKg} tone={d.parcelsKg > d.capacityKg * 0.9 ? "warn" : "ok"} />
            <div className="mt-3 mb-1 flex justify-between text-sm">
              <span className="text-ink-muted">Počet balíkov</span>
              <span className="font-medium tabular-nums">
                {d.parcelsCount} / {d.capacityParcels}
              </span>
            </div>
            <Progress value={d.parcelsCount} max={d.capacityParcels} tone="info" />
          </div>
          {d.trip && (
            <KeyValue
              rows={[
                ["Smer", `${d.trip.directionName} (${d.trip.directionCode})`],
                [d.trip.kind === "inbound" ? "Plánovaný príchod" : "Plánovaný odchod", hhmm(d.trip.kind === "inbound" ? d.trip.plannedArrival : d.trip.plannedDeparture)],
                [
                  d.trip.kind === "inbound" ? "Predikcia príchodu" : "Skutočný odchod",
                  hhmm(d.trip.kind === "inbound" ? (d.trip.actualArrival ?? d.trip.predictedArrival) : d.trip.actualDeparture),
                ],
                ["Zostávajúce zastávky", d.remainingStops.length ? String(d.remainingStops.length) : "— (kuriéri vo fáze 4)"],
              ]}
            />
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Balíky {d.trip?.kind === "inbound" ? "na palube" : "v náklade"} ({d.parcelsCount})
            </h3>
            {d.parcels.length === 0 ? (
              <p className="text-ink-muted text-sm">Zatiaľ žiadne.</p>
            ) : (
              <ul className="divide-line max-h-72 divide-y overflow-y-auto text-sm">
                {d.parcels.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <Link to={`/parcels/${String(p.id)}`} className="text-brand-700 min-w-0 truncate font-mono text-xs hover:underline">
                      {p.barcode}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-ink-muted text-xs tabular-nums">{p.weightKg.toFixed(1)} kg</span>
                      <Badge size="sm" tone={PARCEL_STATUS[p.status].tone}>
                        {PARCEL_STATUS[p.status].label}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SidePanel>
  );
}

export function FleetPage() {
  const vehicles = useVehicles();
  const routes = useRoutes();
  const depots = useDepots();
  const [params, setParams] = useSearchParams();
  const selected = params.get("plate");
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [tab, setTab] = useState<"truck" | "van">("truck");

  useChannel<Position>("vehicles", (ev) => {
    setPositions((prev) => ({ ...prev, [ev.data.plate]: ev.data }));
  });

  const select = (plate: string | null) => {
    setParams(plate ? { plate } : {}, { replace: true });
  };

  // vans are not simulated yet (phase 4): they stand at their home depot, spread on a small ring
  const home = depots.data?.find((d) => d.kind === "depot");
  const markers: MapVehicle[] = useMemo(() => {
    const trips = new Map((vehicles.data ?? []).map((v) => [v.plate, v]));
    const list: MapVehicle[] = Object.values(positions).map((p) => ({
      plate: p.plate,
      kind: trips.get(p.plate)?.kind ?? "truck",
      lat: p.lat,
      lon: p.lon,
      status: p.status,
      delayMin: trips.get(p.plate)?.trip?.delayMin ?? null,
      label: `${p.plate}${p.directionCode ? ` · ${p.directionCode}` : ""}`,
    }));
    const missing = (vehicles.data ?? []).filter((v) => !positions[v.plate]);
    missing.forEach((v, i) => {
      if (!home) return;
      const angle = (2 * Math.PI * i) / Math.max(missing.length, 1);
      list.push({
        plate: v.plate,
        kind: v.kind,
        lat: home.lat + 0.0035 * Math.sin(angle),
        lon: home.lon + 0.0052 * Math.cos(angle),
        status: null,
        delayMin: null,
        label: `${v.plate} · v depe`,
      });
    });
    return list;
  }, [positions, vehicles.data, home]);

  const selectedVehicle = vehicles.data?.find((v) => v.plate === selected);
  const routePoints = selectedVehicle?.trip ? (routes.data?.routes[selectedVehicle.trip.directionCode]?.points ?? null) : null;
  const target = selected ? markers.find((m) => m.plate === selected) : undefined;

  const columns: Column<Vehicle>[] = [
    { key: "plate", header: "Vozidlo", width: "8rem", render: (v) => <span className="font-mono font-medium">{v.plate}</span> },
    {
      key: "trip",
      header: "Jazda",
      minWidth: "10rem",
      title: (v) => v.trip?.directionName ?? "",
      render: (v) =>
        v.trip ? (
          <span className="truncate">
            {v.trip.kind === "inbound" ? "← " : "→ "}
            {v.trip.directionName}
          </span>
        ) : (
          <span className="text-ink-muted">v depe</span>
        ),
    },
    {
      key: "status",
      header: "Stav",
      width: "8.5rem",
      render: (v) => (v.trip ? <Badge tone={TRIP_STATUS[v.trip.status].tone}>{TRIP_STATUS[v.trip.status].label}</Badge> : <Badge>Parkuje</Badge>),
    },
    {
      key: "speed",
      header: "Rýchlosť",
      width: "6rem",
      align: "right",
      hideBelow: "sm",
      render: (v) => <span className="tabular-nums">{positions[v.plate]?.moving ? `${String(positions[v.plate]?.speedKmh)} km/h` : "—"}</span>,
    },
    {
      key: "delay",
      header: "Meškanie",
      width: "7rem",
      render: (v) =>
        v.trip?.delayMin !== null && v.trip?.delayMin !== undefined && v.trip.delayMin >= 3 ? (
          <Badge size="sm" tone={delayTone(v.trip.delayMin)}>
            {delayLabel(v.trip.delayMin)}
          </Badge>
        ) : (
          <span className="text-ink-muted text-xs">včas</span>
        ),
    },
  ];

  const rows = (vehicles.data ?? []).filter((v) => v.kind === tab);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Flotila" subtitle="Kamióny na trasách a dodávky kuriérov – živé polohy" />
      <Card flush className="relative mb-6 overflow-hidden">
        <div className="h-[62vh] min-h-96">
          <MapView>
            <DepotsOnMap />
            <RouteLine points={routePoints} />
            <VehicleMarkers vehicles={markers} selected={selected} onSelect={select} />
            <Camera target={target ? [target.lat, target.lon] : null} view={params.get("view")} />
          </MapView>
        </div>
        {selected && <VehiclePanel plate={selected} onClose={() => select(null)} />}
      </Card>

      <Card
        flush
        title="Vozidlá"
        actions={
          <Tabs
            items={[
              { id: "truck", label: "Kamióny", count: (vehicles.data ?? []).filter((v) => v.kind === "truck").length },
              { id: "van", label: "Dodávky", count: (vehicles.data ?? []).filter((v) => v.kind === "van").length },
            ]}
            active={tab}
            onChange={setTab}
          />
        }
      >
        <DataTable columns={columns} rows={vehicles.data ? rows : undefined} loading={vehicles.isPending} rowKey={(v) => v.plate} onRowClick={(v) => select(v.plate)} selectedKey={selected} />
      </Card>
    </div>
  );
}
