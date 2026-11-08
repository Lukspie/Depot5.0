import { Gauge } from "lucide-react";
import type { CheckpointView } from "../../api/line";
import { Badge, KeyValue, SidePanel } from "../../components/ui";
import { num, pct } from "../../lib/format";
import type { LineVariant } from "../layout";
import { SHADOW_PANEL } from "./placement";

const KIND: Record<string, string> = {
  scanner: "Skener linky",
  tunnel: "Skenovací tunel",
  counter: "Počítadlo",
  input: "Počítadlo vstupu",
  exit: "Počítadlo výstupu",
  decode: "Dekódovacie miesto",
  staging: "Koniec pásu",
};

/** A checkpoint of the sorting line (ADR-071): throughput, read rate, unread, queue at decoding. */
export function CheckpointPanel({ code, view, variant, onClose }: { code: string; view: CheckpointView | undefined; variant: LineVariant; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ["Priepustnosť (posledná hodina)", view ? `${num(view.perHour)} /h` : "—"],
    ["Dnes spolu", view ? num(view.today) : "—"],
  ];
  if (view?.kind === "scanner" || view?.kind === "tunnel") {
    rows.push(["Čítanosť (posledná hodina)", pct(view.readRate)], ["Nečítané dnes", num(view.unread)]);
  }
  if (view?.queue !== null && view?.queue !== undefined) rows.push(["Fronta na dekódovanie", `${num(view.queue)} ks`]);
  return (
    <SidePanel
      open
      onClose={onClose}
      inset={SHADOW_PANEL}
      icon={<Gauge size={22} />}
      eyebrow={`Kontrolný bod · ${KIND[view?.kind ?? ""] ?? "linka"}`}
      title={view?.label ?? code}
      subtitle={code}
    >
      <div className="mb-2">
        <Badge tone={variant === "proposal" ? "info" : "ok"}>{variant === "proposal" ? "návrh Depot 5.0 (simulácia)" : "súčasný stav"}</Badge>
      </div>
      <KeyValue rows={rows} />
      <p className="text-ink-muted mt-3 text-xs leading-snug">
        Prechody balíkov počíta simulátor z dĺžky a rýchlosti pásov. V súčasnom stave sa ukladajú do časovej osi balíka, návrh sa len počíta.
      </p>
    </SidePanel>
  );
}
