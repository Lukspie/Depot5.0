import { hhmm } from "../../lib/format";

export interface TimelineSegment {
  name: string;
  start: Date;
  end: Date;
  /** CSS colour */
  color: string;
}

interface Props {
  /** start of the operating day (15:00); the axis covers 24 h */
  dayStart: Date;
  segments: TimelineSegment[];
  now: Date | null;
  /** hours between the tick labels */
  tickHours?: number;
}

const DAY_MS = 24 * 3600_000;

/** Operating day 15:00 → 15:00 with waves and departures as bars and a "teraz" mark. */
export function DayTimeline({ dayStart, segments, now, tickHours = 3 }: Props) {
  const at = (t: Date) => Math.max(0, Math.min(100, ((t.getTime() - dayStart.getTime()) / DAY_MS) * 100));
  const ticks = Array.from({ length: 24 / tickHours + 1 }, (_, i) => new Date(dayStart.getTime() + i * tickHours * 3600_000));
  const nowAt = now ? at(now) : null;
  return (
    <div className="relative h-14" role="img" aria-label={`Prevádzkový deň od ${hhmm(dayStart)}${now ? `, teraz ${hhmm(now)}` : ""}`}>
      <div className="bg-canvas absolute inset-x-0 top-[18px] h-4 rounded-[5px]" />
      {segments.map((s) => (
        <div
          key={s.name}
          title={`${s.name} ${hhmm(s.start)}–${hhmm(s.end)}`}
          className="absolute top-[18px] h-4 rounded-[5px]"
          style={{ left: `${String(at(s.start))}%`, width: `${String(Math.max(0.6, at(s.end) - at(s.start)))}%`, background: s.color }}
        />
      ))}
      {nowAt !== null && now && (
        <>
          <div className="bg-ink absolute top-2 bottom-3.5 w-0.5 rounded-[1px]" style={{ left: `${String(nowAt)}%` }} />
          <span
            className="bg-surface text-ink absolute -top-1.5 -translate-x-1/2 px-[3px] text-[10.5px] font-extrabold whitespace-nowrap"
            style={{ left: `${String(nowAt)}%` }}
          >
            teraz {hhmm(now)}
          </span>
        </>
      )}
      {ticks.map((t) => (
        <span key={t.getTime()} className="text-ink-faint absolute bottom-0 -translate-x-1/2 text-[10.5px] font-semibold" style={{ left: `${String(at(t))}%` }}>
          {hhmm(t).slice(0, 2)}
        </span>
      ))}
    </div>
  );
}
