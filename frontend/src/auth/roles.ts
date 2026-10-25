/** Role labels and which screens each role may open (mirrors the backend RBAC). */

import type { Role } from "../api/auth";

export const ROLES: Role[] = ["admin", "dispatcher", "operator", "security", "courier"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrátor",
  dispatcher: "Dispečer",
  operator: "Operátor nakládky",
  security: "Ochranka",
  courier: "Kuriér",
};

export const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-brand-100 text-brand-700",
  dispatcher: "bg-sky-100 text-sky-600",
  operator: "bg-mint-100 text-mint-600",
  security: "bg-peach-100 text-peach-600",
  courier: "bg-canvas text-ink-muted",
};

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
  /** false = screen arrives in a later phase */
  ready: boolean;
}

const ALL: Role[] = ROLES;

export const NAV: NavItem[] = [
  { to: "/", label: "Stav systému", roles: ALL, ready: true },
  { to: "/twin", label: "Digitálne dvojča", roles: ["dispatcher", "admin", "security"], ready: false },
  { to: "/fleet", label: "Flotila", roles: ["dispatcher"], ready: false },
  { to: "/loading", label: "Nakládka", roles: ["operator"], ready: false },
  { to: "/gate", label: "Brána", roles: ["security"], ready: false },
  { to: "/courier", label: "Moje zastávky", roles: ["courier"], ready: false },
  { to: "/admin", label: "Administrácia", roles: ["admin"], ready: true },
];
