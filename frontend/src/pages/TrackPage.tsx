/**
 * Public customer tracking /track/:token (zadanie 6), mobile-first, no login.
 * Everything shown comes from GET /api/track/{token}; the server decides what may be shown
 * (exact courier position only for the next 3 customers, ADR-042). Polls every 5 s.
 */

import { CheckCircle2, Clock, MapPin, PackageX, Truck } from "lucide-react";
import { useParams } from "react-router";
import { isApiError } from "../api/client";
import { useTrack, type TrackInfo } from "../api/delivery";
import { MapView } from "../components/map/MapView";
import { AccuracyCircle, FitBounds, HOME_ICON, PointMarkers, VAN_ICON, type MapPoint } from "../components/map/Overlays";
import { Card, EmptyState, Logo, Spinner } from "../components/ui";
import { hhmm, hhmmss } from "../domain/labels";

function Header() {
  return (
    <header className="bg-chrome text-chrome-ink flex items-center gap-3 px-4 py-3">
      <Logo size={30} />
      <div className="leading-tight">
        <div className="text-sm font-semibold">Sledovanie zásielky</div>
        <div className="text-chrome-muted text-xs">Depot 5.0</div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas min-h-screen">
      <Header />
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}

function LineProgress({ position }: { position: number }) {
  const dots = Math.min(position, 6);
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: dots }, (_, i) => (
        <span key={i} className={`h-2.5 rounded-full ${i === dots - 1 ? "bg-brand-500 w-6" : "w-2.5 bg-neutral-300"}`} />
      ))}
      {position > 6 && <span className="text-ink-muted text-xs">…</span>}
    </div>
  );
}

function TrackMap({ t }: { t: TrackInfo }) {
  const points: MapPoint[] = [];
  if (t.destination) {
    points.push({
      id: "home",
      ...t.destination,
      icon: HOME_ICON,
      color: "var(--color-brand-500)",
      title: "Miesto doručenia",
    });
  }
  if (t.courier?.exact) {
    points.push({
      id: "van",
      lat: t.courier.lat,
      lon: t.courier.lon,
      icon: VAN_ICON,
      color: "var(--color-info-600)",
      title: "Kuriér",
    });
  }
  const circle =
    t.courier && !t.courier.exact
      ? {
          lat: t.courier.lat,
          lon: t.courier.lon,
          radiusM: t.courier.radiusM ?? 2000,
        }
      : null;
  const fit: [number, number][] = points.map((p) => [p.lat, p.lon]);
  if (circle) {
    const dLat = circle.radiusM / 111_320;
    const dLon = dLat / Math.cos((circle.lat * Math.PI) / 180);
    fit.push(
      [circle.lat + dLat, circle.lon],
      [circle.lat - dLat, circle.lon],
      [circle.lat, circle.lon + dLon],
      [circle.lat, circle.lon - dLon],
    );
  }
  return (
    <Card flush className="overflow-hidden">
      <div className="h-72">
        <MapView pitch={30}>
          <AccuracyCircle circle={circle} />
          <PointMarkers points={points} />
          <FitBounds points={fit} fitKey={`${t.courier?.exact ? "exact" : "approx"}-${String(t.positionInLine ?? 0)}`} />
        </MapView>
      </div>
      <p className="text-ink-muted px-4 py-2.5 text-xs">
        {t.courier?.exact
          ? "Kuriér je už blízko – vidíte jeho aktuálnu polohu."
          : t.courier
            ? `Kuriér rozváža v oblasti ${t.district ?? ""}. Presnú polohu uvidíte, keď budete na rade do 3 zastávok.`
            : "Polohu kuriéra uvidíte, keď vyrazí na trasu."}
      </p>
    </Card>
  );
}

function OnTheWay({ t }: { t: TrackInfo }) {
  const preparing = t.status === "preparing";
  return (
    <>
      <Card>
        <div className="flex items-start gap-3">
          <div className="bg-brand-100 text-brand-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            <Truck size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-semibold">
              {preparing ? "Balík je pripravený na doručenie" : "Váš balík je na ceste"}
            </h1>
            <p className="text-ink-muted text-sm">
              Kuriér {t.courierName ?? ""}
              {preparing ? " ho práve nakladá v depe a čoskoro vyrazí." : ` · ${t.district ?? ""}`}
            </p>
          </div>
        </div>
        {t.etaFrom && t.etaTo && (
          <div className="border-line mt-4 border-t pt-4">
            <div className="text-ink-muted flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
              <Clock size={14} /> Predpokladané doručenie
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {hhmm(t.etaFrom)} – {hhmm(t.etaTo)}
            </div>
          </div>
        )}
        {t.positionInLine !== undefined && (
          <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <div className="text-xl font-semibold">Ste {t.positionInLine}. v poradí</div>
              <div className="text-ink-muted text-sm">
                {t.stopsAhead === 0 ? "Kuriér ide k vám." : `Pred vami ${String(t.stopsAhead)} ${stopsWord(t.stopsAhead ?? 0)}.`}
              </div>
            </div>
            <LineProgress position={t.positionInLine} />
          </div>
        )}
      </Card>
      <TrackMap t={t} />
    </>
  );
}

function stopsWord(n: number): string {
  if (n === 1) return "zastávka";
  if (n >= 2 && n <= 4) return "zastávky";
  return "zastávok";
}

function Delivered({ t }: { t: TrackInfo }) {
  return (
    <Card>
      <div className="flex flex-col items-center py-8 text-center">
        <CheckCircle2 size={56} className="text-ok-700 mb-3" />
        <h1 className="text-2xl font-semibold">Doručené o {hhmm(t.deliveredAt)}</h1>
        <p className="text-ink-muted mt-1 text-sm">Ďakujeme za trpezlivosť.</p>
      </div>
    </Card>
  );
}

function Failed({ t }: { t: TrackInfo }) {
  return (
    <Card>
      <div className="flex flex-col items-center py-8 text-center">
        <PackageX size={56} className="text-warn-700 mb-3" />
        <h1 className="text-xl font-semibold">Nezastihli sme vás</h1>
        <p className="text-ink-muted mt-1 max-w-xs text-sm">
          Kuriér {t.courierName ?? ""} sa pokúsil balík doručiť o {hhmm(t.failedAt)}. Balík sa vráti do depa a doručíme ho v ďalší
          pracovný deň.
        </p>
      </div>
    </Card>
  );
}

export function TrackPage() {
  const { token = "" } = useParams();
  const q = useTrack(token);

  if (q.isPending) {
    return (
      <Shell>
        <Spinner label="Načítavam zásielku…" className="py-20" />
      </Shell>
    );
  }
  // a 429 while polling keeps the last data on screen (several open windows of one link)
  const throttled = isApiError(q.error, 429);
  if (!q.data || (q.isError && !throttled)) {
    const gone = isApiError(q.error, 404) || isApiError(q.error, 422);
    return (
      <Shell>
        <Card>
          <EmptyState
            icon={<MapPin size={20} />}
            title={gone ? "Odkaz je neplatný alebo jeho platnosť skončila" : "Zásielku sa nepodarilo načítať"}
            description={
              isApiError(q.error, 429)
                ? "Príliš veľa požiadaviek. Skúste to o chvíľu znova."
                : gone
                  ? "Odkaz na sledovanie platí do konca dňa doručenia."
                  : "Skúste stránku obnoviť."
            }
          />
        </Card>
      </Shell>
    );
  }
  const t = q.data;
  return (
    <Shell>
      {t.status === "delivered" ? <Delivered t={t} /> : t.status === "failed" ? <Failed t={t} /> : <OnTheWay t={t} />}
      <p className="text-ink-muted text-center text-xs">
        Zásielka <span className="font-mono">{t.barcode}</span>
        {t.updatedAt && t.status !== "delivered" && <> · aktualizované {hhmmss(t.updatedAt)}</>}
      </p>
      {throttled && <p className="text-warn-700 text-center text-xs">Príliš veľa požiadaviek, údaje sa obnovia o chvíľu.</p>}
    </Shell>
  );
}
