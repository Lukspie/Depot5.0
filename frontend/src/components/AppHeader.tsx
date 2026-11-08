import { Bell, ChevronDown, ChevronRight, DoorOpen, Package, Route as RouteIcon, Search, Truck, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router";
import type { User } from "../api/auth";
import { useDepots, type Depot } from "../api/depots";
import { useCurrentAlerts, useSearch, useShell, type SearchHit } from "../api/shell";
import { ALERT_KIND } from "../domain/labels";
import { useSimClock, useSocketStatus } from "../hooks/telematics";
import { useDepot } from "../hooks/useDepot";
import { hhmm } from "../lib/format";
import { Badge, cn, Menu, MenuItem, MenuLabel, Popover, Spinner } from "./ui";

const HIT_ICON: Record<SearchHit["kind"], LucideIcon> = { parcel: Package, vehicle: Truck, trip: RouteIcon, door: DoorOpen };

/** What the search finds for a role (none for couriers). */
const SEARCH_PLACEHOLDER: Record<User["role"], string | null> = {
  admin: "Hľadať balík, ŠPZ, jazdu…",
  dispatcher: "Hľadať balík, ŠPZ, jazdu…",
  operator: "Hľadať bránu…",
  security: "Hľadať ŠPZ…",
  courier: null,
};

/** Ctrl K / ⌘K focuses the search field. */
function useSearchShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Search within the depot shown; the backend returns what the role may open (ADR-068). */
function SearchBox({ depot, placeholder }: { depot: string | null; placeholder: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useSearchShortcut(input);
  const results = useSearch(q, depot);
  const hits = results.data?.hits;
  const navigate = useNavigate();
  const go = (hit: SearchHit) => {
    setQ("");
    setOpen(false);
    navigate(hit.href);
  };
  return (
    <div className="relative ml-1 hidden max-w-[420px] min-w-0 flex-[1_1_280px] lg:block">
      <label className="border-line bg-subtle text-ink-muted focus-within:border-brand-500 focus-within:ring-brand-100 flex h-[34px] items-center gap-2 rounded-lg border px-2.5 focus-within:ring-4">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Hľadať</span>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") input.current?.blur();
            if (e.key === "Enter" && hits?.[0]) go(hits[0]);
          }}
          placeholder={placeholder}
          className="text-ink placeholder:text-ink-muted min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        <kbd className="border-line bg-surface text-ink-muted rounded-[5px] border px-[5px] font-sans text-[11px] font-semibold">Ctrl K</kbd>
      </label>
      {open && q.trim().length >= 2 && (
        <div className="bg-surface border-line shadow-pop absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-y-auto rounded-[10px] border p-1">
          {results.isPending && <Spinner className="py-4" />}
          {hits?.length === 0 && <p className="text-ink-muted p-3 text-sm">V tomto sklade sa nič nenašlo.</p>}
          {hits?.map((h) => {
            const Icon = HIT_ICON[h.kind];
            return (
              <button
                key={`${h.kind}-${h.key}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
                className="hover:bg-track flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
              >
                <Icon size={15} className="text-ink-muted shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{h.title}</span>
                  <span className="text-ink-muted block truncate text-xs">{h.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The depot shown: a menu of the depots for administrators and dispatchers, a plain label for
 * the roles bound to their own depot (ADR-068).
 */
function DepotSwitch({ depot }: { depot: Depot | undefined }) {
  const { canSwitch, setDepot } = useDepot();
  const depots = useDepots();
  const label = (
    <>
      <span className="bg-brand-500 h-2 w-2 rounded-[2px]" aria-hidden="true" />
      {depot?.name ?? "—"}
    </>
  );
  const cls = "border-line flex h-[34px] shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold whitespace-nowrap";
  if (!canSwitch) return <span className={cls}>{label}</span>;
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`Sklad ${depot?.name ?? ""}, zmeniť sklad`}
          className={cn(cls, "bg-surface hover:bg-subtle focus-visible:ring-brand-200 outline-none focus-visible:ring-4")}
        >
          {label}
          <ChevronDown size={14} className="text-ink-muted" aria-hidden="true" />
        </button>
      }
    >
      <MenuLabel>Sklady siete</MenuLabel>
      {depots.data?.map((d) => (
        <MenuItem key={d.code} active={d.code === depot?.code} onSelect={() => setDepot(d.code)}>
          {d.name}
          <span className="text-ink-muted ml-1.5 text-xs">{d.label}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Simulated time and speed: green while running, amber when paused, grey without telematics. */
function ClockPill() {
  const status = useSocketStatus();
  const { info, now } = useSimClock();
  const live = status === "open" && info !== null && now !== null;
  const tone = !live ? "bg-track text-ink-muted" : info.paused ? "bg-warn-100 text-warn-700" : "bg-ok-100 text-ok-700";
  const dot = !live ? "bg-neutral-600" : info.paused ? "bg-warn-600" : "bg-ok-600";
  return (
    <span
      title={live ? `Simulovaný čas · ×${String(info.speed)}` : "Spojenie s telematikou sa obnovuje"}
      className={cn("flex h-[30px] items-center gap-[7px] rounded-full px-2.5 text-xs font-bold whitespace-nowrap tabular-nums", tone)}
    >
      <span className={cn("h-[7px] w-[7px] rounded-full", dot)} style={live && !info.paused ? { boxShadow: "0 0 0 3px rgb(35 135 79 / 0.18)" } : undefined} />
      {live ? `${hhmm(now)} · ${info.paused ? "pauza" : `${String(info.speed)}×`}` : "offline"}
    </span>
  );
}

function AlertsBell({ user, depot }: { user: User; depot: string | null }) {
  const shell = useShell(depot);
  const count = shell.data?.openAlerts;
  const canList = user.role === "admin" || user.role === "dispatcher" || user.role === "security";
  const [open, setOpen] = useState(false);
  const alerts = useCurrentAlerts(depot, open && canList);
  if (count === null || count === undefined) return null;
  const where = user.role === "security" ? "/shadow" : "/";
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-[22rem] p-0"
      trigger={
        <button
          type="button"
          aria-label={`Alarmy, ${String(count)} aktívnych`}
          className="border-line bg-surface text-ink hover:bg-subtle focus-visible:ring-brand-200 relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg border outline-none focus-visible:ring-4"
        >
          <Bell size={17} aria-hidden="true" />
          {count > 0 && (
            <span className="bg-danger-600 absolute -top-[5px] -right-[5px] h-[17px] min-w-[17px] rounded-[9px] border-2 border-white px-[3px] text-center text-[10px] leading-[13px] font-bold text-white">
              {count}
            </span>
          )}
        </button>
      }
    >
      <div className="border-line-soft flex items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-bold">Alarmy</span>
        <Badge tone="danger" size="sm">
          {count}
        </Badge>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {alerts.isPending && <Spinner className="py-4" />}
        {alerts.data?.alerts.length === 0 && <p className="text-ink-muted px-4 py-3 text-sm">Žiadne aktívne alarmy.</p>}
        {alerts.data?.alerts.slice(0, 6).map((a) => (
          <div key={a.id} className="border-line-soft border-b px-4 py-2.5 last:border-b-0">
            <div className="mb-0.5 flex items-center gap-2 text-[11.5px]">
              <Badge tone={a.severity === "critical" ? "danger" : "warn"} size="sm">
                {ALERT_KIND[a.kind]}
              </Badge>
              <span className="text-ink-muted">{hhmm(a.createdAt)}</span>
            </div>
            <p className="line-clamp-2 text-[13px] leading-snug">{a.message}</p>
          </div>
        ))}
      </div>
      <Link to={where} onClick={() => setOpen(false)} className="text-brand-700 flex h-10 items-center justify-center gap-1 text-[12.5px] font-bold no-underline">
        {user.role === "security" ? "Otvoriť digitálny tieň" : "Zobraziť na dispečingu"} <ChevronRight size={14} />
      </Link>
    </Popover>
  );
}

/**
 * Top bar of design system v2 (docs/design/maketa-dispecing): depot (switch for who may),
 * breadcrumb, search (Ctrl K) within the depot, current wave, simulated time with speed and the
 * alerts of the depot. Pages put their own title and actions under it (PageHeader).
 */
export function AppHeader({ user, depot, title }: { user: User; depot: Depot | undefined; title: string }) {
  const code = depot?.code ?? null;
  const shell = useShell(code);
  const wave = shell.data?.wave;
  const placeholder = SEARCH_PLACEHOLDER[user.role];
  return (
    <header className="bg-surface border-line flex h-[60px] shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <DepotSwitch depot={depot} />
      {title && (
        <>
          <span className="text-chrome-item hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="hidden truncate text-[13px] font-semibold sm:inline">{title}</span>
        </>
      )}
      {placeholder && <SearchBox depot={code} placeholder={placeholder} />}
      <span className="flex-1" />
      {wave && (
        <span className="bg-brand-50 text-brand-800 hidden h-[30px] items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap xl:flex">
          {wave.name} · {wave.start}–{wave.end}
        </span>
      )}
      <ClockPill />
      <AlertsBell user={user} depot={code} />
    </header>
  );
}
