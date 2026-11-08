import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Gauge, Package, PackageCheck, Search, Truck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAckAlert, useDashboard, useParcelSearch, type Alert, type DirectionRow, type TripBrief } from "../api/wms";
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, PageHeader, Progress, Spinner, Tabs, type Column } from "../components/ui";
import {
  ALERT_KIND,
  ALERT_SEVERITY,
  DIRECTION_TYPE,
  TRIP_STATUS,
  WAVE_LABEL,
  dayLabel,
  delayLabel,
  delayTone,
  expectedTime,
  hhmm,
  plannedTime,
} from "../domain/labels";
import { useChannel } from "../hooks/telematics";
import { pct } from "../lib/format";
import { useDepot } from "../hooks/useDepot";

const fmt = new Intl.NumberFormat("sk-SK");

function ParcelSearch() {
  const [q, setQ] = useState("");
  const results = useParcelSearch(q);
  const navigate = useNavigate();
  return (
    <div className="relative w-full sm:w-80">
      <Search size={16} className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Hľadať balík (čiarový kód, meno)…"
        className="border-line bg-surface focus:border-brand-500 focus:ring-brand-100 w-full rounded-xl border py-2 pr-3 pl-9 text-sm outline-none focus:ring-4"
      />
      {q.trim().length >= 3 && (
        <div className="bg-surface shadow-float absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl">
          {results.isPending && <Spinner className="py-4" />}
          {results.data?.length === 0 && <p className="text-ink-muted p-3 text-sm">Nič sa nenašlo.</p>}
          {results.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/parcels/${String(p.id)}`)}
              className="hover:bg-canvas flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{p.barcode}</span>
                <span className="text-ink-muted block truncate text-xs">{p.recipientName}</span>
              </span>
              <Badge size="sm">{p.directionCode}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function tripColumns(): Column<TripBrief>[] {
  return [
    {
      key: "time",
      header: "Plán",
      width: "4.5rem",
      render: (t) => <span className="font-semibold tabular-nums">{hhmm(plannedTime(t))}</span>,
    },
    {
      key: "dir",
      header: "Smer",
      minWidth: "9rem",
      title: (t) => t.directionName,
      render: (t) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{t.directionName}</span>
          <span className="text-ink-muted truncate text-xs">
            {t.vehiclePlate} · {DIRECTION_TYPE[t.directionType]}
          </span>
        </span>
      ),
    },
    { key: "door", header: "Brána", width: "5.5rem", hideBelow: "lg", render: (t) => t.doorCode ?? "—" },
    {
      key: "status",
      header: "Stav",
      width: "8rem",
      render: (t) => <Badge tone={TRIP_STATUS[t.status].tone}>{TRIP_STATUS[t.status].label}</Badge>,
    },
    {
      key: "load",
      header: "Nakládka",
      width: "9rem",
      hideBelow: "sm",
      render: (t) =>
        t.load ? (
          <Progress
            value={t.load.loaded}
            max={Math.max(t.load.expected, 1)}
            label={`${String(t.load.loaded)}/${String(t.load.expected)}`}
            tone={t.status === "departed" && t.load.loaded < t.load.expected ? "warn" : "ok"}
          />
        ) : (
          <span className="text-ink-muted text-xs">—</span>
        ),
    },
    {
      key: "expected",
      header: "Odhad",
      width: "8.5rem",
      render: (t) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="tabular-nums">{hhmm(expectedTime(t))}</span>
          {t.delayMin !== null && Math.abs(t.delayMin) >= 3 && (
            <Badge size="sm" tone={delayTone(t.delayMin)}>
              {delayLabel(t.delayMin)}
            </Badge>
          )}
        </span>
      ),
    },
  ];
}

const DIRECTION_COLUMNS: Column<DirectionRow>[] = [
  {
    key: "name",
    header: "Smer",
    minWidth: "9rem",
    title: (d) => d.name,
    render: (d) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="bg-canvas text-ink-muted shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]">{d.code}</span>
        <span className="truncate">{d.name}</span>
      </span>
    ),
  },
  { key: "type", header: "Typ", width: "6.5rem", hideBelow: "md", render: (d) => <span className="text-ink-muted">{DIRECTION_TYPE[d.type]}</span> },
  { key: "total", header: "Spolu", width: "5rem", align: "right", render: (d) => fmt.format(d.total) },
  { key: "loaded", header: "Naložené", width: "6rem", align: "right", render: (d) => fmt.format(d.loaded) },
  { key: "staged", header: "Odstavené", width: "6.5rem", align: "right", hideBelow: "sm", render: (d) => fmt.format(d.staged) },
  {
    key: "missing",
    header: "Chýba",
    width: "5.5rem",
    align: "right",
    render: (d) => (d.missing > 0 ? <Badge tone="danger" size="sm">{d.missing}</Badge> : <span className="text-ink-muted">0</span>),
  },
];

function AlertList({ alerts }: { alerts: Alert[] }) {
  const ack = useAckAlert();
  if (alerts.length === 0) {
    return <EmptyState title="Žiadne aktívne alarmy" description="Všetko beží podľa plánu." />;
  }
  return (
    <ul className="divide-line divide-y">
      {alerts.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-3">
          <AlertTriangle
            size={18}
            className={`mt-0.5 shrink-0 ${a.severity === "critical" ? "text-danger-700" : "text-warn-700"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <Badge size="sm" tone={ALERT_SEVERITY[a.severity].tone}>
                {ALERT_KIND[a.kind]}
              </Badge>
              <span className="text-ink-muted text-xs tabular-nums">{hhmm(a.createdAt)}</span>
            </div>
            <p className="text-sm">{a.message}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
            Potvrdiť
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const dash = useDashboard(useDepot().code);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tripTab, setTripTab] = useState<"outbound" | "inbound">("outbound");
  // a new alert or a processed scan -> refresh right away instead of waiting for the poll
  useChannel("alerts", () => void qc.invalidateQueries({ queryKey: ["dashboard"] }));

  if (dash.isPending) return <Spinner label="Načítavam dispečing…" className="py-20" />;
  if (dash.isError) {
    return (
      <Card>
        <EmptyState title="Dispečing sa nepodarilo načítať" action={<Button onClick={() => void dash.refetch()}>Skúsiť znova</Button>} />
      </Card>
    );
  }
  const d = dash.data;
  const k = d.kpis;
  const trips = d.trips.filter((t) => t.kind === tripTab);
  const outboundCount = d.trips.filter((t) => t.kind === "outbound").length;
  const inboundCount = d.trips.length - outboundCount;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dispečing"
        subtitle={
          <>
            Prevádzkový deň {dayLabel(d.clock.operatingDay)} ·{" "}
            {d.clock.wave ? WAVE_LABEL[d.clock.wave] : "mimo triediacej vlny"}
          </>
        }
        actions={<ParcelSearch />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={<Package size={22} />} label="Balíky dňa" value={fmt.format(k.parcelsTotal)} context={`${fmt.format(k.parcelsWaiting)} čaká`} />
        <KpiCard
          icon={<PackageCheck size={22} />}
          tone="ok"
          label="Naložené"
          value={fmt.format(k.parcelsLoaded)}
          delta={k.parcelsMissing > 0 ? { value: `−${fmt.format(k.parcelsMissing)}`, tone: "danger" } : undefined}
          context={`odstavené ${fmt.format(k.parcelsStaged + k.parcelsSorted)}`}
        />
        <KpiCard icon={<Truck size={22} />} tone="info" label="Pri bránach" value={k.trucksOnSite} context="kamióny v nakládke" />
        <KpiCard
          icon={<Gauge size={22} />}
          tone={k.readRate !== null && k.readRate < 0.92 ? "warn" : "ok"}
          label="Čítanosť"
          value={pct(k.readRate)}
          context={`${fmt.format(k.unidentified)} neidentif.`}
        />
        <KpiCard
          icon={<AlertTriangle size={22} />}
          tone={k.openAlerts > 0 ? "danger" : "neutral"}
          label="Alarmy"
          value={k.openAlerts}
          context="aktívne"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card
            flush
            title="Jazdy dňa"
            actions={
              <Tabs
                items={[
                  { id: "outbound", label: "Odchody", count: outboundCount },
                  { id: "inbound", label: "Príchody", count: inboundCount },
                ]}
                active={tripTab}
                onChange={setTripTab}
              />
            }
          >
            <DataTable
              columns={tripColumns()}
              rows={trips}
              rowKey={(t) => t.id}
              onRowClick={(t) => navigate(`/fleet?plate=${encodeURIComponent(t.vehiclePlate)}`)}
            />
          </Card>
          <Card flush title="Balíky podľa smerov" subtitle="Naložené, odstavené do rána a chýbajúce po odchode kamióna">
            <DataTable columns={DIRECTION_COLUMNS} rows={d.directions} rowKey={(r) => r.code} compact />
          </Card>
        </div>
        <Card title="Alarmy" subtitle={`${String(d.alerts.length)} aktívnych`} className="self-start">
          <AlertList alerts={d.alerts} />
        </Card>
      </div>
    </div>
  );
}
