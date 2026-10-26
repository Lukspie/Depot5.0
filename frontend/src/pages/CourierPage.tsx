/**
 * Courier screen /courier (ADR-011): mobile-first list of today's stops with big
 * "Doručené" / "Nezastihnutý" buttons, plus the same map component as /fleet and /track.
 * Admin and dispatcher can pick a courier (?courier=kurier03); only the courier (and admin) can
 * finish a stop.
 */

import { CheckCircle2, ChevronDown, MapPin, Package, PackageX, Truck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMe } from "../api/auth";
import { isApiError } from "../api/client";
import { useCourierRoute, useCourierRoutes, useFinishStop, type CourierRoute, type CourierStop } from "../api/delivery";
import { MapView } from "../components/map/MapView";
import { FitBounds, HOME_ICON, PointMarkers, VAN_ICON, type MapPoint } from "../components/map/Overlays";
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Spinner, Tabs } from "../components/ui";
import { hhmm, PARCEL_STATUS } from "../domain/labels";

function eta(s: CourierStop): string | null {
  return s.predictedEta ?? s.plannedEta;
}

function routeState(r: CourierRoute): {
  label: string;
  tone: "ok" | "info" | "neutral" | "warn";
} {
  if (r.returnedAt) return { label: "Späť v depe", tone: "neutral" };
  if (r.departedAt) return { label: "Na trase", tone: "info" };
  if (r.loaded > 0) return { label: "Nakladá", tone: "ok" };
  return { label: "Pred nakládkou", tone: "neutral" };
}

function NextStop({ stop, canAct }: { stop: CourierStop; canAct: boolean }) {
  const finish = useFinishStop();
  const inVan = stop.parcelStatus === "out_for_delivery";
  const error = finish.error;
  return (
    <Card className="border-brand-500 border-2">
      <div className="text-brand-700 text-[11px] font-semibold tracking-wider uppercase">Ďalšia zastávka</div>
      <div className="mt-1 flex items-start gap-3">
        <div className="bg-brand-500 text-on-brand flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold tabular-nums">
          {stop.sequence}
        </div>
        <div className="min-w-0">
          <div className="text-lg leading-tight font-semibold">{stop.address}</div>
          <div className="text-ink-muted text-sm">{stop.recipientName}</div>
          <div className="text-ink-muted mt-1 flex flex-wrap gap-x-3 text-xs">
            <span className="font-mono">{stop.barcode}</span>
            <span>{stop.weightKg.toFixed(1)} kg</span>
            <span>ETA {hhmm(eta(stop))}</span>
          </div>
        </div>
      </div>
      {canAct && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="bg-ok-600 hover:bg-ok-600 text-white hover:opacity-90"
            icon={<CheckCircle2 size={20} />}
            disabled={!inVan || finish.isPending}
            onClick={() => finish.mutate({ stopId: stop.id, outcome: "delivered" })}
          >
            Doručené
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="text-danger-600 border-danger-600"
            icon={<XCircle size={20} />}
            disabled={!inVan || finish.isPending}
            onClick={() => finish.mutate({ stopId: stop.id, outcome: "failed" })}
          >
            Nezastihnutý
          </Button>
        </div>
      )}
      {!inVan && <p className="text-ink-muted mt-3 text-sm">Balík ešte nie je naskenovaný v dodávke.</p>}
      {error && (
        <p className="text-danger-600 mt-3 text-sm">
          {isApiError(error, 409)
            ? "Zastávka je už uzavretá alebo balík nie je v dodávke."
            : "Nepodarilo sa uložiť, skúste znova."}
        </p>
      )}
    </Card>
  );
}

function StopRow({ s }: { s: CourierStop }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="bg-neutral-100 text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums">
        {s.sequence}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.address}</div>
        <div className="text-ink-muted truncate text-xs">{s.recipientName}</div>
      </div>
      <div className="shrink-0 text-right">
        {s.outcome ? (
          <Badge size="sm" tone={s.outcome === "delivered" ? "ok" : "warn"}>
            {s.outcome === "delivered" ? `Doručené ${hhmm(s.deliveredAt)}` : "Nezastihnutý"}
          </Badge>
        ) : (
          <span className="text-sm tabular-nums">{hhmm(eta(s))}</span>
        )}
      </div>
    </li>
  );
}

function StopsList({ route, canAct }: { route: CourierRoute; canAct: boolean }) {
  const [showDone, setShowDone] = useState(false);
  const open = route.stopList.filter((s) => s.outcome === null);
  const done = route.stopList.filter((s) => s.outcome !== null);
  const [next, ...rest] = open;
  return (
    <div className="space-y-4">
      {next ? (
        <NextStop stop={next} canAct={canAct} />
      ) : (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title="Všetky zastávky sú hotové"
            description="Vráťte sa do depa Budimír."
          />
        </Card>
      )}
      {rest.length > 0 && (
        <Card title={`Ďalšie zastávky (${String(rest.length)})`}>
          <ul className="divide-line -my-2 divide-y">
            {rest.map((s) => (
              <StopRow key={s.id} s={s} />
            ))}
          </ul>
        </Card>
      )}
      {done.length > 0 && (
        <Card
          title={`Hotové (${String(done.length)})`}
          actions={
            <button
              type="button"
              className="text-ink-muted flex items-center gap-1 text-sm"
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? "Skryť" : "Zobraziť"}
              <ChevronDown size={16} className={showDone ? "rotate-180" : ""} />
            </button>
          }
        >
          {showDone && (
            <ul className="divide-line -my-2 divide-y">
              {[...done].reverse().map((s) => (
                <StopRow key={s.id} s={s} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function RouteMap({ route }: { route: CourierRoute }) {
  const open = route.stopList.filter((s) => s.outcome === null);
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
    list.push({
      id: "depot",
      ...route.depot,
      icon: HOME_ICON,
      color: "var(--color-chrome)",
      title: "Depo Budimír",
    });
    if (route.vehicle)
      list.push({
        id: "van",
        lat: route.vehicle.lat,
        lon: route.vehicle.lon,
        icon: VAN_ICON,
        color: "var(--color-info-600)",
        title: route.vehiclePlate,
      });
    return list;
  }, [open, route.depot, route.vehicle, route.vehiclePlate]);
  const fit = open.slice(0, 12).map((s): [number, number] => [s.lat, s.lon]);
  if (route.vehicle) fit.push([route.vehicle.lat, route.vehicle.lon]);
  return (
    <Card flush className="overflow-hidden">
      <div className="h-[60vh] min-h-80">
        <MapView pitch={35}>
          <PointMarkers points={points} />
          <FitBounds points={fit} fitKey={String(route.id)} />
        </MapView>
      </div>
      <p className="text-ink-muted px-4 py-2.5 text-xs">Zobrazených {open.length} otvorených zastávok, oranžová je najbližšia.</p>
    </Card>
  );
}

function CourierPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const routes = useCourierRoutes(true);
  return (
    <select
      className="border-line bg-surface rounded-xl border px-3 py-2 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Kuriér"
    >
      <option value="" disabled>
        Vyber kuriéra…
      </option>
      {routes.data?.map((r) => (
        <option key={r.id} value={r.courierUsername}>
          {r.districtCode} · {r.courierName}
        </option>
      ))}
    </select>
  );
}

export function CourierPage() {
  const me = useMe();
  const role = me.data?.role;
  const isCourier = role === "courier";
  const [params, setParams] = useSearchParams();
  const chosen = isCourier ? null : (params.get("courier") ?? "kurier01");
  const route = useCourierRoute(chosen);
  const [tab, setTab] = useState<"stops" | "map">("stops");
  const canAct = isCourier || role === "admin";

  const header = (
    <PageHeader
      title="Moje zastávky"
      subtitle={isCourier ? "Dnešná trasa a doručenie" : "Pohľad na trasu kuriéra"}
      actions={
        !isCourier ? <CourierPicker value={chosen} onChange={(c) => setParams({ courier: c }, { replace: true })} /> : undefined
      }
    />
  );

  if (route.isPending) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <Spinner label="Načítavam trasu…" className="py-16" />
      </div>
    );
  }
  if (route.isError || !route.data) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <Card>
          <EmptyState
            icon={<Package size={20} />}
            title={isApiError(route.error, 404) ? "Dnes nemáte pridelenú trasu" : "Trasu sa nepodarilo načítať"}
            description="Trasa sa vytvára pre balíky prevádzkového dňa a jazdí sa ráno od 7:30."
          />
        </Card>
      </div>
    );
  }
  const r = route.data;
  const state = routeState(r);
  const finished = r.delivered + r.failed;
  return (
    <div className="mx-auto max-w-2xl">
      {header}
      <Card className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-brand-100 text-brand-700 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <Truck size={22} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {r.districtCode} · {r.districtName}
              </div>
              <div className="text-ink-muted truncate text-sm">
                {r.courierName} · {r.vehiclePlate}
              </div>
            </div>
          </div>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-ink-muted">Hotové zastávky</span>
            <span className="font-medium tabular-nums">
              {finished} / {r.stops}
            </span>
          </div>
          <Progress value={finished} max={r.stops} tone="ok" />
          <div className="text-ink-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1">
              <CheckCircle2 size={13} /> doručené {r.delivered}
            </span>
            <span className="flex items-center gap-1">
              <PackageX size={13} /> nezastihnutí {r.failed}
            </span>
            <span className="flex items-center gap-1">
              <MapPin size={13} /> v dodávke {r.loaded - finished}
            </span>
            {r.departedAt && <span>odchod {hhmm(r.departedAt)}</span>}
          </div>
        </div>
      </Card>
      <Tabs
        items={[
          { id: "stops", label: "Zastávky", count: r.stops - finished },
          { id: "map", label: "Mapa" },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-4"
      />
      {tab === "stops" ? <StopsList route={r} canAct={canAct} /> : <RouteMap route={r} />}
      <p className="text-ink-muted mt-4 text-center text-xs">
        Stav balíka: {PARCEL_STATUS.out_for_delivery.label.toLowerCase()} = naskenovaný v dodávke; „Doručené“ zneplatní zákazníkov
        odkaz na sledovanie.
      </p>
    </div>
  );
}
