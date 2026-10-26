import { Wrench } from "lucide-react";
import { useState } from "react";
import { useMaintenanceOrders, useMoveTrip, useStartMaintenance, type ShadowDock } from "../../api/shadow";
import { useAckAlert, type Alert } from "../../api/wms";
import { Badge, Button } from "../../components/ui";
import { hhmm } from "../../domain/labels";
import type { DepotLayout } from "../layout";
import { actionError } from "../permissions";

const select = "border-line bg-surface min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm";

function AckButton({ alert }: { alert: Alert }) {
  const ack = useAckAlert();
  return (
    <Button variant="secondary" size="sm" className="shrink-0" disabled={ack.isPending} onClick={() => ack.mutate(alert.id)}>
      Potvrdiť
    </Button>
  );
}

/** Open alarms about one object with an "acknowledge" button (dispatcher). */
export function AlertList({ alerts, canAct }: { alerts: Alert[]; canAct: boolean }) {
  if (alerts.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {alerts.map((a) => (
        <li key={a.id} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${a.severity === "critical" ? "bg-danger-100 text-danger-600" : "bg-warn-100 text-warn-600"}`}>
          <span className="min-w-0 flex-1">{a.message}</span>
          {canAct && <AckButton alert={a} />}
        </li>
      ))}
    </ul>
  );
}

/** Truck panel: move the trip to another loading door (PATCH /api/trips/{id}/door). */
export function MoveTrip({ dock, layout, onMoved }: { dock: ShadowDock; layout: DepotLayout; onMoved: (door: string) => void }) {
  const move = useMoveTrip();
  const doors = layout.doors.filter((d) => d.kind === "loading_dock" && d.code !== dock.code);
  const [target, setTarget] = useState(doors[0]?.code ?? "");
  const trip = dock.trip;
  if (!trip || (trip.status !== "planned" && trip.status !== "at_door")) {
    return <p className="text-ink-muted mt-4 text-xs">Presunúť sa dá len jazda, ktorá ešte nenakladá.</p>;
  }
  return (
    <div className="border-line mt-4 border-t pt-4">
      <h3 className="mb-2 text-sm font-semibold">Presunúť jazdu na inú bránu</h3>
      <div className="flex gap-2">
        <select className={select} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Cieľová brána">
          {doors.map((d) => (
            <option key={d.code} value={d.code}>
              {d.code}
              {d.directionName ? ` (predvolene ${d.directionName})` : ""}
            </option>
          ))}
        </select>
        <Button disabled={!target || move.isPending} onClick={() => move.mutate({ tripId: trip.id, doorCode: target }, { onSuccess: () => onMoved(target) })}>
          Presunúť
        </Button>
      </div>
      {move.isError && <p className="text-danger-600 mt-2 text-xs">{actionError(move.error)}</p>}
    </div>
  );
}

/** Device panel: take the device out of service (POST /api/devices/{code}/maintenance). */
export function Maintenance({ code }: { code: string }) {
  const start = useStartMaintenance();
  const orders = useMaintenanceOrders();
  const [minutes, setMinutes] = useState(20);
  const last = orders.data?.find((o) => o.deviceCode === code);
  return (
    <div className="border-line mt-4 border-t pt-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Wrench size={15} /> Údržba
      </h3>
      <div className="flex items-center gap-2">
        <select className={select} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Dĺžka údržby">
          {[10, 20, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} min (simulovaný čas)
            </option>
          ))}
        </select>
        <Button disabled={start.isPending} onClick={() => start.mutate({ code, minutes })}>
          Označiť na údržbu
        </Button>
      </div>
      <p className="text-ink-muted mt-2 text-xs">Počas údržby skener neposiela skeny (nakládka sa sníma ručne), potom je vyčistený.</p>
      {start.isError && <p className="text-danger-600 mt-2 text-xs">{actionError(start.error)}</p>}
      {last && (
        <p className="mt-2 text-xs">
          <Badge tone="info" size="sm">
            posledná údržba
          </Badge>{" "}
          {hhmm(last.createdAt)}–{hhmm(last.until)} (simulovaný čas)
        </p>
      )}
    </div>
  );
}
