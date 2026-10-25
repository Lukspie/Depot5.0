import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { Link, useSearchParams } from "react-router";
import { useVehicle, useVehicles, type Vehicle } from "../api/wms";
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

const DEPOT: [number, number] = [48.695, 21.239];
const SLOVAKIA: L.LatLngBoundsExpression = [
  [47.75, 16.8],
  [49.6, 22.6],
];

const COLORS: Record<string, string> = {
  en_route: "#2f5be9",
  departed: "#2f5be9",
  loading: "#23874f",
  at_door: "var(--color-brand-500)",
  planned: "#8a8a86",
};

function icon(p: Position, selected: boolean, kind: string): L.DivIcon {
  const color = (p.status && COLORS[p.status]) ?? "#8a8a86";
  const size = selected ? 38 : 30;
  const glyph =
    kind === "van"
      ? '<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" fill="white"/>'
      : '<path d="M2 6h12v9H2zM14 9h4l3 3v3h-7z" fill="white"/><circle cx="6" cy="17" r="1.6" fill="white"/><circle cx="17" cy="17" r="1.6" fill="white"/>';
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${String(size)}px;height:${String(size)}px;border-radius:999px;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgb(0 0 0 / .25);border:${selected ? "3px solid #1d1d1b" : "2px solid white"}"><svg width="${String(size * 0.6)}" height="${String(size * 0.6)}" viewBox="0 0 22 22">${glyph}</svg></div>`,
  });
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 9), { duration: 0.6 });
  }, [map, target]);
  return null;
}

function FitSlovakia() {
  const map = useMap();
  return (
    <button
      type="button"
      title="Celé Slovensko"
      aria-label="Celé Slovensko"
      onClick={() => map.fitBounds(SLOVAKIA)}
      className="bg-surface shadow-card hover:bg-canvas absolute top-3 left-14 z-[500] rounded-xl p-2"
    >
      <Maximize2 size={16} />
    </button>
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

  const kindOf = useMemo(() => new Map((vehicles.data ?? []).map((v) => [v.plate, v.kind])), [vehicles.data]);
  // vans are not simulated yet (phase 4): they stand at the depot. Vehicles at the depot share
  // one point, so they are spread on a small ring to stay clickable.
  const markers: Position[] = useMemo(() => {
    const list = Object.values(positions);
    for (const v of vehicles.data ?? []) {
      if (!positions[v.plate]) {
        list.push({ plate: v.plate, lat: DEPOT[0], lon: DEPOT[1], speedKmh: 0, heading: 0, moving: false, status: null, directionCode: null });
      }
    }
    const atDepot = list.filter((p) => Math.abs(p.lat - DEPOT[0]) < 0.002 && Math.abs(p.lon - DEPOT[1]) < 0.002);
    return list.map((p) => {
      const i = atDepot.indexOf(p);
      if (i < 0) return p;
      const angle = (2 * Math.PI * i) / atDepot.length;
      return { ...p, lat: DEPOT[0] + 0.012 * Math.sin(angle), lon: DEPOT[1] + 0.018 * Math.cos(angle) };
    });
  }, [positions, vehicles.data]);

  const target = selected && positions[selected] ? ([positions[selected].lat, positions[selected].lon] as [number, number]) : null;

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
        <div className="isolate h-[55vh] min-h-80">
          <MapContainer center={DEPOT} zoom={8} className="h-full w-full" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {markers.map((p) => (
              <Marker
                key={p.plate}
                position={[p.lat, p.lon]}
                icon={icon(p, p.plate === selected, kindOf.get(p.plate) ?? "truck")}
                eventHandlers={{ click: () => select(p.plate) }}
                zIndexOffset={p.plate === selected ? 1000 : 0}
              >
                <Tooltip direction="top" offset={[0, -14]}>
                  {p.plate}
                  {p.directionCode ? ` · ${p.directionCode}` : ""}
                </Tooltip>
              </Marker>
            ))}
            <FlyTo target={target} />
            <FitSlovakia />
          </MapContainer>
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
