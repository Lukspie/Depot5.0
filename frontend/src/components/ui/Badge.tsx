import type { ReactNode } from "react";
import { cn, TONE_BADGE, TONE_DOT, type Tone } from "./tone";

interface Props {
  tone?: Tone;
  children: ReactNode;
  /** small dot before the label */
  dot?: boolean;
  size?: "sm" | "md" | "lg";
  title?: string;
}

const SIZE = {
  sm: "rounded-[5px] px-1.5 py-px text-[11px]",
  md: "rounded-md px-2 py-0.5 text-xs",
  lg: "rounded-md px-2.5 py-1 text-[13px]",
};

/** Tinted label (type of an alert, a count, a state). Never wraps (docs/design/komponenty.md). */
export function Badge({ tone = "neutral", children, dot = false, size = "md", title }: Props) {
  return (
    <span title={title} className={cn("inline-flex shrink-0 items-center gap-1.5 font-bold whitespace-nowrap", SIZE[size], TONE_BADGE[tone])}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}
