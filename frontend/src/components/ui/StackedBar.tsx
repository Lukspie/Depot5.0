export interface BarSegment {
  value: number;
  /** CSS colour, e.g. "var(--color-brand-500)" */
  color: string;
  label: string;
}

interface Props {
  segments: BarSegment[];
  /** length of the bar relative to the longest one in the list, 0–1 */
  scale?: number;
  height?: number;
}

/** Horizontal stacked bar (parcels per direction: loaded / staged / waiting). */
export function StackedBar({ segments, scale = 1, height = 12 }: Props) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const title = segments.map((s) => `${s.label} ${String(s.value)}`).join(" · ");
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className="bg-canvas flex overflow-hidden rounded-[4px]"
      style={{ height, width: `${String(Math.max(0, Math.min(1, scale)) * 100)}%` }}
    >
      {total > 0 &&
        segments.map((s) => <span key={s.label} className="h-full" style={{ width: `${String((s.value / total) * 100)}%`, background: s.color }} />)}
    </span>
  );
}
