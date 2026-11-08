import { ArrowLeft, Check, Package } from "lucide-react";
import { Link, useParams } from "react-router";
import { useParcel, type ParcelStatus } from "../api/wms";
import { Badge, Card, DataTable, EmptyState, KeyValue, PageHeader, Spinner, type Column } from "../components/ui";
import { DIRECTION_TYPE, PARCEL_STATUS, SCAN_RESULT, SOURCE, hhmm, hhmmss } from "../domain/labels";
import type { ParcelEvent, ScanRow } from "../api/wms";
import { num } from "../lib/format";

/** Main path of a parcel through the depot (the horizontal timeline). */
const STEPS: { status: ParcelStatus; label: string }[] = [
  { status: "collected", label: "Prijatý" },
  { status: "on_belt", label: "Na páse" },
  { status: "sorted", label: "Vytriedený" },
  { status: "staged", label: "Odstavený" },
  { status: "loaded", label: "Naložený" },
  { status: "out_for_delivery", label: "V doručovaní" },
  { status: "delivered", label: "Doručený" },
];

function Timeline({ events }: { events: ParcelEvent[] }) {
  // the first time a status was reached (passages through checkpoints repeat the status, ADR-071)
  const reached = new Map<ParcelEvent["status"], string>();
  for (const e of events) if (!reached.has(e.status)) reached.set(e.status, e.at);
  const lastIndex = Math.max(...STEPS.map((s, i) => (reached.has(s.status) ? i : -1)));
  return (
    <ol className="no-scrollbar flex overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const at = reached.get(s.status);
        const done = at !== undefined;
        const current = i === lastIndex;
        return (
          <li key={s.status} className="relative flex min-w-24 flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span
                className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${i <= lastIndex ? "bg-brand-500" : "bg-line"}`}
              />
            )}
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ${
                done ? "bg-brand-500 text-on-brand" : "bg-neutral-100 text-ink-muted"
              } ${current ? "ring-brand-100 ring-4" : ""}`}
            >
              {done ? <Check size={16} /> : <span className="text-xs">{i + 1}</span>}
            </span>
            <span className={`mt-2 text-xs whitespace-nowrap ${done ? "font-medium" : "text-ink-muted"}`}>{s.label}</span>
            <span className="text-ink-muted text-[11px] tabular-nums">{at ? hhmm(at) : "—"}</span>
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_COLUMNS: Column<ParcelEvent>[] = [
  { key: "at", header: "Čas", width: "6.5rem", render: (e) => <span className="tabular-nums">{hhmmss(e.at)}</span> },
  { key: "status", header: "Stav", width: "9rem", render: (e) => <Badge tone={PARCEL_STATUS[e.status].tone}>{PARCEL_STATUS[e.status].label}</Badge> },
  { key: "source", header: "Zdroj", width: "8rem", hideBelow: "sm", render: (e) => SOURCE[e.source] },
  {
    key: "where",
    header: "Kde / kto",
    minWidth: "10rem",
    render: (e) =>
      [e.checkpointLabel && `kontrolný bod ${e.checkpointLabel}`, e.doorCode && `brána ${e.doorCode}`, e.vehiclePlate, e.userName].filter(Boolean).join(" · ") || "—",
  },
];

const SCAN_COLUMNS: Column<ScanRow>[] = [
  { key: "at", header: "Čas", width: "6.5rem", render: (s) => <span className="tabular-nums">{hhmmss(s.at)}</span> },
  { key: "result", header: "Výsledok", width: "10rem", render: (s) => <Badge tone={SCAN_RESULT[s.result].tone}>{SCAN_RESULT[s.result].label}</Badge> },
  { key: "device", header: "Zariadenie", minWidth: "8rem", render: (s) => (s.device === "MANUAL" ? "ručný skener" : (s.device ?? "—")) },
];

export function ParcelPage() {
  const id = Number(useParams().id);
  const parcel = useParcel(id);

  if (parcel.isPending) return <Spinner label="Načítavam balík…" className="py-20" />;
  if (parcel.isError) {
    return (
      <Card>
        <EmptyState title="Balík sa nenašiel" action={<Link to="/" className="text-brand-700 underline">Späť na dispečing</Link>} />
      </Card>
    );
  }
  const p = parcel.data;
  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/" className="text-ink-muted hover:text-ink mb-3 inline-flex items-center gap-1 text-sm">
        <ArrowLeft size={16} /> Dispečing
      </Link>
      <PageHeader
        title={p.barcode}
        subtitle={`${p.recipientName} · ${p.address}`}
        actions={
          <Badge size="lg" tone={PARCEL_STATUS[p.status].tone}>
            {PARCEL_STATUS[p.status].label}
          </Badge>
        }
      />
      <Card title="Cesta balíka depom" className="mb-6">
        <Timeline events={p.events} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card title="Údaje" className="self-start">
          <div className="bg-brand-100 text-brand-700 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
            <Package size={22} />
          </div>
          <KeyValue
            rows={[
              ["Smer", `${p.directionName} (${p.directionCode})`],
              ["Typ smeru", DIRECTION_TYPE[p.directionType]],
              ["Hmotnosť", `${num(p.weightKg, 2)} kg`],
              ["Rozmery", `${String(p.lengthCm)} × ${String(p.widthCm)} × ${String(p.heightCm)} cm`],
              ["Odosielateľ", p.sender],
              ["Prijatý do systému", hhmm(p.createdAt)],
            ]}
          />
        </Card>
        <div className="min-w-0 space-y-6">
          <Card flush title="Časová os stavov">
            <DataTable columns={EVENT_COLUMNS} rows={p.events} rowKey={(e) => `${e.status}-${e.at}-${e.checkpoint ?? ""}`} />
          </Card>
          <Card flush title="Skeny pri nakládke">
            <DataTable columns={SCAN_COLUMNS} rows={p.scans} rowKey={(s) => s.id} empty={<EmptyState title="Balík ešte nebol skenovaný pri bráne" />} />
          </Card>
        </div>
      </div>
    </div>
  );
}
