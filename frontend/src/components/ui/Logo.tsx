import { Package } from "lucide-react";

/** Depot 5.0 mark: a parcel on a square in the theme colour (design system v2). */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="bg-brand-500 text-on-brand grid shrink-0 place-items-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Package size={Math.round(size * 0.53)} strokeWidth={2} />
    </span>
  );
}
