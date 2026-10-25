import type { ReactNode } from "react";

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
  /** small count next to the label, e.g. "4/6" */
  count?: ReactNode;
}

interface Props<K extends string> {
  items: TabItem<K>[];
  active: K;
  onChange: (id: K) => void;
  className?: string;
}

/** Pill tabs in a grey track; the active tab is a white chip (reference style). */
export function Tabs<K extends string>({ items, active, onChange, className = "" }: Props<K>) {
  return (
    <div role="tablist" className={`bg-neutral-100 no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-xl p-1 ${className}`}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
            t.id === active ? "bg-surface text-ink font-medium shadow-sm" : "text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="text-brand-700 ml-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
