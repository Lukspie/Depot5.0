/** Depot 5.0 mark in the current theme colour (a parcel). */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--color-brand-500)" />
      <path d="M8 12l8-4 8 4v9l-8 4-8-4z" fill="var(--color-brand-100)" />
      <path d="M8 12l8 4 8-4M16 16v9" stroke="var(--color-brand-600)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
