import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Shadow } from "../../api/shadow";
import { Badge, Progress, StatusDot, Tabs, type Tone } from "../../components/ui";
import { TRIP_STATUS } from "../../domain/labels";
import { useShadowStore } from "../store";

type Tab = "doors" | "trucks" | "devices";
export type Pick = { kind: "dock" | "device"; code: string };

const DEVICE_TONE: Record<string, Tone> = { online: "ok", degraded: "warn", offline: "danger", maintenance: "neutral" };
const DEVICE_LABEL: Record<string, string> = { online: "online", degraded: "degradované", offline: "offline", maintenance: "údržba" };

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="hover:bg-canvas flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm">
        {children}
        <ChevronRight size={15} className="text-ink-muted shrink-0" />
      </button>
    </li>
  );
}

/**
 * Bottom-right list (reference): tabs Brány x/y · Kamióny · Zariadenia; a row is code, state,
 * mini progress and "›". A click focuses the camera on the object and opens its detail.
 */
export function ObjectList({ live, onPick }: { live: Shadow | undefined; onPick: (p: Pick) => void }) {
  const [tab, setTab] = useState<Tab>("doors");
  const devices = useShadowStore((s) => s.devices);
  const docks = live?.docks ?? [];
  const busy = docks.filter((d) => d.trip && (d.trip.status === "at_door" || d.trip.status === "loading"));
  const deviceList = Object.values(devices).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="bg-surface shadow-card flex max-h-full flex-col rounded-2xl p-3">
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        className="mb-2"
        items={[
          { id: "doors", label: "Brány", count: `${String(busy.length)}/${String(docks.length)}` },
          { id: "trucks", label: "Kamióny", count: String(busy.length) },
          { id: "devices", label: "Zariadenia", count: String(deviceList.length) },
        ]}
      />
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {tab === "doors" &&
          docks.map((d) => (
            <Row key={d.code} onClick={() => onPick({ kind: "dock", code: d.code })}>
              <span className="w-12 shrink-0 font-mono text-xs font-semibold">{d.code}</span>
              <span className="w-10 shrink-0 text-xs">{d.trip?.directionCode ?? d.defaultDirection ?? "—"}</span>
              {d.trip ? <Badge tone={TRIP_STATUS[d.trip.status].tone} size="sm">{TRIP_STATUS[d.trip.status].label}</Badge> : <Badge size="sm">voľná</Badge>}
              <Progress className="min-w-0 flex-1" value={d.trip?.load?.loaded ?? 0} max={d.trip?.load?.expected ?? 0} />
            </Row>
          ))}
        {tab === "trucks" &&
          (busy.length === 0 ? (
            <li className="text-ink-muted px-2 py-3 text-sm">Pri bránach nestojí žiadny kamión.</li>
          ) : (
            busy.map((d) => (
              <Row key={d.code} onClick={() => onPick({ kind: "dock", code: d.code })}>
                <span className="w-20 shrink-0 font-mono text-xs font-semibold">{d.trip?.vehiclePlate}</span>
                <span className="w-12 shrink-0 text-xs">{d.code}</span>
                <Progress className="min-w-0 flex-1" value={Math.round(d.trip?.load?.loadedKg ?? 0)} max={d.trip?.capacityKg ?? 0} tone="brand" />
              </Row>
            ))
          ))}
        {tab === "devices" &&
          deviceList.map((dev) => (
            <Row key={dev.code} onClick={() => onPick({ kind: "device", code: dev.code })}>
              <span className="w-24 shrink-0 font-mono text-xs font-semibold">{dev.code}</span>
              <StatusDot tone={DEVICE_TONE[dev.status] ?? "neutral"}>{DEVICE_LABEL[dev.status] ?? dev.status}</StatusDot>
              <Progress className="min-w-0 flex-1" value={Math.round((dev.readRate ?? 0) * 100)} max={dev.readRate === null ? 0 : 100} tone={dev.status === "degraded" ? "warn" : "ok"} />
            </Row>
          ))}
      </ul>
    </div>
  );
}
