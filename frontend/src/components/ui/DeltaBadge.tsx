import type { ReactNode } from "react";
import { cn, TONE_BADGE, type Tone } from "./tone";

/** Small tinted change next to a number: `+4 min`, `−1 min`, `+186`, `24 %`. */
export function DeltaBadge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-px text-[11px] font-bold whitespace-nowrap tabular-nums", TONE_BADGE[tone])}>
      {children}
    </span>
  );
}
