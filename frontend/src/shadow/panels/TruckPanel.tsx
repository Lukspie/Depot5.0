import { ExternalLink, Truck } from "lucide-react";
import { Link } from "react-router";
import { useMe } from "../../api/auth";
import { useDockDetail } from "../../api/shadow";
import { Badge, EmptyState, KeyValue, Progress, SidePanel, Spinner } from "../../components/ui";
import { DIRECTION_TYPE, TRIP_STATUS, delayLabel, delayTone, hhmm } from "../../domain/labels";
import type { DepotLayout } from "../layout";
import { useCanAct } from "../permissions";
import { AlertList, MoveTrip } from "./Actions";

/**
 * Truck at a loading door (zadanie §7): direction, fill in pieces and kg against the capacity,
 * parcels still missing, wrong-direction alarms, planned departure and the cascade warning.
 */
export function TruckPanel({ code, layout, onClose, onMoved }: { code: string; layout: DepotLayout; onClose: () => void; onMoved: (door: string) => void }) {
  const canAct = useCanAct();
  const isAdmin = useMe().data?.role === "admin";
  const q = useDockDetail(code);
  const dock = q.data?.dock;
  const t = dock?.trip;
  const load = t?.load;
  const detail = q.data;
  return (
    <SidePanel
      open
      onClose={onClose}
      inset="md:top-[76px] md:right-[68px]"
      icon={<Truck size={22} />}
      eyebrow={t ? `Kamión · ${DIRECTION_TYPE[t.directionType]}` : "Nakládková brána"}
      title={t ? `${t.directionName} · ${t.vehiclePlate}` : `Brána ${code}`}
      subtitle={t ? `brána ${code}` : dock?.defaultDirectionName ? `predvolený smer ${dock.defaultDirectionName}` : undefined}
    >
      {q.isPending ? (
        <Spinner label="Načítavam bránu…" className="py-8" />
      ) : !t || !detail ? (
        <EmptyState title="Brána je voľná" description="Žiadna jazda tu práve nenakladá." />
      ) : (
        <>
          <AlertList alerts={dock.cascade ? [dock.cascade] : []} canAct={canAct} />
          <KeyValue
            rows={[
              ["Stav", <Badge key="s" tone={TRIP_STATUS[t.status].tone}>{TRIP_STATUS[t.status].label}</Badge>],
              ["Plánovaný odchod", hhmm(t.plannedDeparture)],
              ["Meškanie", <Badge key="d" tone={delayTone(t.delayMin)}>{delayLabel(t.delayMin)}</Badge>],
              ["Na naloženie", load ? `${String(load.expected)} ks` : "—"],
            ]}
          />
          {load && (
            <div className="mt-3 space-y-2 text-sm">
              <div>
                <div className="text-ink-muted mb-1 text-xs">Naplnenosť (ks)</div>
                <Progress value={load.loaded} max={t.capacityParcels} label={`${String(load.loaded)} / ${String(t.capacityParcels)} ks`} tone="info" />
              </div>
              <div>
                <div className="text-ink-muted mb-1 text-xs">Hmotnosť (kg)</div>
                <Progress value={Math.round(load.loadedKg)} max={t.capacityKg} label={`${Math.round(load.loadedKg).toLocaleString("sk-SK")} / ${t.capacityKg.toLocaleString("sk-SK")} kg`} tone="brand" />
              </div>
            </div>
          )}
          <h3 className="mt-4 mb-2 text-sm font-semibold">
            Zlý smer {detail.wrongDirection.length > 0 && <Badge tone="danger" size="sm">{detail.wrongDirection.length}</Badge>}
          </h3>
          {detail.wrongDirection.length === 0 ? (
            <p className="text-ink-muted text-sm">Bez alarmu zlého smeru.</p>
          ) : (
            <ul className="divide-line divide-y text-sm">
              {detail.wrongDirection.map((w, i) => (
                <li key={`${w.at}-${String(i)}`} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate font-mono text-xs">{w.barcode ?? "—"}</span>
                  <span className="text-ink-muted shrink-0 text-xs">patrí do {w.parcelDirection ?? "?"} · {hhmm(w.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 mb-2 text-sm font-semibold">
            Chýbajúce balíky <span className="text-ink-muted font-normal">({detail.missingCount})</span>
          </h3>
          {detail.missing.length === 0 ? (
            <p className="text-ink-muted text-sm">Všetky priradené balíky sú naložené.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 text-xs">
              {detail.missing.map((m) => (
                <li key={m.barcode} className="truncate py-0.5 font-mono" title={`${m.barcode} · ${String(m.weightKg)} kg`}>
                  {m.barcode}
                </li>
              ))}
            </ul>
          )}
          {detail.missingCount > detail.missing.length && (
            <p className="text-ink-muted mt-1 text-xs">… a ďalších {detail.missingCount - detail.missing.length}</p>
          )}
          {canAct && <MoveTrip dock={dock} layout={layout} onMoved={onMoved} />}
          {canAct && (
            <div className="border-line mt-4 flex flex-wrap gap-4 border-t pt-3 text-sm">
              <Link to={`/fleet?plate=${encodeURIComponent(t.vehiclePlate)}`} className="text-brand-700 flex items-center gap-1 underline">
                Vozidlo na mape <ExternalLink size={13} />
              </Link>
              {isAdmin && (
                <Link to={`/loading?door=${encodeURIComponent(code)}`} className="text-brand-700 flex items-center gap-1 underline">
                  Nakládka pri bráne <ExternalLink size={13} />
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </SidePanel>
  );
}
