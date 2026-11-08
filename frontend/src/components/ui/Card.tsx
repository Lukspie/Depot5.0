import type { ReactNode } from "react";
import { cn } from "./tone";

interface Props {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** right side of the header (tabs, filters, buttons) */
  actions?: ReactNode;
  children?: ReactNode;
  /** no inner padding (tables, lists, maps edge to edge); the header gets a divider */
  flush?: boolean;
  className?: string;
  /** accessible name of the section when the title is not plain text */
  label?: string;
}

/** White card: 1 px border, radius 12, hairline shadow (design system v2); optional header. */
export function Card({ title, subtitle, actions, children, flush = false, className, label }: Props) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section aria-label={label} className={cn("bg-surface border-line shadow-card rounded-card min-w-0 border", flush && "overflow-hidden", className)}>
      {hasHeader && (
        <header className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4", flush ? "border-line-soft border-b py-3.5" : "pt-3.5")}>
          <div className="min-w-0">
            {title !== undefined && <h2 className="truncate text-[15px] font-bold">{title}</h2>}
            {subtitle !== undefined && <p className="text-ink-muted truncate text-xs">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : hasHeader ? "px-4 pt-3 pb-4" : "p-4"}>{children}</div>
    </section>
  );
}
