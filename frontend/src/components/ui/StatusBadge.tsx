import type { ReactNode } from "react";
import { cn, TONE_DOT, type Tone } from "./tone";

interface Props {
  tone?: Tone;
  children: ReactNode;
  /** plain = white with a border (planned, idle); tinted = coloured background (live states) */
  variant?: "plain" | "tinted";
  title?: string;
}

const TINT: Record<Tone, string> = {
  ok: "bg-ok-100 text-ok-700 border-ok-100",
  info: "bg-info-100 text-info-700 border-info-100",
  warn: "bg-warn-100 text-warn-700 border-warn-100",
  danger: "bg-danger-100 text-danger-700 border-danger-100",
  neutral: "bg-subtle text-ink-soft border-line",
  brand: "bg-brand-50 text-brand-800 border-brand-200",
};

/** State of a trip, door or device: dot + text, 22 px high, radius 6, soft border (design system v2). */
export function StatusBadge({ tone = "neutral", children, variant = "tinted", title }: Props) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold whitespace-nowrap",
        variant === "plain" ? "bg-surface text-ink-soft border-line" : TINT[tone],
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", variant === "plain" && tone === "neutral" ? "bg-line" : TONE_DOT[tone])} />
      {children}
    </span>
  );
}
