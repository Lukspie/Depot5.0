import { X } from "lucide-react";
import { Dialog as Dg } from "radix-ui";
import type { ReactNode } from "react";

/** Modal dialog on Radix primitives (focus trap, Esc, ARIA; ADR-067). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dg.Root open={open} onOpenChange={onOpenChange}>
      <Dg.Portal>
        <Dg.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dg.Content className="bg-surface border-line shadow-float fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 outline-none">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dg.Title className="text-base font-bold">{title}</Dg.Title>
              {description !== undefined && <Dg.Description className="text-ink-muted mt-1 text-sm">{description}</Dg.Description>}
            </div>
            <Dg.Close aria-label="Zavrieť" className="text-ink-muted hover:bg-track rounded-lg p-1.5">
              <X size={16} />
            </Dg.Close>
          </div>
          {children}
          {footer !== undefined && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </Dg.Content>
      </Dg.Portal>
    </Dg.Root>
  );
}
