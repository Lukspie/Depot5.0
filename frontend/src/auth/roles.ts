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
  /** group in the side navigation (design system v2) */
  section: "ops" | "system";
  /** a different label for some roles, e.g. the courier's own stops */
  labelFor?: Partial<Record<Role, string>>;
}

const ALL: Role[] = ROLES;

/** Admin may open every screen (ADR-017); `roles` lists the other roles. */
export function canAccess(role: Role, roles: Role[]): boolean {
  return role === "admin" || roles.includes(role);
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dispečing", roles: ["dispatcher"], ready: true, section: "ops" },
  { to: "/shadow", label: "Digitálny tieň", roles: ["dispatcher", "security"], ready: true, section: "ops" },
  { to: "/fleet", label: "Flotila", roles: ["dispatcher"], ready: true, section: "ops" },
  { to: "/loading", label: "Nakládka", roles: ["operator"], ready: true, section: "ops" },
  { to: "/gate", label: "Brána", roles: ["security"], ready: true, section: "ops" },
  { to: "/courier", label: "Kuriéri", roles: ["courier", "dispatcher"], ready: true, section: "ops", labelFor: { courier: "Moje zastávky" } },
  { to: "/admin", label: "Administrácia", roles: [], ready: true, section: "system" },
  { to: "/system", label: "Stav systému", roles: ALL, ready: true, section: "system" },
];

export function navLabel(item: NavItem, role: Role): string {
  return item.labelFor?.[role] ?? item.label;
}

/** Title of the current page for the breadcrumb in the top bar. */
export function pageTitle(pathname: string, role: Role): string {
  if (pathname.startsWith("/parcels/")) return "Detail balíka";
  const item = NAV.filter((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];
  return item ? navLabel(item, role) : "";
}

/** Landing page of a role: "/" is the dispatcher dashboard, others start on their own screen. */
export function homeOf(role: Role): string {
  const first = NAV.find((n) => n.ready && canAccess(role, n.roles));
  return first?.to ?? "/system";
}
