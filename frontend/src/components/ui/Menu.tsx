import { DropdownMenu as Dm } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./tone";

/**
 * Dropdown menu on Radix primitives (keyboard, focus, ARIA; ADR-067), styled with our tokens.
 * Usage: <Menu trigger={<button…/>}><MenuItem onSelect={…}>Text</MenuItem></Menu>
 */
export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Dm.Root>
      <Dm.Trigger asChild>{trigger}</Dm.Trigger>
      <Dm.Portal>
        <Dm.Content
          align={align}
          side={side}
          sideOffset={6}
          className="bg-surface border-line shadow-pop z-50 min-w-48 rounded-[10px] border p-1 text-[13px]"
        >
          {children}
        </Dm.Content>
      </Dm.Portal>
    </Dm.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  disabled,
  active,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  /** marks the current choice (e.g. the selected depot) */
  active?: boolean;
}) {
  return (
    <Dm.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "data-[highlighted]:bg-track flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-50",
        active && "font-semibold",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <span className="bg-brand-500 h-1.5 w-1.5 rounded-full" aria-label="zvolené" />}
    </Dm.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dm.Label className="text-ink-faint px-2 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] uppercase">{children}</Dm.Label>;
}

export function MenuSeparator() {
  return <Dm.Separator className="bg-line-soft my-1 h-px" />;
}
