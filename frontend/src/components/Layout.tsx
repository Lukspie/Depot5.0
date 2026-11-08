import { Outlet, useLocation } from "react-router";
import { useMe } from "../api/auth";
import { useDepots } from "../api/depots";
import { pageTitle } from "../auth/roles";
import { useDepot } from "../hooks/useDepot";
import { AppHeader } from "./AppHeader";
import { MobileNav, Sidebar } from "./Sidebar";
import { SituationLoader } from "./SituationLoader";

/**
 * Application shell of design system v2: side navigation, top bar (AppHeader) and the page.
 * The digital shadow follows its own mockup (docs/design/maketa-tien): navigation collapsed to a
 * 72 px strip, no top bar, the scene over the whole remaining area.
 */
export function Layout() {
  const me = useMe();
  const { pathname } = useLocation();
  const depots = useDepots();
  const shadow = pathname.startsWith("/shadow");
  const user = me.data;
  // the depot shown: address, last choice or the user's home depot (ADR-068)
  const { code } = useDepot();
  const depot = depots.data?.find((d) => d.code === code);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {user && <Sidebar user={user} depot={depot} collapsed={shadow} />}
      <div className={`flex min-w-0 flex-1 flex-col ${shadow ? "md:h-screen" : ""}`}>
        {user && <MobileNav user={user} />}
        {user && !shadow && <AppHeader user={user} depot={depot} title={pageTitle(pathname, user.role)} />}
        <main className={shadow ? "relative min-h-0 min-w-0 flex-1 md:p-4" : "min-w-0 flex-1 p-4 md:p-6"}>
          <Outlet />
          <SituationLoader />
        </main>
      </div>
    </div>
  );
}
