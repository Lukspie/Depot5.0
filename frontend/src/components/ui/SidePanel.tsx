import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** small coloured line above the title, e.g. "KAMIÓN · LINEHAUL" */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Detail panel floating on the right (desktop) or as a bottom sheet (mobile), like the object
 * detail in the reference. Closes with Escape.
 */
export function SidePanel({ open, onClose, eyebrow, title, subtitle, icon, actions, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside
      aria-label="Detail"
      className="bg-surface shadow-float fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl md:absolute md:inset-x-auto md:top-4 md:right-4 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-[26rem] md:rounded-2xl"
    >
      <header className="border-line sticky top-0 z-10 flex items-start gap-3 border-b bg-inherit px-5 py-4">
        {icon !== undefined && (
          <div className="bg-brand-100 text-brand-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {eyebrow !== undefined && (
            <div className="text-brand-700 truncate text-[11px] font-semibold tracking-wider uppercase">{eyebrow}</div>
          )}
          <h2 className="truncate text-lg leading-tight font-semibold">{title}</h2>
          {subtitle !== undefined && <p className="text-ink-muted truncate text-sm">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť"
            className="border-line hover:bg-canvas rounded-full border p-1.5"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </aside>
  );
}

/** "Key ……… value" rows separated by hairlines (detail panels). */
export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="border-line flex items-baseline justify-between gap-4 border-b py-2.5 last:border-0">
          <dt className="text-ink-muted shrink-0">{k}</dt>
          <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
