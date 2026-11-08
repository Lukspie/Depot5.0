import type { ReactNode } from "react";
import { cn } from "./tone";

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
  /** small count next to the label, e.g. "8", "4/6" */
  count?: ReactNode;
}

interface Props<K extends string> {
  items: TabItem<K>[];
  active: K;
  onChange: (id: K) => void;
  className?: string;
  size?: "sm" | "md";
  /** accessible name of the tab list */
  label?: string;
}

/** Segmented control: grey track, the active segment is a white chip (design system v2). */
export function SegmentedTabs<K extends string>({ items, active, onChange, className, size = "md", label }: Props<K>) {
  return (
    <div role="tablist" aria-label={label} className={cn("bg-track no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg p-[3px]", className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cn(
            "focus-visible:ring-brand-200 rounded-md px-2.5 whitespace-nowrap outline-none focus-visible:ring-2",
            size === "sm" ? "h-6 text-xs" : "h-[26px] text-[12.5px]",
            t.id === active ? "bg-surface text-ink font-bold shadow-[0_1px_2px_rgb(29_29_27/0.12)]" : "font-semibold text-neutral-700 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The tabs of the earlier pages use the same segmented look. */
export const Tabs = SegmentedTabs;
