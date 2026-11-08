import { FlaskConical, Play, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useWhatIf, type Intervention, type WhatIfKpis, type WhatIfResult } from "../../api/shadow";
import { useDashboard, type TripBrief } from "../../api/wms";
import { Button, Card } from "../../components/ui";
import { hhmm } from "../../domain/labels";
import type { DepotLayout } from "../layout";
import { useShadowStore } from "../store";
import { actionError } from "../permissions";

type Kind = Intervention["kind"];

const KIND_LABEL: Record<Kind, string> = {
  delay: "Meškanie jazdy",
  device_outage: "Výpadok zariadenia",
  read_rate: "Zmena čítanosti skenera",
  extra_scanner: "Druhý skener na bránu",
  move_trip: "Presun jazdy na inú bránu",
};

const ROWS: { key: keyof WhatIfKpis; label: string }[] = [
  { key: "transitDelayMin", label: "Meškanie prechodov (min spolu)" },
  { key: "transitLate", label: "Oneskorené prechody" },
  { key: "cascadeWarnings", label: "Kaskádové varovania" },
  { key: "unidentified", label: "Neidentifikované balíky" },
  { key: "wrongDirection", label: "Zlé smery" },
  { key: "wrongUndetected", label: "… z toho neodhalené" },
];

function tripLabel(t: TripBrief): string {
  return t.kind === "inbound" ? `← ${t.directionName} (príchod ${hhmm(t.plannedArrival)})` : `→ ${t.directionName} (odchod ${hhmm(t.plannedDeparture)})`;
}

function describe(iv: Intervention, trips: Map<number, TripBrief>): string {
  const t = "tripId" in iv ? trips.get(iv.tripId) : undefined;
  const name = t ? t.directionName : "jazda";
  switch (iv.kind) {
    case "delay":
      return `${name}: meškanie ${String(iv.minutes)} min`;
    case "device_outage":
      return `${iv.device}: výpadok`;
    case "read_rate":
      return `${iv.device}: čítanosť ${String(Math.round(iv.rate * 100))} %`;
    case "extra_scanner":
      return `${iv.doorCode}: druhý skener`;
    case "move_trip":
      return `${name} → brána ${iv.doorCode}`;
  }
}

function Delta({ plan, scenario }: { plan: number; scenario: number }) {
  const d = scenario - plan;
  if (d === 0) return <span className="text-ink-muted">0</span>;
  // every KPI here is "lower is better"
  return <span className={`font-semibold ${d > 0 ? "text-danger-700" : "text-ok-700"}`}>{d > 0 ? `+${String(d)}` : String(d)}</span>;
}

function Results({ r }: { r: WhatIfResult }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="text-ink-muted mb-2 text-xs">
          Od {hhmm(r.from)} do konca prevádzkového dňa ({hhmm(r.to)}).
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-muted text-left text-xs uppercase">
              <th className="py-1 font-medium">Ukazovateľ</th>
              <th className="w-16 py-1 text-right font-medium">Plán</th>
              <th className="w-16 py-1 text-right font-medium">Scenár</th>
              <th className="w-16 py-1 text-right font-medium">Rozdiel</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td className="py-1.5">{row.key === "transitLate" ? `${row.label} (> ${String(r.lateThresholdMin)} min)` : row.label}</td>
                <td className="py-1.5 text-right tabular-nums">{r.plan[row.key]}</td>
                <td className="py-1.5 text-right tabular-nums">{r.scenario[row.key]}</td>
                <td className="py-1.5 text-right tabular-nums">
                  <Delta plan={r.plan[row.key]} scenario={r.scenario[row.key]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold">Dotknuté jazdy</h3>
        {r.trips.length === 0 ? (
          <p className="text-ink-muted text-sm">Časy jázd sa nemenia.</p>
        ) : (
          <ul className="divide-line divide-y text-sm">
            {r.trips.map((t) => (
              <li key={t.tripId} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  {t.kind === "inbound" ? "← " : "→ "}
                  {t.directionName}
                  {t.doorCode && t.kind === "outbound" ? <span className="text-ink-muted"> · {t.doorCode}</span> : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums">
                  {hhmm(t.base)} → <b>{hhmm(t.scenario)}</b>{" "}
                  <span className={t.deltaMin > 0 ? "text-danger-700" : t.deltaMin < 0 ? "text-ok-700" : "text-ink-muted"}>
                    ({t.deltaMin > 0 ? "+" : ""}
                    {t.deltaMin} min)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {r.notes.length > 0 && (
          <p className="text-warn-700 mt-2 text-xs">
            {r.notes.length === 1 ? "Jedna zo zmenených jázd" : "Niektoré zo zmenených jázd"} už prebehli, zásah sa na nich neprejaví.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "Scenár" panel (plan-doplnky, ADR-047): interventions -> telematics computes a copy of the day
 * from now to its end, deterministically and without touching live data -> KPIs plan vs.
 * scenario; affected doors and devices are ringed in the scene.
 */
export function ScenarioPanel({ layout, onAffected }: { layout: DepotLayout; onAffected: (codes: string[] | null) => void }) {
  const dashboard = useDashboard();
  const devices = useShadowStore((s) => s.devices);
  const run = useWhatIf();
  const tripList = useMemo(() => dashboard.data?.trips ?? [], [dashboard.data]);
  const trips = useMemo(() => new Map(tripList.map((t) => [t.id, t])), [tripList]);
  const docks = layout.doors.filter((d) => d.kind === "loading_dock").map((d) => d.code);
  const scanners = Object.values(devices)
    .filter((d) => d.kind === "dock_scanner" || d.kind === "line_scanner")
    .map((d) => d.code)
    .sort();

  const [kind, setKind] = useState<Kind>("delay");
  const [tripId, setTripId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [device, setDevice] = useState<string>("");
  const [ratePct, setRatePct] = useState(85);
  const [door, setDoor] = useState<string>("");
  const [list, setList] = useState<Intervention[]>([]);
  /** a changed list makes the old result (and its rings in the scene) stale */
  const change = (next: Intervention[]) => {
    setList(next);
    run.reset();
    onAffected(null);
  };

  const outbound = tripList.filter((t) => t.kind === "outbound" && (t.status === "planned" || t.status === "at_door"));
  const candidates = kind === "move_trip" ? outbound : tripList.filter((t) => t.status !== "departed" && t.status !== "completed");
  const pickedTrip = tripId ?? candidates[0]?.id ?? null;
  const pickedDevice = device || scanners[0] || "";
  const pickedDoor = door || docks[0] || "";

  function build(): Intervention | null {
    switch (kind) {
      case "delay":
        return pickedTrip === null || !Number.isFinite(minutes) ? null : { kind, tripId: pickedTrip, minutes: Math.round(minutes) };
      case "device_outage":
        return pickedDevice ? { kind, device: pickedDevice } : null;
      case "read_rate":
        return pickedDevice ? { kind, device: pickedDevice, rate: Math.min(100, Math.max(0, ratePct)) / 100 } : null;
      case "extra_scanner":
        return pickedDoor ? { kind, doorCode: pickedDoor } : null;
      case "move_trip":
        return pickedTrip === null || !pickedDoor ? null : { kind, tripId: pickedTrip, doorCode: pickedDoor };
    }
  }

  const field = "border-line bg-surface min-w-0 rounded-xl border px-3 py-2 text-sm";
  const result = run.data;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FlaskConical size={18} /> Scenár (čo ak)
        </span>
      }
      subtitle="Kópia simulácie od teraz do konca prevádzkového dňa. Živé dáta ani iné obrazovky sa nemenia."
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Zásah
          <select className={field} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setTripId(null); }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {(kind === "delay" || kind === "move_trip") && (
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            Jazda
            <select className={field} value={pickedTrip ?? ""} onChange={(e) => setTripId(Number(e.target.value))}>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {tripLabel(t)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "delay" && (
          <label className="flex w-28 flex-col gap-1 text-xs">
            Minúty
            <input className={field} type="number" min={-120} max={600} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        )}
        {(kind === "device_outage" || kind === "read_rate") && (
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Zariadenie
            <select className={field} value={pickedDevice} onChange={(e) => setDevice(e.target.value)}>
              {scanners.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {devices[c]?.doorCode ? ` (${devices[c].doorCode})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "read_rate" && (
          <label className="flex w-28 flex-col gap-1 text-xs">
            Čítanosť %
            <input className={field} type="number" min={0} max={100} value={ratePct} onChange={(e) => setRatePct(Number(e.target.value))} />
          </label>
        )}
        {(kind === "extra_scanner" || kind === "move_trip") && (
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Brána
            <select className={field} value={pickedDoor} onChange={(e) => setDoor(e.target.value)}>
              {docks.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="secondary"
          disabled={list.length >= 10 || build() === null}
          onClick={() => {
            const iv = build();
            if (iv) change([...list, iv]);
          }}
        >
          Pridať zásah
        </Button>
      </div>

      {list.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {list.map((iv, i) => (
            <span key={i} className="bg-canvas flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-xs">
              {describe(iv, trips)}
              <Button variant="ghost" size="sm" className="!rounded-full !p-0.5" aria-label="Odstrániť zásah" onClick={() => change(list.filter((_, j) => j !== i))}>
                <X size={13} />
              </Button>
            </span>
          ))}
          <Button
            icon={<Play size={14} />}
            disabled={run.isPending}
            onClick={() =>
              run.mutate(list, {
                onSuccess: (r) => onAffected([...r.affected.doors, ...r.affected.devices]),
              })
            }
          >
            {run.isPending ? "Počítam…" : "Spustiť scenár"}
          </Button>
          <Button variant="ghost" onClick={() => change([])}>
            Vymazať
          </Button>
        </div>
      )}
      {run.isError && <p className="text-danger-700 mt-3 text-sm">{actionError(run.error)}</p>}
      {result && <Results r={result} />}
    </Card>
  );
}
