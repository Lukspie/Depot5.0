import {
  Activity,
  Boxes,
  Car,
  LayoutDashboard,
  LogOut,
  MapPinned,
  PackageCheck,
  Settings,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useLogout, useMe } from "../api/auth";
import { canAccess, NAV, ROLE_LABEL } from "../auth/roles";
import { useSimClock, useSocketStatus } from "../hooks/telematics";
import { applyTheme, loadTheme, THEMES, type Theme } from "./ui/theme";
import { Logo } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/twin": Boxes,
  "/fleet": MapPinned,
  "/loading": PackageCheck,
  "/gate": ShieldCheck,
  "/courier": Truck,
  "/admin": Settings,
  "/system": Activity,
};

function LiveClock() {
  const status = useSocketStatus();
  const { info, now } = useSimClock();
  const live = status === "open" && info !== null;
  const time = now?.toLocaleTimeString("sk-SK", {
    timeZone: info?.timeZone ?? "Europe/Bratislava",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      title={live ? `Simulovaný čas · ×${String(info.speed)}` : "Spojenie s telematikou sa obnovuje"}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
        live ? (info.paused ? "bg-warn-100 text-warn-600" : "bg-ok-100 text-ok-600") : "bg-neutral-100 text-ink-muted"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${live ? (info.paused ? "bg-warn-600" : "bg-ok-600") : "bg-neutral-600"}`} />
      {live ? (info.paused ? "Pauza" : "Live") : "Offline"}
      <span className="tabular-nums">{time ?? "--:--"}</span>
    </div>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return (
    <div className="bg-neutral-100 flex rounded-full p-1" role="radiogroup" aria-label="Téma">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          title={t.label}
          onClick={() => setTheme(t.id)}
          className={`flex h-7 w-7 items-center justify-center rounded-full ${theme === t.id ? "bg-surface shadow-sm" : ""}`}
        >
          <span className="h-3.5 w-3.5 rounded-full" style={{ background: t.swatch }} />
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = me.data;
  const items = user ? NAV.filter((item) => canAccess(user.role, item.roles)) : [];

  function onLogout() {
    logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  }

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="bg-chrome text-chrome-ink flex flex-col px-3 py-3 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:px-4 md:py-6">
        <div className="mb-3 flex items-center gap-2.5 px-2 md:mb-8">
          <Logo size={36} />
          <div className="min-w-0">
            <div className="text-lg leading-tight font-bold">DepoTrack</div>
            <div className="text-chrome-muted truncate text-xs">Prekládkové depo Budimír</div>
          </div>
        </div>

        <nav className="no-scrollbar flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {items.map((item) => {
            const Icon = ICONS[item.to] ?? Car;
            const base = "flex items-center gap-3 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors";
            return item.ready ? (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `${base} ${isActive ? "bg-chrome-active text-brand-500 font-semibold" : "text-chrome-muted hover:bg-chrome-hover hover:text-chrome-ink"}`
                }
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ) : (
              <span
                key={item.to}
                className={`${base} text-chrome-muted/50 cursor-default`}
                title="Pripravuje sa v ďalšej fáze"
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
                <span className="bg-chrome-muted/40 ml-auto h-1.5 w-1.5 shrink-0 rounded-full" aria-label="čoskoro" />
              </span>
            );
          })}
        </nav>

        {user && (
          <div className="border-chrome-hover mt-auto hidden items-center gap-3 border-t pt-4 md:flex">
            <div className="bg-brand-500 text-on-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
              {user.full_name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.full_name}</div>
              <div className="text-chrome-muted truncate text-xs">{ROLE_LABEL[user.role]}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              disabled={logout.isPending}
              title="Odhlásiť"
              aria-label="Odhlásiť"
              className="text-chrome-muted hover:bg-chrome-hover hover:text-chrome-ink rounded-lg p-2"
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end gap-2 px-4 pt-4 md:px-8">
          <LiveClock />
          <ThemeSwitch />
          {user && (
            <button
              type="button"
              onClick={onLogout}
              className="text-ink-muted hover:bg-surface rounded-full p-2 md:hidden"
              aria-label="Odhlásiť"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
        <main className="min-w-0 flex-1 p-4 md:px-8 md:pt-2 md:pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
