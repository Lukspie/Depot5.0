import { ScanLine } from "lucide-react";
import { useDeviceMetrics } from "../../api/shadow";
import type { Alert } from "../../api/wms";
import { Badge, KeyValue, SidePanel, StatusDot, type Tone } from "../../components/ui";
import { hhmmss } from "../../domain/labels";
import { useShadowStore, type LiveScan } from "../store";
import { useCanAct } from "../permissions";
import { AlertList, Maintenance } from "./Actions";
import { Sparkline } from "./Sparkline";

const EMPTY: LiveScan[] = [];
const STATUS: Record<string, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "ok" },
  degraded: { label: "Degradované", tone: "warn" },
  offline: { label: "Offline", tone: "danger" },
  maintenance: { label: "Údržba", tone: "neutral" },
};
const KIND: Record<string, string> = {
  dock_scanner: "Skener brány",
  line_scanner: "Skener linky",
  gate_camera: "Kamera vjazdu",
  line_sensor: "Senzor linky",
  door_sensor: "Senzor dverí",
};
/** degradation threshold of the simulator (SIM_DEGRADED_THRESHOLD) */
const THRESHOLD = 0.92;

/** Device detail (zadanie §7): live scans, read rate over the shift, sparkline, risk score (phase 6). */
export function DevicePanel({ code, alerts, onClose }: { code: string; alerts: Alert[]; onClose: () => void }) {
  const canAct = useCanAct();
  const d = useShadowStore((s) => s.devices[code]);
  const recent = useShadowStore((s) => s.recent[code] ?? EMPTY);
  const shift = useDeviceMetrics(code, 8);
  const buckets = shift.data?.buckets ?? [];
  const counted = buckets.reduce((n, b) => n + b.items, 0);
  const read = buckets.reduce((n, b) => n + Math.round(b.items * (b.readRate ?? 0)), 0);
  const status = STATUS[d?.status ?? "offline"] ?? { label: "?", tone: "neutral" as Tone };
  return (
    <SidePanel
      open
      onClose={onClose}
      inset="md:top-[76px] md:right-[68px]"
      icon={<ScanLine size={22} />}
      eyebrow={KIND[d?.kind ?? ""] ?? "Zariadenie"}
      title={code}
      subtitle={d?.doorCode ? `brána ${d.doorCode}` : undefined}
    >
      <KeyValue
        rows={[
          ["Stav", <StatusDot key="s" tone={status.tone}>{status.label}</StatusDot>],
          ["Čítanosť (30 min)", d?.readRate === null || d?.readRate === undefined ? "—" : `${(d.readRate * 100).toFixed(1)} %`],
          ["Čítanosť za smenu (8 h)", counted > 0 ? `${((read / counted) * 100).toFixed(1)} %` : "—"],
          ["Spočítané / prečítané", `${counted.toLocaleString("sk-SK")} / ${read.toLocaleString("sk-SK")}`],
          ["Neidentifikované", (counted - read).toLocaleString("sk-SK")],
          ["Riziko poruchy", <span key="r" className="text-ink-muted">model príde vo Fáze 6</span>],
        ]}
      />
      <AlertList alerts={alerts.filter((a) => a.refType === "device" && a.refId === code)} canAct={canAct} />
      <h3 className="mt-4 mb-1 text-sm font-semibold">Čítanosť za posledné hodiny</h3>
      <Sparkline values={buckets.slice(-36).map((b) => b.readRate)} threshold={THRESHOLD} />
      <h3 className="mt-4 mb-2 text-sm font-semibold">Posledné skeny (naživo)</h3>
      {recent.length === 0 ? (
        <p className="text-ink-muted text-sm">Zatiaľ žiadny sken od otvorenia stránky.</p>
      ) : (
        <ul className="divide-line divide-y text-sm">
          {recent.map((s, i) => (
            <li key={`${s.at}-${String(i)}`} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-ink-muted w-16 shrink-0 text-xs tabular-nums">{hhmmss(s.at)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.barcode ?? "—"}</span>
              {s.readOk ? <Badge tone="ok" size="sm">prečítaný</Badge> : <Badge tone="warn" size="sm">nečitateľný</Badge>}
            </li>
          ))}
        </ul>
      )}
      {canAct && d?.kind !== "gate_camera" && d?.kind !== "door_sensor" && <Maintenance code={code} />}
    </SidePanel>
  );
}
