import type { ReactNode } from "react";

export function CenteredMessage({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <p
        className={`rounded-xl px-4 py-3 text-sm ${
          tone === "error" ? "bg-rose-100 text-rose-600" : "text-ink-muted"
        }`}
      >
        {children}
      </p>
    </div>
  );
}
