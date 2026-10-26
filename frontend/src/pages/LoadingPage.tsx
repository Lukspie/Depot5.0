import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, ScanBarcode } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { isApiError } from "../api/client";
import { useDoors, useDoorView, useManualScan, type ManualScanResult, type ScanResult, type ScanRow } from "../api/wms";
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Spinner, StatusDot } from "../components/ui";
import { SCAN_RESULT, TRIP_STATUS, delayLabel, delayTone, hhmm, hhmmss } from "../domain/labels";
import { useChannel } from "../hooks/telematics";

interface LiveScan {
  door: string;
  tripId: number;
  result: ScanResult;
  barcode: string | null;
  parcelId: number | null;
  parcelDirection: string | null;
  tripDirection: string | null;
  device: string | null;
  at: string;
}

const DOOR_KEY = "depotrack.loading.door";

function loadDoor(): string | null {
  try {
    return window.localStorage.getItem(DOOR_KEY);
  } catch {
    return null;
  }
}

function saveDoor(code: string): void {
  try {
    window.localStorage.setItem(DOOR_KEY, code);
  } catch {
    // per-browser convenience only
  }
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" | "ok" }) {
  const color = tone === "danger" ? "text-danger-600" : tone === "warn" ? "text-warn-600" : tone === "ok" ? "text-ok-600" : "";
  return (
    <div className="bg-canvas rounded-2xl px-4 py-3">
      <div className={`text-3xl font-bold tabular-nums md:text-4xl ${color}`}>{value}</div>
      <div className="text-ink-muted text-sm">{label}</div>
    </div>
  );
}

function ManualScan({ door }: { door: string }) {
  const [code, setCode] = useState("");
  const [last, setLast] = useState<ManualScanResult | null>(null);
  const scan = useManualScan(door);
  const input = useRef<HTMLInputElement>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const barcode = code.trim();
    if (barcode.length < 3) return;
    scan.mutate(barcode, {
      onSuccess: (r) => {
        setLast(r);
        setCode("");
        input.current?.focus();
      },
    });
  }

  const error = scan.isError
    ? isApiError(scan.error, 409)
      ? "Pri tejto bráne sa práve nič nenakladá."
      : "Sken sa nepodarilo uložiť."
    : null;

  return (
    <Card title="Ručný skener" subtitle="Naskenujte alebo zadajte čiarový kód balíka">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <ScanBarcode size={22} className="text-ink-muted pointer-events-none absolute top-1/2 left-4 -translate-y-1/2" />
          <input
            ref={input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="DP…"
            autoComplete="off"
            className="border-line focus:border-brand-500 focus:ring-brand-100 w-full rounded-2xl border py-4 pr-4 pl-12 font-mono text-lg outline-none focus:ring-4"
          />
        </label>
        <Button type="submit" size="lg" disabled={scan.isPending || code.trim().length < 3}>
          Skenovať
        </Button>
      </form>
      {last && (
        <p
          role="status"
          className={`mt-3 rounded-xl px-4 py-3 text-base font-medium ${
            last.result === "ok"
              ? "bg-ok-100 text-ok-600"
              : last.result === "wrong_direction"
                ? "bg-danger-100 text-danger-600"
                : "bg-warn-100 text-warn-600"
          }`}
        >
          {last.parcel?.barcode ?? ""} – {last.message}
          {last.result === "wrong_direction" && last.parcel && ` (patrí do ${last.parcel.directionCode})`}
        </p>
      )}
      {error && <p className="bg-danger-100 text-danger-600 mt-3 rounded-xl px-4 py-3 text-sm">{error}</p>}
    </Card>
  );
}

export function LoadingPage() {
  const doors = useDoors();
  // /loading?door=LD-02 (link from the digital shadow) wins over the remembered door
  const [chosen, setChosen] = useState<string | null>(() => new URLSearchParams(window.location.search).get("door") ?? loadDoor());
  // until the operator picks one: the first door where a truck is being loaded
  const fallback = (doors.data?.find((d) => d.trip && ["at_door", "loading"].includes(d.trip.status)) ?? doors.data?.[0])?.code;
  const door = chosen ?? fallback ?? null;
  const view = useDoorView(door);
  const qc = useQueryClient();
  const [live, setLive] = useState<LiveScan[]>([]);
  const [alarm, setAlarm] = useState<LiveScan | null>(null);
  const refreshTimer = useRef<number | undefined>(undefined);

  function chooseDoor(code: string) {
    setChosen(code);
    saveDoor(code);
    setLive([]);
    setAlarm(null);
  }

  useChannel<LiveScan>("devices", (ev) => {
    if (ev.type !== "loading_scan" || ev.data.door !== door) return;
    setLive((prev) => [ev.data, ...prev].slice(0, 60));
    if (ev.data.result === "wrong_direction") setAlarm(ev.data);
    // counters and the missing list: refresh at most every 1.5 s
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["loading", "door", door] });
    }, 1500);
  });

  const feed = useMemo(() => {
    const fromApi: LiveScan[] = (view.data?.recent ?? []).map((s: ScanRow) => ({
      door: door ?? "",
      tripId: view.data?.door.trip?.id ?? 0,
      result: s.result,
      barcode: s.barcode,
      parcelId: s.parcelId,
      parcelDirection: s.parcelDirection,
      tripDirection: view.data?.door.trip?.directionCode ?? null,
      device: s.device,
      at: s.at,
    }));
    const seen = new Set<string>();
    return [...live, ...fromApi]
      .filter((s) => {
        // WS and REST format the same instant differently ("+00:00" vs "Z")
        const key = `${String(Date.parse(s.at))}|${s.barcode ?? ""}|${s.result}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 40);
  }, [live, view.data, door]);

  const trip = view.data?.door.trip ?? null;
  const load = trip?.load ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Nakládka" subtitle="Živý stav brány: IoT skenery na konci pásu a ručný skener" />

      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Brány">
        {doors.isPending && <Spinner />}
        {doors.data?.map((d) => {
          const active = d.code === door;
          const busy = d.trip && ["at_door", "loading"].includes(d.trip.status);
          return (
            <button
              key={d.code}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => chooseDoor(d.code)}
              className={`flex shrink-0 flex-col items-start rounded-2xl border px-4 py-2.5 text-left transition-colors ${
                active ? "border-brand-500 bg-brand-50" : "border-line bg-surface hover:bg-canvas"
              }`}
            >
              <span className="font-mono text-sm font-semibold">{d.code}</span>
              <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <StatusDot tone={busy ? "ok" : "neutral"} pulse={d.trip?.status === "loading"} />
                {d.trip ? d.trip.directionName : (d.defaultDirection ?? "—")}
              </span>
            </button>
          );
        })}
      </div>

      {alarm && (
        <div
          role="alert"
          className="border-danger-600 bg-danger-100 text-danger-600 mb-5 flex flex-col gap-3 rounded-2xl border-4 p-5 sm:flex-row sm:items-center"
        >
          <AlertOctagon size={44} className="shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold tracking-wide uppercase">Zlý smer – vyložiť balík!</div>
            <div className="text-lg">
              <span className="font-mono">{alarm.barcode}</span> patrí do smeru <b>{alarm.parcelDirection}</b>, kamión
              nakladá <b>{alarm.tripDirection}</b> · {hhmmss(alarm.at)}
            </div>
          </div>
          <Button variant="danger" size="lg" onClick={() => setAlarm(null)}>
            Vyriešené
          </Button>
        </div>
      )}

      {!door || view.isPending ? (
        <Spinner label="Načítavam bránu…" className="py-16" />
      ) : view.isError ? (
        <Card>
          <EmptyState title="Bránu sa nepodarilo načítať" action={<Button onClick={() => void view.refetch()}>Skúsiť znova</Button>} />
        </Card>
      ) : !trip ? (
        <Card>
          <EmptyState title={`Pri bráne ${door} sa práve nenakladá`} description="Kamión tejto brány už odišiel alebo ešte nie je pristavený. Brány so zelenou bodkou nakladajú." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <Card>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-brand-700 text-xs font-semibold tracking-wider uppercase">
                    Brána {door} · {trip.vehiclePlate}
                  </div>
                  <h2 className="truncate text-3xl font-bold">{trip.directionName}</h2>
                  <div className="text-ink-muted mt-1 flex flex-wrap items-center gap-2 text-sm">
                    Odchod {hhmm(trip.plannedDeparture)}
                    {trip.delayMin !== null && trip.delayMin >= 3 && (
                      <Badge size="sm" tone={delayTone(trip.delayMin)}>
                        {delayLabel(trip.delayMin)}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge size="lg" tone={TRIP_STATUS[trip.status].tone}>
                  {TRIP_STATUS[trip.status].label}
                </Badge>
              </div>
              {load && (
                <>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm font-medium">Naložené</span>
                    <span className="text-2xl font-bold tabular-nums">
                      {load.loaded} <span className="text-ink-muted text-base font-normal">/ {load.expected}</span>
                    </span>
                  </div>
                  <Progress value={load.loaded} max={Math.max(load.expected, 1)} className="mb-5 [&>div:first-child]:h-3" />
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Counter label="Spočítané (kamera)" value={load.counted} />
                    <Counter label="Prečítané štítky" value={load.read} tone="ok" />
                    <Counter label="Neidentifikované" value={load.unidentified} tone={load.unidentified > 0 ? "warn" : undefined} />
                    <Counter label="Zlý smer" value={load.wrongDirection} tone={load.wrongDirection > 0 ? "danger" : undefined} />
                  </div>
                </>
              )}
            </Card>

            <ManualScan door={door} />

            <Card flush title="Živý feed skenov" subtitle="IoT skener a ručné skeny pri tejto bráne">
              {feed.length === 0 ? (
                <EmptyState title="Zatiaľ žiadne skeny" description="Skeny sa objavia, keď sa začne nakladať." />
              ) : (
                <ul className="divide-line divide-y">
                  {feed.map((s) => (
                    <li key={`${String(Date.parse(s.at))}|${s.barcode ?? ""}|${s.result}`} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="text-ink-muted w-16 shrink-0 tabular-nums">{hhmmss(s.at)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono">{s.barcode ?? "— štítok neprečítaný —"}</span>
                      {s.result === "wrong_direction" && <span className="text-danger-600 shrink-0 text-xs">→ {s.parcelDirection}</span>}
                      <Badge size="sm" tone={SCAN_RESULT[s.result].tone}>
                        {SCAN_RESULT[s.result].label}
                      </Badge>
                      <span className="text-ink-muted hidden w-20 shrink-0 truncate text-right text-xs sm:block">
                        {s.device === "MANUAL" ? "ručne" : "IoT"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card
            flush
            title="Chýbajúce balíky"
            subtitle={`${String(view.data.missing.length)} ešte nie je v kamióne`}
            className="self-start"
          >
            {view.data.missing.length === 0 ? (
              <EmptyState title="Všetko naložené" />
            ) : (
              <ul className="divide-line max-h-[36rem] divide-y overflow-y-auto">
                {view.data.missing.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">{p.barcode}</span>
                      <span className="text-ink-muted block truncate text-xs">{p.recipientName}</span>
                    </span>
                    <span className="text-ink-muted shrink-0 text-xs tabular-nums">{p.weightKg.toFixed(1)} kg</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
