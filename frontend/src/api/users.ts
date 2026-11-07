/** Admin user management. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role, Shift, User } from "./auth";
import { getJson, sendJson } from "./client";

const USERS_KEY = ["admin", "users"] as const;

export interface UserCreate {
  username: string;
  full_name: string;
  role: Role;
  password: string;
  shift?: Shift | null;
}

export interface UserUpdate {
  full_name?: string;
  role?: Role;
  active?: boolean;
  password?: string;
  shift?: Shift | null;
}

export function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => getJson<User[]>("/api/admin/users"),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserCreate) => sendJson<User>("POST", "/api/admin/users", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UserUpdate & { id: number }) =>
      sendJson<User>("PATCH", `/api/admin/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}
