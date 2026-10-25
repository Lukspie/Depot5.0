import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { getJson, isApiError } from "../api/client";
import type { Board, TripBrief } from "../api/wms";
import { Logo } from "../components/ui";
import { TRIP_STATUS, WAVE_LABEL, delayLabel, expectedTime, hhmm, plannedTime } from "../domain/labels";

/**
 * Public ETA board for screens in the depot: no login, read-only, key in the URL
 * (/board?key=…). Polls every 10 s (no WebSocket ticket without a login). Big type for reading
 * from a distance; always dark for contrast.
 */

const DELAY_CLS = (min: number | null): string =>
  min === null || min < 10 ? "text-[#7ee2a8]" : min < 30 ? "text-[#ffc861]" : "text-[#ff8a8a]";

function Row({ t }: { t: TripBrief }) {
  const st = TRIP_STATUS[t.status];
  const late = t.delayMin !== null && t.delayMin >= 3;
  return (
    <tr className="border-t border-white/10">
      <td className="py-3 pr-4 text-3xl font-bold tabular-nums">{hhmm(plannedTime(t))}</td>
      <td className="max-w-0 py-3 pr-4">
        <div className="truncate text-2xl font-semibold">{t.directionName}</div>
        <div className="truncate text-base text-white/60">
          {t.vehiclePlate}
          {t.doorCode ? ` · brána ${t.doorCode}` : ""}
        </div>
      </td>
      <td className={`py-3 pr-4 text-2xl font-semibold tabular-nums ${late ? DELAY_CLS(t.delayMin) : ""}`}>
        {hhmm(expectedTime(t))}
      </td>
      <td className={`py-3 pr-4 text-xl whitespace-nowrap ${DELAY_CLS(t.delayMin)}`}>{late ? delayLabel(t.delayMin) : "včas"}</td>
      <td className="py-3 text-lg whitespace-nowrap text-white/80">{st.label}</td>
    </tr>
  );
}

function Column({ title, trips }: { title: string; trips: TripBrief[] }) {
  return (
    <section className="min-w-0 rounded-3xl bg-white/5 p-6">
      <h2 className="mb-2 text-xl font-semibold tracking-widest text-[var(--color-brand-500)] uppercase">{title}</h2>
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: "7rem" }} />
          <col />
          <col style={{ width: "7rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "9rem" }} />
        </colgroup>
        <thead>
          <tr className="text-left text-sm tracking-wider text-white/50 uppercase">
            <th className="pb-2 font-medium">Plán</th>
            <th className="pb-2 font-medium">Smer</th>
            <th className="pb-2 font-medium">Odhad</th>
            <th className="pb-2 font-medium">Meškanie</th>
            <th className="pb-2 font-medium">Stav</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function BoardPage() {
  const [params] = useSearchParams();
  const key = params.get("key") ?? "";
  const board = useQuery({
    queryKey: ["board", key],
    queryFn: () => getJson<Board>(`/api/board?key=${encodeURIComponent(key)}`),
    refetchInterval: 10_000,
    retry: (n, err) => !isApiError(err, 403) && n < 3,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (isApiError(board.error, 403)) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#16171a] p-8 text-white">
        <p className="text-2xl">Tabuľa nie je dostupná – chýba alebo nesedí kľúč v adrese (?key=…).</p>
      </div>
    );
  }
  const b = board.data;
  const active = (t: TripBrief) => t.status !== "completed" && t.status !== "cancelled";
  return (
    <div className="min-h-full bg-[#16171a] p-6 text-white lg:p-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Logo size={56} />
          <div>
            <h1 className="text-4xl font-bold">Príchody a odchody</h1>
            <p className="text-xl text-white/60">Prekládkové depo Košice{b?.clock.wave ? ` · ${WAVE_LABEL[b.clock.wave] ?? ""}` : ""}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-6xl font-bold tabular-nums">{b ? hhmm(b.clock.simTime) : "--:--"}</div>
          <div className="text-lg text-white/60">
            {board.isError ? "spojenie sa obnovuje…" : `linka: ${b?.devices.lineStatus === "online" ? "v prevádzke" : (b?.devices.lineStatus ?? "—")}`}
            {b?.devices.readRate != null && ` · čítanosť ${(b.devices.readRate * 100).toFixed(1)} %`}
          </div>
        </div>
      </header>

      {b && b.warnings.length > 0 && (
        <div className="mb-8 space-y-3">
          {b.warnings.map((w) => (
            <div key={w.id} className="flex items-start gap-4 rounded-2xl bg-[#5a1f1f] px-6 py-4 text-2xl">
              <AlertTriangle size={36} className="mt-1 shrink-0 text-[#ffc861]" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {b ? (
        <div className="grid gap-8 2xl:grid-cols-2">
          <Column title="Príchody" trips={b.arrivals.filter(active)} />
          <Column title="Odchody" trips={b.departures.filter(active)} />
        </div>
      ) : (
        <p className="text-2xl text-white/60">Načítavam…</p>
      )}
      {b && b.devices.offline > 0 && (
        <p className="mt-6 text-xl text-[#ff8a8a]">Offline zariadenia: {b.devices.offline}</p>
      )}
    </div>
  );
}
