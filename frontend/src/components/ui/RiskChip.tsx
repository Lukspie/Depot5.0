import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn, TONE_BADGE, type Tone } from "./tone";

/** Risk of a trip in a table cell: warning icon + short label (`Kaskáda`, `Skener`). */
export function RiskChip({ tone = "warn", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-md px-[7px] text-[11.5px] font-bold whitespace-nowrap", TONE_BADGE[tone])}>
      <TriangleAlert size={13} strokeWidth={2.25} aria-hidden="true" />
      {children}
    </span>
  );
}
