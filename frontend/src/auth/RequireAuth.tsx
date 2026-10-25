import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useMe, type Role } from "../api/auth";
import { ForbiddenPage } from "../pages/ForbiddenPage";
import { CenteredMessage } from "../components/CenteredMessage";
import { canAccess } from "./roles";

interface Props {
  children: ReactNode;
  /** omit to allow every logged-in user */
  roles?: Role[];
}

/** Guards a route: login required, optionally restricted to roles (the backend enforces it too). */
export function RequireAuth({ children, roles }: Props) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return <CenteredMessage>Načítavam…</CenteredMessage>;
  }
  if (me.isError) {
    return (
      <CenteredMessage tone="error">
        Server je nedostupný. Skúste obnoviť stránku o chvíľu.
      </CenteredMessage>
    );
  }
  if (me.data === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !canAccess(me.data.role, roles)) {
    return <ForbiddenPage />;
  }
  return <>{children}</>;
}
