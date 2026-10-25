import { TONE_DOT, type Tone } from "./tone";

interface Props {
  value: number;
  max: number;
  tone?: Tone;
  /** show "value/max" (or a custom label) next to the bar */
  label?: string | boolean;
  className?: string;
}

/** Thin progress bar with an optional "3/6" label, as in the reference tables. */
export function Progress({ value, max, tone = "ok", label = false, className = "" }: Props) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const text = label === true ? `${String(value)}/${String(max)}` : label || null;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <div
        className="bg-neutral-100 h-1.5 min-w-10 flex-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
      >
        <div className={`h-full rounded-full ${TONE_DOT[tone]}`} style={{ width: `${String(pct)}%` }} />
      </div>
      {text && <span className="text-ink-muted shrink-0 text-xs whitespace-nowrap tabular-nums">{text}</span>}
    </div>
  );
}
