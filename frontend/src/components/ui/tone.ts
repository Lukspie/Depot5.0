/** Semantic tones shared by Badge, StatusDot, Progress, KpiCard. */

export type Tone = "ok" | "info" | "warn" | "danger" | "neutral" | "brand";

export const TONE_BADGE: Record<Tone, string> = {
  ok: "bg-ok-100 text-ok-600",
  info: "bg-info-100 text-info-600",
  warn: "bg-warn-100 text-warn-600",
  danger: "bg-danger-100 text-danger-600",
  neutral: "bg-neutral-100 text-neutral-600",
  brand: "bg-brand-100 text-brand-700",
};

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-ok-600",
  info: "bg-info-600",
  warn: "bg-warn-600",
  danger: "bg-danger-600",
  neutral: "bg-neutral-600",
  brand: "bg-brand-500",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok-600",
  info: "text-info-600",
  warn: "text-warn-600",
  danger: "text-danger-600",
  neutral: "text-neutral-600",
  brand: "text-brand-700",
};
