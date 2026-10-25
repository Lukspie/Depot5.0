import { NavLink, Outlet } from "react-router";

interface NavItem {
  to: string;
  label: string;
  ready: boolean;
}

// Screens are enabled as the project phases deliver them.
const NAV: NavItem[] = [
  { to: "/", label: "Stav systému", ready: true },
  { to: "/twin", label: "Digitálne dvojča", ready: false },
  { to: "/fleet", label: "Flotila", ready: false },
  { to: "/loading", label: "Nakládka", ready: false },
  { to: "/gate", label: "Brána", ready: false },
  { to: "/admin", label: "Administrácia", ready: false },
];

export function Layout() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-line bg-surface border-b px-4 py-4 md:w-60 md:shrink-0 md:border-r md:border-b-0 md:py-6">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="text-lg leading-tight font-semibold">DepoTrack</div>
            <div className="text-ink-muted text-xs">SPS depo Košice</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map((item) =>
            item.ready ? (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-brand-100 text-brand-700 font-medium"
                      : "text-ink-muted hover:bg-brand-50 hover:text-ink"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                className="text-ink-muted/60 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap"
                title="Pripravuje sa v ďalšej fáze"
              >
                {item.label}
                <span className="bg-canvas rounded-full px-2 py-0.5 text-[10px]">čoskoro</span>
              </span>
            ),
          )}
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
