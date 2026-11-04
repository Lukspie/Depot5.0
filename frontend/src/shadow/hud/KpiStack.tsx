import { AlertTriangle, Gauge, Package, Truck } from "lucide-react";
import type { Shadow } from "../../api/shadow";
import { KpiCard } from "../../components/ui";
import { hhmm } from "../../domain/labels";
import { useShadowStore } from "../store";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

/** The hub has no KPI block, only the alert list the API caps at 30 (api/shadow.py). */
const ALERT_CAP = 30;
const alertCount = (n: number | undefined) => (n === undefined ? "—" : n >= ALERT_CAP ? `${String(ALERT_CAP)}+` : String(n));

/** KPI cards in the top left corner (zadanie §7): wave parcels, trucks on site, read rate, alarms. */
export function KpiStack({ data }: { data: Shadow | undefined }) {
  const cars = useShadowStore((s) => s.yard.length);
  const k = data?.kpis;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
      <KpiCard
        icon={<Package size={18} />}
        label="Balíky v aktuálnej vlne"
        value={!k ? "—" : k.parcelsWave === null ? "mimo vlny" : k.parcelsWave.toLocaleString("sk-SK")}
        context={!k ? undefined : k.waveKind === "night" ? "nočná vlna 01:00–06:00" : k.waveKind === "evening" ? "večerná vlna 15:30–22:00" : `ďalšia o ${hhmm(k.nextWaveAt)}`}
      />
      <KpiCard
        icon={<Truck size={18} />}
        label="Kamióny v areáli"
        value={k ? String(k.trucksOnSite) : String(data?.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length ?? "—")}
        context={cars ? `+ ${String(cars)} ${cars === 1 ? "auto" : cars <= 4 ? "autá" : "áut"} na dvore` : "pri bránach"}
        tone="info"
      />
      <KpiCard icon={<Gauge size={18} />} label="Čítanosť" value={pct(k?.readRate ?? null)} context={k ? `${String(k.unidentified)} nečitateľných` : undefined} tone="ok" />
      <KpiCard icon={<AlertTriangle size={18} />} label="Alarmy" value={k ? String(k.openAlerts) : alertCount(data?.alerts.length)} context="aktívne" tone="danger" />
    </div>
  );
}
