import { Bell, ChevronRight, Search } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router";
import type { User } from "../api/auth";
import type { Depot } from "../api/depots";
import { useCurrentAlerts, useShell } from "../api/shell";
import { useParcelSearch } from "../api/wms";
import { ALERT_KIND } from "../domain/labels";
import { useSimClock, useSocketStatus } from "../hooks/telematics";
import { hhmm } from "../lib/format";
import { Badge, cn, Popover, Spinner } from "./ui";

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

function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useSearchShortcut(input);
  const results = useParcelSearch(q);
  const navigate = useNavigate();
  const go = (id: number) => {
    setQ("");
    setOpen(false);
    navigate(`/parcels/${String(id)}`);
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
            if (e.key === "Enter" && results.data?.[0]) go(results.data[0].id);
          }}
          placeholder="Hľadať balík, ŠPZ, jazdu…"
          className="text-ink placeholder:text-ink-muted min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        <kbd className="border-line bg-surface text-ink-muted rounded-[5px] border px-[5px] font-sans text-[11px] font-semibold">Ctrl K</kbd>
      </label>
      {open && q.trim().length >= 3 && (
        <div className="bg-surface border-line shadow-pop absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-y-auto rounded-[10px] border p-1">
          {results.isPending && <Spinner className="py-4" />}
          {results.data?.length === 0 && <p className="text-ink-muted p-3 text-sm">Nič sa nenašlo.</p>}
          {results.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(p.id)}
              className="hover:bg-track flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs font-semibold">{p.barcode}</span>
                <span className="text-ink-muted block truncate text-xs">
                  {p.recipientName} · {p.address}
                </span>
              </span>
              <Badge size="sm">{p.directionCode}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
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

function AlertsBell({ user }: { user: User }) {
  const shell = useShell();
  const count = shell.data?.openAlerts;
  const canList = user.role === "admin" || user.role === "dispatcher" || user.role === "security";
  const [open, setOpen] = useState(false);
  const alerts = useCurrentAlerts(open && canList);
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
 * Top bar of design system v2 (docs/design/maketa-dispecing): depot, breadcrumb, search
 * (Ctrl K), current wave, simulated time with speed and the alerts. Pages put their own title
 * and actions under it (PageHeader).
 */
export function AppHeader({ user, depot, title }: { user: User; depot: Depot | undefined; title: string }) {
  const shell = useShell();
  const wave = shell.data?.wave;
  const canSearch = user.role === "admin" || user.role === "dispatcher";
  return (
    <header className="bg-surface border-line flex h-[60px] shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <span className="border-line flex h-[34px] shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold whitespace-nowrap">
        <span className="bg-brand-500 h-2 w-2 rounded-[2px]" aria-hidden="true" />
        {depot?.name ?? "—"}
      </span>
      {title && (
        <>
          <span className="text-chrome-item hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="hidden truncate text-[13px] font-semibold sm:inline">{title}</span>
        </>
      )}
      {canSearch && <SearchBox />}
      <span className="flex-1" />
      {wave && (
        <span className="bg-brand-50 text-brand-800 hidden h-[30px] items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap xl:flex">
          {wave.name} · {wave.start}–{wave.end}
        </span>
      )}
      <ClockPill />
      <AlertsBell user={user} />
    </header>
  );
}
