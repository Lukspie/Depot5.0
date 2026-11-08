import { AlertTriangle, Gauge, Package, Truck } from "lucide-react";
import type { Shadow } from "../../api/shadow";
import { KpiCard } from "../../components/ui";
import { ALERT_KIND } from "../../domain/labels";
import { hhmm, num, pct } from "../../lib/format";
import { useShadowStore } from "../store";

/** The hub has no KPI block, only the alert list the API caps at 30 (api/shadow.py). */
const ALERT_CAP = 30;
const alertCount = (n: number | undefined) => (n === undefined ? "—" : n >= ALERT_CAP ? `${String(ALERT_CAP)}+` : String(n));

/**
 * Four low KPI cards in one row under the top bar (maketa-tien; two rows below 1380 px): parcels
 * of the wave, trucks on site with the arriving ones, scanner read rate, alarms.
 */
export function KpiStack({ data }: { data: Shadow | undefined }) {
  const cars = useShadowStore((s) => s.yard.filter((c) => c.depot === data?.depot.code).length);
  const degraded = useShadowStore((s) => Object.values(s.devices).find((d) => d.status === "degraded" && d.kind === "dock_scanner"));
  const k = data?.kpis;
  const arriving = data?.trucks.filter((t) => t.state === "arriving").length ?? 0;
  const atHub = data?.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length ?? 0;
  const kinds = [...new Set((data?.alerts ?? []).map((a) => ALERT_KIND[a.kind].toLowerCase()))].slice(0, 3).join(" · ");
  return (
    <div className="shadow-kpis">
      {/* a depot without waves and own trips (Žilina, the hub) gets no empty cards (phase 7d) */}
      {k && (
        <KpiCard
          icon={<Package size={18} />}
          label="Balíky vo vlne"
          value={k.parcelsWave === null ? "mimo vlny" : num(k.parcelsWave)}
          context={k.waveKind === "night" ? "nočná · 01:00–06:00" : k.waveKind === "evening" ? "večerná · 15:30–22:00" : `ďalšia o ${hhmm(k.nextWaveAt)}`}
        />
      )}
      <KpiCard
        icon={<Truck size={18} />}
        label="Kamióny v areáli"
        tone="info"
        value={k ? String(k.trucksOnSite) : String(atHub)}
        unit={arriving ? `+${String(arriving)} prichádza` : undefined}
        context={`${String(k ? k.trucksOnSite : atHub)} pri bránach${cars ? ` · ${String(cars)} ${cars === 1 ? "auto" : cars <= 4 ? "autá" : "áut"} na dvore` : ""}`}
      />
      {k && (
        <KpiCard
          icon={<Gauge size={18} />}
          label="Čítanosť skenerov"
          tone={degraded ? "warn" : "ok"}
          value={pct(k.readRate)}
          context={degraded ? `${degraded.doorCode ?? degraded.code} klesá` : `${num(k.unidentified)} nečitateľných`}
        />
      )}
      <KpiCard
        icon={<AlertTriangle size={18} />}
        label="Alarmy"
        tone="danger"
        value={k ? String(k.openAlerts) : alertCount(data?.alerts.length)}
        unit="aktívne"
        context={kinds || "bez alarmu"}
      />
    </div>
  );
}
