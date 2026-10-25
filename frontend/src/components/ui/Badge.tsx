import type { ReactNode } from "react";
import { TONE_BADGE, TONE_DOT, type Tone } from "./tone";

interface Props {
  tone?: Tone;
  children: ReactNode;
  /** small dot before the label */
  dot?: boolean;
  size?: "sm" | "md" | "lg";
  title?: string;
}

const SIZE = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

/** Pill-shaped status label. Never wraps (rule from docs/design/komponenty.md). */
export function Badge({ tone = "neutral", children, dot = false, size = "md", title }: Props) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${SIZE[size]} ${TONE_BADGE[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  );
}
