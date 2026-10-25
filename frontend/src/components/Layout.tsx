import { NavLink, Outlet, useNavigate } from "react-router";
import { useLogout, useMe } from "../api/auth";
import { NAV, ROLE_LABEL } from "../auth/roles";

export function Layout() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = me.data;
  const items = user ? NAV.filter((item) => item.roles.includes(user.role)) : [];

  function onLogout() {
    logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
  }

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-line bg-surface flex flex-col border-b px-4 py-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 md:py-6">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="text-lg leading-tight font-semibold">DepoTrack</div>
            <div className="text-ink-muted text-xs">SPS depo Košice</div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {items.map((item) =>
            item.ready ? (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
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

        {user && (
          <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-4 md:mt-auto">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user.full_name}</div>
              <div className="text-ink-muted text-xs">{ROLE_LABEL[user.role]}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              disabled={logout.isPending}
              className="text-ink-muted hover:bg-rose-100 hover:text-rose-600 rounded-xl px-3 py-1.5 text-sm transition-colors"
            >
              Odhlásiť
            </button>
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
