import { Check, ChevronDown } from "lucide-react";
import { Select as Sl } from "radix-ui";
import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/** Select on Radix primitives (keyboard, typeahead, ARIA; ADR-067). */
export function Select({
  value,
  onChange,
  options,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** accessible name */
  label: string;
  placeholder?: string;
}) {
  return (
    <Sl.Root value={value} onValueChange={onChange}>
      <Sl.Trigger
        aria-label={label}
        className="border-line bg-surface focus-visible:ring-brand-200 inline-flex h-[34px] items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold outline-none focus-visible:ring-4"
      >
        <Sl.Value placeholder={placeholder} />
        <Sl.Icon>
          <ChevronDown size={14} className="text-ink-muted" />
        </Sl.Icon>
      </Sl.Trigger>
      <Sl.Portal>
        <Sl.Content position="popper" sideOffset={6} className="bg-surface border-line shadow-pop z-50 min-w-[var(--radix-select-trigger-width)] rounded-[10px] border p-1">
          <Sl.Viewport>
            {options.map((o) => (
              // Radix Select does not allow an empty value: "" is mapped by the caller
              <Sl.Item
                key={o.value}
                value={o.value}
                className="data-[highlighted]:bg-track relative flex h-8 cursor-pointer items-center gap-2 rounded-md pr-2 pl-7 text-[13px] outline-none select-none"
              >
                <Sl.ItemIndicator className="absolute left-2">
                  <Check size={14} />
                </Sl.ItemIndicator>
                <Sl.ItemText>{o.label}</Sl.ItemText>
              </Sl.Item>
            ))}
          </Sl.Viewport>
        </Sl.Content>
      </Sl.Portal>
    </Sl.Root>
  );
}
