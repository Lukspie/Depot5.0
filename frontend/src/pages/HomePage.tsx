import { Navigate } from "react-router";
import { useMe } from "../api/auth";
import { canAccess, homeOf } from "../auth/roles";
import { DashboardPage } from "./DashboardPage";

/** "/" is the dispatcher dashboard; other roles are sent to their own start screen. */
export function HomePage() {
  const me = useMe();
  if (!me.data) return null;
  if (canAccess(me.data.role, ["dispatcher"])) return <DashboardPage />;
  return <Navigate to={homeOf(me.data.role)} replace />;
}
