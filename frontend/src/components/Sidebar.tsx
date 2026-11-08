import {
  Activity,
  Boxes,
  Car,
  LayoutDashboard,
  LogOut,
  MapPinned,
  MonitorPlay,
  ScanLine,
  Settings,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { SHIFT_LABEL, useLogout, type User } from "../api/auth";
import type { Depot } from "../api/depots";
import { useShell } from "../api/shell";
import { canAccess, NAV, navLabel, ROLE_LABEL } from "../auth/roles";
import { useSocketStatus } from "../hooks/telematics";
import { cn, Logo, Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "./ui";
import { applyTheme, loadTheme, THEMES, type Theme } from "./ui/theme";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/shadow": Boxes,
  "/fleet": MapPinned,
  "/loading": ScanLine,
  "/gate": ShieldCheck,
  "/courier": Truck,
  "/admin": Settings,
  "/system": Activity,
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleLine(user: User): string {
  const role = ROLE_LABEL[user.role];
  return user.shift ? `${role} · ${SHIFT_LABEL[user.shift]} zmena` : role;
}

/** One item of the navigation; collapsed = icon with a tooltip (72 px strip). */
function Item({ to, label, icon: Icon, collapsed, end, badge, dot, external }: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  end?: boolean;
  badge?: number | null;
  dot?: boolean;
  external?: boolean;
}) {
  const base = cn(
    "focus-visible:ring-brand-500/40 relative flex h-9 items-center rounded-lg text-[13.5px] whitespace-nowrap no-underline outline-none focus-visible:ring-2",
    collapsed ? "w-11 justify-center" : "gap-2.5 px-2.5",
  );
  const content = (active: boolean): ReactNode => (
    <>
      <Icon size={18} strokeWidth={1.9} className="shrink-0" aria-hidden="true" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {badge ? (
        <span
          className={cn(
            "bg-chrome-active-ink text-[11px] font-bold text-[#1d1d1b]",
            collapsed ? "absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center leading-4" : "rounded-full px-[7px] py-px",
          )}
          aria-label={`${String(badge)} čaká`}
        >
          {badge}
        </span>
      ) : null}
      {dot && <span className={cn("bg-ok-600 h-2 w-2 rounded-full", collapsed && "absolute top-1.5 right-1.5")} aria-label="služby v prevádzke" />}
      {active && collapsed && <span className="sr-only">(aktuálna stránka)</span>}
    </>
  );
  const cls = (active: boolean) =>
    cn(base, active ? "bg-chrome-active text-chrome-active-ink font-semibold" : "text-chrome-item hover:bg-chrome-hover hover:text-chrome-ink font-medium");
  const link = external ? (
    <a href={to} target="_blank" rel="noreferrer" className={cls(false)}>
      {content(false)}
    </a>
  ) : (
    <NavLink to={to} end={end} className={({ isActive }) => cls(isActive)}>
      {({ isActive }) => content(isActive)}
    </NavLink>
  );
  // the tooltip trigger is a wrapper: Radix Slot cannot merge NavLink's className function
  return collapsed ? (
    <Tooltip label={label}>
      <span className="flex justify-center">{link}</span>
    </Tooltip>
  ) : (
    link
  );
}

function ThemeItems() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return (
    <>
      <MenuLabel>Téma</MenuLabel>
      {THEMES.map((t) => (
        <MenuItem key={t.id} active={theme === t.id} onSelect={() => setTheme(t.id)} icon={<span className="h-3 w-3 rounded-full" style={{ background: t.swatch }} />}>
          {t.label}
        </MenuItem>
      ))}
    </>
  );
}

function UserBlock({ user, collapsed }: { user: User; collapsed: boolean }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const onLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  return (
    <Menu
      side={collapsed ? "right" : "top"}
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`${user.full_name}, ${roleLine(user)}: menu účtu`}
          className={cn(
            "border-chrome-line hover:bg-chrome-hover focus-visible:ring-brand-500/40 flex items-center gap-2.5 rounded-lg border-t text-left outline-none focus-visible:ring-2",
            collapsed ? "justify-center px-0 py-3" : "p-2.5",
          )}
        >
          <span className="text-brand-500 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#3a3127] text-xs font-bold">{initials(user.full_name)}</span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="text-chrome-ink block truncate text-[13px] font-semibold">{user.full_name}</span>
              <span className="text-chrome-muted block truncate text-[11.5px]">{roleLine(user)}</span>
            </span>
          )}
        </button>
      }
    >
      <ThemeItems />
      <MenuSeparator />
      <MenuItem icon={<LogOut size={15} />} onSelect={onLogout} disabled={logout.isPending}>
        Odhlásiť
      </MenuItem>
    </Menu>
  );
}

function SectionLabel({ children, collapsed, first }: { children: string; collapsed: boolean; first?: boolean }) {
  if (collapsed) return <div className={cn("bg-chrome-line mx-auto my-2 h-px w-8", first && "mt-0")} aria-hidden="true" />;
  return <div className={cn("text-chrome-label px-2.5 pb-1.5 text-[10.5px] font-bold tracking-[0.08em]", first ? "pt-2" : "pt-[18px]")}>{children}</div>;
}

/**
 * Side navigation of design system v2 (docs/design/maketa-dispecing): logo with the depot,
 * sections Prevádzka / Systém, a count at the gate, the services dot, the account at the
 * bottom. On the digital shadow it collapses to a 72 px strip of icons (maketa-tien).
 */
export function Sidebar({ user, depot, collapsed }: { user: User; depot: Depot | undefined; collapsed: boolean }) {
  const shell = useShell(depot?.code ?? null);
  const socket = useSocketStatus();
  const items = NAV.filter((n) => n.ready && canAccess(user.role, n.roles));
  const ops = items.filter((n) => n.section === "ops");
  const system = items.filter((n) => n.section === "system");
  const board = shell.data?.boardUrl;
  return (
    <aside
      aria-label="Hlavná navigácia"
      className={cn("bg-chrome text-chrome-ink sticky top-0 hidden h-screen shrink-0 flex-col gap-0.5 px-3 py-4 md:flex", collapsed ? "w-[72px]" : "w-[232px]")}
    >
      <div className={cn("flex items-center gap-2.5 pb-[18px]", collapsed ? "justify-center" : "px-2 pt-1")}>
        <Logo size={34} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-extrabold">Depot 5.0</div>
            <div className="text-chrome-muted truncate text-[11.5px]">{depot ? [depot.name, depot.label].filter(Boolean).join(" · ") : " "}</div>
          </div>
        )}
      </div>
      <nav aria-label="Obrazovky" className="flex flex-col gap-0.5">
        {ops.length > 0 && <SectionLabel collapsed={collapsed} first>PREVÁDZKA</SectionLabel>}
        {ops.map((n) => (
          <Item
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            label={navLabel(n, user.role)}
            icon={ICONS[n.to] ?? Car}
            collapsed={collapsed}
            badge={n.to === "/gate" ? shell.data?.gateQueue : null}
          />
        ))}
        {board && <Item to={board} label="Tabuľa príchodov" icon={MonitorPlay} collapsed={collapsed} external />}
        {system.length > 0 && <SectionLabel collapsed={collapsed}>SYSTÉM</SectionLabel>}
        {system.map((n) => (
          <Item key={n.to} to={n.to} label={navLabel(n, user.role)} icon={ICONS[n.to] ?? Car} collapsed={collapsed} dot={n.to === "/system" && socket === "open"} />
        ))}
      </nav>
      <span className="flex-1" />
      <UserBlock user={user} collapsed={collapsed} />
    </aside>
  );
}

/** Navigation on phones: logo, a scrolling row of screens and the account menu. */
export function MobileNav({ user }: { user: User }) {
  const items = NAV.filter((n) => n.ready && canAccess(user.role, n.roles));
  return (
    <div className="bg-chrome text-chrome-ink flex items-center gap-2 px-3 py-2.5 md:hidden">
      <Logo size={30} />
      <nav aria-label="Obrazovky" className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {items.map((n) => {
          const Icon = ICONS[n.to] ?? Car;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] whitespace-nowrap",
                  isActive ? "bg-chrome-active text-chrome-active-ink font-semibold" : "text-chrome-item",
                )
              }
            >
              <Icon size={17} aria-hidden="true" />
              {navLabel(n, user.role)}
            </NavLink>
          );
        })}
      </nav>
      <UserBlock user={user} collapsed />
    </div>
  );
}
