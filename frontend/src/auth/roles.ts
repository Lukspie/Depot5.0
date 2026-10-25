/** Role labels and which screens each role may open (mirrors the backend RBAC). */

import type { Role } from "../api/auth";
import type { Tone } from "../components/ui";

export const ROLES: Role[] = ["admin", "dispatcher", "operator", "security", "courier"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrátor",
  dispatcher: "Dispečer",
  operator: "Operátor nakládky",
  security: "Ochranka",
  courier: "Kuriér",
};

export const ROLE_TONE: Record<Role, Tone> = {
  admin: "brand",
  dispatcher: "info",
  operator: "ok",
  security: "warn",
  courier: "neutral",
};

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
  /** false = screen arrives in a later phase */
  ready: boolean;
}

const ALL: Role[] = ROLES;

/** Admin may open every screen (ADR-017); `roles` lists the other roles. */
export function canAccess(role: Role, roles: Role[]): boolean {
  return role === "admin" || roles.includes(role);
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dispečing", roles: ["dispatcher"], ready: true },
  { to: "/twin", label: "Digitálne dvojča", roles: ["dispatcher", "security"], ready: true },
  { to: "/fleet", label: "Flotila", roles: ["dispatcher"], ready: true },
  { to: "/loading", label: "Nakládka", roles: ["operator"], ready: true },
  { to: "/gate", label: "Brána", roles: ["security"], ready: false },
  { to: "/courier", label: "Moje zastávky", roles: ["courier"], ready: false },
  { to: "/admin", label: "Administrácia", roles: [], ready: true },
  { to: "/system", label: "Stav systému", roles: ALL, ready: true },
];

/** Landing page of a role: "/" is the dispatcher dashboard, others start on their own screen. */
export function homeOf(role: Role): string {
  const first = NAV.find((n) => n.ready && canAccess(role, n.roles));
  return first?.to ?? "/system";
}
