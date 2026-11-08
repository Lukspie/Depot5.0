import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./tone";

type Variant = "primary" | "brand" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = black (the main action), brand = orange (accent action in the shadow) */
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  brand: "bg-brand-500 text-on-brand hover:bg-brand-600",
  secondary: "bg-surface border-line text-ink border hover:bg-subtle",
  ghost: "text-ink-muted hover:bg-track hover:text-ink",
  danger: "bg-danger-600 text-white hover:opacity-90",
};

const SIZE = {
  sm: "h-7 gap-1.5 rounded-[7px] px-2.5 text-xs",
  md: "h-[34px] gap-[7px] rounded-lg px-3 text-[13px]",
  lg: "h-11 gap-2 rounded-[10px] px-5 text-sm",
};

/** Button of design system v2: 34 px high, radius 8, semibold; black primary, white secondary. */
export function Button({ variant = "primary", size = "md", icon, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "focus-visible:ring-brand-200 inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
