interface Props {
  size?: number;
  label?: string;
  className?: string;
}

export function Spinner({ size = 20, label, className = "" }: Props) {
  return (
    <div role="status" className={`text-ink-muted flex items-center justify-center gap-2 text-sm ${className}`}>
      <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="var(--color-brand-500)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span>{label}</span>}
    </div>
  );
}
