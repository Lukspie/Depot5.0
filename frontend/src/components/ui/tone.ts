/** Semantic tones shared by the UI kit (design system v2: *-100 background, *-600 dot, *-700 text). */

export type Tone = "ok" | "info" | "warn" | "danger" | "neutral" | "brand";

export const TONE_BADGE: Record<Tone, string> = {
  ok: "bg-ok-100 text-ok-700",
  info: "bg-info-100 text-info-700",
  warn: "bg-warn-100 text-warn-700",
  danger: "bg-danger-100 text-danger-700",
  neutral: "bg-neutral-100 text-neutral-700",
  brand: "bg-brand-50 text-brand-800",
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
  ok: "text-ok-700",
  info: "text-info-700",
  warn: "text-warn-700",
  danger: "text-danger-700",
  neutral: "text-neutral-700",
  brand: "text-brand-700",
};

/** CSS colour of a tone's dot / line (SVG strokes, inline styles). */
export const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-ok-600)",
  info: "var(--color-info-600)",
  warn: "var(--color-warn-600)",
  danger: "var(--color-danger-600)",
  neutral: "var(--color-neutral-600)",
  brand: "var(--color-brand-500)",
};

/** Joins class names, skipping empty ones. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
