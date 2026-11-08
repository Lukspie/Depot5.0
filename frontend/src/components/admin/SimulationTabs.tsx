import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, FastForward, Pause, Play, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { isApiError } from "../../api/client";
import { telematics, type ClockInfo, type DeviceInfo, type SituationInfo } from "../../api/telematicsApi";
import { useDirectionsAdmin, useUpdateDirection, type DirectionAdmin } from "../../api/wms";
import { DIRECTION_TYPE, dayLabel } from "../../domain/labels";
import { useSimClock } from "../../hooks/telematics";
import { Badge, Button, Card, DataTable, KeyValue, StatusDot, type Column, type Tone } from "../ui";
import { num, pct } from "../../lib/format";

// ------------------------------------------------------------------ directions

function TimeCell({ d, field }: { d: DirectionAdmin; field: "plannedDeparture" | "cutoffTime" }) {
  const update = useUpdateDirection();
  const value = (d[field] ?? "").slice(0, 5);
  return (
    <input
      type="time"
      defaultValue={value}
      aria-label={field === "plannedDeparture" ? `Odchod ${d.name}` : `Uzávierka ${d.name}`}
      onBlur={(e) => {
        const v = e.target.value;
        if (v && v !== value) update.mutate({ id: d.id, [field]: `${v}:00` });
      }}
      className="border-line focus:border-brand-500 w-24 rounded-lg border px-2 py-1 text-sm tabular-nums outline-none"
    />
  );
}

export function DirectionsTab() {
  const q = useDirectionsAdmin();
  const columns: Column<DirectionAdmin>[] = [
    {
      key: "name",
      header: "Smer",
      minWidth: "10rem",
      title: (d) => d.name,
      render: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="bg-canvas shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]">{d.code}</span>
          <span className="truncate">{d.name}</span>
        </span>
      ),
    },
    { key: "type", header: "Typ", width: "7rem", render: (d) => <Badge size="sm">{DIRECTION_TYPE[d.type]}</Badge> },
    { key: "door", header: "Brána", width: "6.5rem", hideBelow: "md", render: (d) => d.doorCode ?? "—" },
    { key: "dep", header: "Odchod", width: "8rem", control: true, render: (d) => <TimeCell d={d} field="plannedDeparture" /> },
    { key: "cut", header: "Uzávierka", width: "8rem", control: true, render: (d) => <TimeCell d={d} field="cutoffTime" /> },
    {
      key: "deps",
      header: "Dopĺňajú ho",
      width: "9rem",
      hideBelow: "lg",
      render: (d) => (d.dependsOnLinehaul.length ? d.dependsOnLinehaul.join(", ") : "—"),
    },
  ];
  return (
    <Card flush title="Smery" subtitle="Zmena časov platí pre plány jázd vytvorené odteraz (nasledujúce dni).">
      <DataTable columns={columns} rows={q.data} loading={q.isPending} rowKey={(d) => d.id} />
    </Card>
  );
}

// ------------------------------------------------------------------ devices

const DEVICE_KIND: Record<DeviceInfo["kind"], string> = {
  dock_scanner: "Skener pri bráne",
  line_scanner: "Skener na linke",
  gate_camera: "Kamera brány",
  line_sensor: "Senzor linky",
  door_sensor: "Senzor dverí brány",
};
const DEVICE_TONE: Record<DeviceInfo["status"], Tone> = { online: "ok", degraded: "warn", offline: "danger", maintenance: "info" };
const DEVICE_STATUS: Record<DeviceInfo["status"], string> = { online: "online", degraded: "degradovaný", offline: "offline", maintenance: "údržba" };

export function DevicesTab() {
  const qc = useQueryClient();
  // SIM_CONTROLS_ENABLED=false: device switches are simulation controls too (ADR-053)
  const controls = useSimClock().info?.controlsEnabled !== false;
  const devices = useQuery({
    queryKey: ["telematics", "devices"],
    queryFn: () => telematics<{ devices: DeviceInfo[] }>("GET", "/devices"),
    refetchInterval: 5000,
  });
  const update = useMutation({
    mutationFn: ({ code, ...body }: { code: string; enabled?: boolean; repair?: boolean }) =>
      telematics<DeviceInfo>("PUT", `/sim/devices/${code}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telematics", "devices"] }),
  });
  const columns: Column<DeviceInfo>[] = [
    { key: "code", header: "Zariadenie", width: "9.5rem", render: (d) => <span className="font-mono text-xs font-medium">{d.code}</span> },
    { key: "kind", header: "Typ", minWidth: "9rem", render: (d) => <span className="truncate">{DEVICE_KIND[d.kind]}</span> },
    { key: "door", header: "Brána", width: "6.5rem", hideBelow: "md", render: (d) => d.doorCode ?? "—" },
    {
      key: "status",
      header: "Stav",
      width: "9rem",
      render: (d) => (
        <StatusDot tone={DEVICE_TONE[d.status]} colored pulse={d.status !== "online"}>
          {DEVICE_STATUS[d.status]}
        </StatusDot>
      ),
    },
    {
      key: "rate",
      header: "Čítanosť",
      width: "8.5rem",
      align: "right",
      hideBelow: "sm",
      render: (d) => <span className="tabular-nums">{pct(d.readRate)}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "12rem",
      align: "right",
      control: true,
      render: (d) =>
        !controls ? null : (
        <span className="inline-flex gap-2">
          {d.kind === "dock_scanner" && d.status === "degraded" && (
            <Button size="sm" variant="secondary" onClick={() => update.mutate({ code: d.code, repair: true })}>
              Opraviť
            </Button>
          )}
          <Button
            size="sm"
            variant={d.enabled ? "ghost" : "primary"}
            onClick={() => update.mutate({ code: d.code, enabled: !d.enabled })}
            disabled={update.isPending}
          >
            {d.enabled ? "Vypnúť" : "Zapnúť"}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <Card
      flush
      title="Zariadenia"
      subtitle="Vypnuté zariadenie prestane posielať heartbeat a po 30 s je offline (alarm)."
    >
      <DataTable
        columns={columns}
        rows={devices.data?.devices}
        loading={devices.isPending}
        error={devices.isError && <p className="text-danger-700 text-sm">Telematika je nedostupná.</p>}
        rowKey={(d) => d.code}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ simulation

const SPEEDS = [1, 10, 60, 300, 600];
const JUMPS = [
  { to: "15:30", label: "15:30 večerná vlna" },
  { to: "18:30", label: "18:30 špička" },
  { to: "01:00", label: "01:00 nočné kamióny" },
  { to: "06:00", label: "06:00 ranné odchody" },
];
const STEPS = [5, 15, 60];
type JumpMode = "skip" | "replay";

/** hours from `now` to the next local HH:MM (as the telematics jump computes it) */
function hoursUntil(now: Date, hhmm: string, timeZone: string): number {
  const local = now.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = local.split(":").map(Number);
  const [th, tm] = hhmm.split(":").map(Number);
  const diff = ((th ?? 0) * 60 + (tm ?? 0) - ((h ?? 0) * 60 + (m ?? 0)) + 1440) % 1440 || 1440;
  return diff / 60;
}

function resultText(c: ClockInfo): string {
  const base = `Simulovaný čas ${c.localTime}, deň ${dayLabel(c.operatingDay)}, ×${String(c.speed)}${c.paused ? ", pauza" : ""}`;
  if (!c.replay) return base;
  const secs = (c.replay.ms / 1000).toLocaleString("sk-SK", { maximumFractionDigits: 1 });
  return `${base}. Dosimulovaných ${String(c.replay.minutes)} min za ${secs} s, ${c.replay.scans.toLocaleString("sk-SK")} skenov odoslaných do WMS.`;
}

export function SimulationTab() {
  const qc = useQueryClient();
  const { info, now } = useSimClock();
  const [seed, setSeed] = useState("");
  const [jumpTo, setJumpTo] = useState("18:30");
  const [mode, setMode] = useState<JumpMode>("replay");
  const [message, setMessage] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ method, path, body }: { method: "POST" | "PUT"; path: string; body?: unknown }) =>
      telematics<ClockInfo>(method, path, body),
    onSuccess: (c) => {
      setMessage(resultText(c));
      void qc.invalidateQueries();
    },
    onError: (err) =>
      setMessage(
        isApiError(err, 409)
          ? "Práve beží pretáčanie alebo reset, počkajte, kým skončí."
          : isApiError(err, 503)
            ? "Pretáčanie sa zastavilo: WMS alebo prevádzkový deň nie je dostupný. Hodiny ostali na mieste zastavenia."
            : "Akcia zlyhala – telematika nedostupná alebo chýba oprávnenie.",
      ),
  });
  const busy = act.isPending;
  const jump = (to: string) => {
    // the next HH:MM can be almost a day ahead (e.g. the same time again): ask before a long replay
    const hours = now ? hoursUntil(now, to, info?.timeZone ?? "Europe/Bratislava") : 0;
    if (mode === "replay" && hours > 6 && !window.confirm(`Pretočiť s dátami ${num(hours, 1)} h simulácie? Môže to trvať desiatky sekúnd.`)) return;
    act.mutate({ method: "POST", path: "/sim/clock/jump", body: { to, mode } });
  };
  const situations = useQuery({
    queryKey: ["sim-situations"],
    queryFn: () => telematics<SituationInfo[]>("GET", "/sim/situations"),
    staleTime: Infinity,
  });

  if (info?.controlsEnabled === false) {
    return (
      <Card title="Simulácia">
        <p className="text-ink-muted text-sm">
          Ovládanie simulácie je v tomto prostredí vypnuté (<code>SIM_CONTROLS_ENABLED=false</code>). Čas beží sám, scenár „čo ak“ v digitálnom tieni
          funguje ďalej.
        </p>
      </Card>
    );
  }

  function applySeed(e: FormEvent) {
    e.preventDefault();
    const n = Number(seed);
    if (!Number.isInteger(n) || n < 0) return;
    if (window.confirm(`Zmeniť seed na ${String(n)}? Aktuálny deň začne znova od 15:00.`)) {
      act.mutate({ method: "PUT", path: "/sim/seed", body: { seed: n } });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Simulované hodiny">
        <div className="mb-4 font-mono text-4xl font-bold tabular-nums">
          {now?.toLocaleTimeString("sk-SK", { timeZone: info?.timeZone ?? "Europe/Bratislava" }) ?? "--:--:--"}
        </div>
        <KeyValue
          rows={[
            ["Prevádzkový deň", info ? dayLabel(info.operatingDay) : "—"],
            ["Rýchlosť", info ? `×${String(info.speed)}` : "—"],
            ["Stav", info?.paused ? <Badge tone="warn">pauza</Badge> : <Badge tone="ok">beží</Badge>],
            ["Seed", info?.seed ?? "—"],
            ["Situácia", situations.data?.find((s) => s.id === info?.situation)?.name ?? info?.situation ?? "—"],
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {info?.paused ? (
            <Button icon={<Play size={16} />} onClick={() => act.mutate({ method: "POST", path: "/sim/clock/resume" })}>
              Spustiť
            </Button>
          ) : (
            <Button icon={<Pause size={16} />} variant="secondary" onClick={() => act.mutate({ method: "POST", path: "/sim/clock/pause" })}>
              Pauza
            </Button>
          )}
          {SPEEDS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={info?.speed === s ? "primary" : "secondary"}
              onClick={() => act.mutate({ method: "PUT", path: "/sim/clock/speed", body: { speed: s } })}
            >
              ×{s}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="Situácie" className="lg:col-span-2">
        <p className="text-ink-muted mb-3 text-sm">
          Situácia je čistý reset s daným seedom a prepínačmi a pretočenie dňa s dátami do jej času. Rovnaká situácia dá vždy rovnaké čísla. Dá sa
          otvoriť aj odkazom, napr. <code>/shadow?depot=BUD&amp;situation=evening-peak</code>.
        </p>
        {situations.isError && <p className="text-danger-700 text-sm">Telematika je nedostupná.</p>}
        <ul className="divide-line divide-y">
          {situations.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-12 shrink-0 font-mono text-sm tabular-nums">{s.time}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {s.name} {info?.situation === s.id && <Badge tone="ok">načítaná</Badge>}
                </span>
                <span className="text-ink-muted block text-xs">{s.description}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Načítať situáciu „${s.name}“? Aktuálny deň sa vráti do čistého stavu a pretočí do ${s.time}.`)) {
                    act.mutate({ method: "POST", path: `/sim/situations/${s.id}` });
                  }
                }}
              >
                Načítať
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Skok v čase a reset">
        <div className="mb-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Režim skoku">
          {(
            [
              ["replay", "Pretočiť s dátami"],
              ["skip", "Preskočiť (bez dát)"],
            ] as const
          ).map(([m, label]) => (
            <Button key={m} size="sm" role="radio" aria-checked={mode === m} variant={mode === m ? "primary" : "secondary"} onClick={() => setMode(m)}>
              {label}
            </Button>
          ))}
        </div>
        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (jumpTo) jump(jumpTo);
          }}
        >
          <input
            type="time"
            value={jumpTo}
            onChange={(e) => setJumpTo(e.target.value)}
            aria-label="Skok na čas"
            className="border-line focus:border-brand-500 w-32 rounded-xl border px-3 py-2 text-sm tabular-nums outline-none"
          />
          <Button type="submit" icon={<FastForward size={16} />} disabled={busy || !jumpTo}>
            {busy ? "Pretáčam…" : "Skočiť"}
          </Button>
        </form>
        <div className="mb-3 flex flex-wrap gap-2">
          {JUMPS.map((j) => (
            <Button key={j.to} size="sm" variant="secondary" disabled={busy} onClick={() => jump(j.to)}>
              {j.label}
            </Button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-ink-muted text-sm">Krok s dátami:</span>
          {STEPS.map((m) => (
            <Button key={m} size="sm" variant="secondary" disabled={busy} onClick={() => act.mutate({ method: "POST", path: "/sim/clock/step", body: { minutes: m } })}>
              +{m} min
            </Button>
          ))}
        </div>
        <p className="text-ink-muted mb-4 text-sm">
          „Pretočiť s dátami“ rýchlo dosimuluje preskočený úsek: skeny, prejazdy aj alarmy nadväzujú. „Preskočiť“ je rýchlejšie, ale za preskočený úsek
          chýbajú dáta.
        </p>
        <form onSubmit={applySeed} className="mb-4 flex flex-wrap items-center gap-2">
          <input
            inputMode="numeric"
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
            placeholder={`seed (teraz ${String(info?.seed ?? "")})`}
            className="border-line focus:border-brand-500 w-44 rounded-xl border px-3 py-2 text-sm outline-none"
          />
          <Button type="submit" variant="secondary" disabled={!seed}>
            Zmeniť seed
          </Button>
        </form>
        <Button
          variant="danger"
          icon={<RotateCcw size={16} />}
          onClick={() => {
            if (window.confirm("Prehrať aktuálny deň znova od 15:00? Telemetria dňa sa zmaže.")) {
              act.mutate({ method: "POST", path: "/sim/restart-day" });
            }
          }}
        >
          Deň znova od 15:00
        </Button>{" "}
        <Button
          variant="danger"
          icon={<Eraser size={16} />}
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Čistý reset dňa? Seed sa vráti na hodnotu z .env, vypnuté zariadenia sa zapnú, zmaže sa údržba, presuny jázd a alarmy dňa, staršie alarmy sa uzavrú. Deň začne od 15:00.",
              )
            ) {
              act.mutate({ method: "POST", path: "/sim/reset" });
            }
          }}
        >
          Čistý reset dňa
        </Button>
        {message && (
          <p className="bg-canvas mt-4 rounded-xl px-3 py-2 text-sm" role="status">
            {message}
          </p>
        )}
      </Card>
    </div>
  );
}
