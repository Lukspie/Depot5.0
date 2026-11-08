import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** Page title 24/800 with a grey context line and actions on the right (design system v2). */
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <h1 className="truncate text-2xl font-extrabold tracking-[-0.01em]">{title}</h1>
        {subtitle !== undefined && <p className="text-ink-muted mt-1 text-[13px]">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
