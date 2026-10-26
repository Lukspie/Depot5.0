import { AlertTriangle, Clock3, Gauge, Package, ScanLine, Truck } from "lucide-react";
import type { Shadow } from "../../api/shadow";
import { KpiCard } from "../../components/ui";
import { WAVE_SHORT } from "../../domain/labels";
import { useSimClock } from "../../hooks/telematics";
import { useShadowStore } from "../store";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} %`);

/** Top KPI row of the shadow (zadanie §7): parcels, trucks on site, read rate, unidentified, alarms, time. */
export function KpiBar({ data }: { data: Shadow | undefined }) {
  const { now } = useSimClock();
  const cars = useShadowStore((s) => s.yard.length);
  const k = data?.kpis;
  const time = now ? now.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" }) : "—";
  const wave = data?.clock.wave ? WAVE_SHORT[data.clock.wave] : "mimo vlny";
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard icon={<Package size={20} />} label="Balíky dňa" value={k ? k.parcelsTotal.toLocaleString("sk-SK") : "—"} context={k ? `${String(k.parcelsLoaded)} naložených` : undefined} />
      <KpiCard icon={<Truck size={20} />} label="Kamióny" value={k ? String(k.trucksOnSite) : String(data?.trucks.filter((t) => t.state !== "departed" && t.state !== "arriving").length ?? "—")} context={cars ? `+ ${String(cars)} autá na dvore` : "v areáli"} tone="info" />
      <KpiCard icon={<Gauge size={20} />} label="Čítanosť" value={pct(k?.readRate ?? null)} context="za deň" tone="ok" />
      <KpiCard icon={<ScanLine size={20} />} label="Nečitateľné" value={k ? String(k.unidentified) : "—"} context="neidentifikované" tone="warn" />
      <KpiCard icon={<AlertTriangle size={20} />} label="Alarmy" value={k ? String(k.openAlerts) : String(data?.alerts.length ?? "—")} context="aktívne" tone="danger" />
      <KpiCard icon={<Clock3 size={20} />} label="Čas" value={time} context={wave} tone="neutral" />
    </div>
  );
}
