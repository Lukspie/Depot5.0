import type { ReactNode } from "react";
import { TONE_DOT, TONE_TEXT, type Tone } from "./tone";

interface Props {
  tone: Tone;
  children?: ReactNode;
  /** soft pulse, e.g. for a live device */
  pulse?: boolean;
  /** colour the label too (default: muted ink) */
  colored?: boolean;
}

/** Dot + label on one line (never wraps). */
export function StatusDot({ tone, children, pulse = false, colored = false }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${colored ? TONE_TEXT[tone] : "text-ink-muted"}`}
    >
      <span className="relative inline-flex h-2 w-2 shrink-0">
        {pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${TONE_DOT[tone]}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      </span>
      {children}
    </span>
  );
}
