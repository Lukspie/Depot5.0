import { ChevronRight, Truck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useMe } from "../../api/auth";
import { useDepots } from "../../api/depots";
import { useDockDetail } from "../../api/shadow";
import { Badge, Button, EmptyState, SidePanel, Spinner, StatusBadge, type Tone } from "../../components/ui";
import { DIRECTION_TYPE, TRIP_STATUS } from "../../domain/labels";
import { useSimClock } from "../../hooks/telematics";
import { hhmm, num, relative } from "../../lib/format";
import type { DepotLayout, DoorState, LayoutDoor } from "../layout";
import { useCanAct } from "../permissions";
import { useShadowStore } from "../store";
import { MoveTrip } from "./Actions";
import { SHADOW_PANEL } from "./placement";

const DOOR_LABEL: Record<DoorState, string> = { open: "otvorená", closed: "zatvorená", fault: "senzor – porucha", unknown: "senzor – bez údajov" };
const DRIVE: Record<LayoutDoor["doorDrive"], string> = { electric: "elektrická", manual: "ručná (lanko)" };
const EQUIPMENT: Record<LayoutDoor["dockEquipment"], string> = { dock_leveler: "vyrovnávací mostík", telescopic_conveyor: "teleskopický pás", none: "bez vybavenia" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line-soft flex items-center justify-between gap-4 border-b py-2.5 text-[13.5px] last:border-0">
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold">{children}</span>
    </div>
  );
}

function Bar({ label, value, max, unit, tone }: { label: string; value: number; max: number; unit: string; tone: "brand" | "neutral" }) {
  const share = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="text-ink-soft tabular-nums">
          {num(value)} / {num(max)} {unit} · {share} %
        </span>
      </div>
      <div className="bg-line-soft h-1.5 overflow-hidden rounded-[3px]">
        <div className="h-full rounded-[3px]" style={{ width: `${String(share)}%`, background: tone === "brand" ? "var(--color-brand-500)" : "#8a8984" }} />
      </div>
    </div>
  );
}

/**
 * Truck at a loading door (zadanie §7, maketa-tien): direction and door, state and departure,
 * fill in pieces and kg, door and equipment, missing parcels, wrong-direction alarm and cascade,
 * actions "Nakládka pri bráne" and "Presunúť bránu".
 */
export function TruckPanel({ code, layout, onClose, onMoved }: { code: string; layout: DepotLayout; onClose: () => void; onMoved: (door: string) => void }) {
  const canAct = useCanAct();
  const isAdmin = useMe().data?.role === "admin";
  const depots = useDepots();
  const { now } = useSimClock();
  const q = useDockDetail(code);
  const [showMissing, setShowMissing] = useState(false);
  const [moving, setMoving] = useState(false);
  const dock = q.data?.dock;
  const t = dock?.trip;
  const load = t?.load;
  const detail = q.data;
  const reading = useShadowStore((s) => s.doors[code]);
  const layoutDoor = layout.doors.find((d) => d.code === code);
  const here = depots.data?.find((d) => d.code === layout.depot.code)?.name ?? layout.depot.name;
  const status = t ? TRIP_STATUS[t.status] : null;
  const wrong = detail?.wrongDirection ?? [];
  return (
    <SidePanel
      open
      onClose={onClose}
      inset={SHADOW_PANEL}
      icon={<Truck size={22} />}
      eyebrow={t ? `Kamión · ${DIRECTION_TYPE[t.directionType]}` : "Nakládková brána"}
      title={t ? t.vehiclePlate : `Brána ${code}`}
      subtitle={t ? `${t.kind === "inbound" ? `${t.directionName} → ${here}` : `${here} → ${t.directionName}`} · brána ${code}` : (dock?.defaultDirectionName ?? undefined)}
    >
      {q.isPending ? (
        <Spinner label="Načítavam bránu…" className="py-8" />
      ) : !t || !detail || !status ? (
        <>
          <Row label="Brána">
            {code} · {DOOR_LABEL[reading?.state ?? "unknown"]}
          </Row>
          <EmptyState title="Brána je voľná" description="Žiadna jazda tu práve nenakladá." />
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2.5 text-[13.5px]">
            <StatusBadge tone={status.tone as Tone}>{status.label}</StatusBadge>
            <span className="text-ink-soft">
              {t.kind === "inbound" ? "príchod" : "odchod"} {hhmm(t.kind === "inbound" ? t.plannedArrival : t.plannedDeparture)}
              {now && (t.kind === "inbound" ? t.plannedArrival : t.plannedDeparture) && ` · ${relative(t.kind === "inbound" ? t.plannedArrival : t.plannedDeparture, now)}`}
            </span>
          </div>
          {load && (
            <div className="bg-subtle border-line mb-2 flex flex-col gap-3 rounded-xl border p-3.5">
              <Bar label="Balíky" value={load.loaded} max={t.capacityParcels || load.expected} unit="ks" tone="brand" />
              <Bar label="Hmotnosť" value={Math.round(load.loadedKg)} max={t.capacityKg} unit="kg" tone="neutral" />
            </div>
          )}
          <Row label="Brána">
            {code} · {DOOR_LABEL[reading?.state ?? "unknown"]}
          </Row>
          <Row label="Vybavenie">{layoutDoor ? `${DRIVE[layoutDoor.doorDrive]} · ${EQUIPMENT[layoutDoor.dockEquipment]}` : "—"}</Row>
          <Row label="Chýbajúce balíky">
            {detail.missingCount === 0 ? (
              "žiadne"
            ) : (
              <button type="button" className="text-brand-700 inline-flex items-center gap-0.5 underline underline-offset-2" onClick={() => setShowMissing((v) => !v)}>
                {num(detail.missingCount)} {showMissing ? "skryť" : "zobraziť"} <ChevronRight size={14} className={showMissing ? "rotate-90" : ""} />
              </button>
            )}
          </Row>
          {showMissing && (
            <ul className="mb-2 grid grid-cols-2 gap-x-3 font-mono text-xs">
              {detail.missing.map((m) => (
                <li key={m.barcode} className="truncate py-0.5" title={`${m.barcode} · ${String(m.weightKg)} kg`}>
                  {m.barcode}
                </li>
              ))}
              {detail.missingCount > detail.missing.length && <li className="text-ink-muted col-span-2 font-sans">… a ďalších {num(detail.missingCount - detail.missing.length)}</li>}
            </ul>
          )}
          <Row label="Zlý smer">
            {wrong.length === 0 ? (
              <span className="text-ink-muted font-normal">bez alarmu</span>
            ) : (
              <Badge tone="danger">
                {wrong.length} {wrong.length === 1 ? "alarm" : "alarmy"} · {hhmm(wrong[0]?.at)}
              </Badge>
            )}
          </Row>
          <Row label="Kaskáda">
            {dock.cascade ? <Badge tone="danger">ohrozuje prechody</Badge> : <Badge tone="ok">bez vplyvu na prechody</Badge>}
          </Row>
          {canAct && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {isAdmin ? (
                <Link
                  to={`/loading?door=${encodeURIComponent(code)}`}
                  className="bg-brand-500 text-on-brand hover:bg-brand-600 grid h-11 place-items-center rounded-[10px] text-sm font-bold no-underline"
                >
                  Nakládka pri bráne
                </Link>
              ) : (
                <Link
                  to={`/fleet?plate=${encodeURIComponent(t.vehiclePlate)}`}
                  className="bg-brand-500 text-on-brand hover:bg-brand-600 grid h-11 place-items-center rounded-[10px] text-sm font-bold no-underline"
                >
                  Vozidlo na mape
                </Link>
              )}
              <Button variant="secondary" size="lg" onClick={() => setMoving((v) => !v)}>
                Presunúť bránu
              </Button>
            </div>
          )}
          {canAct && moving && <MoveTrip dock={dock} layout={layout} onMoved={onMoved} />}
        </>
      )}
    </SidePanel>
  );
}
