import type { ReactNode } from "react";
import { TONE_TEXT, type Tone } from "./tone";

interface Props {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  /** small change next to the value, e.g. "+15" */
  delta?: { value: string; tone: Tone };
  /** grey context line under the value, e.g. "palety · WH-01" */
  context?: ReactNode;
  tone?: Tone;
}

const ICON_BG: Record<Tone, string> = {
  ok: "bg-ok-100 text-ok-600",
  info: "bg-info-100 text-info-600",
  warn: "bg-warn-100 text-warn-600",
  danger: "bg-danger-100 text-danger-600",
  neutral: "bg-neutral-100 text-neutral-600",
  brand: "bg-brand-100 text-brand-700",
};

/** KPI tile as in the reference: icon square, label, big number, delta, context. */
export function KpiCard({ icon, label, value, delta, context, tone = "brand" }: Props) {
  return (
    <div className="bg-surface shadow-card rounded-card flex min-w-0 items-center gap-4 p-4">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${ICON_BG[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-ink-muted truncate text-sm">{label}</div>
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-2xl leading-tight font-bold tabular-nums">{value}</span>
          {delta && <span className={`text-sm font-medium ${TONE_TEXT[delta.tone]}`}>{delta.value}</span>}
        </div>
        {context !== undefined && <div className="text-ink-muted truncate text-xs">{context}</div>}
      </div>
    </div>
  );
}
