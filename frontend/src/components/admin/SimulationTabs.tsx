import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { telematics, type ClockInfo, type DeviceInfo } from "../../api/telematicsApi";
import { useDirectionsAdmin, useUpdateDirection, type DirectionAdmin } from "../../api/wms";
import { DIRECTION_TYPE, dayLabel } from "../../domain/labels";
import { useSimClock } from "../../hooks/telematics";
import { Badge, Button, Card, DataTable, KeyValue, StatusDot, type Column, type Tone } from "../ui";

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
      render: (d) => <span className="tabular-nums">{d.readRate === null ? "—" : `${(d.readRate * 100).toFixed(1)} %`}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "12rem",
      align: "right",
      control: true,
      render: (d) => (
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
        error={devices.isError && <p className="text-danger-600 text-sm">Telematika je nedostupná.</p>}
        rowKey={(d) => d.code}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ simulation

const SPEEDS = [1, 10, 60, 300, 600];
const JUMPS = [
  { to: "15:30", label: "15:30 večerná vlna" },
  { to: "01:00", label: "01:00 nočné kamióny" },
  { to: "06:00", label: "06:00 ranné odchody" },
];

export function SimulationTab() {
  const qc = useQueryClient();
  const { info, now } = useSimClock();
  const [seed, setSeed] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ method, path, body }: { method: "POST" | "PUT"; path: string; body?: unknown }) =>
      telematics<ClockInfo>(method, path, body),
    onSuccess: (c) => {
      setMessage(`Simulovaný čas ${c.localTime}, deň ${dayLabel(c.operatingDay)}, ×${String(c.speed)}${c.paused ? ", pauza" : ""}`);
      void qc.invalidateQueries();
    },
    onError: () => setMessage("Akcia zlyhala – telematika nedostupná alebo chýba oprávnenie."),
  });

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

      <Card title="Skok v čase a scenár">
        <div className="mb-5 flex flex-wrap gap-2">
          {JUMPS.map((j) => (
            <Button key={j.to} variant="secondary" onClick={() => act.mutate({ method: "POST", path: "/sim/clock/jump", body: { to: j.to } })}>
              {j.label}
            </Button>
          ))}
        </div>
        <p className="text-ink-muted mb-4 text-sm">
          Skok preskočí skeny a prejazdy v preskočenom čase. Pre súvislé dáta zrýchlite hodiny.
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
        </Button>
        {message && <p className="bg-canvas mt-4 rounded-xl px-3 py-2 text-sm">{message}</p>}
      </Card>
    </div>
  );
}
