import type { ReactNode } from "react";
import { cn } from "./tone";

export interface FilterChip<K extends string> {
  id: K;
  label: ReactNode;
  count?: number;
  /** highlight a chip that needs attention (e.g. "S rizikom 3") */
  accent?: boolean;
}

interface Props<K extends string> {
  items: FilterChip<K>[];
  active: K;
  onChange: (id: K) => void;
  label?: string;
}

/** Row of pill filters; the active one is black (design system v2). */
export function FilterChips<K extends string>({ items, active, onChange, label }: Props<K>) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar flex max-w-full gap-1.5 overflow-x-auto">
      {items.map((c) => {
        const on = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              "focus-visible:ring-brand-200 h-[26px] shrink-0 rounded-full border px-2.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2",
              on
                ? "bg-primary border-primary text-on-primary font-semibold"
                : c.accent
                  ? "border-brand-200 bg-brand-50 text-brand-800 font-bold"
                  : "border-line bg-surface hover:text-ink font-semibold text-neutral-700",
            )}
          >
            {c.label}
            {c.count !== undefined && <span className="ml-1 tabular-nums">{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
