import { Popover as Pp, Tooltip as Tt } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./tone";

/** Popover on Radix primitives (focus trap, Esc, outside click; ADR-067). */
export function Popover({
  trigger,
  children,
  align = "end",
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Pp.Root open={open} onOpenChange={onOpenChange}>
      <Pp.Trigger asChild>{trigger}</Pp.Trigger>
      <Pp.Portal>
        <Pp.Content align={align} sideOffset={8} className={cn("bg-surface border-line shadow-pop z-50 rounded-xl border outline-none", className)}>
          {children}
        </Pp.Content>
      </Pp.Portal>
    </Pp.Root>
  );
}

/** Hover / focus label (icon buttons of the collapsed navigation, the camera column). */
export function Tooltip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tt.Provider delayDuration={250}>
      <Tt.Root>
        <Tt.Trigger asChild>{children}</Tt.Trigger>
        <Tt.Portal>
          <Tt.Content side={side} sideOffset={8} className="bg-ink z-50 rounded-md px-2 py-1 text-xs font-semibold text-white">
            {label}
          </Tt.Content>
        </Tt.Portal>
      </Tt.Root>
    </Tt.Provider>
  );
}
