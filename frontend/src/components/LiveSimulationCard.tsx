import { useEffect, useRef, useState } from "react";
import { useChannel, useSimClock, useSocketStatus } from "../hooks/telematics";

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Pripojené", cls: "bg-ok-100 text-ok-700" },
  connecting: { label: "Pripájam…", cls: "bg-info-100 text-info-700" },
  closed: { label: "Odpojené – skúšam znova", cls: "bg-danger-100 text-danger-700" },
};

interface AlertData {
  message: string;
  severity: string;
}

/** Live view of the WebSocket stream from telematics: simulated clock and event rates. */
export function LiveSimulationCard() {
  const status = useSocketStatus();
  const { info, now } = useSimClock();
  const counts = useRef({ vehicles: 0, scans: 0, gate: 0 });
  const [rates, setRates] = useState({ vehicles: 0, scans: 0, gate: 0 });
  const [lastAlert, setLastAlert] = useState<AlertData | null>(null);

  useChannel("vehicles", () => {
    counts.current.vehicles++;
  });
  useChannel<unknown>("devices", (ev) => {
    if (ev.type === "scan") counts.current.scans++;
    if (ev.type === "gate_passage") counts.current.gate++;
  });
  useChannel<AlertData>("alerts", (ev) => {
    setLastAlert(ev.data);
  });

  // events per 10 s window
  useEffect(() => {
    const t = window.setInterval(() => {
      setRates({ ...counts.current });
      counts.current = { vehicles: 0, scans: 0, gate: 0 };
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);

  const s = STATUS[status] ?? { label: status, cls: "" };
  const time = now?.toLocaleTimeString("sk-SK", {
    timeZone: info?.timeZone ?? "Europe/Bratislava",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <section className="bg-surface shadow-card rounded-card p-5 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Živá simulácia (WebSocket z telematiky)</h2>
          <p className="text-ink-muted text-sm">Ticket z app → priame spojenie prehliadača s telematikou</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${s.cls}`}>{s.label}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="bg-canvas rounded-xl px-5 py-4">
          <div className="text-ink-muted text-xs">Simulovaný čas</div>
          <div className="font-mono text-3xl font-semibold tabular-nums">{time ?? "--:--:--"}</div>
          <div className="text-ink-muted mt-1 text-xs whitespace-nowrap">
            {info ? (
              <>
                deň {info.operatingDay} · ×{info.speed} · seed {info.seed}
                {info.paused && <span className="bg-warn-100 text-warn-700 ml-2 rounded-full px-2 py-0.5">pauza</span>}
              </>
            ) : (
              "čakám na hodiny…"
            )}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-center">
          {[
            ["Polohy vozidiel", rates.vehicles],
            ["Skeny", rates.scans],
            ["Prejazdy bránou", rates.gate],
          ].map(([label, value]) => (
            <div key={label} className="bg-canvas rounded-xl px-2 py-3">
              <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              <dt className="text-ink-muted text-xs">{label} / 10 s</dt>
            </div>
          ))}
        </dl>
      </div>

      {lastAlert && (
        <p className="bg-warn-100 text-warn-700 mt-4 rounded-xl px-3 py-2 text-sm">
          <span className="font-medium">Posledný alarm:</span> {lastAlert.message}
        </p>
      )}
    </section>
  );
}
