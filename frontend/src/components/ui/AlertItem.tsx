import type { ReactNode } from "react";
import { cn, TONE_BADGE, type Tone } from "./tone";

const BAR: Record<Tone, string> = {
  ok: "bg-ok-600",
  info: "bg-info-600",
  warn: "bg-warn-600",
  danger: "bg-danger-600",
  neutral: "bg-neutral-600",
  brand: "bg-brand-500",
};

export interface AlertAction {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

interface Props {
  tone: Tone;
  /** type of the alert, e.g. "Kaskáda meškania" */
  type: string;
  /** "23:51 · ML predikcia" */
  meta?: ReactNode;
  /** one sentence */
  title: ReactNode;
  /** facts as chips: "nočný BB príde 05:36", "odchod 05:45 → 06:06" */
  facts?: string[];
  primary?: AlertAction;
  secondary?: AlertAction;
}

function ActionButton({ action, primary }: { action: AlertAction; primary: boolean }) {
  const cls = cn(
    "focus-visible:ring-brand-200 inline-flex h-7 items-center rounded-[7px] px-2.5 text-xs font-semibold whitespace-nowrap no-underline outline-none focus-visible:ring-2 disabled:opacity-50",
    primary ? "bg-primary text-on-primary hover:bg-primary-hover" : "border-line text-ink hover:bg-subtle border",
  );
  if (action.href) {
    return (
      <a href={action.href} className={cls}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled} className={cls}>
      {action.label}
    </button>
  );
}

/** Structured alert: coloured bar, type, time, one-sentence title, facts as chips, actions. */
export function AlertItem({ tone, type, meta, title, facts = [], primary, secondary }: Props) {
  return (
    <div className="border-line-soft flex gap-3 border-b px-4 py-3.5 last:border-b-0">
      <span className={cn("w-1 shrink-0 self-stretch rounded-sm", BAR[tone])} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
          <span className={cn("rounded-[5px] px-[7px] py-px font-bold whitespace-nowrap", TONE_BADGE[tone])}>{type}</span>
          {meta !== undefined && <span className="text-ink-muted truncate">{meta}</span>}
        </div>
        <div className="text-[13.5px] leading-snug font-bold">{title}</div>
        {facts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {facts.map((f) => (
              <span key={f} className="text-ink-soft bg-canvas rounded-md border border-[#ebeae6] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap">
                {f}
              </span>
            ))}
          </div>
        )}
        {(primary || secondary) && (
          <div className="mt-0.5 flex gap-2">
            {primary && <ActionButton action={primary} primary />}
            {secondary && <ActionButton action={secondary} primary={false} />}
          </div>
        )}
      </div>
    </div>
  );
}
