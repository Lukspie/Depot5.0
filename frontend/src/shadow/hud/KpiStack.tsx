import { AlertTriangle, Gauge, Package, Truck } from "lucide-react";
import type { Shadow } from "../../api/shadow";
import { KpiCard } from "../../components/ui";
import { useShadowStore } from "../store";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

/** KPI cards in the top left corner (zadanie §7): wave parcels, trucks on site, read rate, alarms. */
export function KpiStack({ data }: { data: Shadow | undefined }) {
  const cars = useShadowStore((s) => s.yard.length);
  const k = data?.kpis;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
      <KpiCard
        icon={<Package size={18} />}
        label="Balíky v aktuálnej vlne"
        value={k ? k.parcelsWave.toLocaleString("sk-SK") : "—"}
        context={k ? (k.waveKind === "morning" ? "ranná vlna (nočné kamióny)" : "večerná vlna") : undefined}
      />
      <KpiCard
        icon={<Truck size={18} />}
        label="Kamióny v areáli"
        value={k ? String(k.trucksOnSite) : String(data?.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length ?? "—")}
        context={cars ? `+ ${String(cars)} autá na dvore` : "pri bránach"}
        tone="info"
      />
      <KpiCard icon={<Gauge size={18} />} label="Čítanosť" value={pct(k?.readRate ?? null)} context={k ? `${String(k.unidentified)} nečitateľných` : undefined} tone="ok" />
      <KpiCard icon={<AlertTriangle size={18} />} label="Alarmy" value={k ? String(k.openAlerts) : String(data?.alerts.length ?? "—")} context="aktívne" tone="danger" />
    </div>
  );
}
