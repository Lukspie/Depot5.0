import { Building2, ChevronDown, FlaskConical, Search, Warehouse } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useDepots } from "../../api/depots";
import type { Shadow } from "../../api/shadow";
import { Button } from "../../components/ui";
import { useSimClock } from "../../hooks/telematics";

interface Props {
  depot: string;
  live: Shadow | undefined;
  onSearch: (query: string) => void;
  onScenario?: () => void;
}

/** Occupied loading doors of the current depot, e.g. "6/8 brán obsadených". */
function occupancy(live: Shadow | undefined): string | null {
  if (!live) return null;
  if (live.depot.kind === "hub") {
    const here = live.trucks.filter((t) => t.state === "at_hub" || t.state === "loading_at_hub").length;
    const word = here === 1 ? "kamión" : here >= 2 && here <= 4 ? "kamióny" : "kamiónov";
    return `${String(here)} ${word} na mieste`;
  }
  const busy = live.docks.filter((d) => d.trip && (d.trip.status === "at_door" || d.trip.status === "loading")).length;
  return `${String(busy)}/${String(live.docks.length)} brán obsadených`;
}

/**
 * Top bar of the shadow (plan-doplnky 5c): depot switch with context, search (parcel, plate,
 * door, device), live simulated time and the "Scenár" button.
 */
export function TopBar({ depot, live, onSearch, onScenario }: Props) {
  const depots = useDepots();
  const navigate = useNavigate();
  const current = depots.data?.find((d) => d.code === depot);
  const { now } = useSimClock();
  const [text, setText] = useState("");
  const time = now ? now.toLocaleTimeString("sk-SK", { timeZone: "Europe/Bratislava" }) : "—";
  return (
    <div className="bg-surface shadow-card flex flex-wrap items-center gap-2 rounded-2xl p-2">
      {/* depot switch: a drop-down, the list of depots does not fit as pills (phase 7c) */}
      <label className="bg-brand-100 text-brand-700 focus-within:ring-brand-500 relative flex items-center gap-1.5 rounded-xl py-2 pr-8 pl-3 text-sm font-semibold whitespace-nowrap focus-within:ring-2">
        {current?.kind === "hub" ? <Building2 size={15} /> : <Warehouse size={15} />}
        <select
          value={depot}
          onChange={(e) => void navigate(`/shadow?depot=${e.target.value}`)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Sklad"
        >
          {depots.data?.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
              {d.kind === "hub" ? " · hub Bratislava" : ""}
            </option>
          ))}
        </select>
        <span aria-hidden>{current?.name ?? depot}</span>
        {current?.kind === "hub" && <span className="hidden text-[11px] font-normal xl:inline">hub Bratislava</span>}
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5" aria-hidden />
      </label>
      <span className="text-ink-muted hidden px-1 text-xs whitespace-nowrap lg:inline">{occupancy(live)}</span>
      <form
        className="border-line flex min-w-40 flex-1 items-center gap-2 rounded-xl border px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const q = text.trim().toUpperCase();
          if (q.length >= 2) onSearch(q);
        }}
      >
        <Search size={15} className="text-ink-muted shrink-0" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Balík, ŠPZ, brána alebo zariadenie…"
          aria-label="Hľadať v tieni"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          autoComplete="off"
        />
      </form>
      <span className="bg-ok-100 text-ok-600 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap tabular-nums">
        <span className="bg-ok-600 h-1.5 w-1.5 rounded-full" /> {time}
      </span>
      {onScenario && (
        <Button size="sm" icon={<FlaskConical size={15} />} onClick={onScenario}>
          Scenár
        </Button>
      )}
    </div>
  );
}
