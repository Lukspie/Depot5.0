/** Session-based authentication against the app backend. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, isApiError, sendJson } from "./client";

export type Role = "admin" | "dispatcher" | "operator" | "security" | "courier";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  /** dispatcher's work shift (phase 7b) */
  shift?: Shift | null;
}

export type Shift = "morning" | "afternoon" | "night";
export const SHIFT_LABEL: Record<Shift, string> = { morning: "ranná", afternoon: "poobedná", night: "nočná" };

export const ME_KEY = ["auth", "me"] as const;

/** Current user, or null when not logged in (401 is not an error here). */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await getJson<User>("/api/auth/me");
      } catch (err) {
        if (isApiError(err, 401)) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      sendJson<User>("POST", "/api/auth/login", body),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(ME_KEY, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<void>("POST", "/api/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}
