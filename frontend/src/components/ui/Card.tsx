import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** right side of the header (buttons, badge) */
  actions?: ReactNode;
  children?: ReactNode;
  /** no inner padding (tables, maps edge to edge) */
  flush?: boolean;
  className?: string;
}

/** White floating card with a soft shadow; optional header. */
export function Card({ title, subtitle, actions, children, flush = false, className = "" }: Props) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className={`bg-surface shadow-card rounded-card min-w-0 ${className}`}>
      {hasHeader && (
        <header className={`flex items-start justify-between gap-3 ${flush ? "border-line border-b px-5 py-4" : "px-5 pt-5"}`}>
          <div className="min-w-0">
            {title !== undefined && <h2 className="truncate font-semibold">{title}</h2>}
            {subtitle !== undefined && <p className="text-ink-muted truncate text-sm">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : hasHeader ? "px-5 pt-4 pb-5" : "p-5"}>{children}</div>
    </section>
  );
}
