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

const DOOR: Record<string, { label: string; tone: Tone }> = {
  open: { label: "brána otvorená", tone: "ok" },
  closed: { label: "brána zatvorená", tone: "neutral" },
  fault: { label: "senzor – porucha", tone: "warn" },
  unknown: { label: "senzor – bez údajov", tone: "neutral" },
};

function DoorBadge({ state }: { state: string | undefined }) {
  const s = DOOR[state ?? "unknown"] ?? { label: "?", tone: "neutral" as Tone };
  return <StatusDot tone={s.tone}>{s.label}</StatusDot>;
}

function Row({ onClick, children, active = false }: { onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active || undefined}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm ${active ? "bg-brand-50" : "hover:bg-canvas"}`}
      >
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
export function ObjectList({ live, onPick, selected }: { live: Shadow | undefined; onPick: (p: Pick) => void; selected?: string | null }) {
  const [tab, setTab] = useState<Tab>("doors");
  const devices = useShadowStore((s) => s.devices);
  const doorReadings = useShadowStore((s) => s.doors);
  const docks = live?.docks ?? [];
  const busy = docks.filter((d) => d.trip && (d.trip.status === "at_door" || d.trip.status === "loading"));
  // the hub has no tracked doors (docks = []): its trucks come from live.trucks; a depot gets
  // there the linehaul trucks that end at it (Žilina)
  const hub = live?.depot.kind === "hub";
  const hubTrucks = (live?.trucks ?? []).filter((t) => t.state === "at_hub" || t.state === "loading_at_hub");
  const deviceList = Object.values(devices).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="bg-surface border-line shadow-card flex max-h-full flex-col rounded-2xl border p-3">
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        className="mb-2"
        items={[
          { id: "doors", label: "Brány", count: `${String(Math.min(busy.length + (hub ? 0 : hubTrucks.length), docks.length))}/${String(docks.length)}` },
          { id: "trucks", label: "Kamióny", count: String(hub ? hubTrucks.length : busy.length + hubTrucks.length) },
          { id: "devices", label: "Zariadenia", count: String(deviceList.length) },
        ]}
      />
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {tab === "doors" &&
          docks.map((d) => (
            <Row key={d.code} active={selected === d.code} onClick={() => onPick({ kind: "dock", code: d.code })}>
              <span className="w-12 shrink-0 font-mono text-xs font-semibold">{d.code}</span>
              <span className="w-10 shrink-0 text-xs">{d.trip?.directionCode ?? d.defaultDirection ?? "—"}</span>
              {d.trip ? <Badge tone={TRIP_STATUS[d.trip.status].tone} size="sm">{TRIP_STATUS[d.trip.status].label}</Badge> : <Badge size="sm">voľná</Badge>}
              <Progress className="min-w-0 flex-1" value={d.trip?.load?.loaded ?? 0} max={d.trip?.load?.expected ?? 0} />
            </Row>
          ))}
        {tab === "doors" && hub && <li className="text-ink-muted px-2 py-3 text-sm">Rampy hubu nemajú sledované brány.</li>}
        {tab === "trucks" &&
          hub &&
          (hubTrucks.length === 0 ? (
            <li className="text-ink-muted px-2 py-3 text-sm">V hube nestojí žiadny kamión.</li>
          ) : (
            hubTrucks.map((t) => (
              <li key={t.plate} className="flex items-center gap-3 px-2 py-2 text-sm">
                <span className="w-20 shrink-0 font-mono text-xs font-semibold">{t.plate}</span>
                <Badge tone={t.state === "loading_at_hub" ? "ok" : "neutral"} size="sm">
                  {t.state === "loading_at_hub" ? "nakladá sa" : "na mieste"}
                </Badge>
              </li>
            ))
          ))}
        {tab === "trucks" &&
          !hub &&
          (busy.length + hubTrucks.length === 0 ? (
            <li className="text-ink-muted px-2 py-3 text-sm">Pri bránach nestojí žiadny kamión.</li>
          ) : (
            busy.map((d) => (
              <Row key={d.code} active={selected === d.code} onClick={() => onPick({ kind: "dock", code: d.code })}>
                <span className="w-20 shrink-0 font-mono text-xs font-semibold">{d.trip?.vehiclePlate}</span>
                <span className="w-12 shrink-0 text-xs">{d.code}</span>
                <Progress className="min-w-0 flex-1" value={Math.round(d.trip?.load?.loadedKg ?? 0)} max={d.trip?.capacityKg ?? 0} tone="brand" />
              </Row>
            ))
          ))}
        {tab === "trucks" &&
          !hub &&
          // linehaul trucks of other depots' directions that end here (Žilina, ADR-065)
          hubTrucks.map((t) => (
            <li key={t.plate} className="flex items-center gap-3 px-2 py-2 text-sm">
              <span className="w-20 shrink-0 font-mono text-xs font-semibold">{t.plate}</span>
              <Badge tone={t.state === "loading_at_hub" ? "ok" : "neutral"} size="sm">
                {t.state === "loading_at_hub" ? "nakladá sa" : "na mieste"}
              </Badge>
            </li>
          ))}
        {tab === "devices" &&
          deviceList.map((dev) => (
            <Row key={dev.code} active={selected === dev.code} onClick={() => onPick({ kind: "device", code: dev.code })}>
              <span className="w-24 shrink-0 font-mono text-xs font-semibold">{dev.code}</span>
              {dev.kind === "door_sensor" ? (
                <DoorBadge state={dev.status === "offline" ? "unknown" : doorReadings[dev.doorCode ?? ""]?.state} />
              ) : (
                <>
                  <StatusDot tone={DEVICE_TONE[dev.status] ?? "neutral"}>{DEVICE_LABEL[dev.status] ?? dev.status}</StatusDot>
                  <Progress className="min-w-0 flex-1" value={Math.round((dev.readRate ?? 0) * 100)} max={dev.readRate === null ? 0 : 100} tone={dev.status === "degraded" ? "warn" : "ok"} />
                </>
              )}
            </Row>
          ))}
      </ul>
      {/* legend of the pins (maketa-tien: at the bottom of the tabs) */}
      <div className="border-line-soft text-ink-muted mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t px-1 pt-2 text-[11.5px]">
        {(["online", "degraded", "offline", "maintenance"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <i className={`inline-block h-2.5 w-2.5 rounded-full ${s === "online" ? "bg-ok-600" : s === "degraded" ? "bg-warn-600" : s === "offline" ? "bg-danger-600" : "bg-[#7c5cd6]"}`} />
            {DEVICE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
