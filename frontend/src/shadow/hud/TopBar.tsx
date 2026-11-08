import { Bell, Building2, ChevronDown, FlaskConical, Search, Warehouse } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useMe } from "../../api/auth";
import { useDepots } from "../../api/depots";
import { useShell } from "../../api/shell";
import type { Shadow } from "../../api/shadow";
import { Badge, Button, cn, Popover } from "../../components/ui";
import { ALERT_KIND } from "../../domain/labels";
import { useSimClock, useSocketStatus } from "../../hooks/telematics";
import { useDepot } from "../../hooks/useDepot";
import { hhmm } from "../../lib/format";

interface Props {
  depot: string;
  live: Shadow | undefined;
  onSearch: (query: string) => void;
  onScenario?: () => void;
}

/** Occupied loading doors of the current depot, e.g. "5/8 brán obsadených". */
function occupancy(live: Shadow | undefined): string | null {
  if (!live) return null;
  if (live.depot.kind === "hub") {
    const here = live.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length;
    const word = here === 1 ? "kamión" : here >= 2 && here <= 4 ? "kamióny" : "kamiónov";
    return `${String(here)} ${word} na mieste`;
  }
  const busy = live.docks.filter((d) => d.trip && (d.trip.status === "at_door" || d.trip.status === "loading")).length;
  // linehaul trucks that end in this depot (Žilina, ADR-065) stand on free ramps
  const arrived = live.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length;
  return `${String(Math.min(busy + arrived, live.docks.length))}/${String(live.docks.length)} brán obsadených`;
}

/** "/" focuses the search of the scene (maketa-tien), unless the user is typing elsewhere. */
function useSlashShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/**
 * Top bar of the shadow in one row (maketa-tien): depot switch, occupied doors, search ("/"), the
 * simulated time with the wave and the speed, the what-if scenario and the alarms.
 */
export function TopBar({ depot, live, onSearch, onScenario }: Props) {
  const depots = useDepots();
  const me = useMe();
  const { canSwitch, setDepot } = useDepot();
  const shell = useShell(depot);
  // only the depots the user may open (ADR-068); the backend checks again
  const allowed = (depots.data ?? []).filter((d) => me.data?.depots?.includes(d.code));
  const current = depots.data?.find((d) => d.code === depot);
  const { info, now } = useSimClock();
  const socket = useSocketStatus();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useSlashShortcut(input);
  const live_ = socket === "open" && info !== null && now !== null;
  const wave = shell.data?.wave;
  const alerts = live?.alerts.length ?? 0;
  return (
    <div className="bg-surface border-line shadow-card flex flex-wrap items-center gap-2 rounded-2xl border p-2 lg:flex-nowrap">
      {/* depot switch: a drop-down, five depots do not fit as segments (phase 7c) */}
      <label className="bg-brand-50 text-ink focus-within:ring-brand-500 relative flex h-10 shrink-0 items-center gap-1.5 rounded-xl py-2 pr-8 pl-3 text-sm font-bold whitespace-nowrap focus-within:ring-2">
        {current?.kind === "hub" ? <Building2 size={16} className="text-brand-700" /> : <Warehouse size={16} className="text-brand-700" />}
        {canSwitch && (
          <select value={depot} onChange={(e) => setDepot(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Sklad">
            {allowed.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
                {d.label ? ` · ${d.label}` : ""}
              </option>
            ))}
          </select>
        )}
        <span aria-hidden={canSwitch}>{current?.name ?? depot}</span>
        {current?.label && <span className="text-ink-muted hidden text-xs font-medium xl:inline">{current.kind === "hub" ? "hub" : "depo"}</span>}
        {canSwitch && <ChevronDown size={14} className="text-ink-muted pointer-events-none absolute right-2.5" aria-hidden />}
      </label>
      <span className="hidden px-1.5 text-[13px] font-bold whitespace-nowrap lg:inline">{occupancy(live)}</span>
      <form
        className="border-line bg-subtle focus-within:border-brand-500 flex h-10 min-w-40 flex-1 items-center gap-2 rounded-xl border px-3"
        onSubmit={(e) => {
          e.preventDefault();
          const q = text.trim().toUpperCase();
          if (q.length >= 2) onSearch(q);
        }}
      >
        <Search size={16} className="text-ink-muted shrink-0" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Balík, ŠPZ, brána alebo zariadenie…"
          aria-label="Hľadať v tieni"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          autoComplete="off"
        />
        <kbd className="border-line bg-surface text-ink-muted rounded-[5px] border px-[5px] font-sans text-[11px] font-semibold">/</kbd>
      </form>
      <span
        title={live_ ? "Simulovaný čas" : "Spojenie s telematikou sa obnovuje"}
        className={cn(
          "flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold whitespace-nowrap tabular-nums",
          !live_ ? "bg-track text-ink-muted" : info.paused ? "bg-warn-100 text-warn-700" : "bg-ok-100 text-ok-700",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", !live_ ? "bg-neutral-600" : info.paused ? "bg-warn-600" : "bg-ok-600")} />
        {live_ ? hhmm(now) : "offline"}
        {live_ && (
          <span className="hidden text-xs font-semibold xl:inline">
            {wave ? `${wave.name.toLowerCase()} · ` : ""}
            {info.paused ? "pauza" : `${String(info.speed)}×`}
          </span>
        )}
      </span>
      {onScenario && (
        <Button variant="secondary" className="h-10 rounded-xl" icon={<FlaskConical size={15} />} onClick={onScenario}>
          Scenár <span className="hidden xl:inline">(čo ak)</span>
        </Button>
      )}
      <Popover
        className="w-[22rem] p-0"
        trigger={
          <button
            type="button"
            aria-label={`Alarmy, ${String(alerts)} aktívnych`}
            className="border-line bg-surface hover:bg-subtle relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
          >
            <Bell size={17} />
            {alerts > 0 && (
              <span className="bg-danger-600 absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] rounded-[9px] border-2 border-white px-[3px] text-center text-[10px] leading-[14px] font-bold text-white">
                {alerts}
              </span>
            )}
          </button>
        }
      >
        <div className="border-line-soft border-b px-4 py-3 text-sm font-bold">Alarmy v sklade</div>
        <ul className="max-h-80 overflow-y-auto">
          {(live?.alerts ?? []).length === 0 && <li className="text-ink-muted px-4 py-3 text-sm">Žiadne aktívne alarmy.</li>}
          {(live?.alerts ?? []).slice(0, 8).map((a) => (
            <li key={a.id} className="border-line-soft border-b px-4 py-2.5 last:border-b-0">
              <div className="mb-0.5 flex items-center gap-2 text-[11.5px]">
                <Badge tone={a.severity === "critical" ? "danger" : "warn"} size="sm">
                  {ALERT_KIND[a.kind]}
                </Badge>
                <span className="text-ink-muted">{hhmm(a.createdAt)}</span>
              </div>
              <p className="line-clamp-2 text-[13px] leading-snug">{a.message}</p>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
