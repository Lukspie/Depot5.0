/**
 * The depot the user is looking at (phase 7d, ADR-068): `?depot=` in the address, else the last
 * choice remembered in this browser, else the user's home depot. Only depots the backend allows
 * (`/api/auth/me` → depots); the backend checks again on every request.
 */

import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { useMe } from "../api/auth";

const KEY = "depotrack.depot";

function remembered(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private window)
  }
}

export function useDepot(): { code: string | null; canSwitch: boolean; setDepot: (code: string) => void } {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const user = me.data;
  const allowed = user?.depots ?? [];
  const wanted = params.get("depot") ?? remembered();
  const code = wanted && allowed.includes(wanted) ? wanted : (user?.home_depot ?? null);
  const setDepot = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        // not remembered, still switched
      }
      setParams(
        (p) => {
          const out = new URLSearchParams(p);
          out.set("depot", next);
          // a door, device or plate of the previous depot does not exist in the new one
          for (const k of ["door", "device", "plate", "view"]) out.delete(k);
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return { code, canSwitch: user?.can_switch_depot ?? false, setDepot };
}
