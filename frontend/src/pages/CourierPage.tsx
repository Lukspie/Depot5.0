/**
 * Courier app /courier (ADR-011, phase 7b ADR-062): a mobile app. On a phone it fills the screen,
 * on a desktop it sits in a phone frame (~390 × 844) in the middle. Bottom navigation: stops, map,
 * scanner. The Bluetooth scanner paired with the van is simulated: before the departure a scan
 * loads the parcel into the van, later it selects the stop of the parcel and shows it on the map.
 * Admin and dispatcher look at a courier's app (?courier=kurier03); only the courier (and admin)
 * can finish a stop or scan.
 */

import {
  ArrowLeft,
  Bluetooth,
  BluetoothOff,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Clock,
  ListChecks,
  LogOut,
  Mailbox,
  Map as MapIcon,
  Package,
  PackageCheck,
  ScanLine,
  UserRound,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useLogout, useMe } from "../api/auth";
import { isApiError } from "../api/client";
import { useCourierRoute, useCourierRoutes, useCourierScan, useFinishStop, type CourierRoute, type CourierStop } from "../api/delivery";
import { MapView } from "../components/map/MapView";
import { FitBounds, HOME_ICON, PointMarkers, VAN_ICON, type MapPoint } from "../components/map/Overlays";
import { RouteLine } from "../components/map/RouteLine";
import { Badge, Button, EmptyState, Progress, Spinner, type Tone } from "../components/ui";
import { hhmm } from "../domain/labels";

type Tab = "stops" | "map" | "scan";

const KIND: Record<CourierStop["deliveryType"], { label: string; icon: ReactNode }> = {
  handover: { label: "Osobné odovzdanie", icon: <UserRound size={14} /> },
  mailbox: { label: "Do schránky", icon: <Mailbox size={14} /> },
  locker: { label: "Výdajný box", icon: <Boxes size={14} /> },
};

function eta(s: CourierStop): string | null {
  return s.predictedEta ?? s.plannedEta;
}

/** "Stihneš / nestihneš okno" of a personal handover by the current ETA. */
function windowState(s: CourierStop): { label: string; tone: Tone } | null {
  const e = eta(s);
  if (s.deliveryType !== "handover" || !s.windowFrom || !s.windowTo || !e || s.outcome) return null;
  const t = Date.parse(e);
  if (t > Date.parse(s.windowTo)) return { label: "nestihneš okno", tone: "danger" };
  if (Date.parse(s.windowTo) - t < 15 * 60_000) return { label: "tesne stihneš", tone: "warn" };
  return { label: "stihneš okno", tone: "ok" };
}

function KindBadge({ s }: { s: CourierStop }) {
  const k = KIND[s.deliveryType];
  return (
    <span className="text-ink-muted inline-flex items-center gap-1 text-xs">
      {k.icon}
      {k.label}
      {s.deliveryType === "handover" && s.windowFrom && s.windowTo && (
        <span className="tabular-nums">
          {" "}
          {hhmm(s.windowFrom)}–{hhmm(s.windowTo)}
        </span>
      )}
    </span>
  );
}

/**
 * Open stops split at the last finished one: the next stop is the first open one after it; open
 * stops before it were skipped and must not be shown as "next" with an ETA from the past (5b fix).
 */
function splitStops(stops: CourierStop[]): { upcoming: CourierStop[]; skipped: CourierStop[]; done: CourierStop[] } {
  const done = stops.filter((s) => s.outcome !== null);
  const lastDone = Math.max(0, ...done.map((s) => s.sequence));
  const open = stops.filter((s) => s.outcome === null).sort((a, b) => a.sequence - b.sequence);
  return { upcoming: open.filter((s) => s.sequence > lastDone), skipped: open.filter((s) => s.sequence < lastDone), done };
}

/** The stop to show: the one picked by a scan (while open), else the next on the route. */
function currentStop(route: CourierRoute, selected: number | null): CourierStop | undefined {
  const picked = route.stopList.find((s) => s.id === selected && s.outcome === null);
  return picked ?? splitStops(route.stopList).upcoming[0];
}

function loadingPhase(r: CourierRoute): boolean {
  return !r.departedAt && r.loaded < r.stops;
}

// ------------------------------------------------------------------ stops tab

function LoadingCard({ route, onScan }: { route: CourierRoute; onScan?: () => void }) {
  return (
    <section className="bg-brand-50 border-brand-500 rounded-2xl border-2 p-4">
      <div className="text-brand-700 text-[11px] font-semibold tracking-wider uppercase">Nakládka</div>
      <div className="mt-1 text-lg leading-tight font-semibold">
        Státie {route.stagingBay ?? "—"} · odchod {hhmm(route.plannedDeparture)}
      </div>
      <div className="mt-3 mb-1 flex justify-between text-sm">
        <span className="text-ink-muted">V dodávke</span>
        <span className="font-semibold tabular-nums">
          {route.loaded} / {route.stops}
        </span>
      </div>
      <Progress value={route.loaded} max={route.stops} tone="brand" />
      <p className="text-ink-muted mt-3 text-sm">Naskenujte balíky skenerom pri nakládke. Doručovať sa dá po odchode z depa.</p>
      {onScan && (
        <Button size="lg" className="mt-3 w-full" icon={<ScanLine size={20} />} onClick={onScan}>
          Otvoriť skener
        </Button>
      )}
    </section>
  );
}

function NextStop({ stop, canAct, picked, first }: { stop: CourierStop; canAct: boolean; picked: boolean; first: boolean }) {
  const finish = useFinishStop();
  const w = windowState(stop);
  return (
    <section className="bg-surface border-brand-500 rounded-2xl border-2 p-4">
      <div className="text-brand-700 flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase">
        <span>{picked ? "Vybraná skenom" : first ? "Prvá zastávka po odchode" : "Ďalšia zastávka"}</span>
        {w && <Badge tone={w.tone} size="sm">{w.label}</Badge>}
      </div>
      <div className="mt-1 flex items-start gap-3">
        <div className="bg-brand-500 text-on-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold tabular-nums">
          {stop.sequence}
        </div>
        <div className="min-w-0">
          <div className="text-lg leading-tight font-semibold">{stop.address}</div>
          <div className="text-ink-muted text-sm">{stop.recipientName}</div>
          <div className="mt-1">
            <KindBadge s={stop} />
          </div>
          <div className="text-ink-muted mt-1 flex flex-wrap gap-x-3 text-xs">
            <span className="font-mono">{stop.barcode}</span>
            <span>{stop.weightKg.toFixed(1)} kg</span>
            <span className="flex items-center gap-1">
              <Clock size={12} /> ETA {hhmm(eta(stop))}
            </span>
          </div>
        </div>
      </div>
      {canAct && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="bg-ok-600 hover:bg-ok-600 py-4 text-white hover:opacity-90"
            icon={<CheckCircle2 size={22} />}
            disabled={finish.isPending}
            onClick={() => finish.mutate({ stopId: stop.id, outcome: "delivered" })}
          >
            Doručené
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="text-danger-600 border-danger-600 py-4"
            icon={<XCircle size={22} />}
            disabled={finish.isPending}
            onClick={() => finish.mutate({ stopId: stop.id, outcome: "failed" })}
          >
            Nezastihnutý
          </Button>
        </div>
      )}
      {finish.error && (
        <p className="text-danger-600 mt-3 text-sm">
          {isApiError(finish.error, 409) ? "Zastávka je už uzavretá alebo balík nie je v dodávke." : "Nepodarilo sa uložiť, skúste znova."}
        </p>
      )}
    </section>
  );
}

function StopRow({ s, skipped = false }: { s: CourierStop; skipped?: boolean }) {
  const w = windowState(s);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-sm font-semibold tabular-nums">
        {s.sequence}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.address}</div>
        <KindBadge s={s} />
      </div>
      <div className="shrink-0 text-right">
        {s.outcome ? (
          <Badge size="sm" tone={s.outcome === "delivered" ? "ok" : "warn"}>
            {s.outcome === "delivered" ? `Doručené ${hhmm(s.deliveredAt)}` : "Nezastihnutý"}
          </Badge>
        ) : skipped ? (
          <Badge size="sm" tone="warn">
            vynechaná
          </Badge>
        ) : (
          <>
            <div className="text-sm tabular-nums">{hhmm(eta(s))}</div>
            {w && w.tone !== "ok" && <div className={`text-[11px] ${w.tone === "danger" ? "text-danger-600" : "text-ink-muted"}`}>{w.label}</div>}
          </>
        )}
      </div>
    </li>
  );
}

function StopsTab({ route, canAct, selected, onScan }: { route: CourierRoute; canAct: boolean; selected: number | null; onScan?: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const { upcoming, skipped, done } = splitStops(route.stopList);
  const current = currentStop(route, selected);
  const rest = upcoming.filter((s) => s.id !== current?.id);
  const loading = loadingPhase(route);
  const inVan = current?.parcelStatus === "out_for_delivery";
  return (
    <div className="space-y-3 p-3">
      {loading && <LoadingCard route={route} onScan={onScan} />}
      {current && (!loading || inVan) && (
        <NextStop stop={current} canAct={canAct && inVan && route.departedAt !== null} picked={current.id === selected} first={!route.departedAt} />
      )}
      {current && route.departedAt && !inVan && (
        <p className="text-warn-600 px-1 text-sm">Balík tejto zastávky nie je v dodávke (nenaložený pri nakládke).</p>
      )}
      {!current && (
        <div className="bg-surface rounded-2xl p-4">
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title={skipped.length ? "Trasa je prejdená" : "Všetky zastávky sú hotové"}
            description={skipped.length ? "Zostali vynechané zastávky (nižšie)." : "Vráťte sa do depa Budimír."}
          />
        </div>
      )}
      {rest.length > 0 && (
        <section className="bg-surface rounded-2xl px-4 py-2">
          <h3 className="text-ink-muted pt-2 text-xs font-semibold tracking-wider uppercase">
            {loading ? "Poradie zastávok" : "Ďalšie zastávky"} ({rest.length})
          </h3>
          <ul className="divide-line divide-y">
            {rest.map((s) => (
              <StopRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}
      {skipped.length > 0 && (
        <section className="bg-surface rounded-2xl px-4 py-2">
          <h3 className="text-ink-muted pt-2 text-xs font-semibold tracking-wider uppercase">Vynechané ({skipped.length})</h3>
          <ul className="divide-line divide-y">
            {skipped.map((s) => (
              <StopRow key={s.id} s={s} skipped />
            ))}
          </ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="bg-surface rounded-2xl px-4 py-2">
          <button type="button" className="flex w-full items-center justify-between py-2 text-sm" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <span className="text-ink-muted text-xs font-semibold tracking-wider uppercase">Hotové ({done.length})</span>
            <ChevronDown size={16} className={showDone ? "rotate-180" : ""} />
          </button>
          {showDone && (
            <ul className="divide-line divide-y">
              {[...done].reverse().map((s) => (
                <StopRow key={s.id} s={s} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ map tab

function MapTab({ route, selected }: { route: CourierRoute; selected: number | null }) {
  const current = currentStop(route, selected);
  const open = useMemo(() => {
    const { upcoming, skipped } = splitStops(route.stopList);
    const list = [...upcoming, ...skipped];
    return current ? [current, ...list.filter((s) => s.id !== current.id)] : list;
  }, [route.stopList, current]);
  const start: [number, number] = route.vehicle ? [route.vehicle.lat, route.vehicle.lon] : [route.depot.lat, route.depot.lon];
  // orientation line: from the van (or the depot) through the next stops in order
  const line = useMemo((): [number, number][] => [start, ...open.slice(0, 10).map((s): [number, number] => [s.lat, s.lon])], [start[0], start[1], open]); // eslint-disable-line react-hooks/exhaustive-deps
  const points: MapPoint[] = useMemo(() => {
    const list: MapPoint[] = open.map((s, i) => ({
      id: `s${String(s.id)}`,
      lat: s.lat,
      lon: s.lon,
      label: String(s.sequence),
      variant: "dot",
      color: i === 0 ? "var(--color-brand-500)" : "var(--color-neutral-600)",
      title: `${String(s.sequence)}. ${s.address}`,
    }));
    list.push({ id: "depot", ...route.depot, icon: HOME_ICON, color: "var(--color-chrome)", title: "Depo Budimír" });
    if (route.vehicle)
      list.push({ id: "van", lat: route.vehicle.lat, lon: route.vehicle.lon, icon: VAN_ICON, color: "var(--color-info-600)", title: route.vehiclePlate });
    return list;
  }, [open, route.depot, route.vehicle, route.vehiclePlate]);
  const fit: [number, number][] = current ? [start, [current.lat, current.lon]] : line;
  const w = current ? windowState(current) : null;
  return (
    <div className="relative h-full min-h-[24rem]">
      <MapView pitch={35} className="absolute inset-0">
        <RouteLine points={line} />
        <PointMarkers points={points} />
        <FitBounds points={fit} fitKey={`${String(route.id)}-${String(current?.id ?? 0)}`} />
      </MapView>
      {current && (
        <div className="bg-surface shadow-float absolute inset-x-3 bottom-9 rounded-2xl p-3">
          <div className="flex items-start gap-3">
            <div className="bg-brand-500 text-on-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold tabular-nums">{current.sequence}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{current.address}</div>
              <KindBadge s={current} />
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums">{hhmm(eta(current))}</div>
              {w && <Badge tone={w.tone} size="sm">{w.label}</Badge>}
            </div>
          </div>
          <p className="text-ink-muted mt-2 text-[11px]">Čiara je orientačné poradie ďalších zastávok, nie cesta po uliciach.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ scanner tab

interface ScannerState {
  connected: boolean;
  setConnected: (v: boolean) => void;
  log: { text: string; tone: Tone }[];
  setLog: (f: (l: { text: string; tone: Tone }[]) => { text: string; tone: Tone }[]) => void;
}

function ScanTab({
  route,
  canAct,
  onPicked,
  scanner,
}: {
  route: CourierRoute;
  canAct: boolean;
  onPicked: (stopId: number) => void;
  scanner: ScannerState;
}) {
  const { connected, setConnected, log, setLog } = scanner;
  const [code, setCode] = useState("");
  const scan = useCourierScan();
  const input = useRef<HTMLInputElement>(null);
  const loading = loadingPhase(route);

  const run = (barcode: string) => {
    scan.mutate(barcode, {
      onSuccess: (r) => {
        const msg =
          r.action === "loaded"
            ? `Naložené ${r.stop.barcode} → zastávka ${String(r.stop.sequence)}`
            : r.action === "done"
              ? `${r.stop.barcode}: zastávka ${String(r.stop.sequence)} je už vybavená`
              : `${r.stop.barcode}: zastávka ${String(r.stop.sequence)} na mape`;
        setLog((l) => [{ text: msg, tone: (r.action === "done" ? "neutral" : "ok") as Tone }, ...l].slice(0, 6));
        // during loading a repeated scan only reports; after the departure it opens the map
        if (r.action === "selected" && route.departedAt) onPicked(r.stop.id);
      },
      onError: (err) => {
        const text = isApiError(err, 404)
          ? `${barcode}: nie je na vašej dnešnej trase`
          : isApiError(err, 409)
            ? `${barcode}: teraz sa nedá naložiť (mimo nakládky 6:30 až odchod, alebo balík neprišiel do tohto skladu)`
            : `${barcode}: sken sa nepodarilo uložiť`;
        setLog((l) => [{ text, tone: "danger" as Tone }, ...l].slice(0, 6));
      },
    });
    setCode("");
    input.current?.focus();
  };
  // a simulated scan: during loading the next parcel not yet in the van, then the next open stop
  const simulated = loading
    ? route.stopList.find((s) => s.parcelStatus !== "out_for_delivery" && s.outcome === null)
    : splitStops(route.stopList).upcoming[0];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length >= 3) run(code.trim());
  };

  return (
    <div className="space-y-3 p-3">
      <section className="bg-surface rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${connected ? "bg-info-100 text-info-600" : "bg-neutral-100 text-neutral-600"}`}>
            {connected ? <Bluetooth size={22} /> : <BluetoothOff size={22} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{connected ? "Skener pripojený" : "Skener odpojený"}</div>
            <div className="text-ink-muted text-sm">Spárovaný s vozidlom {route.vehiclePlate} (simulácia)</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setConnected(!connected)}>
            {connected ? "Odpojiť" : "Pripojiť"}
          </Button>
        </div>
      </section>

      {loading && <LoadingCard route={route} />}

      <section className="bg-surface rounded-2xl p-4">
        <h3 className="font-semibold">{loading ? "Nakládka: sken balíka do dodávky" : "Sken balíka v dodávke"}</h3>
        <p className="text-ink-muted mt-1 text-sm">
          {loading ? "Každý sken naloží balík a zákazník dostane SMS s odkazom na sledovanie." : "Sken vyberie zastávku balíka a ukáže ju na mape."}
        </p>
        <Button
          size="lg"
          className="mt-3 w-full py-4"
          icon={<ScanLine size={22} />}
          disabled={!canAct || !connected || !simulated || scan.isPending}
          onClick={() => simulated && run(simulated.barcode)}
        >
          {simulated ? `Simulovať sken ${simulated.barcode}` : "Nič na skenovanie"}
        </Button>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            ref={input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="alebo zadať čiarový kód"
            aria-label="Čiarový kód"
            autoComplete="off"
            disabled={!canAct || !connected}
            className="border-line bg-surface focus:border-brand-500 focus:ring-brand-100 min-w-0 flex-1 rounded-xl border px-3 py-3 font-mono text-base outline-none focus:ring-4"
          />
          <Button type="submit" variant="secondary" disabled={!canAct || !connected || code.trim().length < 3}>
            OK
          </Button>
        </form>
        {!canAct && <p className="text-ink-muted mt-2 text-xs">Skenovať môže len kuriér tejto trasy.</p>}
      </section>

      {log.length > 0 && (
        <ul className="bg-surface divide-line divide-y rounded-2xl px-4 py-1 text-sm" aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={`py-2 ${l.tone === "danger" ? "text-danger-600" : l.tone === "ok" ? "text-ink" : "text-ink-muted"}`}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shell

function CourierPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const routes = useCourierRoutes(true);
  return (
    <select className="border-line bg-surface rounded-xl border px-3 py-2 text-sm" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="Kuriér">
      <option value="" disabled>
        Vyberte kuriéra…
      </option>
      {routes.data?.map((r) => (
        <option key={r.id} value={r.courierUsername}>
          {r.districtCode} · {r.courierName}
        </option>
      ))}
    </select>
  );
}

/** On a phone the whole screen, on a desktop a phone frame in the middle. */
function PhoneFrame({ children, above }: { children: ReactNode; above?: ReactNode }) {
  return (
    <div className="bg-canvas md:flex md:min-h-dvh md:flex-col md:items-center md:justify-center md:gap-3 md:py-6">
      {above && <div className="hidden w-[390px] items-center justify-between gap-2 md:flex">{above}</div>}
      <div className="bg-canvas flex h-dvh w-full flex-col overflow-hidden md:h-[844px] md:max-h-[calc(100dvh-5rem)] md:w-[390px] md:rounded-[2.75rem] md:border-[10px] md:border-neutral-900 md:shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function BottomNav({ tab, onChange, open }: { tab: Tab; onChange: (t: Tab) => void; open: number }) {
  const items: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "stops", label: "Zastávky", icon: <ListChecks size={22} /> },
    { id: "map", label: "Mapa", icon: <MapIcon size={22} /> },
    { id: "scan", label: "Skener", icon: <ScanLine size={22} /> },
  ];
  return (
    <nav className="bg-surface border-line grid shrink-0 grid-cols-3 border-t pb-[env(safe-area-inset-bottom)]" aria-label="Kuriér">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          aria-current={tab === i.id ? "page" : undefined}
          onClick={() => onChange(i.id)}
          className={`relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${tab === i.id ? "text-brand-700" : "text-ink-muted"}`}
        >
          {i.icon}
          {i.label}
          {i.id === "stops" && open > 0 && (
            <span className="bg-brand-500 text-on-brand absolute top-1.5 left-1/2 ml-2 rounded-full px-1.5 text-[10px] leading-4 tabular-nums">{open}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

export function CourierPage() {
  const me = useMe();
  const logout = useLogout();
  const role = me.data?.role;
  const isCourier = role === "courier";
  const [params, setParams] = useSearchParams();
  const chosen = isCourier ? null : (params.get("courier") ?? "kurier01");
  const route = useCourierRoute(chosen);
  const [tab, setTab] = useState<Tab>("stops");
  const [selected, setSelected] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [log, setLog] = useState<{ text: string; tone: Tone }[]>([]);
  const canAct = isCourier || role === "admin";
  const pickCourier = (c: string) => {
    setSelected(null);
    setLog(() => []);
    setParams({ courier: c }, { replace: true });
  };

  const above = !isCourier ? (
    <>
      <Link to="/" className="text-ink-muted flex items-center gap-1 text-sm">
        <ArrowLeft size={16} /> Späť
      </Link>
      <CourierPicker value={chosen} onChange={pickCourier} />
    </>
  ) : (
    <span className="text-ink-muted text-sm">Mobilná aplikácia kuriéra · na telefóne cez http://&lt;IP počítača&gt;:8000/courier</span>
  );

  const r = route.data;
  const finished = r ? r.delivered + r.failed : 0;
  const header = (
    <header className="bg-chrome text-chrome-ink shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r ? `${r.districtCode} · ${r.districtName}` : "Moje zastávky"}</div>
          <div className="truncate text-xs opacity-75">{r ? `${r.courierName} · ${r.vehiclePlate}` : (me.data?.full_name ?? "")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${connected ? "bg-white/10" : "bg-danger-600 text-white"}`}
              title={connected ? "Bluetooth skener spárovaný s vozidlom" : "Skener odpojený"}
            >
              {connected ? <Bluetooth size={12} /> : <BluetoothOff size={12} />} {r.vehiclePlate}
            </span>
          )}
          {isCourier && (
            <button type="button" aria-label="Odhlásiť" className="rounded-full p-1.5 hover:bg-white/10" onClick={() => logout.mutate()}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>
      {r && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-xs opacity-80">
            <span>
              {r.returnedAt ? "Späť v depe" : r.departedAt ? `Na trase od ${hhmm(r.departedAt)}` : loadingPhase(r) ? "Nakládka" : "Naložené, pred odchodom"}
            </span>
            <span className="tabular-nums">
              {finished} / {r.stops} hotových
            </span>
          </div>
          <Progress value={finished} max={r.stops} tone="ok" />
        </div>
      )}
    </header>
  );

  let body: ReactNode;
  if (route.isPending) body = <Spinner label="Načítavam trasu…" className="py-16" />;
  else if (!r)
    body = (
      <div className="p-4">
        <EmptyState
          icon={<Package size={20} />}
          title={isApiError(route.error, 404) ? "Dnes nemáte pridelenú trasu" : "Trasu sa nepodarilo načítať"}
          description="Trasa sa vytvára pre balíky prevádzkového dňa, nakladá sa od 6:30 a jazdí od 7:30."
        />
      </div>
    );
  else if (tab === "stops") body = <StopsTab route={r} canAct={canAct} selected={selected} onScan={isCourier ? () => setTab("scan") : undefined} />;
  else if (tab === "map") body = <MapTab route={r} selected={selected} />;
  else
    body = (
      <ScanTab
        route={r}
        canAct={isCourier}
        scanner={{ connected, setConnected, log, setLog }}
        onPicked={(id) => {
          setSelected(id);
          setTab("map");
        }}
      />
    );

  return (
    <PhoneFrame above={above}>
      {header}
      {!isCourier && (
        <div className="bg-surface border-line flex items-center justify-between gap-2 border-b px-3 py-2 md:hidden">
          <Link to="/" className="text-ink-muted flex items-center gap-1 text-sm">
            <ArrowLeft size={16} /> Späť
          </Link>
          <CourierPicker value={chosen} onChange={pickCourier} />
        </div>
      )}
      {r && route.isError && (
        <div className="bg-warn-100 text-warn-600 shrink-0 px-3 py-1.5 text-xs" role="status">
          Bez spojenia, zobrazené údaje z {new Date(route.dataUpdatedAt).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })}.
        </div>
      )}
      <main className={`min-h-0 flex-1 ${tab === "map" ? "overflow-hidden" : "overflow-y-auto"}`}>{body}</main>
      {r && (
        <div className="text-ink-muted bg-canvas flex shrink-0 items-center justify-center gap-1 py-1 text-[10px]">
          <PackageCheck size={11} /> v dodávke {Math.max(0, r.loaded - finished)} · doručené {r.delivered} · nezastihnutí {r.failed}
        </div>
      )}
      <BottomNav tab={tab} onChange={setTab} open={r ? r.stops - finished : 0} />
    </PhoneFrame>
  );
}
