import { useId } from "react";
import { TONE_COLOR, type Tone } from "./tone";

interface Props {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  /** accessible description, e.g. "vývoj od 15:00" */
  label?: string;
}

/** Small line chart with a soft area (KPI cards). Plain SVG, no chart library (ADR-067). */
export function Sparkline({ values, tone = "brand", width = 84, height = 28, label }: Props) {
  const id = useId();
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [1 + (i / (values.length - 1)) * (width - 2), height - 3 - ((v - min) / span) * (height - 7)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = TONE_COLOR[tone];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.16" />
          <stop offset="1" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`1,${String(height - 1)} ${line} ${String(width - 1)},${String(height - 1)}`} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
