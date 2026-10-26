/** Tiny line chart of a 0..1 series (read rate), with the threshold as a dashed line. */
export function Sparkline({ values, threshold, height = 48 }: { values: (number | null)[]; threshold?: number; height?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <p className="text-ink-muted text-xs">Zatiaľ málo dát.</p>;
  const w = 260;
  const min = Math.min(0.8, ...pts.map((p) => p[1]));
  const max = 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => height - ((v - min) / (max - min || 1)) * (height - 4) - 2;
  const d = pts.map(([i, v], k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${String(w)} ${String(height)}`} className="h-12 w-full" role="img" aria-label="Čítanosť v čase">
      {threshold !== undefined && threshold > min && (
        <line x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} className="stroke-warn-600" strokeDasharray="4 4" strokeWidth={1} />
      )}
      <path d={d} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" />
      {last && <circle cx={x(last[0])} cy={y(last[1])} r={3} className="fill-brand-600" />}
    </svg>
  );
}
