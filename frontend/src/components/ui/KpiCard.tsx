import type { ReactNode } from "react";
import { DeltaBadge } from "./DeltaBadge";
import { Sparkline } from "./Sparkline";
import { cn, TONE_BADGE, TONE_DOT, type Tone } from "./tone";

interface Props {
  label: string;
  value: ReactNode;
  /** grey unit after the number, e.g. "/ 1 989", "%" */
  unit?: ReactNode;
  /** colour of the small square before the label and of the sparkline */
  tone?: Tone;
  /** history for the sparkline (oldest first) */
  spark?: number[];
  /** small tinted change, e.g. "+186", "↓ 1,6", "LD-02" */
  delta?: { value: string; tone: Tone };
  /** grey context after the change, e.g. "495 čaká na triedenie" */
  context?: ReactNode;
  /** icon square instead of the marker (compact cards floating over the 3D scene) */
  icon?: ReactNode;
}

/**
 * KPI card of design system v2: marker + label, big number with a unit, sparkline, change and
 * context. With `icon` the compact variant used over the digital shadow.
 */
export function KpiCard({ label, value, unit, tone = "brand", spark, delta, context, icon }: Props) {
  if (icon !== undefined) {
    return (
      <div className="bg-surface border-line shadow-card rounded-card flex min-w-0 items-center gap-3 border px-3.5 py-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]", TONE_BADGE[tone])}>{icon}</div>
        <div className="min-w-0">
          <div className="text-ink-muted truncate text-xs font-medium">{label}</div>
          <div className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-[22px] leading-tight font-extrabold tracking-tight tabular-nums">{value}</span>
            {unit !== undefined && <span className="text-ink-muted text-xs font-semibold">{unit}</span>}
            {delta && <DeltaBadge tone={delta.tone}>{delta.value}</DeltaBadge>}
          </div>
          {context !== undefined && <div className="text-ink-muted truncate text-xs">{context}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-surface border-line shadow-card rounded-card flex min-w-0 flex-col gap-2 border px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
        <span className={cn("h-2 w-2 shrink-0 rounded-[2px]", TONE_DOT[tone])} />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[26px] leading-none font-extrabold tracking-tight tabular-nums">{value}</span>
          {unit !== undefined && <span className="text-ink-muted truncate text-[13px] font-semibold">{unit}</span>}
        </div>
        {spark && <Sparkline values={spark} tone={tone} label={`${label}: vývoj dňa`} />}
      </div>
      {(delta || context !== undefined) && (
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap">
          {delta && <DeltaBadge tone={delta.tone}>{delta.value}</DeltaBadge>}
          {context !== undefined && <span className="text-ink-muted truncate">{context}</span>}
        </div>
      )}
    </div>
  );
}
