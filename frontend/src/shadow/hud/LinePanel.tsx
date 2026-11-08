import { Workflow } from "lucide-react";
import type { LineView, VariantKpis } from "../../api/line";
import { SegmentedTabs, cn } from "../../components/ui";
import { num } from "../../lib/format";
import type { LineVariant } from "../layout";

interface Row {
  label: string;
  value: (k: VariantKpis) => number | null;
  format: (v: number) => string;
  /** a lower value is better */
  lower: boolean;
}

const ROWS: Row[] = [
  { label: "Priepustnosť (špička)", value: (k) => k.peakPerHour, format: (v) => `${num(v)} /h`, lower: false },
  { label: "Nečítané na prvý raz", value: (k) => k.unread, format: num, lower: true },
  { label: "Vstup → odkladacia plocha", value: (k) => k.avgMinutes, format: (v) => `${v.toLocaleString("sk-SK")} min`, lower: true },
  { label: "Ručné manipulácie", value: (k) => k.manual, format: num, lower: true },
];

/**
 * The sorting line with the roof open (phase 7d step 5d): the variant shown in the scene and the
 * comparison of the current state with the Depot 5.0 proposal over the whole operating day. The
 * proposal is computed from the same parcels (what-if), it never touches the data of the depot.
 */
export function LinePanel({ view, variant, onVariant, hasProposal }: { view: LineView | undefined; variant: LineVariant; onVariant: (v: LineVariant) => void; hasProposal: boolean }) {
  const cur = view?.compare.current;
  const pro = view?.compare.proposal;
  return (
    <div className="bg-surface border-line shadow-card w-full rounded-2xl border p-4 md:w-[340px]">
      <div className="flex items-center gap-2.5">
        <span className="bg-brand-50 text-brand-700 grid h-8 w-8 shrink-0 place-items-center rounded-[10px]">
          <Workflow size={17} />
        </span>
        <span className="text-[15px] font-bold">Triediaca linka</span>
      </div>
      {hasProposal && (
        <SegmentedTabs
          className="mt-3"
          label="Variant linky"
          items={[
            { id: "current", label: "Súčasný stav" },
            { id: "proposal", label: "Návrh Depot 5.0" },
          ]}
          active={variant}
          onChange={onVariant}
        />
      )}
      {cur && cur.parcels > 0 ? (
        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="text-ink-muted text-left text-[11.5px]">
              <th className="pb-1 font-semibold" />
              <th className="pb-1 text-right font-semibold">Súčasný</th>
              {pro && <th className="pb-1 text-right font-semibold">Návrh</th>}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const a = r.value(cur);
              const b = pro ? r.value(pro) : null;
              // within 2 % it is the same (the proposal moves the same parcels)
              const same = a !== null && b !== null && Math.abs(b - a) <= Math.max(Math.abs(a), 1) * 0.02;
              const better = !same && a !== null && b !== null && (r.lower ? b < a : b > a);
              const worse = !same && a !== null && b !== null && (r.lower ? b > a : b < a);
              return (
                <tr key={r.label} className="border-line border-t">
                  <td className="text-ink-muted py-1.5 pr-2">{r.label}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", variant === "current" && "font-bold")}>{a === null ? "—" : r.format(a)}</td>
                  {pro && (
                    <td className={cn("py-1.5 text-right tabular-nums", variant === "proposal" && "font-bold", better && "text-ok-700", worse && "text-danger-700")}>
                      {b === null ? "—" : r.format(b)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-ink-muted mt-3 text-[13px]">Linka dnes ešte nemá balíky.</p>
      )}
      <p className="text-ink-muted mt-2 text-[11.5px] leading-snug">
        {cur ? `${num(cur.parcels)} balíkov celého prevádzkového dňa` : ""}
        {pro ? " · návrh počíta s tými istými balíkmi (simulácia, dáta skladu nemení), ručne len štítky, ktoré tunel neprečíta" : ""}
      </p>
    </div>
  );
}
